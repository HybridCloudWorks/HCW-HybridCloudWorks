/**
 * firestore-transform.mjs
 *
 * Firestore document → Cosmos DB document conversion, shared by the migrator
 * and the verifier so that both agree on what a migrated document should look
 * like.
 *
 * Design rule: the transform is *faithful*. It converts representations that
 * Cosmos cannot store (Timestamp, GeoPoint, DocumentReference, Bytes) and it
 * satisfies Cosmos's own constraints on `id` and reserved properties. It does
 * not rename, normalise, default or drop business fields — including the
 * `'Cloud Provider'` / `cloudProvider` split that Site-Main carries. Reshaping
 * data during a migration hides bugs on the far side; the API port handles the
 * split, the same way Site-Main's `providerOf()` helper does today.
 */

/** Cosmos DB rejects these characters anywhere in a document id. */
const ILLEGAL_ID_CHARS = /[/\\?#]/g;

/** Cosmos DB owns these property names; a source document must not carry them. */
const COSMOS_RESERVED = new Set(['_rid', '_self', '_etag', '_attachments', '_ts']);

/**
 * Make a Firestore document id safe to use as a Cosmos DB id.
 *
 * Firestore ids may contain characters Cosmos forbids, and may exceed the
 * 1,023-byte limit. Both are rare in this dataset but a silent collision is
 * unrecoverable, so anything we rewrite is recorded on the document as
 * `firestoreId` and reported by the migrator.
 *
 * @param {string} rawId
 * @returns {{ id: string, rewritten: boolean, reason: string|null }}
 */
export function sanitizeId(rawId) {
  let id = String(rawId);
  let reason = null;

  if (ILLEGAL_ID_CHARS.test(id)) {
    id = id.replace(ILLEGAL_ID_CHARS, '_');
    reason = 'illegal-characters';
  }

  // Cosmos trims trailing whitespace from ids, which turns two distinct source
  // ids into one target id without erroring.
  if (id !== id.trimEnd()) {
    id = id.trimEnd();
    reason = reason ? `${reason},trailing-whitespace` : 'trailing-whitespace';
  }

  if (Buffer.byteLength(id, 'utf8') > 1023) {
    id = Buffer.from(id, 'utf8').subarray(0, 1023).toString('utf8');
    reason = reason ? `${reason},too-long` : 'too-long';
  }

  return { id, rewritten: reason !== null, reason };
}

/**
 * Recursively convert Firestore-specific values into JSON Cosmos can store.
 *
 * The previous implementation only walked the top level of each document,
 * which left Timestamps nested inside objects and arrays to be serialised as
 * `{_seconds, _nanoseconds}` — the exact silent-coercion defect Migration_Plan
 * §5 warns about, just one level down.
 *
 * @param {unknown} value
 * @param {{ path?: string, conversions?: Map<string, number> }} [ctx]
 * @returns {unknown}
 */
export function convertValue(value, ctx = {}) {
  const conversions = ctx.conversions ?? new Map();
  const path = ctx.path ?? '';

  const record = (kind) => conversions.set(kind, (conversions.get(kind) ?? 0) + 1);

  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    return value.map((item, i) => convertValue(item, { path: `${path}[${i}]`, conversions }));
  }

  if (typeof value !== 'object') return value;

  // Node Buffer / Firestore Bytes → base64. Checked before the generic object
  // walk because a Buffer is an object with numeric keys.
  if (Buffer.isBuffer(value)) {
    record('bytes');
    return { _type: 'bytes', base64: value.toString('base64') };
  }
  if (typeof value.toBase64 === 'function') {
    record('bytes');
    return { _type: 'bytes', base64: value.toBase64() };
  }

  if (value instanceof Date) {
    record('date');
    return value.toISOString();
  }

  // Firestore Timestamp (live Admin SDK object).
  if (typeof value.toDate === 'function') {
    record('timestamp');
    return value.toDate().toISOString();
  }

  // Firestore Timestamp that has already been through JSON.
  if (typeof value._seconds === 'number' && typeof value._nanoseconds === 'number') {
    record('timestamp');
    return new Date(value._seconds * 1000 + value._nanoseconds / 1e6).toISOString();
  }

  // Firestore GeoPoint.
  if (typeof value.latitude === 'number' && typeof value.longitude === 'number' && Object.keys(value).length <= 2) {
    record('geopoint');
    return { _type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  }

  // Firestore DocumentReference. Kept as its path so the far side can rebuild
  // the link once the target container names are known.
  if (typeof value.path === 'string' && typeof value.id === 'string' && typeof value.collection === 'function') {
    record('reference');
    return { _type: 'reference', path: value.path };
  }

  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = convertValue(inner, { path: path ? `${path}.${key}` : key, conversions });
  }
  return out;
}

/**
 * Build the Cosmos document for one Firestore document.
 *
 * @param {{ id: string, data: object, parentPath?: string|null }} source
 * @returns {{ doc: object, warnings: Array<{ code: string, detail: string }> }}
 */
export function transformDocument(source) {
  const warnings = [];
  const conversions = new Map();

  const converted = convertValue(source.data, { conversions });
  const doc = { ...converted };

  // A document whose *data* contains its own `id` field would previously
  // overwrite the Firestore document id, because the id was assigned before
  // the data was spread. That silently changes a document's identity and can
  // collapse two documents into one on upsert.
  const dataId = Object.prototype.hasOwnProperty.call(converted, 'id') ? converted.id : undefined;
  if (dataId !== undefined && String(dataId) !== String(source.id)) {
    warnings.push({
      code: 'id-field-conflict',
      detail: `document ${source.id} carries a data field id="${dataId}"; keeping the Firestore document id and preserving the field as dataId`,
    });
    doc.dataId = dataId;
  }

  const { id, rewritten, reason } = sanitizeId(source.id);
  if (rewritten) {
    warnings.push({ code: 'id-rewritten', detail: `${source.id} → ${id} (${reason})` });
  }

  doc.id = id;

  // Always retain the original identity, whether or not it was rewritten. It
  // is what makes a re-run idempotent and a reconciliation report auditable.
  doc.firestoreId = source.id;
  if (source.parentPath) doc.firestoreParentPath = source.parentPath;

  for (const key of COSMOS_RESERVED) {
    if (key in doc) {
      warnings.push({ code: 'reserved-property', detail: `${source.id} carries reserved property ${key}; renamed to source${key}` });
      doc[`source${key}`] = doc[key];
      delete doc[key];
    }
  }

  return { doc, warnings, conversions: Object.fromEntries(conversions) };
}
