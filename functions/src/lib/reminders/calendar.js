/**
 * reminders/calendar.js — dates for the reminders sheet, and when a reminder
 * is due to be said.
 *
 * Kept apart from the shape (settings.js) so each file holds one concern:
 * this one never sees a request body, that one never computes a day. Every
 * date here is a UTC calendar day as `YYYY-MM-DD`, which is how the sheet
 * stores it and how the daily timer (timers/reminders.js) reads the clock.
 */

/** How often an overdue reminder is repeated until it is marked done. */
export const OVERDUE_REPEAT_DAYS = 7;

/** The three moments a reminder is said, in the order they happen. */
export const STAGES = Object.freeze(['ahead', 'due', 'overdue']);

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` that names a real day (2026-02-30 is refused), else null. */
export function parseDateOnly(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(DATE_PATTERN);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const roundTrip = new Date(utc);
  const real =
    roundTrip.getUTCFullYear() === y && roundTrip.getUTCMonth() === m - 1 && roundTrip.getUTCDate() === d;
  return real ? utc : null;
}

/** The UTC calendar day of an instant, as `YYYY-MM-DD`. */
export const dateOnly = (date) => new Date(date).toISOString().slice(0, 10);

/** Whole days from `today` (YYYY-MM-DD) to `dueDate` (YYYY-MM-DD); negative when past. */
export function daysUntil(dueDate, today) {
  const due = parseDateOnly(dueDate);
  const from = parseDateOnly(today);
  if (due === null || from === null) return null;
  return Math.round((due - from) / DAY_MS);
}

/** An overdue reminder is said when never said, then once each OVERDUE_REPEAT_DAYS. */
function overdueAgain(stamp, nowMs) {
  if (!stamp) return true;
  const since = Date.parse(stamp);
  return Number.isFinite(since) && nowMs - since >= OVERDUE_REPEAT_DAYS * DAY_MS;
}

/**
 * Which stage, if any, `reminder` is due to be said at on `today`, given
 * what has been said already (`notified`). Null means stay quiet.
 *
 *   ahead    once, the first day within `leadDays` of the date
 *   due      once, on the day
 *   overdue  the day after, then every OVERDUE_REPEAT_DAYS until done
 *
 * A reminder marked done is never said. `leadDays` 0 skips the ahead stage.
 */
export function stageDue(reminder, today, nowMs = Date.parse(`${today}T00:00:00.000Z`)) {
  const days = daysUntil(reminder.dueDate, today);
  if (reminder.done || days === null || days > reminder.leadDays) return null;
  const notified = reminder.notified ?? {};
  let stage = null;
  if (days > 0) stage = notified.ahead ? null : 'ahead';
  else if (days === 0) stage = notified.due ? null : 'due';
  else if (overdueAgain(notified.overdue, nowMs)) stage = 'overdue';
  return stage;
}
