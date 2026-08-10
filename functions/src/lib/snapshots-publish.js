/**
 * publishSnapshot RPC — writes the public `_snapshots/{collection}` documents
 * the About page and speaking-events widget read. Ported from Site-Main
 * lib/snapshots.js + index.js :5431.
 *
 * The certification sanitizer is the security boundary here: only
 * display:true certs, only the whitelisted fields — the snapshot path must
 * never leak more than the build-time static JSON does (hidden certs,
 * descriptions, learn URLs, _updatedAt). Carried verbatim, including the
 * GeoPoint flattening fix (private {_latitude,_longitude} keys crashed the
 * About page renderer).
 */
const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function serializeValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (
    typeof value === 'object' &&
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number'
  ) {
    return { latitude: value.latitude, longitude: value.longitude };
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = serializeValue(v);
    return out;
  }
  return value;
}

function getFirst(data, keys) {
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null) return data[key];
  }
  return undefined;
}

function compactObject(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null)
  );
}

function sanitizeImageValue(value) {
  if (!value) return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(sanitizeImageValue).filter(Boolean);
  if (typeof value === 'object') {
    return compactObject({
      downloadURL: getFirst(value, ['downloadURL', 'downloadUrl']),
      url: value.url,
      src: value.src,
      link: value.link,
    });
  }
  return undefined;
}

export function sanitizeCertification(doc) {
  if (getFirst(doc, ['display', 'Display']) !== true) return null;

  return compactObject({
    id: doc.id,
    name: getFirst(doc, ['name', 'Name']),
    Name: doc.Name,
    issuer: getFirst(doc, ['issuer', 'Issuer']),
    Issuer: doc.Issuer,
    issueDate: getFirst(doc, ['issueDate', 'issue_date', 'IssueDate']),
    expDate: getFirst(doc, ['expDate', 'exp_date', 'ExpDate']),
    certState: getFirst(doc, ['certState', 'isValid', 'is_valid', 'cert_state']),
    code: getFirst(doc, ['code', 'Code']),
    verifyUrl: getFirst(doc, ['verifyUrl', 'verify_url', 'VerifyUrl']),
    image: sanitizeImageValue(getFirst(doc, ['image', 'Image', 'badge', 'Badge'])),
    credentialImage: sanitizeImageValue(
      getFirst(doc, ['credentialImage', 'CredentialImage', 'imageUrl', 'ImageUrl', 'image_url'])
    ),
    displayOrder: getFirst(doc, ['displayOrder', 'display_order', 'DisplayOrder']),
    tags: getFirst(doc, ['tags', 'Tags']),
    display: true,
  });
}

/**
 * The speaker-events equivalent, and the reason it now exists.
 *
 * `SANITIZERS` had a `certifications` entry and no `speakerevents` one, so raw
 * rows were written wholesale into `_snapshots/speakerevents` and served
 * anonymously by `GET public/snapshots/speakerevents` (TODO.md T-201). Two
 * things leaked:
 *
 *  - **Every admin's email address.** `upsertSpeakerEvent` stamps `createdBy`
 *    and `updatedBy` with `actor(user)`, which resolves to the admin's email.
 *    Both names are in `INTERNAL_FIELDS`, but `stripInternalFields` operates on
 *    the snapshot wrapper and never descends into `items[]`, so it never
 *    reached them.
 *  - **Hidden events.** `display: false` was filtered only client-side, in
 *    `CustomSessionizeWidget.jsx:451`, which is not a filter at all for anyone
 *    reading the endpoint directly.
 *
 * The allowlist below is positive, not a denylist, and that is the point:
 * `upsertSpeakerEvent` has no field allowlist on the write side, so anything an
 * editor adds to a document would otherwise become public the next time
 * snapshots are published. Only the fields the widget actually renders are
 * listed — derived from `mergeWithFirestore` and the manual-entry path in
 * `CustomSessionizeWidget.jsx`.
 *
 * Adding a field here publishes it to anonymous callers. That should be a
 * deliberate act, which is why the list is enumerated rather than computed.
 */
export function sanitizeSpeakerEvent(doc) {
  // Not `!== false`: a document with no `display` field is not published.
  // Failing closed matters more than showing an event whose author forgot the
  // flag, and it matches how sanitizeCertification treats the same field.
  if (getFirst(doc, ['display', 'Display']) !== true) return null;

  return compactObject({
    id: doc.id,
    name: getFirst(doc, ['name', 'Name', 'title', 'Title']),
    date: getFirst(doc, ['date', 'Date']),
    location: getFirst(doc, ['location', 'Location']),
    location_coords: serializeValue(getFirst(doc, ['location_coords', 'locationCoords'])),
    description: getFirst(doc, ['description', 'Description']),
    eventUrl: getFirst(doc, ['eventUrl', 'event_url', 'website', 'Website']),
    presentationUrl: getFirst(doc, ['presentationUrl', 'presentation_url']),
    image: sanitizeImageValue(getFirst(doc, ['image', 'Image'])),
    eventImageUrl: sanitizeImageValue(getFirst(doc, ['eventImageUrl', 'event_image_url'])),
    // The join key the widget matches Sessionize entries on. Not sensitive —
    // Sessionize ids are public — and omitting it would break the merge.
    sessionizeId: getFirst(doc, ['sessionizeId', 'sessionize_id']),
    display: true,
  });
}

const SANITIZERS = {
  certifications: sanitizeCertification,
  speakerevents: sanitizeSpeakerEvent,
};

const SNAPSHOT_COLLECTIONS = ['certifications', 'speakerevents'];

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, upsertDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 */
export function createSnapshotPublishHandlers({ guard, store, now = () => new Date() }) {
  async function publishSnapshots(collectionNames = SNAPSHOT_COLLECTIONS) {
    const generatedAt = now().toISOString();
    const results = {};

    for (const collectionName of collectionNames) {
      const rows = await store.queryDocs(collectionName, 'SELECT TOP 2000 * FROM c', []);
      let items = rows.map((d) => serializeValue(d));
      const sanitize = SANITIZERS[collectionName];
      if (sanitize) items = items.map(sanitize).filter(Boolean);
      await store.upsertDoc('_snapshots', { id: collectionName, generatedAt, items });
      results[collectionName] = items.length;
    }

    return { results, generatedAt };
  }

  return {
    /** POST /api/publishSnapshot — editor. */
    async publishSnapshot(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const { results, generatedAt } = await publishSnapshots();
        return json(200, { ...results, generatedAt });
      } catch (error) {
        context.error('publishSnapshot failed:', error);
        return json(500, {
          error: 'Failed to publish snapshots',
          message: error?.message || 'Unknown error',
        });
      }
    },
  };
}
