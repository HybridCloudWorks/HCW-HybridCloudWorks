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

// `upcoming` is a version a vendor has announced but nobody can sit yet (AWS
// SAP-C03 before 2026-11-17); it becomes `active` on its `availableDate`.
export const CERT_STATUSES = Object.freeze(['active', 'beta', 'upcoming', 'expiring', 'retired']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True for a `YYYY-MM-DD` string that names a real calendar day — the check
 * the catalogue tests run on `DATA_AS_OF` and on every dated field, so a
 * typo like `2026-02-30` is a red build rather than a date that never comes.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const ms = utcDay(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

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
 * The server snapshot `useToday` uses when a caller has no `DATA_AS_OF` to
 * give it. A fixed day rather than the clock, so the pre-render and the
 * hydrating render still agree with each other (#465 review): with an
 * undefined fallback `useSyncExternalStore` would have hydrated on the
 * viewer's date and mismatched the HTML. Every catalogue exports a
 * `DATA_AS_OF`, so this is reached only by a page that forgot to pass it.
 */
export const UNDATED_FALLBACK_ISO = '1970-01-01';

/**
 * "Today" for a render: `fallbackIso` (the catalogue's `DATA_AS_OF`) while
 * pre-rendering and while hydrating that HTML, the viewer's local date on every
 * render after that — and immediately on a client-side navigation, which has
 * no HTML to agree with. See the module header for why. A missing or
 * malformed `fallbackIso` is replaced by `UNDATED_FALLBACK_ISO`, so the server
 * snapshot is always the same real day.
 *
 * @param {string} [fallbackIso] `YYYY-MM-DD`
 * @returns {string} `YYYY-MM-DD`
 */
export function useToday(fallbackIso) {
  const serverSnapshot = isIsoDate(fallbackIso) ? fallbackIso : UNDATED_FALLBACK_ISO;
  return useSyncExternalStore(subscribeToNothing, todayIso, () => serverSnapshot);
}

/**
 * Whether an ISO date is strictly before `today`. Both are `YYYY-MM-DD`
 * strings and are compared as text, so no Date parsing or zone conversion is
 * involved here; the caller defines "today" (`todayIso` gives the viewer's
 * local calendar date, `useToday` the catalogue date until mount).
 *
 * A missing, malformed or impossible date (`2026-02-30`) is never "past" — a
 * bad value must not retire a certification by accident, and it is reported
 * once, by the shape check in `findStaleStatuses`, not again here.
 */
export function isPastDate(iso, today) {
  if (!isIsoDate(iso) || !isIsoDate(today)) return false;
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
  if (!isIsoDate(iso) || !isIsoDate(today)) return null;
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
  if (!isIsoDate(iso)) return iso;
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
 *   3. Stored `upcoming` whose `availableDate` is today or earlier → `active`.
 *   4. Stored `active` with an `expiryDate` still ahead → `expiring`, because
 *      a published retirement date is what "expiring" means.
 *   5. Otherwise the stored status (`active` when absent).
 *
 * @param {{status?: string, expiryDate?: string, betaEndDate?: string, gaDate?: string, availableDate?: string}} cert
 * @param {string} [today] `YYYY-MM-DD`; defaults to the local date
 * @returns {'active'|'beta'|'upcoming'|'expiring'|'retired'}
 */
export function deriveStatus(cert, today = todayIso()) {
  const stored = CERT_STATUSES.includes(cert?.status) ? cert.status : 'active';
  if (!cert) return stored;

  if (isPastDate(cert.expiryDate, today)) return 'retired';

  // Every date that decides a status goes through isIsoDate, not the shape
  // regex: an impossible day such as 2026-02-30 must not flip anything.
  const reached = (iso) => isIsoDate(iso) && isIsoDate(today) && iso <= today;

  if (stored === 'beta') {
    if (isPastDate(cert.betaEndDate, today) || reached(cert.gaDate)) return 'active';
    return 'beta';
  }

  if (stored === 'upcoming') {
    return reached(cert.availableDate) ? 'active' : 'upcoming';
  }

  if (stored === 'active' && isIsoDate(cert.expiryDate)) {
    return 'expiring';
  }

  return stored;
}

/**
 * What a status badge should say for a row on `today`.
 *
 * `label` is the short word on the badge and `detail` the date phrase beside
 * it; both are `null` for an active exam so a caller can render nothing.
 * Dates are printed with `formatIsoDate`, never a local `new Date(iso)`.
 *
 * @param {object} cert
 * @param {string} [today] `YYYY-MM-DD`; defaults to the local date
 * @returns {{status: string, label: string|null, detail: string|null}}
 */
export function describeCertStatus(cert, today = todayIso()) {
  const status = deriveStatus(cert, today);
  const replacedBy = cert?.replacement?.code ? ` · replaced by ${cert.replacement.code}` : '';

  switch (status) {
    case 'expiring':
      return {
        status,
        label: 'Retiring',
        detail: `last day to test ${formatIsoDate(cert.expiryDate)}${replacedBy}`,
      };
    case 'retired': {
      const on = cert.retiredDate ?? cert.expiryDate;
      const detail = `${isIsoDate(on) ? formatIsoDate(on) : ''}${replacedBy}`.replace(/^ · /, '');
      return { status, label: 'Retired', detail: detail || null };
    }
    case 'beta': {
      if (isIsoDate(cert.betaStartDate) && cert.betaStartDate > today) {
        return { status, label: 'Beta', detail: `from ${formatIsoDate(cert.betaStartDate)}` };
      }
      return {
        status,
        label: 'Beta',
        detail: isIsoDate(cert.gaDate) ? `GA ${formatIsoDate(cert.gaDate)}` : null,
      };
    }
    case 'upcoming':
      return {
        status,
        label: 'Coming',
        detail: isIsoDate(cert.availableDate)
          ? `available ${formatIsoDate(cert.availableDate)}`
          : null,
      };
    default:
      return { status, label: null, detail: null };
  }
}

/**
 * Every field on a catalogue row that holds a `YYYY-MM-DD`. This is the one
 * list: `findStaleStatuses` validates each of them, and the catalogue tests
 * import it so a field added to the data cannot be missed by the check —
 * `registrationOpens` (the AWS upcoming rows) was, once (#465 review).
 */
export const CERT_DATE_FIELDS = Object.freeze([
  'expiryDate',
  'betaEndDate',
  'betaStartDate',
  'gaDate',
  'availableDate',
  'registrationOpens',
  'retiredDate',
]);

/**
 * The stored statuses that contradict their own dates on `today` — the check
 * the data test runs so the next drift is a red build rather than a stale
 * page. Returns one line per offender, empty when the file is consistent.
 * Also names a status outside `CERT_STATUSES`, a dated field that is not
 * `YYYY-MM-DD`, and an `expiring` row with no `expiryDate`, since each of
 * those is a claim `deriveStatus` cannot check.
 *
 * @param {Array<{code?: string, id?: string}>} entries
 * @param {string} today
 * @returns {string[]}
 */
export function findStaleStatuses(entries, today = todayIso()) {
  const problems = [];
  for (const entry of entries || []) {
    const label = entry.code || entry.id || entry.slug || '(unnamed)';
    if (entry.status !== undefined && !CERT_STATUSES.includes(entry.status)) {
      problems.push(`${label}: unknown status '${entry.status}'`);
      continue;
    }
    problems.push(...shapeProblems(entry, label), ...dateProblems(entry, label, today));
  }
  return problems;
}

/** Fields that are present but not a calendar day, and a dateless `expiring`. */
function shapeProblems(entry, label) {
  const problems = [];
  for (const field of CERT_DATE_FIELDS) {
    const value = entry[field];
    if (value !== undefined && value !== null && !isIsoDate(value)) {
      problems.push(`${label}: ${field} '${value}' is not YYYY-MM-DD`);
    }
  }
  if (
    entry.status === 'expiring' &&
    (entry.expiryDate === undefined || entry.expiryDate === null)
  ) {
    problems.push(`${label}: status 'expiring' but no expiryDate`);
  }
  return problems;
}

/** A stored status that `today` has already moved past. */
function dateProblems(entry, label, today) {
  const problems = [];
  const reached = (iso) => isIsoDate(iso) && isIsoDate(today) && iso <= today;
  switch (entry.status) {
    case 'expiring':
    case 'active':
      if (isPastDate(entry.expiryDate, today)) {
        problems.push(
          `${label}: status '${entry.status}' but expiryDate ${entry.expiryDate} has passed`
        );
      }
      break;
    case 'beta':
      if (isPastDate(entry.betaEndDate, today)) {
        problems.push(`${label}: status 'beta' but betaEndDate ${entry.betaEndDate} has passed`);
      } else if (reached(entry.gaDate)) {
        problems.push(`${label}: status 'beta' but gaDate ${entry.gaDate} has been reached`);
      }
      break;
    case 'upcoming':
      if (reached(entry.availableDate)) {
        problems.push(
          `${label}: status 'upcoming' but availableDate ${entry.availableDate} has been reached`
        );
      }
      break;
    default:
      break;
  }
  return problems;
}
