/**
 * Readiness (ADR 0033 §4): how close the evidence on file is to a program's
 * requirements. Pure functions, so the test can pin the arithmetic; the
 * explanation says how the number was computed and that acceptance is the
 * program's decision, never this page's promise.
 */
import { toCalendarDate } from './model.js';

const DAY_MS = 86_400_000;

/** `?period=` as `{ start, end }`: `2026`, `2026-01-01..2026-12-31`, or null for no bound. */
export function parsePeriod(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  if (/^\d{4}$/.test(value)) return { start: `${value}-01-01`, end: `${value}-12-31` };
  const [start, end] = value.split('..').map((part) => toCalendarDate(part));
  if (!start && !end) return null;
  return { start, end };
}

/** True when `day` falls inside `period`; no period means every day, no day means never. */
export function inPeriod(day, period) {
  if (!period) return true;
  if (!day) return false;
  if (period.start && day < period.start) return false;
  if (period.end && day > period.end) return false;
  return true;
}

/**
 * Does one evidence row count toward one program? When it names programs it
 * counts only for those; when it names none it is general evidence and counts
 * for every program.
 */
export function evidenceRelevant(item, programId) {
  const ids = Array.isArray(item.programIds) ? item.programIds : [];
  return ids.length === 0 || ids.includes(programId);
}

/** One requirement scored against the relevant evidence. */
function scoreRequirement(req, relevant) {
  const types = Array.isArray(req.evidenceTypes) ? req.evidenceTypes : [];
  const items = relevant
    .filter((item) => types.length === 0 || types.includes(item.sourceModule))
    .map((item) => ({
      id: item.id,
      title: item.title,
      date: item.date,
      sourceModule: item.sourceModule,
      verificationStatus: item.verificationStatus || 'unverified',
    }));
  const minCount = Math.max(0, Number(req.minCount) || 0);
  return {
    id: req.id,
    label: req.label,
    minCount,
    weight: Number(req.weight) || 0,
    count: items.length,
    met: items.length >= minCount,
    items,
  };
}

/**
 * Evidence that will leave a rolling twelve-month window within sixty days,
 * so a renewal reads what is about to stop counting. Only when no explicit
 * period was asked for: a fixed period has no rolling edge.
 */
function expiringSoon(relevant, { period, today }) {
  if (period) return [];
  const now = today || new Date().toISOString().slice(0, 10);
  const edge = new Date(Date.parse(`${now}T00:00:00Z`) - 365 * DAY_MS);
  const soon = new Date(edge.getTime() + 60 * DAY_MS).toISOString().slice(0, 10);
  const edgeIso = edge.toISOString().slice(0, 10);
  return relevant
    .filter((item) => item.date && item.date >= edgeIso && item.date <= soon)
    .map((item) => ({ id: item.id, title: item.title, date: item.date, agesOutAfter: soon }));
}

/**
 * Score a program's requirements against the evidence. A requirement is met
 * when the count of relevant evidence of its evidence types in the period
 * reaches `minCount`; the score is the met weight over the total weight, as
 * a percentage; the explanation says so in words.
 */
export function computeReadiness(program, evidence, { period = null, today = null } = {}) {
  const requirements = Array.isArray(program?.requirements) ? program.requirements : [];
  const relevant = (evidence || []).filter(
    (item) =>
      !item.softDeletedAt && evidenceRelevant(item, program.id) && inPeriod(item.date, period)
  );
  const rows = requirements.map((req) => scoreRequirement(req, relevant));
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  const metRows = rows.filter((row) => row.met);
  const metWeight = metRows.reduce((sum, row) => sum + row.weight, 0);
  const score = totalWeight > 0 ? Math.round((metWeight / totalWeight) * 100) : 0;
  const missing = rows
    .filter((row) => !row.met)
    .map((row) => ({ id: row.id, label: row.label, shortfall: row.minCount - row.count }));

  const periodText = period
    ? `between ${period.start || 'the beginning'} and ${period.end || 'today'}`
    : 'with no date bound';
  const explanation = [
    `${metRows.length} of ${rows.length} requirements met ${periodText}.`,
    `Score is the weight of met requirements (${metWeight}) over the total weight (${totalWeight}), as a percentage.`,
    'A requirement is met when the number of relevant evidence items of its types reaches its minimum count; evidence that names no program counts for every program.',
    'This is a readiness estimate from your own records. Acceptance is decided by the program against its current published criteria, which this page does not promise.',
  ].join(' ');

  return {
    programId: program.id,
    period,
    requirements: rows,
    score,
    explanation,
    missing,
    expiring: expiringSoon(relevant, { period, today }),
  };
}
