/**
 * The metadata request a gallery row accepts and the patch it produces
 * (PR #841 split of gallery-images.js).
 *
 * The slot-guard subtlety the source fixed is preserved: `slot` has NO
 * default in validation, so a rename/archive that doesn't mention slot can't
 * silently clear the image's slot tag, while an explicit '' still does.
 */
import {
  GALLERY_COLLECTIONS,
  cleanFolder,
  cleanTagList,
  lower,
  optionalInt,
  trimmed,
} from './shared.js';

export const APPROVAL_STATUSES = ['draft', 'approved', 'rejected', 'archived'];
export const LICENSES = ['', 'ai-generated', 'owned', 'cc0', 'cc-by', 'cc-by-sa', 'stock', 'other'];

/** Source :5105 — note the deliberate absence of a `slot` default. */
export function validateGalleryImageMetadataRequest(body) {
  const {
    imageId,
    id,
    galleryCollection = 'generated_content_images',
    provider,
    slot,
    title,
    folder,
    customTags,
    tags,
    theme,
    style,
    promptSet,
    promptName,
    promptTemplateVersion,
    approvalStatus,
    archived,
    trash,
    altText,
    caption,
    license,
    credit,
    width,
    height,
    bytes,
    format,
  } = body || {};

  const actualImageId = imageId || id;

  if (!actualImageId || typeof actualImageId !== 'string') {
    return { ok: false, status: 400, error: 'imageId or id required' };
  }
  if (!GALLERY_COLLECTIONS.includes(galleryCollection)) {
    return { ok: false, status: 400, error: 'Invalid galleryCollection' };
  }
  return {
    ok: true,
    imageId: actualImageId,
    galleryCollection,
    provider,
    slot,
    title,
    folder,
    customTags: customTags ?? tags,
    theme,
    style,
    promptSet,
    promptName,
    promptTemplateVersion,
    approvalStatus,
    archived,
    trash,
    altText,
    caption,
    license,
    credit,
    width,
    height,
    bytes,
    format,
  };
}

const present = (value) => value !== undefined && value !== null;
const defined = (value) => value !== undefined;
const textRule = (key, max, fallback) => [
  key,
  present,
  (v) => ({ [key]: trimmed(v, max, fallback) }),
];
const intRule = (key) => [
  key,
  present,
  (v) => {
    const n = optionalInt(v);
    return n === undefined ? {} : { [key]: n };
  },
];

/**
 * One row per metadata field: when the request's value counts as given, and
 * the patch fields it writes. `slot` is the one field a null clears — see the
 * header on the missing slot default. Applied in this order, which is the
 * order the response body lists them in.
 */
const METADATA_RULES = Object.freeze([
  ['provider', present, (v) => ({ provider: lower(v) })],
  ['slot', defined, (v) => ({ slot: String(v || '').trim() })],
  textRule('title', 300, 'Uploaded image'),
  ['folder', present, (v) => ({ folder: cleanFolder(v) })],
  ['customTags', present, (v) => ({ customTags: cleanTagList(v) })],
  textRule('theme', 2000),
  textRule('style', 2000),
  [
    'promptSet',
    present,
    (v) => {
      const promptSet = trimmed(v, 120);
      return { promptSet, promptSetId: promptSet, setId: promptSet };
    },
  ],
  textRule('promptName', 120),
  textRule('promptTemplateVersion', 160),
  textRule('altText', 500),
  textRule('caption', 1000),
  textRule('credit', 300),
  [
    'license',
    present,
    (v) => {
      const value = lower(v);
      return { license: LICENSES.includes(value) ? value : 'other' };
    },
  ],
  [
    'approvalStatus',
    present,
    (v) => {
      const normalized = String(v || 'draft').trim();
      return { approvalStatus: APPROVAL_STATUSES.includes(normalized) ? normalized : 'draft' };
    },
  ],
  [
    'archived',
    present,
    (v, nowIso) => ({ archived: v === true, archivedAt: v === true ? nowIso : null }),
  ],
  ['trash', present, (v, nowIso) => ({ softDeletedAt: v === true ? nowIso : null })],
  intRule('width'),
  intRule('height'),
  intRule('bytes'),
  [
    'format',
    present,
    (v) => ({
      format: lower(v)
        .replace(/^image\//, '')
        .slice(0, 20),
    }),
  ],
]);

/**
 * The patch a metadata request produces. Pure so the field rules are
 * testable: absent fields never write, `archived`/`trash` booleans become the
 * `archivedAt`/`softDeletedAt` stamps the listing filters on, and
 * `customTags` REPLACES (the bulk route is where per-item toggling lives).
 */
export function buildMetadataPatch(validated, { nowIso, actor }) {
  const updateData = { updatedAt: nowIso, updatedBy: actor };
  for (const [key, given, write] of METADATA_RULES) {
    if (given(validated[key])) Object.assign(updateData, write(validated[key], nowIso));
  }
  return updateData;
}
