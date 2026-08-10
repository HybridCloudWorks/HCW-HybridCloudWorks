/**
 * Timestamp normalization for values that crossed the Firestore → Cosmos
 * migration.
 *
 * Documents in Cosmos carry ISO strings. Documents written before the migration
 * carried Firestore `Timestamp` objects, and some still do. Rendering and
 * sorting code therefore has to accept both, plus `Date`, plus absent.
 *
 * That was already understood — ten separate copies of this function existed,
 * eight of them correct. The two that were not are the reason this module does:
 * `PublishedPage.jsx` and `EditorListPage.jsx` kept the Firestore-only form,
 * `value?.toMillis?.() || 0`, which on an ISO string yields 0 for **every**
 * document. Every comparator returned 0, so every sort was a no-op and the
 * lists rendered in raw Cosmos order while the sort controls appeared to work.
 * The same expression in the row components produced the em-dash where a date
 * belonged (TODO.md T-304).
 *
 * The rule that matters: **never return NaN.** A NaN comparison is silently
 * false, and a NaN subtraction makes a comparator non-transitive, so the
 * failure shows up as an arbitrary order rather than an error. Every branch
 * here is checked for finiteness before it is returned.
 */

/**
 * Milliseconds since the epoch from a Firestore `Timestamp`, an ISO string, a
 * `Date`, or a number.
 *
 * Returns 0 — never NaN — for absent or unparseable input, which sorts such
 * documents last under a descending comparator. Note that a literal epoch-0
 * timestamp is indistinguishable from absent here; no field in this system
 * carries one, and treating it as absent is the safer of the two mistakes.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function toMillis(value) {
  if (!value) return 0;

  let ms;
  if (typeof value.toMillis === 'function') {
    ms = value.toMillis();
  } else if (typeof value.toDate === 'function') {
    ms = value.toDate()?.getTime();
  } else if (typeof value.seconds === 'number') {
    // A Timestamp that went through JSON and came back as plain
    // `{seconds, nanoseconds}` with its methods gone. Only QueuePage's copy
    // handled this; folded in here so consolidating did not quietly drop it.
    ms = value.seconds * 1000;
  } else {
    ms = new Date(value).getTime();
  }

  return Number.isFinite(ms) ? ms : 0;
}

/**
 * A `Date` for anything `toMillis` can read, or `null`.
 *
 * `null` rather than an Invalid Date on purpose: callers render this, and
 * `String(new Date(NaN))` is "Invalid Date" on the page, whereas `null` lets
 * them choose their own placeholder.
 *
 * @param {unknown} value
 * @returns {Date|null}
 */
export function toDate(value) {
  const ms = toMillis(value);
  return ms ? new Date(ms) : null;
}

/**
 * Descending comparator over the first present of several timestamp fields —
 * the shape every one of the replaced copies was reaching for.
 *
 * `Math.max` rather than `||` between fields: `||` takes the first *truthy*
 * field, which after normalization means the first one that exists, not the
 * most recent. Where a document carries both `archivedAt` and `updatedAt`, the
 * later of the two is what a "most recent first" list should sort on.
 *
 * @param {...string} fields
 * @returns {(a: object, b: object) => number}
 */
export function byNewest(...fields) {
  const newest = (doc = {}) => Math.max(0, ...fields.map((field) => toMillis(doc[field])));
  return (a, b) => newest(b) - newest(a);
}
