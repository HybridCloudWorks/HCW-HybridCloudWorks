/**
 * Certification status derived from dates, not from the stored field.
 *
 * The Azure catalogue in src/data/azure/certifications.js is a hand-synced
 * file. Between syncs its `status` field goes stale the moment a date passes:
 * from 2026-06-30 to 2026-09-09 the live page printed "Expiring Soon" for ten
 * exams Microsoft had already retired and "BETA · ends Jun 30, 2026" for exams
 * that had gone GA (#461). The dates in the file were right the whole time;
 * only the label was wrong. So the label is computed here, at render time,
 * from the dates — and a date passing can no longer show a status that has
 * already ended.
 *
 * Every function here is pure so the page, the detail page, the pre-renderer
 * and the tests agree on one rule. The one hook, `useToday`, exists for
 * hydration: /azure/education and the 68 detail routes are pre-rendered at
 * build time and hydrated with `hydrateRoot`. If a render read the real clock,
 * the HTML built on Monday and the first client render on Friday would
 * disagree the day a status flips (an expiring row turned retired) — React
 * logs a hydration mismatch and re-renders the tree from scratch. So during
 * the pre-render and the hydrating render "today" is the catalogue's own
 * `DATA_AS_OF`, which the build and the browser share, and the render right
 * after hydration moves it to the viewer's real date. Server and first client
 * render agree; the page still corrects itself.
 */
import { useSyncExternalStore } from 'react';

