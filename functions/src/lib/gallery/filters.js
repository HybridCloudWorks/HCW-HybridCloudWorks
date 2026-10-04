/**
 * The Image Gallery's query string → listing params, and the filter and
 * sort they drive over normalised rows (ADR 0033 §4). Pure: every value is
 * bounded on the way in, and each filter is one predicate in a table, so a
 * new facet is one more row rather than one more early return. Split out of
 * gallery-images.js in PR #841.
 */
export const GALLERY_MAX_LIMIT = 200;

const STATES = ['active', 'archived', 'trash', 'all'];
const SORTS = ['newest', 'oldest', 'title', 'most-used'];

/** Epoch milliseconds of an ISO stamp, 0 for anything unreadable. */
export const dateValue = (v) => {
  if (!v) return 0;
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

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

/** Which rows each lifecycle state shows; `all` is every row. */
const STATE_MATCHES = Object.freeze({
  trash: (item) => Boolean(item.softDeletedAt),
  archived: (item) => !item.softDeletedAt && Boolean(item.archivedAt),
  active: (item) => !item.softDeletedAt && !item.archivedAt,
  all: () => true,
});

/** `--none--` is the page's name for "the default folder only". */
const folderMatches = (item, folder) =>
  folder === '--none--' ? item.folder === 'default' : item.folder === folder;

/** Everything a free-text search looks through, lower-cased. */
const searchText = (item) =>
  [
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

/**
 * One row per param: the predicate a set value must satisfy. An empty value
 * never filters; `allIsAny` params treat the literal `all` the same way,
 * because the page's facet selects offer it.
 */
const PARAM_FILTERS = Object.freeze([
  { param: 'state', allIsAny: true, matches: (item, v) => STATE_MATCHES[v](item) },
  { param: 'folder', allIsAny: true, matches: folderMatches },
  { param: 'source', allIsAny: true, matches: (item, v) => item.source === v },
  { param: 'provider', allIsAny: true, matches: (item, v) => item.provider.toLowerCase() === v },
  { param: 'slot', allIsAny: true, matches: (item, v) => item.slot.toLowerCase() === v },
  { param: 'tag', allIsAny: true, matches: (item, v) => item.customTags.includes(v) },
  { param: 'set', matches: (item, v) => item.promptSet === v || item.promptSetId === v },
  { param: 'contentId', matches: (item, v) => item.contentId === v || item.articleId === v },
  { param: 'articleId', matches: (item, v) => item.articleId === v },
  { param: 'q', matches: (item, v) => searchText(item).includes(v) },
]);

/** Whether a normalised row passes every filter the params set. */
export function matchesParams(item, p) {
  return PARAM_FILTERS.every(({ param, allIsAny, matches }) => {
    const value = p[param];
    if (!value || (allIsAny && value === 'all')) return true;
    return matches(item, value);
  });
}

/** In place, by the named sort; ties break newest first. */
export function sortItems(items, sort) {
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
