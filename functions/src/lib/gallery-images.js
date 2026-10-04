/**
 * Gallery image-record RPCs — saveContentImageOrder,
 * updateGalleryImageMetadata, createManualGalleryImageRecord,
 * deleteCuratedGeneratedImage, deleteContentGeneratedImage,
 * deleteRejectedContent — plus, since ADR 0033 (Creative slice), the media
 * library the Image Gallery page is: `buildGalleryListing` (search, filters,
 * sort, pagination, usage and duplicate detection over both image
 * containers), bulk edits, persisted folders (admin_config/gallery_folders),
 * import-from-URL, and per-image usage.
 *
 * Ported from Site-Main cms-functions.js (:2376-2440, :4967-5330, :7095-7250).
 *
 * Storage adaptation: GCS bucket paths ('covers/x.png') map onto the Azure
 * storage containers Terraform creates with the SAME names as the GCS path
 * prefixes (blogs, covers, certifications, speakerevents, content) — first
 * path segment selects the container, the rest is the blob name.
 * parseStorageRef also reads Azure blob URLs, the site's own media route
 * (`/api/public/media/{container}/{path}` — the URL every AI-generated row
 * carries, which until ADR 0033 meant none of their blobs could be deleted)
 * and the two legacy Google URL shapes; a legacy URL whose prefix is a known
 * container maps across, and anything else returns null — the record delete
 * still proceeds and storageDeleted reports false, mirroring the source's
 * ignore-failures posture (and matching reality: pre-migration blobs live in
 * Firebase Storage, whose bucket has since been decommissioned — see below).
 *
 * THE GOOGLE BRANCHES STAY, THOUGH THE BUCKET IS GONE (#518). The bucket was
 * decommissioned and every URL into it 404s — but this path does not FETCH
 * those URLs, it maps a legacy URL onto the Azure blob that replaced it so a
 * delete can find it. Removing the branches would make that mapping fail for
 * any row still carrying a legacy URL whose object WAS migrated, turning a
 * successful delete into a silent orphan. The rendering side is where the dead
 * URLs mattered, and it now treats them as absent.
 *
 * The slot-guard subtlety the source fixed is preserved: `slot` has NO
 * default in validation, so a rename/archive that doesn't mention slot can't
 * silently clear the image's slot tag, while an explicit '' still does.
 *
 * A BLOB IS DELETED ONLY WHEN NO OTHER ROW POINTS AT IT. Before the stamped
 * paths, every regeneration of a slot wrote the same blob, so deleting an old
 * history row deleted the CURRENT cover's bytes. The delete now checks both
 * containers for another row with the same URL and leaves the blob when one
 * exists (`storageDeleted: false, sharedWith: n`).
 */
import { randomUUID } from 'node:crypto';
import { buildContentImageUpdates } from './content-workflow.js';
import { ADMIN_CONFIG_PARTITION } from './cosmos-client.js';
import { mediaUrlFor } from './blob-paths.js';
import { fetchImage as defaultFetchImage, requireImageExtension } from './triggers/fetch-image.js';
import { sourceOf } from './cms/inline-images.js';
import { measureImage, sha256Hex } from './gallery/measure.js';
import {
  dateValue,
  GALLERY_MAX_LIMIT,
  matchesParams,
  parseGalleryListParams,
  sortItems,
} from './gallery/filters.js';

// The byte readers and the listing filters moved to ./gallery/ in PR #841;
// re-exported so the callers and tests that import them from here still do.
export { measureImage, sha256Hex, parseGalleryListParams, GALLERY_MAX_LIMIT };

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** A refusal on its way to `json(status, { error })`. */
const refuse = (status, error) => ({ ok: false, status, error });

export const KNOWN_STORAGE_CONTAINERS = new Set([
  'blogs',
  'covers',
  'certifications',
  'speakerevents',
  'content',
]);

export const GALLERY_COLLECTIONS = Object.freeze([
  'generated_content_images',
  'curated_article_images',
]);

/** admin_config document the gallery's folder list lives in (ADR 0033 §4). */
export const GALLERY_FOLDERS_CONFIG_ID = 'gallery_folders';
export const GALLERY_FOLDER_LIMIT = 100;

const MEDIA_ROUTE_PREFIX = '/api/public/media/';

/** URL or relative path -> { container, blobName } | null. See header. */
export function parseStorageRef(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const fromPath = (path) => {
    const clean = String(path || '').replace(/^\/+/, '');
    const slash = clean.indexOf('/');
    if (slash <= 0) return null;
    const container = clean.slice(0, slash);
    const blobName = clean.slice(slash + 1);
    if (!KNOWN_STORAGE_CONTAINERS.has(container) || !blobName) return null;
    return { container, blobName };
  };
  const fromMediaRoute = (pathname) => {
    if (!pathname.startsWith(MEDIA_ROUTE_PREFIX)) return null;
    const rest = pathname.slice(MEDIA_ROUTE_PREFIX.length);
    const decoded = rest
      .split('/')
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join('/');
    return fromPath(decoded);
  };

  if (raw.startsWith(MEDIA_ROUTE_PREFIX)) return fromMediaRoute(raw.split(/[?#]/)[0]);
  if (!/^https?:\/\//i.test(raw)) return fromPath(raw);

  try {
    const parsed = new URL(raw);
    const viaRoute = fromMediaRoute(parsed.pathname);
    if (viaRoute) return viaRoute;
    if (parsed.hostname.endsWith('.blob.core.windows.net')) {
      return fromPath(decodeURIComponent(parsed.pathname));
    }
    if (parsed.hostname === 'storage.googleapis.com') {
      // /{bucket}/{path} — drop the bucket segment.
      const parts = parsed.pathname.replace(/^\/+/, '').split('/');
      return fromPath(decodeURIComponent(parts.slice(1).join('/')));
    }
    if (parsed.hostname === 'firebasestorage.googleapis.com') {
      const marker = '/o/';
      const markerIndex = parsed.pathname.indexOf(marker);
      if (markerIndex >= 0) {
        return fromPath(decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length)));
      }
    }
  } catch {
    return null;
  }
  return null;
}

// ── metadata requests ─────────────────────────────────────────────────────

const APPROVAL_STATUSES = ['draft', 'approved', 'rejected', 'archived'];
const LICENSES = ['', 'ai-generated', 'owned', 'cc0', 'cc-by', 'cc-by-sa', 'stock', 'other'];

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

const cleanTagList = (value) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .map((tag) =>
              String(tag || '')
                .trim()
                .toLowerCase()
            )
            .filter(Boolean)
        ),
      ]
    : [];

