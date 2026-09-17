import { getJSON } from '@/lib/api';
import { toMillis } from '@/lib/dateUtils';

const PAGE_SIZE = 200;

export function normalizeGalleryItem(item, sourceCollection) {
  const data = item || {};
  const articleId = String(data.articleId || data.contentId || data.id);
  const normalizedSourceCollection = String(data.sourceCollection || '').trim() || sourceCollection;
  return {
    id: data.id,
    articleId,
    imageUrl: data.imageUrl || '',
    provider: data.provider || '',
    title: data.title || articleId,
    slot: data.slot || '',
    galleryCollection: sourceCollection,
    sourceCollection: normalizedSourceCollection,
    createdAt: data.createdAt || null,
    customTags: data.customTags || [],
    folder: data.folder || 'default',
  };
}

export function getSourceLabel(sourceCollection) {
  if (
    sourceCollection === 'generated_content_images' ||
    sourceCollection === 'content' ||
    sourceCollection === 'blogs'
  ) {
    return 'ContentForge';
  }
  if (sourceCollection === 'curated_article_images') return 'Curated';
  if (sourceCollection === 'preview') return 'Preview';
  if (sourceCollection === 'manual_upload') return 'Uploaded';
  return 'Generated';
}

const createdAtMillis = toMillis;

export async function loadGalleryItems({ max = PAGE_SIZE } = {}) {
  // GET cms/images returns both galleries, newest first each, capped at max.
  const res = await getJSON(`cms/images?limit=${max}`);

  return [
    ...(res.curated || []).map((item) => normalizeGalleryItem(item, 'curated_article_images')),
    ...(res.generated || []).map((item) => normalizeGalleryItem(item, 'generated_content_images')),
  ]
    .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))
    .reduce(
      (acc, item) => {
        // Dedupe by imageUrl — multiple rows for the same generated asset
        // (regens, multi-page reuse) collapse into a single tile keyed on the
        // newest row. Items without a URL fall back to id-uniqueness.
        const key = item.imageUrl || `__id:${item.id}`;
        if (acc.seen.has(key)) return acc;
        acc.seen.add(key);
        acc.items.push(item);
        return acc;
      },
      { seen: new Set(), items: [] }
    ).items;
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
 * created but has not filed anything into yet.
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
