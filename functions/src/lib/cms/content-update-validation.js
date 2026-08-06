/**
 * Update-payload validation for updateContentItem — pure, no I/O.
 *
 * Ported verbatim from Site-Main cms-functions.js (:767-1040): the assertion
 * helpers, the protected-field denylist, the per-field-type normalizers, and
 * validateAndNormalizeUpdateContentItemUpdates itself. This layer is the only
 * thing standing between an authenticated editor's arbitrary JSON and the
 * content document, so its rules are carried exactly:
 *
 *   - Workflow state (contentStatus, Live, approvedForNews, review*) and
 *     backend-owned identity/timestamps are FORBIDDEN — the transition
 *     handler is the state machine's single writer.
 *   - Field-name and payload-size ceilings (80 fields, 120-char names,
 *     12k/120k string caps, 500-item arrays, 120k JSON payloads).
 *   - Dual-casing fields (title/Title, summary/Summary, tags/Tags,
 *     cloudProvider/'Cloud Provider') are always written as a pair so the
 *     legacy readers and the new readers never diverge.
 *
 * One serialization note rather than adaptation: date-like fields normalize to
 * Date instances exactly as the source did; Cosmos JSON-serializes a Date to
 * its ISO string on write, which is the same shape the migration writes.
 */
import { normalizePublishTarget } from './publish-targets.js';