const cleanFolder = (value) =>
  String(value || 'default')
    .trim()
    .toLowerCase() || 'default';

const optionalInt = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
};

const present = (value) => value !== undefined && value !== null;
const defined = (value) => value !== undefined;
const lower = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();
const trimmed = (value, max, fallback = '') =>
  String(value || '')
    .trim()
    .slice(0, max) || fallback;
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

/**
 * Source :7160 — dotted paths; undefined = patchDoc deletion. Extended under
 * ADR 0033 to scrub every field a content document can point at an image
 * with: the AI slot map and history, the hero/cover trio, and the secondary
 * list. Before, deleting a gallery row left `heroImageUrl` pointing at a blob
 * that no longer existed.
 */
export function buildContentImageRemovalUpdates(contentData, { slot, imageUrl }) {
  const currentHistory = Array.isArray(contentData.aiImageHistory?.[slot])
    ? contentData.aiImageHistory[slot]
    : [];
  const nextHistory = currentHistory.filter((url) => url !== imageUrl);
  const fallbackUrl = nextHistory[nextHistory.length - 1] || '';
  const updates = {
    [`aiImageHistory.${slot}`]: nextHistory.length > 0 ? nextHistory : undefined,
  };
  if ((contentData.aiImageUrls || {})[slot] === imageUrl) {
    updates[`aiImageUrls.${slot}`] = fallbackUrl || undefined;
  }
  if (slot === 'hero' && contentData.altCoverImage === imageUrl) {
    updates.altCoverImage = fallbackUrl || undefined;
  }
  for (const field of ['heroImageUrl', 'contentImageUrl', 'coverImage']) {
    if (contentData[field] === imageUrl) updates[field] = fallbackUrl || undefined;
  }
  const secondary = Array.isArray(contentData.secondaryImageUrls)
    ? contentData.secondaryImageUrls
    : [];
  if (secondary.includes(imageUrl)) {
    const remaining = secondary.filter((url) => url !== imageUrl);
    updates.secondaryImageUrls = remaining.length > 0 ? remaining : undefined;
  }
  return updates;
}

// ── listing ───────────────────────────────────────────────────────────────

/** `sourceCollection` spellings → the gallery's source id. */
const SOURCE_IDS = new Map([
  ['curated_article_images', 'curated'],
  ['manual_upload', 'upload'],
  ['preview', 'preview'],
  ['import', 'import'],
  ['rehost', 'rehost'],
  ['content', 'ai-cover'],
  ['generated_content_images', 'ai-cover'],
  ['blogs', 'ai-cover'],
]);

/** The normalised `source` id for a row: where the image came from. */
export function sourceIdFor(row = {}, collection = '') {
  if (collection === 'curated_article_images') return 'curated';
  const raw = String(row.sourceCollection || '').trim();
  // An unnamed source is an AI cover (the rows that predate the field); a
  // named one the gallery does not know is 'other'.
  return SOURCE_IDS.get(raw) || (raw ? 'other' : 'ai-cover');
}

export const GALLERY_SOURCES = Object.freeze([
  'upload',
  'ai-cover',
  'preview',
  'curated',
  'import',
  'rehost',
  'other',
]);

/**
 * One row in the shape the gallery reads, whatever container it came from.
 * Curated rows have no `createdAt` or `title`; they get `generatedAt` and
 * `articleTitle` so they sort and label like everything else.
 */
export function normalizeGalleryRow(row = {}, collection) {
  const createdAt =
    row.createdAt || row.generatedAt || (row._ts ? new Date(row._ts * 1000).toISOString() : null);
  const archivedAt = row.archivedAt || (row.archived === true ? row.updatedAt || createdAt : null);
  return {
    id: row.id,
    galleryCollection: collection,
    articleId: String(row.articleId || row.contentId || row.id || ''),
    contentId: String(
      row.contentId || (collection === 'curated_article_images' ? '' : row.articleId || '')
    ),
    imageUrl: String(row.imageUrl || ''),
    title: String([row.title, row.articleTitle, row.articleId, row.id].find(Boolean) || 'Untitled'),
    altText: String(row.altText || ''),
    caption: String(row.caption || ''),
    license: String(row.license || ''),
    credit: String(row.credit || ''),
    provider: String(row.provider || ''),
    slot: String(row.slot || (collection === 'curated_article_images' ? 'curated' : '')),
    folder: cleanFolder(row.folder),
    customTags: cleanTagList(row.customTags),
    source: sourceIdFor(row, collection),
    sourceCollection: String(row.sourceCollection || collection),
    sourceUrl: row.sourceUrl || row.articleUrl || null,
    approvalStatus: String(row.approvalStatus || ''),
    promptSet: String(row.promptSet || row.promptSetId || ''),
    promptSetId: String(row.promptSetId || row.promptSet || ''),
    promptName: String(row.promptName || ''),
    promptTemplateVersion: String(row.promptTemplateVersion || ''),
    prompt: String(row.prompt || ''),
    imageProvider: String(row.imageProvider || ''),
    imageModel: String(row.imageModel || ''),
    width: Number.isFinite(Number(row.width)) && row.width !== null ? Number(row.width) : null,
    height: Number.isFinite(Number(row.height)) && row.height !== null ? Number(row.height) : null,
    bytes: Number.isFinite(Number(row.bytes)) && row.bytes !== null ? Number(row.bytes) : null,
    format: String(row.format || ''),
    sha256: String(row.sha256 || ''),
    storagePath: String(row.storagePath || ''),
    createdAt,
    createdBy: row.createdBy || null,
    updatedAt: row.updatedAt || null,
    archivedAt: archivedAt || null,
    softDeletedAt: row.softDeletedAt || null,
    usedBy: [],
    usageCount: 0,
    duplicateOf: null,
  };
}

