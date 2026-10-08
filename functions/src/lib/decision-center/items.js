/**
 * Decision Center items (#1013, #1014): the one shape every source answers
 * with, and how items are ordered and weighed.
 *
 * An item is `{ id, category, kind, title, stage, status, waitingSince,
 * priority, href, source, detail }`:
 *
 *   id            unique across sources: `<kind>:<source id>`
 *   category      frameworks | queues | pipelines | governance | other
 *   kind          what it is (a content type, transcript, chapter, alert...)
 *   stage         where it waits, as a short id the dashboard labels
 *   status        the stored status, verbatim
 *   waitingSince  ISO instant it started waiting — for a dated item, when it
 *                 came due or came inside its warning window — or null when
 *                 the source records none
 *   priority      high | normal | low
 *   href          the admin page that opens this item at its stage
 *   source        `{ collection, id, ... }` — what the item was read from
 *   detail        one short line of context, or ''
 *
 * The same shape as the Calendar's items (lib/calendar/items.js), with the
 * date a wait rather than a slot.
 */

export const CATEGORIES = Object.freeze(['frameworks', 'queues', 'pipelines', 'governance', 'other']);
export const PRIORITIES = Object.freeze(['high', 'normal', 'low']);

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a decision may wait before it is flagged as overdue for attention. */
export const STALE_AFTER_DAYS = 7;

export const text = (value, max = 200) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** Epoch ms of an ISO string, number, Date or legacy Timestamp-shaped value; NaN when unreadable. */
function millisOf(value) {
  if (value === null || value === undefined || value === '') return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'object' && Number.isFinite(value.seconds)) return value.seconds * 1000;
  return new Date(value).getTime();
}

/** A stored timestamp as an ISO instant, or null when unreadable. */
export function toIso(value) {
  const ms = millisOf(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Cosmos `_ts` (whole seconds) as an ISO instant, or null. */
export const fromTs = (ts) => (Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null);

/** True when `waitingSince` is more than `days` before `nowMs`. */
export function waitedLongerThan(waitingSince, nowMs, days = STALE_AFTER_DAYS) {
  const ms = millisOf(waitingSince);
  return Number.isFinite(ms) && nowMs - ms > days * DAY_MS;
}

export function decisionItem({
  id,
  category,
  kind,
  title,
  stage,
  status,
  waitingSince = null,
  priority = 'normal',
  href,
  source,
  detail = '',
}) {
  return {
    id,
    category,
    kind,
    title: text(title) || 'Untitled',
    stage,
    status: String(status ?? ''),
    waitingSince: toIso(waitingSince),
    priority: PRIORITIES.includes(priority) ? priority : 'normal',
    href,
    source,
    detail: text(detail, 300),
  };
}

/** Newest first; an item with no time sorts after every timed one; ties by id. */
export function byNewest(a, b) {
  const left = millisOf(a.waitingSince);
  const right = millisOf(b.waitingSince);
  const leftTimed = Number.isFinite(left);
  const rightTimed = Number.isFinite(right);
  if (leftTimed && rightTimed && left !== right) return right - left;
  if (leftTimed !== rightTimed) return leftTimed ? -1 : 1;
  return String(a.id).localeCompare(String(b.id));
}

/** `{ all, frameworks, queues, pipelines, governance, other }` over `items`. */
export function countByCategory(items) {
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  for (const item of items) {
    if (Object.hasOwn(counts, item.category)) counts[item.category] += 1;
  }
  return { all: items.length, ...counts };
}
