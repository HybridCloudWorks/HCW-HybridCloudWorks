/**
 * The queue's view state in the URL — `?status=…&contentType=…&kind=…
 * &ideaOrigin=…&pageSize=…&sort=…&dir=…` — read on mount and written on
 * every change, so a reload or a shared link lands on the same view. Pure,
 * out of QueuePage.jsx (PR #841).
 */
import { SORT_OPTIONS } from './itemHelpers';

export const PAGE_SIZES = [50, 100, 200];

/** The sort key from the URL, or the default when absent or unknown. */
export function readSortKey(searchParams) {
  const v = searchParams.get('sort');
  return v && SORT_OPTIONS[v] ? v : 'published';
}

/** 'asc' only when the URL says so; everything else is descending. */
export function readSortDirection(searchParams) {
  return searchParams.get('dir') === 'asc' ? 'asc' : 'desc';
}

/** The page size from the URL when it is one of PAGE_SIZES, else 100. */
export function readPageSize(searchParams) {
  const fromUrl = Number(searchParams.get('pageSize'));
  return PAGE_SIZES.includes(fromUrl) ? fromUrl : 100;
}

/** The URL for a view. The taxonomy filters are written only when narrowed. */
export function buildQueueSearchParams({
  statusFilter,
  contentTypeFilter,
  kindFilter,
  ideaOriginFilter,
  pageSize,
  sortKey,
  sortDirection,
}) {
  const next = new URLSearchParams();
  next.set('status', statusFilter);
  next.set('contentType', contentTypeFilter);
  if (kindFilter !== 'all') next.set('kind', kindFilter);
  if (ideaOriginFilter !== 'all') next.set('ideaOrigin', ideaOriginFilter);
  next.set('pageSize', String(pageSize));
  next.set('sort', sortKey);
  next.set('dir', sortDirection);
  return next;
}