const CONTENT_IMAGE_FIELDS = Object.freeze([
  'heroImageUrl',
  'altCoverImage',
  'contentImageUrl',
  'coverImage',
  'Cover Image',
]);

/** Projection the usage index needs; one query covers every image on a page. */
export const CONTENT_USAGE_PROJECTION =
  'c.id, c.Title, c.title, c.contentStatus, c.type, c.heroImageUrl, c.altCoverImage, ' +
  'c.contentImageUrl, c.coverImage, c["Cover Image"], c.aiImageUrls, c.secondaryImageUrls';

/** Every `[url, field]` a content document points at an image with. */
function imageReferencesOf(doc) {
  const refs = CONTENT_IMAGE_FIELDS.map((field) => [doc[field], field]);
  for (const [slot, url] of Object.entries(doc.aiImageUrls || {})) {
    refs.push([url, `aiImageUrls.${slot}`]);
  }
  const secondary = Array.isArray(doc.secondaryImageUrls) ? doc.secondaryImageUrls : [];
  for (const url of secondary) refs.push([url, 'secondaryImageUrls']);
  return refs;
}

/** Record one use of `url`, once per document and field. */
function addUsage(index, url, entry) {
  const key = String(url || '').trim();
  if (!key) return;
  const list = index.get(key) || [];
  if (!list.some((e) => e.id === entry.id && e.field === entry.field)) list.push(entry);
  index.set(key, list);
}

/** URL → the content documents using it, with the field each one uses it in. */
export function buildContentUsageIndex(contentRows = []) {
  const index = new Map();
  for (const doc of contentRows || []) {
    if (!doc?.id) continue;
    const base = {
      id: doc.id,
      title: String(doc.Title || doc.title || doc.id),
      status: String(doc.contentStatus || ''),
      type: String(doc.type || ''),
    };
    for (const [url, field] of imageReferencesOf(doc)) addUsage(index, url, { ...base, field });
  }
  return index;
}

/** Mark every later row that shares a sha or URL with an earlier one. */
export function markDuplicates(items) {
  const oldestFirst = [...items].sort((a, b) => dateValue(a.createdAt) - dateValue(b.createdAt));
  const byKey = new Map();
  for (const item of oldestFirst) {
    const keys = [
      item.sha256 ? `sha:${item.sha256}` : '',
      item.imageUrl ? `url:${item.imageUrl}` : '',
    ].filter(Boolean);
    const canonical = keys.map((key) => byKey.get(key)).find(Boolean);
    if (canonical && canonical.id !== item.id) item.duplicateOf = canonical.id;
    for (const key of keys) if (!byKey.has(key)) byKey.set(key, item);
  }
  return items;
}

/**
 * The gallery listing from raw rows: normalise, attach usage, mark
 * duplicates, filter, sort, page. Pure — the handler does the reads.
 *
 * @param {{ generated?: object[], curated?: object[], content?: object[] }} rows
 * @param {ReturnType<typeof parseGalleryListParams>} params
 */
export function buildGalleryListing({ generated = [], curated = [], content = [] }, params) {
  const all = [
    ...generated.map((row) => normalizeGalleryRow(row, 'generated_content_images')),
    ...curated.map((row) => normalizeGalleryRow(row, 'curated_article_images')),
  ].filter((item) => item.id);
  const usage = buildContentUsageIndex(content);
  for (const item of all) {
    const users = usage.get(item.imageUrl) || [];
    item.usedBy = users.slice(0, 20);
    // Distinct documents, not fields: a hero also listed in aiImageUrls.hero
    // is one use, not two.
    item.usageCount = new Set(users.map((u) => u.id)).size;
  }
  markDuplicates(all);
  const facets = {
    folders: [...new Set(all.map((i) => i.folder))].sort(),
    providers: [...new Set(all.map((i) => i.provider.toLowerCase()).filter(Boolean))].sort(),
    slots: [...new Set(all.map((i) => i.slot.toLowerCase()).filter(Boolean))].sort(),
    tags: [...new Set(all.flatMap((i) => i.customTags))].sort(),
    sources: [...new Set(all.map((i) => i.source))].sort(),
    sets: [...new Set(all.map((i) => i.promptSet).filter(Boolean))].sort(),
    counts: {
      active: all.filter((i) => !i.softDeletedAt && !i.archivedAt).length,
      archived: all.filter((i) => !i.softDeletedAt && i.archivedAt).length,
      trash: all.filter((i) => i.softDeletedAt).length,
    },
  };
  const matched = sortItems(
    all.filter((item) => matchesParams(item, params)),
    params.sort
  );
  const page = matched.slice(params.offset, params.offset + params.limit);
  return {
    items: page,
    total: matched.length,
    offset: params.offset,
    limit: params.limit,
    hasMore: params.offset + page.length < matched.length,
    facets,
  };
}

