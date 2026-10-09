/**
 * What the lab host last reported about its Coder upkeep, as the Hybrid Lab
 * card shows it under Coder (2026-10-08). Pure, so every sentence and every
 * colour is testable without a network or a DOM.
 *
 * The host renews the site's Coder status token itself and hands it to the
 * API, which checks it against Coder before storing it; it also publishes
 * the lab template. Each run reports how that went, and the API keeps the
 * latest report in one document, read here through
 * `cms/labs/coder-automation` (editor). The card's Test still says when the
 * token itself expires (serviceRegistry.jsx, describeTokenExpiry); this says
 * whether anything is keeping it from expiring.
 *
 * THE STATUS IS lib/status.js's, worst first, from what the report says:
 *
 *   critical  the status token or the rotation credential has expired, or a
 *             check failed while the status token is inside the renewal
 *             window: nothing will renew it in time without a person.
 *   degraded  the last check failed with the token still well inside its
 *             life; the rotation credential is inside the window; or the
 *             host has not reported for SILENT_AFTER_DAYS.
 *   healthy   none of those.
 *
 * Before the first report there is no status at all, only "Automatic renewal
 * not set up yet": the manual paste on the Keys tab is still a supported way
 * to keep the token, so the absence of automation is not an error.
 */

import { describeAge, worstStatus } from '@/lib/status';

export const CODER_AUTOMATION_ROUTE = 'cms/labs/coder-automation';

export const NOT_SET_UP = 'Automatic renewal not set up yet';

/** The renewal window, when the answer does not carry the server's (it does: 30). */
export const DEFAULT_WARNING_DAYS = 30;

/**
 * A host that has said nothing for a week has stopped, whatever its last
 * report said. A week, not a day, so a host down for a weekend is not an
 * alarm: a 30-day renewal window leaves three more before it matters.
 */
export const SILENT_AFTER_DAYS = 7;

const DAY_MS = 86_400_000;

const day = (iso) => String(iso).slice(0, 10);

/** Whole days from now until `iso` (negative once it has passed), or null when it is not a time. */
function daysUntil(iso, now) {
  const ms = Date.parse(iso ?? '');
  return Number.isFinite(ms) ? Math.floor((ms - now) / DAY_MS) : null;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The rows, in the order the card lists them. */
function describeRows(report, now) {
  const renewed = report.statusTokenRotatedAt
    ? `Status token renewed on ${day(report.statusTokenRotatedAt)} (by the lab host)`
    : 'Status token not renewed by the lab host yet';
  const expires = report.statusTokenExpiresAt
    ? `; it expires on ${day(report.statusTokenExpiresAt)}`
    : '';
  const template = report.templatePushedAt
    ? `Template last published ${day(report.templatePushedAt)}${report.templateVersion ? ` (${report.templateVersion})` : ''}`
    : 'Template not published by the lab host yet';
  const age = describeAge(report.checkedAt, now);
  return [
    { id: 'renewed', text: `${renewed}${expires}.` },
    {
      id: 'rotation',
      text: report.rotationTokenExpiresAt
        ? `Rotation credential expires on ${day(report.rotationTokenExpiresAt)}.`
        : 'Rotation credential expiry not reported.',
    },
    { id: 'template', text: `${template}.` },
    {
      id: 'checked',
      text: report.checkedAt
        ? `Last automation check ${day(report.checkedAt)}${age ? ` (${age})` : ''}.`
        : 'No automation check reported.',
    },
  ];
}

/** What is wrong, each with the status it earns. Empty when nothing is. */
function describeProblems(report, warningDays, now) {
  const problems = [];
  const tokenDays = daysUntil(report.statusTokenExpiresAt, now);
  const rotationDays = daysUntil(report.rotationTokenExpiresAt, now);
  const checkedMs = Date.parse(report.checkedAt ?? '');
  const silentDays = Number.isFinite(checkedMs) ? Math.floor((now - checkedMs) / DAY_MS) : null;

  if (tokenDays !== null && tokenDays < 0) {
    problems.push({
      status: 'critical',
      text: `The status token expired on ${day(report.statusTokenExpiresAt)}.`,
    });
  }
  if (rotationDays !== null && rotationDays < 0) {
    problems.push({
      status: 'critical',
      text: `The rotation credential expired on ${day(report.rotationTokenExpiresAt)}, so the lab host can no longer renew the status token. Renew the credential on the lab host, or paste a status token on the Keys tab.`,
    });
  } else if (rotationDays !== null && rotationDays <= warningDays) {
    problems.push({
      status: 'degraded',
      text: `The rotation credential expires in ${plural(rotationDays, 'day')}; renew it on the lab host before then.`,
    });
  }
  if (report.lastError) {
    const urgent = tokenDays !== null && tokenDays <= warningDays;
    problems.push({
      status: urgent ? 'critical' : 'degraded',
      text: `Last check failed: ${report.lastError}`,
    });
  }
  if (silentDays !== null && silentDays >= SILENT_AFTER_DAYS) {
    problems.push({
      status: 'degraded',
      text: `The lab host has not reported for ${plural(silentDays, 'day')}.`,
    });
  }
  return problems;
}

/**
 * The card's view of one `cms/labs/coder-automation` answer.
 *
 * @param {{ report?: object|null, warningDays?: number }|null|undefined} read
 * @param {number} [now] epoch ms
 * @returns {{ setUp: false, status: null, rows: [], problems: [], note: string }
 *   | { setUp: true, status: 'healthy'|'degraded'|'critical', rows: Array<{id: string, text: string}>, problems: Array<{status: string, text: string}>, note: null }}
 */
export function describeCoderAutomation(read, now = Date.now()) {
  const report = read?.report;
  if (!report || typeof report !== 'object') {
    return { setUp: false, status: null, rows: [], problems: [], note: NOT_SET_UP };
  }
  const warningDays = Number.isFinite(read.warningDays) ? read.warningDays : DEFAULT_WARNING_DAYS;
  const problems = describeProblems(report, warningDays, now);
  const status = problems.length ? worstStatus(problems.map((p) => p.status)) : 'healthy';
  return { setUp: true, status, rows: describeRows(report, now), problems, note: null };
}
