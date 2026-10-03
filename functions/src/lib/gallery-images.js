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
import { createHash, randomUUID } from 'node:crypto';
import { buildContentImageUpdates } from './content-workflow.js';
import { ADMIN_CONFIG_PARTITION } from './cosmos-client.js';
import { mediaUrlFor } from './blob-paths.js';
import { fetchImage as defaultFetchImage, requireImageExtension } from './triggers/fetch-image.js';
import { sourceOf } from './cms/inline-images.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

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

// ── image bytes ───────────────────────────────────────────────────────────

/**
 * Pixel dimensions from the first bytes of a PNG, GIF, JPEG or WebP, or null
 * when the format is not one of those or the header is truncated. No decoder
 * dependency: these are the header layouts, and a wrong answer here only
 * costs a missing "1920 × 1080" on a card.
 */
export function measureImage(buffer, contentType = '') {
  if (!buffer || typeof buffer.length !== 'number' || buffer.length < 10) return null;
  const type = String(contentType || '').toLowerCase();
  try {
    if (type.includes('png') || buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
      if (buffer.length < 24) return null;
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (type.includes('gif') || buffer.slice(0, 3).toString('ascii') === 'GIF') {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (type.includes('webp') || buffer.slice(8, 12).toString('ascii') === 'WEBP') {
      if (buffer.length < 30) return null;
      const chunk = buffer.slice(12, 16).toString('ascii');
      if (chunk === 'VP8 ') {
        return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
      }
      if (chunk === 'VP8L') {
        const b0 = buffer[21];
        const b1 = buffer[22];
        const b2 = buffer[23];
        const b3 = buffer[24];
        return {
          width: 1 + (((b1 & 0x3f) << 8) | b0),
          height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
        };
      }
      if (chunk === 'VP8X') {
        return {
          width: 1 + buffer.readUIntLE(24, 3),
          height: 1 + buffer.readUIntLE(27, 3),
        };
      }
      return null;
    }
    if (type.includes('jpeg') || type.includes('jpg') || (buffer[0] === 0xff && buffer[1] === 0xd8)) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 2;
          continue;
        }
        const length = buffer.readUInt16BE(offset + 2);
        // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Hex sha256 of the bytes — the duplicate key. */
export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
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
    provider, slot, title, folder,
    customTags: customTags ?? tags,
    theme, style,
    promptSet, promptName, promptTemplateVersion, approvalStatus, archived, trash,
    altText, caption, license, credit, width, height, bytes, format,
  };
}

const cleanTagList = (value) =>
  Array.isArray(value)
    ? [...new Set(value.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean))]
    : [];

const cleanFolder = (value) => String(value || 'default').trim().toLowerCase() || 'default';

const optionalInt = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
};

/**
 * The patch a metadata request produces. Pure so the field rules are
 * testable: absent fields never write, `archived`/`trash` booleans become the
 * `archivedAt`/`softDeletedAt` stamps the listing filters on, and
 * `customTags` REPLACES (the bulk route is where per-item toggling lives).
 */