// ── folders ───────────────────────────────────────────────────────────────

export const SEED_FOLDERS = Object.freeze([
  'default',
  'aws',
  'azure',
  'gcp',
  'finops',
  'architecture',
]);

/** The folder list a PUT may store: lowercased, deduplicated, `default` first. */
export function cleanFolderList(value) {
  const folders = new Set(['default']);
  for (const folder of Array.isArray(value) ? value : []) {
    const name = String(folder || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._ -]+/g, '-')
      .slice(0, 40);
    if (name) folders.add(name);
  }
  return [...folders].slice(0, GALLERY_FOLDER_LIMIT);
}

// ── bulk ──────────────────────────────────────────────────────────────────

export const BULK_ACTIONS = Object.freeze([
  'tag',
  'move',
  'archive',
  'restore',
  'trash',
  'untrash',
  'delete',
  'set',
]);
export const BULK_LIMIT = 200;

/** The item's tags with `removeTags` taken away and `addTags` added. */
function toggledTags(existing, body) {
  const add = cleanTagList(body.addTags);
  const remove = new Set(cleanTagList(body.removeTags));
  const current = cleanTagList(existing.customTags);
  return [...new Set([...current.filter((t) => !remove.has(t)), ...add])];
}

/** Action → the fields it writes on one item, beside the update stamps. */
const BULK_PATCHES = Object.freeze({
  tag: (existing, body) => ({ customTags: toggledTags(existing, body) }),
  move: (_existing, body) => ({ folder: cleanFolder(body.folder) }),
  archive: (_existing, _body, { nowIso }) => ({ archived: true, archivedAt: nowIso }),
  restore: () => ({ archived: false, archivedAt: null, softDeletedAt: null }),
  trash: (_existing, _body, { nowIso }) => ({ softDeletedAt: nowIso }),
  untrash: () => ({ softDeletedAt: null }),
  set: (existing, body, stamps) => {
    const validated = validateGalleryImageMetadataRequest({
      imageId: existing.id,
      galleryCollection: 'generated_content_images',
      ...(body.fields || {}),
    });
    return validated.ok ? buildMetadataPatch(validated, stamps) : {};
  },
});

/**
 * The patch one bulk action produces for one item, given the item's own
 * tags. `tag` ADDS and REMOVES against what the item has — the whole point:
 * the page used to send the toggle set as the new tag list, erasing every
 * tag not on screen.
 */
export function buildBulkPatch(action, existing, body, { nowIso, actor }) {
  const build = Object.hasOwn(BULK_PATCHES, action) ? BULK_PATCHES[action] : null;
  if (!build) return null;
  return { updatedAt: nowIso, updatedBy: actor, ...build(existing, body, { nowIso, actor }) };
}

// ── store and blob operations the routes share ────────────────────────────

/**
 * The scaffold every route shares: the role guard, then the route body,
 * with any throw logged under `label` and answered as a 500 carrying
 * `message` (and the error's own message where the route always has). The
 * body answers everything else (PR #841).
 */
const guardedWith =
  (guard) =>
  (role, label, message, run, { withMessage = true } = {}) =>
  async (request, context) => {
    const auth = await guard.requireRole(request, role);
    if (auth.error) return auth.error;
    try {
      return await run({ request, context, auth, user: auth.user });
    } catch (error) {
      context.error(`${label} failed:`, error);
      const body = withMessage
        ? { error: message, message: error?.message || 'Unknown error' }
        : { error: message };
      return json(500, body);
    }
  };

/** Rows in either container (other than `excludeId`) that point at `imageUrl`. */
async function otherRowsSharing(store, imageUrl, excludeId) {
  if (!imageUrl || typeof store.queryDocs !== 'function') return 0;
  let count = 0;
  for (const collection of GALLERY_COLLECTIONS) {
    try {
      const rows = await store.queryDocs(
        collection,
        'SELECT TOP 10 c.id FROM c WHERE c.imageUrl = @url AND c.id != @id',
        [
          { name: '@url', value: imageUrl },
          { name: '@id', value: excludeId || '' },
        ]
      );
      count += (rows || []).length;
    } catch {
      // Counting is protective; an unreadable container reads as unshared.
    }
  }
  return count;
}

async function deleteBlobFor(storage, { imageUrl, storagePath }, context) {
  const ref = parseStorageRef(storagePath) || parseStorageRef(imageUrl);
  if (!ref) return false;
  try {
    await storage.deleteBlob(ref.container, ref.blobName);
    return true;
  } catch (error) {
    context.warn?.('gallery blob delete failed:', ref.container, ref.blobName, error?.message);
    return false;
  }
}

/** Scrub every reference to `imageUrl` on the content doc that owns a row. */
async function scrubContentReferences(store, { contentId, slot, imageUrl }) {
  if (!contentId || contentId === 'manual-upload') return;
  const contentData = await store.readDoc('content', contentId, contentId).catch(() => null);
  if (!contentData) return;
  const updates = buildContentImageRemovalUpdates(contentData, { slot, imageUrl });
  await store.patchDoc('content', contentId, updates);
}

/** Permanent delete of one row: blob (if unshared), content references, the row. */
async function deleteOneRow({ store, storage }, { galleryCollection, id }, context) {
  const row = await store.readDoc(galleryCollection, id, id);
  if (!row) return refuse(404, `${galleryCollection}/${id} not found`);
  const imageUrl = String(row.imageUrl || '').trim();
  const sharedWith = await otherRowsSharing(store, imageUrl, id);
  const storageDeleted =
    sharedWith > 0
      ? false
      : await deleteBlobFor(storage, { imageUrl, storagePath: row.storagePath }, context);

  const owned = galleryCollection === 'generated_content_images';
  const contentId = owned ? String(row.contentId || row.articleId || '').trim() : '';
  const slot = owned ? String(row.slot || 'hero').trim() : '';
  if (owned) await scrubContentReferences(store, { contentId, slot, imageUrl });
  await store.deleteDoc(galleryCollection, id);
  return { ok: true, id, galleryCollection, contentId, slot, storageDeleted, sharedWith };
}