export const CERT_STATUSES = Object.freeze(['active', 'beta', 'expiring', 'retired']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Today as `YYYY-MM-DD` in the viewer's local calendar. For code that runs
 * outside a render (tests, scripts, effects); inside a component use
 * `useToday` so the pre-rendered HTML and the first client render agree.
 */
export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// The clock is an external system as far as React is concerned, so it is read
// through useSyncExternalStore rather than a state-plus-effect pair: React
// uses the server snapshot for the pre-render and for the hydrating render,
// then re-renders with the client snapshot when the two differ — without a
// hydration mismatch, and without the setState-in-effect cascade the lint
// rule forbids. Nothing pushes updates (the date changes at midnight, which a
// page open that long can miss), so subscribe is a no-op.
const subscribeToNothing = () => () => {};

/**
 * "Today" for a render: `fallbackIso` (the catalogue's `DATA_AS_OF`) while
 * pre-rendering and while hydrating that HTML, the viewer's local date on every
 * render after that — and immediately on a client-side navigation, which has
 * no HTML to agree with. See the module header for why.
 *
 * @param {string} fallbackIso `YYYY-MM-DD`
 * @returns {string} `YYYY-MM-DD`
 */
export function useToday(fallbackIso) {
  return useSyncExternalStore(subscribeToNothing, todayIso, () => fallbackIso);
}

/**
 * Whether an ISO date is strictly before `today`. Both are `YYYY-MM-DD`
 * strings and are compared as text, so no Date parsing or zone conversion is
 * involved here; the caller defines "today" (`todayIso` gives the viewer's
 * local calendar date, `useToday` the catalogue date until mount).
 *
 * A missing or malformed date is never "past" — a bad value must not retire a
 * certification by accident.
 */
export function isPastDate(iso, today) {
  if (typeof iso !== 'string' || !ISO_DATE.test(iso)) return false;
  if (typeof today !== 'string' || !ISO_DATE.test(today)) return false;
  return iso < today;
}

/** `YYYY-MM-DD` → the UTC millisecond timestamp of that calendar day. */
function utcDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Whole calendar days from `today` to `iso`, both `YYYY-MM-DD`: 0 on the day
 * itself, positive ahead, negative once past. The parts are placed on the UTC
 * calendar with `Date.UTC`, where every day is exactly 86,400,000 ms, so a
 * span that crosses a daylight-saving change is not 23 or 25 hours long and
 * the "Xd" countdown cannot be off by one. Returns `null` for a missing or
 * malformed date rather than `NaN`.
 *
 * This is the canonical day-difference helper for the Learn pages; the
 * provider pages share it rather than subtracting two local-midnight Dates.
 */
export function daysUntil(iso, today) {
  if (typeof iso !== 'string' || !ISO_DATE.test(iso)) return null;
  if (typeof today !== 'string' || !ISO_DATE.test(today)) return null;
  return Math.round((utcDay(iso) - utcDay(today)) / 86400000);
}

/**
 * `2026-06-30` → `Jun 30, 2026`, the calendar day itself in every zone. The
 * day is placed on the UTC calendar and formatted in UTC, so neither the
 * parse nor the print applies the viewer's offset; `new Date('2026-06-30')`
 * formatted locally reads "Jun 29, 2026" west of Greenwich. Returns the input
 * unchanged when it is not a `YYYY-MM-DD` string.
 */
export function formatIsoDate(iso) {
  if (typeof iso !== 'string' || !ISO_DATE.test(iso)) return iso;
  return new Date(utcDay(iso)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The status to render for a certification (or applied skill) on `today`.
 *
 * Rules, in order:
 *   1. `expiryDate` before today → `retired`, whatever the stored status says.
 *   2. Stored `beta` whose `betaEndDate` is before today, or whose `gaDate` is
 *      today or earlier → `active`.
 *   3. Stored `active` with an `expiryDate` still ahead → `expiring`, because
 *      a published retirement date is what "expiring" means.
 *   4. Otherwise the stored status (`active` when absent).
 *
 * @param {{status?: string, expiryDate?: string, betaEndDate?: string, gaDate?: string}} cert
 * @param {string} [today] `YYYY-MM-DD`; defaults to the local date
 * @returns {'active'|'beta'|'expiring'|'retired'}
 */
export function deriveStatus(cert, today = todayIso()) {
  const stored = CERT_STATUSES.includes(cert?.status) ? cert.status : 'active';
  if (!cert) return stored;

  if (isPastDate(cert.expiryDate, today)) return 'retired';

  if (stored === 'beta') {
    const betaOver = isPastDate(cert.betaEndDate, today);
    const gaReached =
      typeof cert.gaDate === 'string' && ISO_DATE.test(cert.gaDate) && cert.gaDate <= today;
    if (betaOver || gaReached) return 'active';
    return 'beta';
  }

  if (
    stored === 'active' &&
    typeof cert.expiryDate === 'string' &&
    ISO_DATE.test(cert.expiryDate)
  ) {
    return 'expiring';
  }

  return stored;
}

/**
 * The stored statuses that contradict their own dates on `today` — the check
 * the data test runs so the next drift is a red build rather than a stale
 * page. Returns one line per offender, empty when the file is consistent.
 *
 * @param {Array<{code?: string, id?: string}>} entries
 * @param {string} today
 * @returns {string[]}
 */
export function findStaleStatuses(entries, today = todayIso()) {
  const problems = [];
  for (const entry of entries || []) {
    const label = entry.code || entry.id || entry.slug || '(unnamed)';
    if (entry.status === 'expiring' && isPastDate(entry.expiryDate, today)) {
      problems.push(`${label}: status 'expiring' but expiryDate ${entry.expiryDate} has passed`);
    }
    if (entry.status === 'active' && isPastDate(entry.expiryDate, today)) {
      problems.push(`${label}: status 'active' but expiryDate ${entry.expiryDate} has passed`);
    }
    if (entry.status === 'beta') {
      if (isPastDate(entry.betaEndDate, today)) {
        problems.push(`${label}: status 'beta' but betaEndDate ${entry.betaEndDate} has passed`);
      } else if (
        typeof entry.gaDate === 'string' &&
        ISO_DATE.test(entry.gaDate) &&
        entry.gaDate <= today
      ) {
        problems.push(`${label}: status 'beta' but gaDate ${entry.gaDate} has been reached`);
      }
    }
  }
  return problems;
}
