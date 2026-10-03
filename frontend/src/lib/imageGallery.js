/**
 * The Image Gallery's data layer (ADR 0033 Creative slice): the listing
 * call with its server-side search, filters, sort and paging; the folder,
 * bulk, import and usage calls; and the pure helpers the page and its tests
 * share. The derived-option helpers from #602 stay here too: they are pure
 * functions of the items on screen and the page passes each one straight to
 * `useMemo`.
 */
import { getJSON, postJSON, sendJSON } from '@/lib/api';
import { toMillis } from '@/lib/dateUtils';

const PAGE_SIZE = 200;

export const GALLERY_COLLECTIONS = Object.freeze([
  'generated_content_images',
  'curated_article_images',
]);

/** Where an image came from — the server's `source` id and the word for it. */
export const SOURCE_LABELS = Object.freeze({
  upload: 'Uploaded',
  'ai-cover': 'AI cover',
  preview: 'Preview',
  curated: 'Curated',
  import: 'Imported',
  rehost: 'Re-hosted',
  other: 'Generated',
});

export const STATE_OPTIONS = Object.freeze([
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'trash', label: 'Trash' },
  { value: 'all', label: 'Everything' },
]);

export const SORT_OPTIONS = Object.freeze([
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'most-used', label: 'Most used' },
]);

export const LICENSE_OPTIONS = Object.freeze([
  { value: '', label: 'Not recorded' },
  { value: 'ai-generated', label: 'AI generated' },
  { value: 'owned', label: 'Owned / original' },
  { value: 'cc0', label: 'CC0 / public domain' },
  { value: 'cc-by', label: 'CC BY' },
  { value: 'cc-by-sa', label: 'CC BY-SA' },
  { value: 'stock', label: 'Stock licence' },
  { value: 'other', label: 'Other' },
]);

export const COMMON_PROVIDERS = Object.freeze([
  { value: '', label: 'No provider tag' },
  { value: 'aws', label: 'AWS' },
  { value: 'azure', label: 'Azure' },
  { value: 'gcp', label: 'GCP' },
  { value: 'terraform', label: 'Terraform' },
  { value: 'finops', label: 'FinOps' },
  { value: 'github', label: 'GitHub' },
  { value: 'docker', label: 'Docker' },
  { value: 'vmware', label: 'VMware' },
  { value: 'ansible', label: 'Ansible' },
]);

export const SLOT_OPTIONS = Object.freeze([
  { value: '', label: 'No slot tag' },
  { value: 'rss', label: 'RSS' },
  { value: 'hero', label: 'Hero' },
  { value: 'secondary1', label: 'Secondary 1' },
  { value: 'secondary2', label: 'Secondary 2' },
  { value: 'secondary3', label: 'Secondary 3' },
  { value: 'curated', label: 'Curated' },
]);

const text = (value, fallback = '') => (value ? String(value) : fallback);
const orNull = (value) => value ?? null;

/** The descriptive fields: what the image is and says. */
function describeItem(data, articleId) {
  return {
    title: text(data.title, articleId),
    altText: text(data.altText),
    caption: text(data.caption),
    license: text(data.license),
    credit: text(data.credit),
    provider: text(data.provider),
    slot: text(data.slot),
    folder: text(data.folder, 'default'),
    customTags: Array.isArray(data.customTags) ? data.customTags : [],
    approvalStatus: text(data.approvalStatus),
  };
}

/** Where the image came from: set, prompt, model. */
function lineageOf(data) {
  return {
    promptSet: text(data.promptSet || data.promptSetId),
    promptSetId: text(data.promptSetId || data.promptSet),
    promptName: text(data.promptName),
    promptTemplateVersion: text(data.promptTemplateVersion),
    prompt: text(data.prompt),
    imageProvider: text(data.imageProvider),
    imageModel: text(data.imageModel),
  };
}

/** The bytes and the record's lifecycle stamps. */
function fileFactsOf(data) {
  return {
    width: orNull(data.width),
    height: orNull(data.height),
    bytes: orNull(data.bytes),
    format: text(data.format),
    sha256: text(data.sha256),
    storagePath: text(data.storagePath),
    createdAt: data.createdAt || data.generatedAt || null,
    updatedAt: orNull(data.updatedAt),
    archivedAt: orNull(data.archivedAt),
    softDeletedAt: orNull(data.softDeletedAt),
    createdBy: orNull(data.createdBy),
  };
}

export function normalizeGalleryItem(item, sourceCollection) {
  const data = item || {};
  const articleId = String(data.articleId || data.contentId || data.id || '');
  const normalizedSourceCollection = String(data.sourceCollection || '').trim() || sourceCollection;
  const galleryCollection = data.galleryCollection || sourceCollection;
  return {
    id: data.id,
    articleId,
    contentId: text(data.contentId),
    imageUrl: text(data.imageUrl),
    galleryCollection,
    sourceCollection: normalizedSourceCollection,
    source: data.source || sourceIdFor(normalizedSourceCollection, galleryCollection),
    sourceUrl: orNull(data.sourceUrl),
    ...describeItem(data, articleId),
    ...lineageOf(data),
    ...fileFactsOf(data),
    usedBy: Array.isArray(data.usedBy) ? data.usedBy : [],
    usageCount: Number(data.usageCount) || 0,
    duplicateOf: orNull(data.duplicateOf),
  };
}