async function readFolders(store) {
  const doc = await store
    .readDoc('admin_config', GALLERY_FOLDERS_CONFIG_ID, ADMIN_CONFIG_PARTITION)
    .catch(() => null);
  return cleanFolderList([...SEED_FOLDERS, ...(doc?.folders || [])]);
}

// ── bulk ──────────────────────────────────────────────────────────────────

/** `{ action, items }` of a bulk body, bounded, or the 400 to answer. */
function parseBulkRequest(body) {
  const action = String(body.action || '').trim();
  if (!BULK_ACTIONS.includes(action)) {
    return refuse(400, `action must be one of ${BULK_ACTIONS.join(', ')}`);
  }
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((item) => ({
      id: String(item?.id || '').trim(),
      galleryCollection: String(item?.galleryCollection || 'generated_content_images'),
    }))
    .filter((item) => item.id && GALLERY_COLLECTIONS.includes(item.galleryCollection));
  if (!items.length) return refuse(400, 'items required');
  if (items.length > BULK_LIMIT) return refuse(400, `At most ${BULK_LIMIT} items per request`);
  return { ok: true, action, items };
}

/** One bulk item: deleted, or patched against ITS OWN document. Never throws. */
async function applyBulkAction({ store, deleteOne }, { item, action, body, stamps, context }) {
  try {
    if (action === 'delete') {
      const result = await deleteOne(item, context);
      return result.ok
        ? { id: item.id, ok: true, storageDeleted: result.storageDeleted }
        : { id: item.id, ok: false, error: result.error };
    }
    const existing = await store.readDoc(item.galleryCollection, item.id, item.id);
    if (!existing) return { id: item.id, ok: false, error: 'not found' };
    const patch = buildBulkPatch(action, existing, body, stamps);
    await store.patchDoc(item.galleryCollection, item.id, patch);
    return { id: item.id, ok: true, customTags: patch.customTags };
  } catch (error) {
    return { id: item.id, ok: false, error: error?.message || 'failed' };
  }
}

// ── import ────────────────────────────────────────────────────────────────

/** Why an import cannot start: a non-http(s) URL, or a route with no upload. */
function importRefusal(url, storage) {
  if (!/^https?:\/\//i.test(url)) return refuse(400, 'url must be http(s)');
  if (typeof storage?.uploadBlob !== 'function') {
    return refuse(503, 'Blob upload is not configured on this route');
  }
  return null;
}

/** The guarded fetch, with a thrown error as 422 and a refusal as 415. */
async function fetchForImport(fetchImage, url) {
  let fetched;
  try {
    fetched = await fetchImage(url);
  } catch (error) {
    const reason = String(error?.message || error).replace(url, '[url]');
    return refuse(422, `Could not fetch image: ${reason}`);
  }
  if (fetched.refused) return refuse(415, fetched.reason);
  return { ok: true, buffer: fetched.buffer, contentType: fetched.contentType };
}

/** The gallery row already holding these bytes or this source URL, or null. */
async function findImportDuplicate(store, { sha, source }) {
  if (typeof store.queryDocs !== 'function') return null;
  const dupes = await store
    .queryDocs(
      'generated_content_images',
      'SELECT TOP 1 c.id, c.imageUrl, c.title FROM c WHERE c.sha256 = @sha OR c.sourceUrl = @url',
      [
        { name: '@sha', value: sha },
        { name: '@url', value: source },
      ]
    )
    .catch(() => []);
  return dupes?.length ? dupes[0] : null;
}

/** The URL's last path segment without its extension, or ''. */
function importFileName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '').replace(
      /\.[^.]+$/,
      ''
    );
  } catch {
    return '';
  }
}

/** `image-gallery/imports/{stamp}-{slug}.{ext}` under the covers container. */
function importBlobPath(title, ext, nowIso) {
  const stamp = nowIso
    .replace(/[-:TZ]/g, '')
    .replace(/\..*$/, '')
    .slice(0, 14);
  const slug =
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'import';
  return `image-gallery/imports/${stamp}-${slug}.${ext}`;
}

/** The gallery record an import creates. */
function importedImageDoc({
  id,
  body,
  url,
  source,
  title,
  blobPath,
  buffer,
  contentType,
  ext,
  sha,
  nowIso,
  who,
}) {
  const measured = measureImage(buffer, contentType);
  const license = String(body.license || '').toLowerCase();
  return {
    id,
    articleId: 'import',
    contentId: '',
    imageUrl: mediaUrlFor('covers', blobPath),
    title,
    altText: String(body.altText || '').trim() || title,
    caption: String(body.caption || '').trim(),
    license: LICENSES.includes(license) ? license : 'other',
    credit: String(body.credit || '').trim() || new URL(url).hostname,
    provider: lower(body.provider),
    slot: String(body.slot || '').trim(),
    customTags: cleanTagList(body.tags ?? body.customTags),
    folder: cleanFolder(body.folder),
    archived: false,
    archivedAt: null,
    softDeletedAt: null,
    approvalStatus: 'approved',
    sourceCollection: 'import',
    sourceUrl: source,
    storagePath: `covers/${blobPath}`,
    bytes: buffer.length,
    format: ext,
    width: measured?.width ?? null,
    height: measured?.height ?? null,
    sha256: sha,
    promptSet: '',
    promptSetId: '',
    promptName: '',
    promptTemplateVersion: '',
    usageCount: 0,
    usedByContentIds: [],
    createdAt: nowIso,
    createdBy: who,
    updatedAt: nowIso,
    updatedBy: who,
  };
}

