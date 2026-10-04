/**
 * The media library the Image Gallery page is (ADR 0033 Creative slice):
 * one row shape over both image containers, the usage index from the
 * content documents, duplicate detection, and `buildGalleryListing` — search,
 * filters, sort and pagination (PR #841 split of gallery-images.js).
 */
import { dateValue, matchesParams, sortItems } from './filters.js';
import { cleanFolder, cleanTagList } from './shared.js';

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

/** A finite, non-null number as a number; otherwise null. */
const numberOrNull = (value) =>
  Number.isFinite(Number(value)) && value !== null ? Number(value) : null;

/**
 * One row in the shape the gallery reads, whatever container it came from.
 * Curated rows have no `createdAt` or `title`; they get `generatedAt` and
 * `articleTitle` so they sort and label like everything else.
 */
export function normalizeGalleryRow(row = {}, collection) {
  const curated = collection === 'curated_article_images';
  const createdAt =
    row.createdAt || row.generatedAt || (row._ts ? new Date(row._ts * 1000).toISOString() : null);
  const archivedAt = row.archivedAt || (row.archived === true ? row.updatedAt || createdAt : null);
  return {
    id: row.id,
    galleryCollection: collection,
    articleId: String(row.articleId || row.contentId || row.id || ''),
    contentId: String(row.contentId || (curated ? '' : row.articleId || '')),
    imageUrl: String(row.imageUrl || ''),
    title: String([row.title, row.articleTitle, row.articleId, row.id].find(Boolean) || 'Untitled'),
    altText: String(row.altText || ''),
    caption: String(row.caption || ''),
    license: String(row.license || ''),
    credit: String(row.credit || ''),
    provider: String(row.provider || ''),
    slot: String(row.slot || (curated ? 'curated' : '')),
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
    width: numberOrNull(row.width),
    height: numberOrNull(row.height),
    bytes: numberOrNull(row.bytes),
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

/** The keys a row may be a duplicate under: its bytes, its URL. */
const duplicateKeysOf = (item) =>
  [item.sha256 ? `sha:${item.sha256}` : '', item.imageUrl ? `url:${item.imageUrl}` : ''].filter(
    Boolean
  );

/** Mark every later row that shares a sha or URL with an earlier one. */
export function markDuplicates(items) {
  const oldestFirst = [...items].sort((a, b) => dateValue(a.createdAt) - dateValue(b.createdAt));
  const byKey = new Map();
  for (const item of oldestFirst) {
    const keys = duplicateKeysOf(item);
    const canonical = keys.map((key) => byKey.get(key)).find(Boolean);
    if (canonical && canonical.id !== item.id) item.duplicateOf = canonical.id;
    for (const key of keys) if (!byKey.has(key)) byKey.set(key, item);
  }
  return items;
}

/** The distinct, sorted values of `pick` over the rows, blanks dropped. */
const facetOf = (all, pick) => [...new Set(all.flatMap(pick).filter(Boolean))].sort();

/** What the filter bar offers: every value present, and the three state counts. */
function facetsOf(all) {
  return {
    folders: [...new Set(all.map((i) => i.folder))].sort(),
    providers: facetOf(all, (i) => i.provider.toLowerCase()),
    slots: facetOf(all, (i) => i.slot.toLowerCase()),
    tags: facetOf(all, (i) => i.customTags),
    sources: [...new Set(all.map((i) => i.source))].sort(),
    sets: facetOf(all, (i) => i.promptSet),
    counts: {
      active: all.filter((i) => !i.softDeletedAt && !i.archivedAt).length,
      archived: all.filter((i) => !i.softDeletedAt && i.archivedAt).length,
      trash: all.filter((i) => i.softDeletedAt).length,
    },
  };
}

/**
 * The gallery listing from raw rows: normalise, attach usage, mark
 * duplicates, filter, sort, page. Pure — the handler does the reads.
 *
 * @param {{ generated?: object[], curated?: object[], content?: object[] }} rows
 * @param {ReturnType<typeof import('./filters.js').parseGalleryListParams>} params
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
  const facets = facetsOf(all);
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
