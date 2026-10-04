/**
 * Calendar items (ADR 0033 §4): how a stored date becomes an instant, how a
 * window is asked of Cosmos and checked precisely, and the one item shape
 * every collector answers with.
 *
 * An item is `{ id, kind, title, start, end?, allDay, status, href, sourceId,
 * sourceCollection, meta }`. `start` and `end` are ISO instants; a calendar
 * date (a `YYYY-MM-DD` with no time) is `allDay: true` with `start` at UTC
 * midnight of that day, which the page shows on that day in every time zone.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The most rows one source contributes to one read. */
export const PER_SOURCE_LIMIT = 500;

/** `YYYY-MM-DD` of an ISO instant, in UTC. */
const dayOf = (iso) => String(iso).slice(0, 10);
const isCalendarDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** A legacy Timestamp-shaped object, or an ISO string or number, as a Date. */
function toDate(value) {
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && Number.isFinite(value.seconds)) {
    return new Date(value.seconds * 1000);
  }
  return new Date(value);
}

/**
 * A stored date — an ISO string, a calendar date, a number, or a legacy
 * Timestamp-shaped object — as `{ iso, allDay }`, or null when unreadable.
 */
export function toInstant(value) {
  if (value === null || value === undefined || value === '') return null;
  if (isCalendarDate(value)) return { iso: `${value}T00:00:00.000Z`, allDay: true };
  const date = toDate(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return { iso: date.toISOString(), allDay: false };
}

/** True when `instant` falls inside [from, to). */
export const inWindow = (instant, from, to) => {
  const t = Date.parse(instant.iso);
  return t >= from.getTime() && t < to.getTime();
};

/**
 * Each row paired with the in-window instant `pick` reads off it. Rows with
 * no readable date, or one outside the window, are dropped.
 */
export function rowsInWindow(rows, { from, to }, pick) {
  const out = [];
  for (const row of rows || []) {
    const when = toInstant(pick(row));
    if (when && inWindow(when, from, to)) out.push({ row, when });
  }
  return out;
}

/**
 * One item per dated field of each row that falls in the window, built by
 * `build(row, when, field)`, in field order.
 */
export function itemsPerDate(rows, { from, to }, fields, build) {
  const out = [];
  for (const row of rows || []) {
    for (const field of fields) {
      const when = toInstant(row[field]);
      if (when && inWindow(when, from, to)) out.push(build(row, when, field));
    }
  }
  return out;
}

/**
 * Cosmos string bounds for a field that may hold either `YYYY-MM-DD` or an
 * ISO instant: a day-granular lower bound and an exclusive upper bound of the
 * day after `to`. Both spellings sort correctly against a bare day, so one
 * query serves both; the collector then filters precisely with `inWindow`.
 */
export function dayBounds(from, to) {
  return {
    fromDay: dayOf(from.toISOString()),
    toDay: dayOf(new Date(to.getTime() + DAY_MS).toISOString()),
  };
}

export const text = (value, max = 200) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** The parameter list every instant-windowed query shares. */
export const windowParams = (from, to) => [
  { name: '@from', value: from.toISOString() },
  { name: '@to', value: to.toISOString() },
];

/** The parameter list every day-windowed query shares (dayBounds). */
export function dayParams(from, to) {
  const { fromDay, toDay } = dayBounds(from, to);
  return [
    { name: '@fromDay', value: fromDay },
    { name: '@toDay', value: toDay },
  ];
}

export function item({
  id,
  kind,
  title,
  start,
  end = null,
  allDay = false,
  status,
  href,
  sourceId,
  sourceCollection,
  meta = {},
}) {
  return {
    id,
    kind,
    title: text(title) || 'Untitled',
    start,
    end,
    allDay,
    status: String(status || 'scheduled'),
    href,
    sourceId,
    sourceCollection,
    meta,
  };
}