export function buildMetadataPatch(validated, { nowIso, actor }) {
  const {
    provider, slot, title, folder, customTags, theme, style, promptSet, promptName,
    promptTemplateVersion, approvalStatus, archived, trash, altText, caption, license, credit,
    width, height, bytes, format,
  } = validated;
  const updateData = { updatedAt: nowIso, updatedBy: actor };
  const text = (key, value, { fallback = '', max = 2000 } = {}) => {
    if (value === undefined || value === null) return;
    updateData[key] = String(value || '').trim().slice(0, max) || fallback;
  };
  if (provider !== undefined && provider !== null) {
    updateData.provider = String(provider || '').trim().toLowerCase();
  }
  if (slot !== undefined) {
    updateData.slot = String(slot || '').trim();
  }
  text('title', title, { fallback: 'Uploaded image', max: 300 });
  if (folder !== undefined && folder !== null) updateData.folder = cleanFolder(folder);
  if (customTags !== undefined && customTags !== null) {
    updateData.customTags = cleanTagList(customTags);
  }
  text('theme', theme);
  text('style', style);
  text('promptSet', promptSet, { max: 120 });
  if (promptSet !== undefined && promptSet !== null) {
    updateData.promptSetId = updateData.promptSet;
    updateData.setId = updateData.promptSet;
  }
  text('promptName', promptName, { max: 120 });
  text('promptTemplateVersion', promptTemplateVersion, { max: 160 });
  text('altText', altText, { max: 500 });
  text('caption', caption, { max: 1000 });
  text('credit', credit, { max: 300 });
  if (license !== undefined && license !== null) {
    const value = String(license || '').trim().toLowerCase();
    updateData.license = LICENSES.includes(value) ? value : 'other';
  }
  if (approvalStatus !== undefined && approvalStatus !== null) {
    const normalized = String(approvalStatus || 'draft').trim();
    updateData.approvalStatus = APPROVAL_STATUSES.includes(normalized) ? normalized : 'draft';
  }
  if (archived !== undefined && archived !== null) {
    updateData.archived = archived === true;
    updateData.archivedAt = archived === true ? nowIso : null;
  }
  if (trash !== undefined && trash !== null) {
    updateData.softDeletedAt = trash === true ? nowIso : null;
  }
  for (const [key, value] of [
    ['width', width],
    ['height', height],
    ['bytes', bytes],
  ]) {
    const n = optionalInt(value);
    if (n !== undefined) updateData[key] = n;
  }
  if (format !== undefined && format !== null) {
    updateData.format = String(format || '').trim().toLowerCase().replace(/^image\//, '').slice(0, 20);
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

const dateValue = (v) => {
  if (!v) return 0;
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

/** The normalised `source` id for a row: where the image came from. */
export function sourceIdFor(row = {}, collection = '') {
  const raw = String(row.sourceCollection || '').trim();
  if (collection === 'curated_article_images' || raw === 'curated_article_images') return 'curated';
  if (raw === 'manual_upload') return 'upload';
  if (raw === 'preview') return 'preview';
  if (raw === 'import') return 'import';
  if (raw === 'rehost') return 'rehost';
  if (raw === 'content' || raw === 'generated_content_images' || raw === 'blogs') return 'ai-cover';
  return raw ? 'other' : 'ai-cover';
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
    contentId: String(row.contentId || (collection === 'curated_article_images' ? '' : row.articleId || '')),
    imageUrl: String(row.imageUrl || ''),
    title: String(row.title || row.articleTitle || row.articleId || row.id || 'Untitled'),
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

/** URL → the content documents using it, with the field each one uses it in. */
export function buildContentUsageIndex(contentRows = []) {
  const index = new Map();
  const add = (url, entry) => {
    const key = String(url || '').trim();
    if (!key) return;
    const list = index.get(key) || [];
    if (!list.some((e) => e.id === entry.id && e.field === entry.field)) list.push(entry);
    index.set(key, list);
  };
  for (const doc of contentRows || []) {
    if (!doc?.id) continue;
    const base = {
      id: doc.id,
      title: String(doc.Title || doc.title || doc.id),
      status: String(doc.contentStatus || ''),
      type: String(doc.type || ''),
    };
    for (const field of CONTENT_IMAGE_FIELDS) add(doc[field], { ...base, field });
    for (const [slot, url] of Object.entries(doc.aiImageUrls || {})) {
      add(url, { ...base, field: `aiImageUrls.${slot}` });
    }
    for (const url of Array.isArray(doc.secondaryImageUrls) ? doc.secondaryImageUrls : []) {
      add(url, { ...base, field: 'secondaryImageUrls' });
    }
  }
  return index;
}

/** Mark every later row that shares a sha or URL with an earlier one. */
export function markDuplicates(items) {
  const oldestFirst = [...items].sort((a, b) => dateValue(a.createdAt) - dateValue(b.createdAt));
  const byKey = new Map();
  for (const item of oldestFirst) {
    const keys = [item.sha256 ? `sha:${item.sha256}` : '', item.imageUrl ? `url:${item.imageUrl}` : ''].filter(Boolean);
    const canonical = keys.map((key) => byKey.get(key)).find(Boolean);
    if (canonical && canonical.id !== item.id) item.duplicateOf = canonical.id;
    for (const key of keys) if (!byKey.has(key)) byKey.set(key, item);
  }
  return items;
}

const STATES = ['active', 'archived', 'trash', 'all'];
const SORTS = ['newest', 'oldest', 'title', 'most-used'];
export const GALLERY_MAX_LIMIT = 200;

/** Query-string → listing params, every value bounded. */
export function parseGalleryListParams(get) {
  const str = (key) => String(get(key) || '').trim();
  const state = str('state').toLowerCase();
  const sort = str('sort').toLowerCase();
  return {
    q: str('q').toLowerCase().slice(0, 200),
    folder: str('folder').toLowerCase(),
    source: str('source').toLowerCase(),
    provider: str('provider').toLowerCase(),
    slot: str('slot').toLowerCase(),
    tag: str('tag').toLowerCase(),
    set: str('set'),
    contentId: str('contentId'),
    articleId: str('articleId'),
    state: STATES.includes(state) ? state : 'active',
    sort: SORTS.includes(sort) ? sort : 'newest',
    offset: Math.max(Number(get('offset')) || 0, 0),
    limit: Math.min(Math.max(Number(get('limit')) || 60, 1), GALLERY_MAX_LIMIT),
    usage: ['1', 'true'].includes(str('usage').toLowerCase()),
  };
}

function matchesParams(item, p) {
  if (p.state === 'trash') {
    if (!item.softDeletedAt) return false;
  } else if (p.state === 'archived') {
    if (item.softDeletedAt || !item.archivedAt) return false;
  } else if (p.state === 'active') {
    if (item.softDeletedAt || item.archivedAt) return false;
  }
  if (p.folder && p.folder !== 'all') {
    if (p.folder === '--none--') {
      if (item.folder !== 'default') return false;
    } else if (item.folder !== p.folder) return false;
  }
  if (p.source && p.source !== 'all' && item.source !== p.source) return false;
  if (p.provider && p.provider !== 'all' && item.provider.toLowerCase() !== p.provider) return false;
  if (p.slot && p.slot !== 'all' && item.slot.toLowerCase() !== p.slot) return false;
  if (p.tag && p.tag !== 'all' && !item.customTags.includes(p.tag)) return false;
  if (p.set && item.promptSet !== p.set && item.promptSetId !== p.set) return false;
  if (p.contentId && item.contentId !== p.contentId && item.articleId !== p.contentId) return false;
  if (p.articleId && item.articleId !== p.articleId) return false;
  if (p.q) {
    const haystack = [
      item.title,
      item.altText,
      item.caption,
      item.customTags.join(' '),
      item.prompt,
      item.promptSet,
      item.promptName,
      item.articleId,
      item.imageUrl,
      item.provider,
      item.slot,
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(p.q)) return false;
  }
  return true;
}

function sortItems(items, sort) {
  const byNewest = (a, b) => dateValue(b.createdAt) - dateValue(a.createdAt);
  switch (sort) {
    case 'oldest':
      return items.sort((a, b) => dateValue(a.createdAt) - dateValue(b.createdAt));
    case 'title':
      return items.sort((a, b) => a.title.localeCompare(b.title) || byNewest(a, b));
    case 'most-used':
      return items.sort((a, b) => b.usageCount - a.usageCount || byNewest(a, b));
    default:
      return items.sort(byNewest);
  }
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
  const matched = sortItems(all.filter((item) => matchesParams(item, params)), params.sort);
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

export const SEED_FOLDERS = Object.freeze(['default', 'aws', 'azure', 'gcp', 'finops', 'architecture']);

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

/**
 * The patch one bulk action produces for one item, given the item's own
 * tags. `tag` ADDS and REMOVES against what the item has — the whole point:
 * the page used to send the toggle set as the new tag list, erasing every
 * tag not on screen.
 */
export function buildBulkPatch(action, existing, body, { nowIso, actor }) {
  const base = { updatedAt: nowIso, updatedBy: actor };
  switch (action) {
    case 'tag': {
      const add = cleanTagList(body.addTags);
      const remove = new Set(cleanTagList(body.removeTags));
      const current = cleanTagList(existing.customTags);
      return { ...base, customTags: [...new Set([...current.filter((t) => !remove.has(t)), ...add])] };
    }
    case 'move':
      return { ...base, folder: cleanFolder(body.folder) };
    case 'archive':
      return { ...base, archived: true, archivedAt: nowIso };
    case 'restore':
      return { ...base, archived: false, archivedAt: null, softDeletedAt: null };
    case 'trash':
      return { ...base, softDeletedAt: nowIso };
    case 'untrash':
      return { ...base, softDeletedAt: null };
    case 'set': {
      const validated = validateGalleryImageMetadataRequest({
        imageId: existing.id,
        galleryCollection: 'generated_content_images',
        ...(body.fields || {}),
      });
      return validated.ok ? buildMetadataPatch(validated, { nowIso, actor }) : base;
    }
    default:
      return null;
  }
}

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

  /** Rows in either container (other than `excludeId`) that point at `imageUrl`. */
  async function otherRowsSharing(imageUrl, excludeId) {
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

  async function deleteBlobFor({ imageUrl, storagePath }, context) {
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

  /** Permanent delete of one row: blob (if unshared), content references, the row. */
  async function deleteOne({ galleryCollection, id }, context) {
    const row = await store.readDoc(galleryCollection, id, id);
    if (!row) return { ok: false, status: 404, error: `${galleryCollection}/${id} not found` };
    const imageUrl = String(row.imageUrl || '').trim();
    const sharedWith = await otherRowsSharing(imageUrl, id);
    const storageDeleted =
      sharedWith > 0
        ? false
        : await deleteBlobFor({ imageUrl, storagePath: row.storagePath }, context);

    let contentId = '';
    let slot = '';
    if (galleryCollection === 'generated_content_images') {
      contentId = String(row.contentId || row.articleId || '').trim();
      slot = String(row.slot || 'hero').trim();
      // Scrub every reference on the owning content doc.
      if (contentId && contentId !== 'manual-upload') {
        const contentData = await store.readDoc('content', contentId, contentId).catch(() => null);
        if (contentData) {
          const updates = buildContentImageRemovalUpdates(contentData, { slot, imageUrl });
          await store.patchDoc('content', contentId, updates);
        }
      }
    }
    await store.deleteDoc(galleryCollection, id);
    return { ok: true, id, galleryCollection, contentId, slot, storageDeleted, sharedWith };
  }

  async function readFolders() {
    const doc = await store
      .readDoc('admin_config', GALLERY_FOLDERS_CONFIG_ID, ADMIN_CONFIG_PARTITION)
      .catch(() => null);
    return cleanFolderList([...SEED_FOLDERS, ...(doc?.folders || [])]);
  }

  return {
    /** POST /api/saveContentImageOrder — source :4967; editor. */
    async saveContentImageOrder(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
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
      } catch (error) {
        context.error('saveContentImageOrder failed:', error);
        return json(500, { error: 'Failed to save image order', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/updateGalleryImageMetadata — source :5156; editor; partial. */
    async updateGalleryImageMetadata(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
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
      } catch (error) {
        context.error('updateGalleryImageMetadata failed:', error);
        return json(500, { error: 'Failed to update image metadata', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/createManualGalleryImageRecord — source :5304; editor. */
    async createManualGalleryImageRecord(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
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
          license: String(body.license || 'owned').trim().toLowerCase(),
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
          format: String(body.format || '').trim().toLowerCase().replace(/^image\//, '') || null,
          sha256: /^[a-f0-9]{64}$/i.test(String(body.sha256 || '')) ? String(body.sha256).toLowerCase() : '',
          createdAt: nowIso,
          createdBy: who,
          updatedAt: nowIso,
          updatedBy: who,
        };
        await store.upsertDoc('generated_content_images', doc);
        return json(200, { success: true, imageId: doc.id });
      } catch (error) {
        context.error('createManualGalleryImageRecord failed:', error);
        return json(500, { error: 'Failed to create image record', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/deleteCuratedGeneratedImage — source :7095; editor. */
    async deleteCuratedGeneratedImage(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { articleId } = body;
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
      } catch (error) {
        context.error('deleteCuratedGeneratedImage failed:', error);
        return json(500, { error: 'Failed to delete curated image', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/deleteContentGeneratedImage — source :7193; editor. */
    async deleteContentGeneratedImage(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { imageId } = body;
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
      } catch (error) {
        context.error('deleteContentGeneratedImage failed:', error);
        return json(500, { error: 'Failed to delete generated image', message: error?.message || 'Unknown error' });
      }
    },

    /**
     * POST /api/cms/images/bulk — { items: [{id, galleryCollection}], action,
     * addTags?, removeTags?, folder?, fields? } → per-item results. One
     * request for a selection, each item patched against ITS OWN document.
     */
    async bulkGalleryImages(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;
      try {
        const body = (await request.json().catch(() => null)) || {};
        const action = String(body.action || '').trim();
        if (!BULK_ACTIONS.includes(action)) {
          return json(400, { error: `action must be one of ${BULK_ACTIONS.join(', ')}` });
        }
        const items = (Array.isArray(body.items) ? body.items : [])
          .map((item) => ({
            id: String(item?.id || '').trim(),
            galleryCollection: String(item?.galleryCollection || 'generated_content_images'),
          }))
          .filter((item) => item.id && GALLERY_COLLECTIONS.includes(item.galleryCollection));
        if (!items.length) return json(400, { error: 'items required' });
        if (items.length > BULK_LIMIT) {
          return json(400, { error: `At most ${BULK_LIMIT} items per request` });
        }
        const nowIso = now().toISOString();
        const who = actor(user);
        const results = [];
        for (const item of items) {
          try {
            if (action === 'delete') {
              const result = await deleteOne(item, context);
              results.push(
                result.ok
                  ? { id: item.id, ok: true, storageDeleted: result.storageDeleted }
                  : { id: item.id, ok: false, error: result.error }
              );
              continue;
            }
            const existing = await store.readDoc(item.galleryCollection, item.id, item.id);
            if (!existing) {
              results.push({ id: item.id, ok: false, error: 'not found' });
              continue;
            }
            const patch = buildBulkPatch(action, existing, body, { nowIso, actor: who });
            await store.patchDoc(item.galleryCollection, item.id, patch);
            results.push({ id: item.id, ok: true, customTags: patch.customTags });
          } catch (error) {
            results.push({ id: item.id, ok: false, error: error?.message || 'failed' });
          }
        }
        const updated = results.filter((r) => r.ok).length;
        return json(200, { success: updated > 0, action, updated, failed: results.length - updated, results });
      } catch (error) {
        context.error('bulkGalleryImages failed:', error);
        return json(500, { error: 'Failed to update images', message: error?.message || 'Unknown error' });
      }
    },

    /** GET /api/cms/images/folders — the persisted folder list plus the seeds. */
    async getGalleryFolders(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        return json(200, { success: true, folders: await readFolders() });
      } catch (error) {
        context.error('getGalleryFolders failed:', error);
        return json(500, { error: 'Failed to load folders' });
      }
    },

    /** PUT /api/cms/images/folders — { folders: [] } replaces the list. */
    async putGalleryFolders(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;
      try {
        const body = (await request.json().catch(() => null)) || {};
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
        return json(200, { success: true, folders: cleanFolderList([...SEED_FOLDERS, ...folders]) });
      } catch (error) {
        context.error('putGalleryFolders failed:', error);
        return json(500, { error: 'Failed to save folders' });
      }
    },

    /**
     * POST /api/cms/images/import — { url, title?, folder?, tags?, provider?,
     * slot?, altText?, caption?, license?, credit?, force? }. Fetches through
     * the guarded fetcher (protocol and private-IP checks, size cap, media
     * type gate), stores under covers/image-gallery/imports/, creates the
     * record. A byte-identical or same-URL image already in the gallery
     * answers 409 with that record unless `force` is set.
     */
    async importGalleryImage(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;
      try {
        const body = (await request.json().catch(() => null)) || {};
        const url = String(body.url || '').trim();
        if (!/^https?:\/\//i.test(url)) return json(400, { error: 'url must be http(s)' });
        if (typeof storage?.uploadBlob !== 'function') {
          return json(503, { error: 'Blob upload is not configured on this route' });
        }
        let fetched;
        try {
          fetched = await fetchImage(url);
        } catch (error) {
          return json(422, { error: `Could not fetch image: ${String(error?.message || error).replace(url, '[url]')}` });
        }
        if (fetched.refused) return json(415, { error: fetched.reason });
        const { buffer, contentType } = fetched;
        const ext = requireImageExtension(contentType);
        const sha = sha256Hex(buffer);
        const source = sourceOf(url);

        if (body.force !== true && typeof store.queryDocs === 'function') {
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
          if (dupes?.length) {
            return json(409, {
              error: 'This image is already in the gallery',
              duplicateOf: dupes[0].id,
              imageUrl: dupes[0].imageUrl,
              title: dupes[0].title,
            });
          }
        }

        const nowIso = now().toISOString();
        const stamp = nowIso.replace(/[-:TZ]/g, '').replace(/\..*$/, '').slice(0, 14);
        const fileName = (() => {
          try {
            return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
          } catch {
            return '';
          }
        })().replace(/\.[^.]+$/, '');
        const title = String(body.title || '').trim() || fileName || 'Imported image';
        const slug =
          String(title)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'import';
        const blobPath = `image-gallery/imports/${stamp}-${slug}.${ext}`;
        await storage.uploadBlob('covers', blobPath, buffer, contentType, { sourceUrl: source });
        const imageUrl = mediaUrlFor('covers', blobPath);
        const measured = measureImage(buffer, contentType);
        const who = actor(user);
        const doc = {
          id: uuid(),
          articleId: 'import',
          contentId: '',
          imageUrl,
          title,
          altText: String(body.altText || '').trim() || title,
          caption: String(body.caption || '').trim(),
          license: LICENSES.includes(String(body.license || '').toLowerCase())
            ? String(body.license || '').toLowerCase()
            : 'other',
          credit: String(body.credit || '').trim() || new URL(url).hostname,
          provider: String(body.provider || '').trim().toLowerCase(),
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
        await store.upsertDoc('generated_content_images', doc);
        return json(200, {
          success: true,
          imageId: doc.id,
          imageUrl,
          bytes: doc.bytes,
          width: doc.width,
          height: doc.height,
          format: ext,
        });
      } catch (error) {
        context.error('importGalleryImage failed:', error);
        return json(500, { error: 'Failed to import image', message: error?.message || 'Unknown error' });
      }
    },

    /**
     * GET /api/cms/images/{id}/usage?collection= — the content documents
     * using this image (by URL match on every image field) and its variants
     * (other rows for the same content and slot).
     */
    async getImageUsage(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const id = String(request.params.id || '').trim();
        const collection = String(request.query.get('collection') || 'generated_content_images');
        if (!id) return json(400, { error: 'id required' });
        if (!GALLERY_COLLECTIONS.includes(collection)) {
          return json(400, { error: 'Invalid collection' });
        }
        const row = await store.readDoc(collection, id, id);
        if (!row) return json(404, { error: `${collection}/${id} not found` });
        const item = normalizeGalleryRow(row, collection);
        const usedBy = item.imageUrl
          ? await store.queryDocs(
              'content',
              `SELECT TOP 100 ${CONTENT_USAGE_PROJECTION} FROM c WHERE NOT IS_DEFINED(c.softDeletedAt) AND (` +
                'c.heroImageUrl = @u OR c.altCoverImage = @u OR c.contentImageUrl = @u OR c.coverImage = @u OR c["Cover Image"] = @u ' +
                'OR c.aiImageUrls.hero = @u OR c.aiImageUrls.secondary1 = @u OR c.aiImageUrls.secondary2 = @u OR c.aiImageUrls.secondary3 = @u OR c.aiImageUrls.content = @u ' +
                'OR ARRAY_CONTAINS(c.secondaryImageUrls, @u))',
              [{ name: '@u', value: item.imageUrl }]
            )
          : [];
        const usage = buildContentUsageIndex(usedBy).get(item.imageUrl) || [];
        const variants =
          item.contentId && item.slot
            ? await store.queryDocs(
                'generated_content_images',
                'SELECT TOP 50 c.id, c.imageUrl, c.title, c.createdAt, c.promptSet, c.promptName, c.approvalStatus, c.softDeletedAt, c.archivedAt FROM c WHERE c.contentId = @cid AND c.slot = @slot AND c.id != @id',
                [
                  { name: '@cid', value: item.contentId },
                  { name: '@slot', value: item.slot },
                  { name: '@id', value: id },
                ]
              )
            : [];
        return json(200, {
          success: true,
          id,
          imageUrl: item.imageUrl,
          usedBy: usage,
          usageCount: new Set(usage.map((u) => u.id)).size,
          variants: (variants || []).sort((a, b) => dateValue(b.createdAt) - dateValue(a.createdAt)),
        });
      } catch (error) {
        context.error('getImageUsage failed:', error);
        return json(500, { error: 'Failed to read image usage' });
      }
    },

    /** POST /api/deleteRejectedContent — source :2376/:5807; publisher. */
    async deleteRejectedContent(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;

      try {
        const body = (await request.json().catch(() => null)) || {};
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
      } catch (error) {
        context.error('deleteRejectedContent failed:', error);
        return json(500, { error: 'Failed to delete rejected content', message: error?.message || 'Unknown error' });
      }
    },
  };
}