// ── usage ─────────────────────────────────────────────────────────────────

/** Why a usage read cannot start, or null. */
function usageRefusal(id, collection) {
  if (!id) return refuse(400, 'id required');
  if (!GALLERY_COLLECTIONS.includes(collection)) return refuse(400, 'Invalid collection');
  return null;
}

/** Live content documents pointing at `@u` through any image field. */
const USAGE_QUERY =
  `SELECT TOP 100 ${CONTENT_USAGE_PROJECTION} FROM c WHERE NOT IS_DEFINED(c.softDeletedAt) AND (` +
  'c.heroImageUrl = @u OR c.altCoverImage = @u OR c.contentImageUrl = @u OR c.coverImage = @u OR c["Cover Image"] = @u ' +
  'OR c.aiImageUrls.hero = @u OR c.aiImageUrls.secondary1 = @u OR c.aiImageUrls.secondary2 = @u OR c.aiImageUrls.secondary3 = @u OR c.aiImageUrls.content = @u ' +
  'OR ARRAY_CONTAINS(c.secondaryImageUrls, @u))';

/** Other rows generated for the same content and slot. */
const VARIANTS_QUERY =
  'SELECT TOP 50 c.id, c.imageUrl, c.title, c.createdAt, c.promptSet, c.promptName, c.approvalStatus, c.softDeletedAt, c.archivedAt FROM c WHERE c.contentId = @cid AND c.slot = @slot AND c.id != @id';

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function, patchDoc: Function, deleteDoc: Function }} deps.store
 * @param {{ deleteBlob: Function, uploadBlob?: Function }} deps.storage
 * @param {Function} [deps.fetchImage] the guarded fetcher (import-from-URL)
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createGalleryImageHandlers({
  guard,
  store,
  storage,
  fetchImage = defaultFetchImage,
  now = () => new Date(),
  uuid = randomUUID,
}) {
  const actor = (user) => user.email || user.preferred_username || user.oid || 'admin';
  const guarded = guardedWith(guard);
  const deleteOne = (target, context) => deleteOneRow({ store, storage }, target, context);
  const readBody = async (request) => (await request.json().catch(() => null)) || {};

  return {
    /** POST /api/saveContentImageOrder — source :4967; editor. */
    saveContentImageOrder: guarded(
      'editor',
      'saveContentImageOrder',
      'Failed to save image order',
      async ({ request, user }) => {
        const body = await readBody(request);
        const { contentId, imageUrls = [] } = body;
        if (!contentId || typeof contentId !== 'string') {
          return json(400, { error: 'contentId required' });
        }
        if (!Array.isArray(imageUrls)) {
          return json(400, { error: 'imageUrls array required' });
        }

        const contentData = await store.readDoc('content', contentId, contentId);
        if (!contentData) return json(404, { error: `content ${contentId} not found` });

        const updates = buildContentImageUpdates(imageUrls, contentData);
        await store.patchDoc('content', contentId, {
          heroImageUrl: updates.heroImageUrl || undefined,
          contentImageUrl: updates.contentImageUrl || undefined,
          altCoverImage: updates.altCoverImage || undefined,
          secondaryImageUrls:
            updates.secondaryImageUrls.length > 0 ? updates.secondaryImageUrls : undefined,
          aiImageUrls: updates.aiImageUrls,
          updatedAt: now().toISOString(),
          updatedBy: actor(user),
        });

        return json(200, { success: true, contentId, imageCount: imageUrls.length });
      }
    ),

    /** POST /api/updateGalleryImageMetadata — source :5156; editor; partial. */
    updateGalleryImageMetadata: guarded(
      'editor',
      'updateGalleryImageMetadata',
      'Failed to update image metadata',
      async ({ request, user }) => {
        const body = await readBody(request);
        const validated = validateGalleryImageMetadataRequest(body);
        if (!validated.ok) return json(validated.status, { error: validated.error });
        const { imageId, galleryCollection } = validated;

        const existing = await store.readDoc(galleryCollection, imageId, imageId);
        if (!existing) return json(404, { error: `${galleryCollection}/${imageId} not found` });

        const updateData = buildMetadataPatch(validated, {
          nowIso: now().toISOString(),
          actor: actor(user),
        });
        await store.patchDoc(galleryCollection, imageId, updateData);
        return json(200, { success: true, imageId, galleryCollection, ...updateData });
      }
    ),

    /** POST /api/createManualGalleryImageRecord — source :5304; editor. */
    createManualGalleryImageRecord: guarded(
      'editor',
      'createManualGalleryImageRecord',
      'Failed to create image record',
      async ({ request, user }) => {
        const body = await readBody(request);
        if (!String(body.imageUrl || '').trim()) {
          return json(400, { error: 'imageUrl required' });
        }

        const nowIso = now().toISOString();
        const who = actor(user);
        const customTags = cleanTagList(body.customTags);
        const title = String(body.title || '').trim() || 'Uploaded image';
        const doc = {
          id: uuid(),
          articleId: String(body.articleId || 'manual-upload').trim(),
          contentId: '',
          imageUrl: String(body.imageUrl).trim(),
          provider: String(body.provider || '').trim(),
          title,
          altText: String(body.altText || '').trim() || title,
          caption: String(body.caption || '').trim(),
          license: String(body.license || 'owned')
            .trim()
            .toLowerCase(),
          credit: String(body.credit || '').trim(),
          slot: String(body.slot || '').trim(),
          customTags,
          folder: cleanFolder(body.folder),
          archived: false,
          archivedAt: null,
          softDeletedAt: null,
          theme: String(body.theme || '').trim(),
          style: String(body.style || '').trim(),
          promptSet: String(body.promptSet || '').trim(),
          promptSetId: String(body.promptSet || '').trim(),
          promptName: String(body.promptName || '').trim(),
          promptTemplateVersion: String(body.promptTemplateVersion || '').trim(),
          approvalStatus: String(body.approvalStatus || 'approved').trim(),
          usageCount: 0,
          usedByContentIds: [],
          lastUsedAt: null,
          sourceCollection: 'manual_upload',
          storagePath: String(body.storagePath || '').trim(),
          width: optionalInt(body.width) ?? null,
          height: optionalInt(body.height) ?? null,
          bytes: optionalInt(body.bytes) ?? null,
          format:
            String(body.format || '')
              .trim()
              .toLowerCase()
              .replace(/^image\//, '') || null,
          sha256: /^[a-f0-9]{64}$/i.test(String(body.sha256 || ''))
            ? String(body.sha256).toLowerCase()
            : '',
          createdAt: nowIso,
          createdBy: who,
          updatedAt: nowIso,
          updatedBy: who,
        };
        await store.upsertDoc('generated_content_images', doc);
        return json(200, { success: true, imageId: doc.id });
      }
    ),

    /** POST /api/deleteCuratedGeneratedImage — source :7095; editor. */
    deleteCuratedGeneratedImage: guarded(
      'editor',
      'deleteCuratedGeneratedImage',
      'Failed to delete curated image',
      async ({ request, context }) => {
        const { articleId } = await readBody(request);
        if (!articleId || typeof articleId !== 'string') {
          return json(400, { error: 'articleId is required' });
        }
        const result = await deleteOne(
          { galleryCollection: 'curated_article_images', id: articleId },
          context
        );
        if (!result.ok) return json(result.status, { error: result.error });
        return json(200, {
          success: true,
          articleId,
          storageDeleted: result.storageDeleted,
          sharedWith: result.sharedWith,
        });
      }
    ),

    /** POST /api/deleteContentGeneratedImage — source :7193; editor. */
    deleteContentGeneratedImage: guarded(
      'editor',
      'deleteContentGeneratedImage',
      'Failed to delete generated image',
      async ({ request, context }) => {
        const { imageId } = await readBody(request);
        if (!imageId || typeof imageId !== 'string') {
          return json(400, { error: 'imageId is required' });
        }
        const result = await deleteOne(
          { galleryCollection: 'generated_content_images', id: imageId },
          context
        );
        if (!result.ok) return json(result.status, { error: result.error });
        return json(200, {
          success: true,
          imageId,
          contentId: result.contentId,
          slot: result.slot,
          sourceCollection: 'content',
          storageDeleted: result.storageDeleted,
          sharedWith: result.sharedWith,
        });
      }
    ),

    /**
     * POST /api/cms/images/bulk — { items: [{id, galleryCollection}], action,
     * addTags?, removeTags?, folder?, fields? } → per-item results. One
     * request for a selection, each item patched against ITS OWN document.
     */
    bulkGalleryImages: guarded(
      'editor',
      'bulkGalleryImages',
      'Failed to update images',
      async ({ request, context, user }) => {
        const body = await readBody(request);
        const parsed = parseBulkRequest(body);
        if (!parsed.ok) return json(parsed.status, { error: parsed.error });
        const { action, items } = parsed;
        const stamps = { nowIso: now().toISOString(), actor: actor(user) };
        const results = [];
        for (const item of items) {
          results.push(
            await applyBulkAction({ store, deleteOne }, { item, action, body, stamps, context })
          );
        }
        const updated = results.filter((r) => r.ok).length;
        return json(200, {
          success: updated > 0,
          action,
          updated,
          failed: results.length - updated,
          results,
        });
      }
    ),

    /** GET /api/cms/images/folders — the persisted folder list plus the seeds. */
    getGalleryFolders: guarded(
      'editor',
      'getGalleryFolders',
      'Failed to load folders',
      async () => json(200, { success: true, folders: await readFolders(store) }),
      { withMessage: false }
    ),

    /** PUT /api/cms/images/folders — { folders: [] } replaces the list. */
    putGalleryFolders: guarded(
      'editor',
      'putGalleryFolders',
      'Failed to save folders',
      async ({ request, user }) => {
        const body = await readBody(request);
        if (!Array.isArray(body.folders)) return json(400, { error: 'folders array required' });
        const folders = cleanFolderList(body.folders);
        const nowIso = now().toISOString();
        const existing = await store
          .readDoc('admin_config', GALLERY_FOLDERS_CONFIG_ID, ADMIN_CONFIG_PARTITION)
          .catch(() => null);
        if (existing) {
          await store.patchDoc(
            'admin_config',
            GALLERY_FOLDERS_CONFIG_ID,
            { folders, updatedAt: nowIso, updatedBy: actor(user) },
            { partitionKey: ADMIN_CONFIG_PARTITION }
          );
        } else {
          await store.upsertDoc('admin_config', {
            id: GALLERY_FOLDERS_CONFIG_ID,
            configScope: ADMIN_CONFIG_PARTITION,
            folders,
            createdAt: nowIso,
            updatedAt: nowIso,
            updatedBy: actor(user),
          });
        }
        return json(200, {
          success: true,
          folders: cleanFolderList([...SEED_FOLDERS, ...folders]),
        });
      },
      { withMessage: false }
    ),

    /**
     * POST /api/cms/images/import — { url, title?, folder?, tags?, provider?,
     * slot?, altText?, caption?, license?, credit?, force? }. Fetches through
     * the guarded fetcher (protocol and private-IP checks, size cap, media
     * type gate), stores under covers/image-gallery/imports/, creates the
     * record. A byte-identical or same-URL image already in the gallery
     * answers 409 with that record unless `force` is set.
     */
    importGalleryImage: guarded(
      'editor',
      'importGalleryImage',
      'Failed to import image',
      async ({ request, user }) => {
        const body = await readBody(request);
        const url = String(body.url || '').trim();
        const refused = importRefusal(url, storage);
        if (refused) return json(refused.status, { error: refused.error });

        const fetched = await fetchForImport(fetchImage, url);
        if (!fetched.ok) return json(fetched.status, { error: fetched.error });
        const { buffer, contentType } = fetched;
        const ext = requireImageExtension(contentType);
        const sha = sha256Hex(buffer);
        const source = sourceOf(url);

        const duplicate =
          body.force === true ? null : await findImportDuplicate(store, { sha, source });
        if (duplicate) {
          return json(409, {
            error: 'This image is already in the gallery',
            duplicateOf: duplicate.id,
            imageUrl: duplicate.imageUrl,
            title: duplicate.title,
          });
        }

        const nowIso = now().toISOString();
        const title = String(body.title || '').trim() || importFileName(url) || 'Imported image';
        const blobPath = importBlobPath(title, ext, nowIso);
        await storage.uploadBlob('covers', blobPath, buffer, contentType, { sourceUrl: source });
        const doc = importedImageDoc({
          id: uuid(),
          body,
          url,
          source,
          title,
          blobPath,
          buffer,
          contentType,
          ext,
          sha,
          nowIso,
          who: actor(user),
        });
        await store.upsertDoc('generated_content_images', doc);
        return json(200, {
          success: true,
          imageId: doc.id,
          imageUrl: doc.imageUrl,
          bytes: doc.bytes,
          width: doc.width,
          height: doc.height,
          format: ext,
        });
      }
    ),

    /**
     * GET /api/cms/images/{id}/usage?collection= — the content documents
     * using this image (by URL match on every image field) and its variants
     * (other rows for the same content and slot).
     */
    getImageUsage: guarded(
      'editor',
      'getImageUsage',
      'Failed to read image usage',
      async ({ request }) => {
        const id = String(request.params.id || '').trim();
        const collection = String(request.query.get('collection') || 'generated_content_images');
        const refused = usageRefusal(id, collection);
        if (refused) return json(refused.status, { error: refused.error });
        const row = await store.readDoc(collection, id, id);
        if (!row) return json(404, { error: `${collection}/${id} not found` });
        const item = normalizeGalleryRow(row, collection);
        const usedBy = item.imageUrl
          ? await store.queryDocs('content', USAGE_QUERY, [{ name: '@u', value: item.imageUrl }])
          : [];
        const usage = buildContentUsageIndex(usedBy).get(item.imageUrl) || [];
        const variants =
          item.contentId && item.slot
            ? await store.queryDocs('generated_content_images', VARIANTS_QUERY, [
                { name: '@cid', value: item.contentId },
                { name: '@slot', value: item.slot },
                { name: '@id', value: id },
              ])
            : [];
        return json(200, {
          success: true,
          id,
          imageUrl: item.imageUrl,
          usedBy: usage,
          usageCount: new Set(usage.map((u) => u.id)).size,
          variants: (variants || []).sort(
            (a, b) => dateValue(b.createdAt) - dateValue(a.createdAt)
          ),
        });
      },
      { withMessage: false }
    ),

    /** POST /api/deleteRejectedContent — source :2376/:5807; publisher. */
    deleteRejectedContent: guarded(
      'publisher',
      'deleteRejectedContent',
      'Failed to delete rejected content',
      async ({ request, auth }) => {
        const body = await readBody(request);
        const { olderThanHours = null, limit = 500 } = body;
        const maxLimit = Math.min(Number(limit) || 500, 499);
        const nowDate = now();
        const cutoffMs =
          typeof olderThanHours === 'number' && olderThanHours > 0
            ? nowDate.getTime() - olderThanHours * 60 * 60 * 1000
            : null;

        const rows = await store.queryDocs(
          'content',
          `SELECT TOP ${maxLimit} c.id, c["softDeletedAt"], c["rejectedAt"], c["reviewedAt"], c["updatedAt"] FROM c WHERE c.contentStatus = 'rejected'`,
          []
        );

        const dateOf = (d) => {
          const v = d.rejectedAt || d.reviewedAt || d.updatedAt;
          const parsed = v ? new Date(v) : null;
          return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : null;
        };
        const toMark = rows.filter((d) => {
          if (d.softDeletedAt) return false;
          if (cutoffMs === null) return true;
          const ref = dateOf(d);
          return ref !== null && ref < cutoffMs;
        });

        const nowIso = nowDate.toISOString();
        for (const doc of toMark) {
          await store.patchDoc('content', doc.id, {
            softDeletedAt: nowIso,
            softDeletedReason: 'rejected_aged_out',
          });
        }

        if (toMark.length > 0) {
          await store.upsertDoc('admin_audit_logs', {
            id: uuid(),
            action: 'soft_deleted_rejected_content',
            actor: 'admin-rpc',
            userId: auth.user.oid ?? null,
            userEmail: auth.user.email || null,
            timestamp: nowIso,
            details: {
              affectedCount: toMark.length,
              examinedCount: rows.length,
              olderThanHours: typeof olderThanHours === 'number' ? olderThanHours : null,
              affectedIds: toMark.slice(0, 50).map((d) => d.id),
            },
            compliance: { schemaVersion: 1, detailsSanitized: true, identityVerified: true },
          });
        }

        return json(200, {
          success: true,
          deletedCount: toMark.length,
          softDeletedCount: toMark.length,
          examinedCount: rows.length,
          hasMore: rows.length === maxLimit,
        });
      }
    ),
  };
}