function sourceIdFor(sourceCollection, galleryCollection) {
  if (
    galleryCollection === 'curated_article_images' ||
    sourceCollection === 'curated_article_images'
  )
    return 'curated';
  if (sourceCollection === 'manual_upload') return 'upload';
  if (sourceCollection === 'preview') return 'preview';
  if (sourceCollection === 'import') return 'import';
  if (sourceCollection === 'rehost') return 'rehost';
  if (['content', 'generated_content_images', 'blogs'].includes(sourceCollection))
    return 'ai-cover';
  return sourceCollection ? 'other' : 'ai-cover';
}

/** The word for a source id, or for a legacy sourceCollection value. */
export function getSourceLabel(sourceOrCollection) {
  const key = String(sourceOrCollection || '');
  if (SOURCE_LABELS[key]) return SOURCE_LABELS[key];
  return SOURCE_LABELS[sourceIdFor(key, '')] || 'Generated';
}

const createdAtMillis = toMillis;

/** `?a=b&c=d` from the non-empty, non-default params. */
export function galleryQueryString(params = {}) {
  const search = new URLSearchParams();
  const entries = {
    q: params.q,
    folder: params.folder,
    source: params.source,
    provider: params.provider,
    slot: params.slot,
    tag: params.tag,
    set: params.set,
    contentId: params.contentId,
    articleId: params.articleId,
    state: params.state,
    sort: params.sort,
    offset: params.offset,
    limit: params.limit ?? PAGE_SIZE,
    usage: params.usage === false ? '' : '1',
  };
  for (const [key, value] of Object.entries(entries)) {
    const text = String(value ?? '').trim();
    if (!text || text === 'all') continue;
    if (key === 'state' && text === 'active') continue;
    if (key === 'sort' && text === 'newest') continue;
    if (key === 'offset' && text === '0') continue;
    search.set(key, text);
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

/**
 * Whatever the listing call returned — the envelope, or a bare array from an
 * older caller or a test — as `{ items, total, hasMore, facets }`.
 */
export function asListing(response) {
  if (Array.isArray(response)) {
    return { items: response, total: response.length, hasMore: false, facets: null, offset: 0 };
  }
  const items = Array.isArray(response?.items)
    ? response.items
    : [
        ...(response?.curated || []).map((i) => normalizeGalleryItem(i, 'curated_article_images')),
        ...(response?.generated || []).map((i) =>
          normalizeGalleryItem(i, 'generated_content_images')
        ),
      ].sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt));
  return {
    items: items.map((item) => normalizeGalleryItem(item, item.galleryCollection)),
    total: Number(response?.total) || items.length,
    hasMore: Boolean(response?.hasMore),
    offset: Number(response?.offset) || 0,
    facets: response?.facets || null,
  };
}

/** The listing, with every server-side filter: `{ items, total, hasMore, facets }`. */
export async function queryGalleryImages(params = {}) {
  return asListing(await getJSON(`cms/images${galleryQueryString(params)}`));
}

/**
 * The first page as a flat list, for pickers that only need "the newest
 * images" (BlogReviewBoard, MetadataTab, PostImageField). Rows sharing one
 * URL collapse into the newest, as the tile view did before paging.
 */
