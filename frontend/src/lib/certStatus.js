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
 * Pure and dependency-free so the page, the detail page, the pre-renderer and
 * the tests all agree on one rule.
 */

export const CERT_STATUSES = Object.freeze(['active', 'beta', 'expiring', 'retired']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today as `YYYY-MM-DD` in the viewer's local calendar. */
export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Whether an ISO date is strictly before `today`. ISO `YYYY-MM-DD` strings
 * compare correctly as text, which keeps this free of time zones: a
 * retirement dated 2026-06-30 is "past" from 2026-07-01, everywhere.
 *
 * A missing or malformed date is never "past" — a bad value must not retire a
 * certification by accident.
 */
export function isPastDate(iso, today) {
  if (typeof iso !== 'string' || !ISO_DATE.test(iso)) return false;
  if (typeof today !== 'string' || !ISO_DATE.test(today)) return false;
  return iso < today;
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