export function assertStringLength(value, fieldName, maxLength, { allowEmpty = true } = {}) {
  const normalized = String(value || '');
  if (!allowEmpty && !normalized.trim()) {
    throw new Error(`${fieldName} is required`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${fieldName} exceeds ${maxLength} characters`);
  }
  return normalized;
}

export function assertOptionalDateString(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid date`);
  }
  return parsed;
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function assertOptionalHttpUrl(value, fieldName, { allowEmpty = true } = {}) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    if (!allowEmpty) throw new Error(`${fieldName} is required`);
    return '';
  }
  if (normalized.length > 2048) {
    throw new Error(`${fieldName} exceeds 2048 characters`);
  }
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${fieldName} must be a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${fieldName} must be an http(s) URL`);
  }
  return normalized;
}

export function assertStringArray(value, fieldName, { maxItems = 50, maxItemLength = 120 } = {}) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  if (value.length > maxItems) {
    throw new Error(`${fieldName} exceeds ${maxItems} items`);
  }
  return value.map((entry) => {
    const normalized = String(entry || '').trim();
    if (normalized.length > maxItemLength) {
      throw new Error(`${fieldName} contains an entry that exceeds ${maxItemLength} characters`);
    }
    return normalized;
  });
}

export function assertJsonSize(value, fieldName, maxChars = 120_000) {
  if (value === null || value === undefined) return value;
  // Defensive: only JSON-friendly values should be stored.
  const serialized = JSON.stringify(value);
  if (serialized.length > maxChars) {
    throw new Error(`${fieldName} payload exceeds ${maxChars} characters`);
  }
  return value;
}

export function normalizeProviderName(value) {
  const key = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (key === 'aws') return 'Aws';
  if (key === 'azure') return 'Azure';
  if (key === 'gcp' || key === 'googlecloud') return 'Gcp';
  if (key === 'github') return 'Github';
  if (key === 'terraform') return 'Terraform';
  if (key === 'finops') return 'Finops';
  return '';
}

export const FORBIDDEN_CONTENT_UPDATE_KEYS = new Set([
  // Workflow/state machine is authoritative via transition handlers.
  'contentStatus',
  'Status',
  'Live',

  'approvedForNews',
  'reviewedAt',
  'reviewedBy',
  'reviewNotes',
  'publishedToBlogs',
  'publishedBlogId',
  'movedToBlogsAt',
  // Timestamps/identity are backend-owned.
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'publishedAt',
  'Published At',
]);

// Per-field-type normalizers used by validateAndNormalizeUpdateContentItemUpdates.
// Each tries to handle the field; returns true if it consumed the entry,
// false to fall through to the next normalizer.
function isUrlField(field) {
  return (
    /Url$/i.test(field) ||
    /URL$/i.test(field) ||
    field === 'url' ||
    field === 'sourceUrl' ||
    field === 'docLink' ||
    field === 'diagramUrl'
  );
}

function isDateLikeField(field) {
  return /At$/.test(field) || /Date$/.test(field) || field === 'publishedDate';
}

function tryNormalizeKnownField(normalized, field, value) {
  if (isUrlField(field)) {
    normalized[field] = assertOptionalHttpUrl(value, field, { allowEmpty: true });
    return true;
  }
  if (isDateLikeField(field)) {
    if (typeof value === 'string') {
      normalized[field] = assertOptionalDateString(value, field);
      return true;
    }
    if (value instanceof Date) {
      normalized[field] = value;
      return true;
    }
  }
  if (field === 'title' || field === 'Title') {
    const t = assertStringLength(value, 'title', 240, { allowEmpty: true }).trim();
    normalized.title = t;
    normalized.Title = t;
    return true;
  }
  if (field === 'summary' || field === 'Summary') {
    const s = assertStringLength(value, 'summary', 10_000, { allowEmpty: true }).trim();
    normalized.summary = s;
    normalized.Summary = s;
    return true;
  }
  if (field === 'cloudProvider' || field === 'Cloud Provider') {
    const provider = normalizeProviderName(value);
    if (!provider) {
      throw new Error(`cloudProvider must be one of: Aws, Azure, Gcp, Github, Terraform, Finops`);
    }
    normalized.cloudProvider = provider;
    normalized['Cloud Provider'] = provider;
    return true;
  }
  if (field === 'publishTarget') {
    normalized.publishTarget = normalizePublishTarget(value);
    return true;
  }
  return tryNormalizeArrayField(normalized, field, value);
}

function tryNormalizeArrayField(normalized, field, value) {
  if (field === 'tags' || field === 'Tags') {
    const tags = assertStringArray(value, 'tags', { maxItems: 60, maxItemLength: 60 }) || [];
    const cleaned = tags.map((t) => String(t || '').trim()).filter(Boolean);
    normalized.tags = cleaned;
    normalized.Tags = cleaned;
    return true;
  }
  if (field === 'keyTopics') {
    const topics =
      assertStringArray(value, 'keyTopics', { maxItems: 40, maxItemLength: 120 }) || [];
    normalized.keyTopics = topics.map((t) => String(t || '').trim()).filter(Boolean);
    return true;
  }
  if (field === 'frameworkSourceUrls') {
    const urls =
      assertStringArray(value, 'frameworkSourceUrls', { maxItems: 30, maxItemLength: 2048 }) || [];
    urls.forEach((u) => {
      if (u) assertOptionalHttpUrl(u, 'frameworkSourceUrls', { allowEmpty: true });
    });
    normalized.frameworkSourceUrls = urls.filter(Boolean);
    return true;
  }
  return false;
}

const MAX_STRING_DEFAULT = 12_000;
const MAX_STRING_LARGE = 120_000;

function isLargeStringField(field) {
  return (
    /Html$/i.test(field) ||
    /Code$/i.test(field) ||
    /Draft$/i.test(field) ||
    field === 'overviewHtml' ||
    field === 'terraformCode'
  );
}

function normalizeGenericField(normalized, field, value) {
  if (typeof value === 'boolean' || typeof value === 'number') {
    normalized[field] = value;
    return;
  }
  if (typeof value === 'string') {
    const max = isLargeStringField(field) ? MAX_STRING_LARGE : MAX_STRING_DEFAULT;
    normalized[field] = assertStringLength(value, field, max, { allowEmpty: true });
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 500) {
      throw new Error(`${field} exceeds 500 items`);
    }
    normalized[field] = assertJsonSize(value, field);
    return;
  }
  if (isPlainObject(value)) {
    normalized[field] = assertJsonSize(value, field);
    return;
  }
  throw new Error(`Unsupported value type for ${field}`);
}

export function validateAndNormalizeUpdateContentItemUpdates(updates = {}) {
  if (!isPlainObject(updates)) {
    throw new Error('updates must be an object');
  }
  const entries = Object.entries(updates);
  if (entries.length === 0) {
    throw new Error('updates must include at least one field');
  }
  if (entries.length > 80) {
    throw new Error('updates exceeds 80 fields');
  }

  const normalized = {};
  for (const [key, value] of entries) {
    const field = String(key || '').trim();
    if (!field) continue;
    if (field.length > 120) {
      throw new Error(`updates contains a field name that exceeds 120 characters`);
    }
    if (FORBIDDEN_CONTENT_UPDATE_KEYS.has(field)) {
      throw new Error(`updates cannot modify protected field: ${field}`);
    }
    if (value === undefined) continue;
    if (value === null) {
      normalized[field] = null;
      continue;
    }
    if (tryNormalizeKnownField(normalized, field, value)) continue;
    normalizeGenericField(normalized, field, value);
  }
  return normalized;
}

/**
 * Blog-only-era shaping applied after validation (source :262): re-resolve the
 * publish target with the doc type as fallback, collapse legacy statuses, and
 * force the retired approvedForNews flag off.
 */
export function normalizeContentUpdatesForBlogOnly(updates = {}) {
  const normalized = { ...updates };

  if (Object.prototype.hasOwnProperty.call(normalized, 'publishTarget')) {
    normalized.publishTarget = normalizePublishTarget(
      normalized.publishTarget,
      normalized.type || normalized.contentType
    );
  }

  if (typeof normalized.contentStatus === 'string') {
    normalized.contentStatus = normalizeStatusForBlogOnly(normalized.contentStatus);
  }

  if (normalized.approvedForNews === true) {
    normalized.approvedForNews = false;
  }

  return normalized;
}

/** Collapse the retired news-era statuses onto their blog equivalents. */
export function normalizeStatusForBlogOnly(status) {
  if (status === 'published_news' || status === 'published_both') {
    return 'published';
  }
  if (status === 'approved_news') {
    return 'approved';
  }
  return status;
}

export function normalizeCurrentStatusForBlogOnly(status) {
  return normalizeStatusForBlogOnly(status || 'ingested');
}
