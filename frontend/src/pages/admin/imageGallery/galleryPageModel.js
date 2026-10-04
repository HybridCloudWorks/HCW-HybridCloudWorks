/**
 * The Image Gallery page's pure rules (ADR 0033 Creative slice; split out of
 * ImageGalleryPage.jsx for PR #841): the filter defaults a link can override,
 * the sentences the page says after an action, the empty-state copy per
 * state tab, and the paging arithmetic. Nothing here touches React.
 */
import { customTagOptions, providerOptions, slotOptions } from '@/lib/imageGallery';

export const DEFAULT_FILTERS = Object.freeze({
  q: '',
  folder: 'all',
  source: 'all',
  provider: 'all',
  slot: 'all',
  tag: 'all',
  set: '',
  state: 'active',
  sort: 'newest',
  offset: 0,
  limit: 60,
});

export const PAGE_SIZES = [60, 120, 200];

export const EMPTY_LISTING = Object.freeze({ items: [], total: 0, hasMore: false, facets: null });

export const HELP = [
  'Every image the site holds is here: uploaded by hand, imported from a URL, generated as an AI cover or preview, or curated for a news grid.',
  'Hover or tab to a tile for its actions; open Details to edit the title, alt text, caption, licence, tags and folder, and to see which content uses it and the prompt and set that produced it.',
  'Tick several tiles to tag, move, archive, trash or delete them together. A tag toggle adds to every selected image, or removes it when all of them already have it — other tags are untouched.',
  'Archive keeps an image but hides it from pickers. Trash hides it everywhere and keeps the file until you delete permanently from the Trash filter.',
  'A "Duplicate" chip means the same bytes or URL already exist in an earlier record. "Used in N" counts the content documents whose cover or inline slots point at the image.',
];

/** What a permanent delete did, in one sentence. */
export function deletionMessage(item, res) {
  if (res.storageDeleted) return `"${item.title}" and its file were deleted.`;
  if (res.sharedWith) {
    const others = `${res.sharedWith} other record${res.sharedWith === 1 ? '' : 's'}`;
    return `"${item.title}" was deleted; the file stays because ${others} use it.`;
  }
  return `"${item.title}" was deleted; no stored file was found for it.`;
}

const EMPTY_STATE_COPY = Object.freeze({
  trash: {
    title: 'Trash is empty',
    description: 'Trashed images appear here until you restore or delete them.',
  },
  archived: {
    title: 'No archived images',
    description: 'Archived images appear here, hidden from pickers but kept.',
  },
});

/** The empty-state copy for a state tab with nothing in it. */
export function emptyStateFor(state) {
  return (
    EMPTY_STATE_COPY[state] || {
      title: 'No images',
      description: 'Nothing has been recorded in any state.',
    }
  );
}

const FILTER_KEYS = ['q', 'folder', 'source', 'provider', 'slot', 'tag', 'set'];

/** True when any filter other than paging and state differs from the default. */
export function hasActiveFilters(filters) {
  return FILTER_KEYS.some(
    (key) => String(filters[key] || '') !== String(DEFAULT_FILTERS[key] || '')
  );
}

/** Filters a link can carry: `?set=NAME`, `?q=TEXT`, `?state=trash`, `?folder=aws`. */
export function filtersFromSearch(search) {
  const params = new URLSearchParams(search || '');
  const next = { ...DEFAULT_FILTERS };
  for (const key of [...FILTER_KEYS, 'state', 'sort']) {
    const value = params.get(key);
    if (value) next[key] = value;
  }
  // A link into a set or a search should find the image whatever its state.
  if ((next.set || next.q) && !params.get('state')) next.state = 'all';
  return next;
}

const BULK_VERBS = Object.freeze({
  tag: 'retagged',
  archive: 'archived',
  restore: 'restored',
  trash: 'moved to trash',
  untrash: 'restored',
  delete: 'deleted permanently',
  set: 'updated',
});

/** What a bulk action did, in one sentence: `3 images archived; 1 failed.` */
export function bulkMessage(action, extra, res) {
  const verb = action === 'move' ? `moved to ${extra.folder}` : BULK_VERBS[action];
  const plural = res.updated === 1 ? '' : 's';
  const failed = res.failed ? `; ${res.failed} failed` : '';
  return `${res.updated} image${plural} ${verb}${failed}.`;
}

const CLEARS_SELECTION = Object.freeze(['delete', 'trash', 'archive', 'restore']);

/** True when a bulk action leaves nothing sensible to stay selected. */
export function bulkClearsSelection(action) {
  return CLEARS_SELECTION.includes(action);
}

/** True when a bulk action removed the image whose details are open. */
export function bulkClosesDetails(targets, action, detailsId) {
  return action === 'delete' && targets.some((t) => t.id === detailsId);
}

/** `err.message`, or the error itself when it has none. */
export function reason(err) {
  return err?.message || err;
}

/** A selection set with some ids removed. Returned fresh; the argument is untouched. */
export function withoutIds(selected, ids) {
  const next = new Set(selected);
  ids.forEach((id) => next.delete(id));
  return next;
}

/** A selection set with some ids added. Returned fresh; the argument is untouched. */
export function withIds(selected, ids) {
  return new Set([...selected, ...ids]);
}

/** Where the listing stands: the page number and the 1-based range on screen. */
export function pagePosition({ offset, limit }, total, count) {
  return {
    page: Math.floor(offset / limit) + 1,
    pageCount: Math.max(1, Math.ceil(total / limit)),
    first: total === 0 ? 0 : offset + 1,
    last: Math.min(offset + count, total),
  };
}

/** The toolbar's one-line summary of the listing and the selection. */
export function listingSummary({ loading, filters, total, count, selectedCount }) {
  if (loading) return 'Loading images…';
  const { first, last } = pagePosition(filters, total, count);
  const selected = selectedCount ? ` · ${selectedCount} selected` : '';
  return `Showing ${first}–${last} of ${total}${selected}`;
}

/** Providers for the filter: the server's facet, uppercased as badges are, else derived. */
export function providerValuesFrom(facets, items) {
  return facets?.providers?.length
    ? facets.providers.map((p) => p.toUpperCase())
    : providerOptions(items).slice(1);
}

/** Slots for the filter: the server's facet, else derived from the items on screen. */
export function slotValuesFrom(facets, items) {
  return facets?.slots?.length ? facets.slots : slotOptions(items).slice(1);
}

/** Tags for the filter: the server's facet, else derived from the items on screen. */
export function tagValuesFrom(facets, items) {
  return facets?.tags?.length ? facets.tags : customTagOptions(items).slice(1);
}
