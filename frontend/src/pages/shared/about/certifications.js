/**
 * The certification rows the About page renders, normalised from whatever
 * shape the snapshot carries. The published snapshot and the build-time
 * JSON spell the same field three ways (`issueDate`, `issue_date`,
 * `IssueDate`), store a date as a Firestore Timestamp, an ISO day, a full
 * timestamp or epoch milliseconds, and keep the badge image as an upload
 * object, an array of them, or a bare URL. Each of those is one table entry
 * here, so a new spelling is a new row and not a new branch.
 */

/** The first of `keys` that `obj` carries with a value. */
export function firstDefined(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

// ── Dates ────────────────────────────────────────────────────────────────────

/**
 * A stored date is a calendar day (`YYYY-MM-DD`, or a timestamp whose
 * leading day is the one meant). Anchored at local noon so the day shown is
 * the day named — `new Date('2026-10-01')` is midnight UTC and read as
 * 30 September everywhere west of Greenwich (ADR 0033 §1). Anything else
 * goes through `Date` itself, and an unparseable string is no date at all.
 */
function parseDateString(value) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Accepted date shapes, in the order they are tried: [accepts, parse]. */
const DATE_SHAPES = [
  [(v) => typeof v?.toDate === 'function', (v) => v.toDate()],
  [(v) => typeof v === 'string', parseDateString],
  [(v) => typeof v === 'number', (v) => new Date(v)],
];

export function toDate(value) {
  if (!value) return undefined;
  const shape = DATE_SHAPES.find(([accepts]) => accepts(value));
  return shape ? shape[1](value) : undefined;
}

// ── Booleans ─────────────────────────────────────────────────────────────────

/** How each primitive type reads as a flag. Any other type is no flag. */
const BOOL_BY_TYPE = new Map([
  ['boolean', (v) => v],
  ['string', (v) => v.toLowerCase() === 'true'],
  ['number', (v) => v !== 0],
]);

export function toBool(value) {
  if (value === undefined || value === null) return undefined;
  const parse = BOOL_BY_TYPE.get(typeof value);
  return parse ? parse(value) : undefined;
}

// ── Issuer ───────────────────────────────────────────────────────────────────

/**
 * Issuer spellings the data has carried, case-folded, and the name shown
 * for each. `Microsft` is a typo that shipped and still sits in old rows.
 */
const ISSUER_ALIASES = new Map([
  ['microsft', 'Microsoft'],
  ['google cloud partners', 'Google Cloud Partners'],
  ['google cloud partner', 'Google Cloud Partners'],
  ['google cloud', 'Google Cloud'],
]);

export function normalizeIssuer(value) {
  if (Array.isArray(value)) return value[0] ?? 'Other';
  if (!value) return 'Other';
  if (typeof value !== 'string') return value;
  return ISSUER_ALIASES.get(value.trim().toLowerCase()) ?? value;
}

// ── Image ────────────────────────────────────────────────────────────────────

/** Upload-object fields (Rowy image fields), in preference order. */
const IMAGE_OBJECT_KEYS = [
  'image',
  'Image',
  'badge',
  'Badge',
  'credentialImage',
  'CredentialImage',
];
/** Plain string URL fields, in preference order. */
const IMAGE_URL_KEYS = ['imageUrl', 'ImageUrl', 'image_url', 'credentialImage', 'CredentialImage'];
/** Where an upload object keeps its URL, in preference order. */
const UPLOAD_URL_KEYS = ['downloadURL', 'downloadUrl', 'url', 'src', 'link'];

// The Firebase Storage bucket is gone (#518). This used to rewrite the GCS
// form into the Firebase REST form "so storage rules apply"; both point at
// the same decommissioned project, so the rewrite produced one dead URL
// from another. Undefined, so the caller's existing falsy branch omits the
// image rather than rendering a broken frame. `http` and case-insensitive,
// matching what blogUtils.js gets for free from `new URL().hostname` — the
// two must agree or one page renders a broken image the other has already
// learned to skip.
const DEAD_STORAGE_URL = /^https?:\/\/(storage|firebasestorage)\.googleapis\.com\//i;
// Case-insensitive: `startsWith('http')` treated `HTTPS://example.com/x` as
// a relative path and prefixed it with `/`, producing a URL that resolves
// nowhere.
const ABSOLUTE_OR_ROOTED = /^(https?:\/\/|\/|data:)/i;

/** A usable URL from a stored value, or undefined. */
export function cleanUrl(value) {
  if (typeof value !== 'string') return undefined;
  const key = value.trim();
  if (key === '' || DEAD_STORAGE_URL.test(key)) return undefined;
  return ABSOLUTE_OR_ROOTED.test(key) ? key : `/${key}`;
}

/** The URL inside an upload object, or the first of an array of them. */
function urlFromUpload(value) {
  const upload = Array.isArray(value) ? value[0] : value;
  if (!upload || typeof upload !== 'object') return undefined;
  return cleanUrl(UPLOAD_URL_KEYS.map((key) => upload[key]).find(Boolean));
}

/** The upload object wins over a plain URL field when it yields a URL. */
export function resolveImageUrl(raw) {
  return (
    urlFromUpload(firstDefined(raw, IMAGE_OBJECT_KEYS)) ??
    cleanUrl(firstDefined(raw, IMAGE_URL_KEYS))
  );
}

// ── The row ──────────────────────────────────────────────────────────────────

const identity = (v) => v;

/**
 * Output field → the source spellings tried in order → how the value read
 * is normalised. `id` and `image_url` sit outside the table: the first is
 * taken as is, the second reads several fields at once.
 */
const FIELDS = [
  ['name', ['name', 'Name'], identity],
  ['issuer', ['issuer', 'Issuer'], normalizeIssuer],
  ['issue_date', ['issueDate', 'issue_date', 'IssueDate'], toDate],
  ['exp_date', ['expDate', 'exp_date', 'ExpDate'], toDate],
  ['certState', ['certState', 'isValid', 'is_valid', 'cert_state'], toBool],
  ['code', ['code', 'Code'], identity],
  ['verify_url', ['verifyUrl', 'verify_url', 'VerifyUrl'], identity],
  ['display_order', ['displayOrder', 'display_order', 'DisplayOrder'], (v) => v ?? 999],
  ['tags', ['tags', 'Tags'], (v) => v || []],
  ['display', ['display', 'Display'], (v) => v === true],
  // "Feature in Spotlight" in the admin: featured certs lead the page.
  ['featured', ['featured', 'Featured'], (v) => v === true],
];

export function normalizeCertification(raw) {
  const normalized = { id: raw.id };
  for (const [field, sources, normalise] of FIELDS) {
    normalized[field] = normalise(firstDefined(raw, sources));
  }
  normalized.image_url = resolveImageUrl(raw);
  return normalized;
}