export async function loadGalleryItems({ max = PAGE_SIZE, ...params } = {}) {
  const { items } = await queryGalleryImages({ ...params, limit: max });
  const seen = new Set();
  return items.filter((item) => {
    const key = item.imageUrl || `__id:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchGalleryFolders() {
  const res = await getJSON('cms/images/folders');
  return Array.isArray(res?.folders) ? res.folders : [...SEED_FOLDERS];
}

export async function saveGalleryFolders(folders) {
  const res = await sendJSON('cms/images/folders', 'PUT', { folders });
  return Array.isArray(res?.folders) ? res.folders : folders;
}

/** One image's metadata patch; fields absent from `fields` are untouched. */
export function updateGalleryImage(item, fields) {
  return postJSON('updateGalleryImageMetadata', {
    id: item.id,
    galleryCollection: item.galleryCollection,
    ...fields,
  });
}

/** `{ items: [{id, galleryCollection}], action, ... }` → per-item results. */
export function bulkGalleryImages(items, action, extra = {}) {
  return postJSON('cms/images/bulk', {
    action,
    items: items.map((item) => ({ id: item.id, galleryCollection: item.galleryCollection })),
    ...extra,
  });
}

export function importGalleryImage(body) {
  return postJSON('cms/images/import', body);
}

export function fetchImageUsage(item) {
  return getJSON(
    `cms/images/${encodeURIComponent(item.id)}/usage?collection=${encodeURIComponent(item.galleryCollection)}`
  );
}

/** Permanent delete of one row through the route its collection uses. */
export function deleteGalleryImage(item) {
  if (item.galleryCollection === 'curated_article_images') {
    return postJSON('deleteCuratedGeneratedImage', { articleId: item.articleId || item.id });
  }
  return postJSON('deleteContentGeneratedImage', { imageId: item.id });
}

/** `1.2 MB`, `640 KB`, `312 B`; '' for nothing. */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** `1920 × 1080`, or '' when either side is unknown. */
export function formatDimensions(item) {
  const w = Number(item?.width);
  const h = Number(item?.height);
  return w > 0 && h > 0 ? `${w} × ${h}` : '';
}

/**
 * The filter dropdowns' options, derived from the items on screen (#602).
 *
 * These were six `useMemo` bodies inside ImageGalleryPage. Qlty counts a
 * closure's exits into the function that holds it, so the component carried
 * their returns and measured 16 — and they are pure functions of `items`
 * anyway, which is the argument for them being here rather than a note about a
 * linter. The page now passes each one straight to `useMemo`.
 */

/** A gallery item's custom tags, trimmed and lowercased; [] when it has none. */
function tagsOf(item) {
  const tags = item?.customTags;
  return (Array.isArray(tags) ? tags : []).map((tag) =>
    String(tag || '')
      .trim()
      .toLowerCase()
  );
}

/**
 * `['all', …distinct non-empty values, sorted]` — the shape every filter
 * dropdown wants, with `all` first because that is the default selection.
 *
 * @param {Array} items
 * @param {(item: object) => string[]} pick one item's contribution
 */
function optionsFrom(items, pick) {
  const values = new Set((items || []).flatMap(pick).filter(Boolean));
  return ['all', ...Array.from(values).sort()];
}

/** Providers, uppercased: they are displayed as badges (AZURE, AWS). */
export const providerOptions = (items) =>
  optionsFrom(items, (item) => [
    String(item?.provider || '')
      .trim()
      .toUpperCase(),
  ]);

/** Slots, lowercased: they are matched against stored values, not displayed raw. */
export const slotOptions = (items) =>
  optionsFrom(items, (item) => [
    String(item?.slot || '')
      .trim()
      .toLowerCase(),
  ]);

/** Custom tags as filter options — one item contributes as many as it carries. */
export const customTagOptions = (items) => optionsFrom(items, tagsOf);

/**
 * Every tag in use, WITHOUT the leading `all`.
 *
 * Deliberately not customTagOptions: this drives the tag-toggle subsection,
 * where `all` is not a tag and would be offered as one.
 */
export const uniqueTags = (items) =>
  Array.from(new Set((items || []).flatMap(tagsOf).filter(Boolean))).sort();

/** The six folders that always exist, whether or not anything is filed in them. */
export const SEED_FOLDERS = Object.freeze([
  'default',
  'aws',
  'azure',
  'gcp',
  'finops',
  'architecture',
]);

/**
 * Folders to offer: the seeds, every folder in use, and any the operator
 * created (persisted in admin_config/gallery_folders) but has not filed
 * anything into yet.
 */
export function folderOptions(items, manualFolders = []) {
  const folders = new Set(SEED_FOLDERS);
  for (const item of items || []) {
    const folder = String(item?.folder || 'default')
      .trim()
      .toLowerCase();
    if (folder) folders.add(folder);
  }
  for (const folder of manualFolders) folders.add(String(folder).toLowerCase());
  return Array.from(folders).sort();
}

/**
 * Why a new folder cannot be created, or '' when it can.
 *
 * A named decision rather than two guards in the handler: the page's component
 * carried 16 exits, and every one of these that stays inline is one of them.
 */
export function newFolderProblem(folderName, folders) {
  if (!folderName) return 'Folder name cannot be empty';
  return folders.includes(folderName) ? 'Folder already exists' : '';
}

/** Why a folder cannot be deleted, or '' when it can. */
export function deleteFolderProblem(folderName, items) {
  const lower = String(folderName).toLowerCase();
  if (lower === 'default') return 'Cannot delete Default folder';
  const held = (items || []).filter(
    (item) => String(item?.folder || 'default').toLowerCase() === lower
  ).length;
  return held > 0
    ? `Cannot delete folder "${folderName}" - it contains ${held} image(s). Move or delete images first.`
    : '';
}

/** A selection set with one id flipped. Returned fresh; the argument is untouched. */
export function toggledSelection(selected, id) {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * The tag change a bulk toggle means for a SELECTION: the tags every selected
 * item already has are the ones a click removes; the rest are the ones a
 * click adds. Pure, so the "toggle erased every other tag" defect has a test
 * that names it.
 */
export function tagToggleIntent(tag, selectedItems) {
  const items = selectedItems || [];
  if (items.length === 0) return { addTags: [], removeTags: [] };
  const onAll = items.every((item) => tagsOf(item).includes(String(tag).toLowerCase()));
  return onAll ? { addTags: [], removeTags: [tag] } : { addTags: [tag], removeTags: [] };
}
