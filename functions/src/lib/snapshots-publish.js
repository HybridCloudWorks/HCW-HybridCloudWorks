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

const SANITIZERS = {
  certifications: sanitizeCertification,
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
        return json(500, { error: 'Failed to publish snapshots', message: error?.message || 'Unknown error' });
      }
    },
  };
}
