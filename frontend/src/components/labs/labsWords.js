/**
 * The words the labs cards print (#681, #664, #680). Every state on
 * `/education/labs` is signalled by a word, never by a colour alone — the
 * same rule `AVAILABLE_STATUS_WORD` in EducationIndexPage.jsx follows — and
 * these are the words. Pure functions, so the cards stay markup.
 */

/**
 * Azure Arc's `status` values for a `microsoft.hybridcompute/machines` row,
 * as the estate route passes them through, and the lowercase word each is
 * printed as. Anything else is "unknown" rather than echoed: the value comes
 * from a service, and a word this page did not choose should not reach the
 * screen unexamined.
 */
export const ARC_STATUS_WORD = Object.freeze({
  Connected: 'connected',
  Disconnected: 'disconnected',
  Expired: 'expired',
  Unknown: 'unknown',
});

export function arcStatusWord(status) {
  return ARC_STATUS_WORD[status] ?? 'unknown';
}

/** "1 minute" / "4 minutes". */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "4 minutes ago" for a heartbeat timestamp, measured against `nowMs` — the
 * estate card passes the server snapshot's `asOf`; a missing or unparseable
 * reference falls back to the real clock.
 *
 * Null is a fact of its own — Arc has recorded no heartbeat — and is said so,
 * not shown as an age. A timestamp in the future (clock skew between the
 * host, Azure and the viewer) is "just now" rather than a negative number.
 * An unparseable value is "unknown": the estate route promises an ISO string
 * or null, and anything else is not something this page should guess about.
 */
export function heartbeatAgeWords(iso, nowMs) {
  if (iso === null || iso === undefined) return 'no heartbeat recorded';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const reference = Number.isFinite(nowMs) ? nowMs : Date.now();
  const age = reference - then;
  if (age < 45 * SECOND) return 'just now';
  if (age < MINUTE) return `${plural(Math.round(age / SECOND), 'second')} ago`;
  if (age < HOUR) return `${plural(Math.round(age / MINUTE), 'minute')} ago`;
  if (age < DAY) return `${plural(Math.round(age / HOUR), 'hour')} ago`;
  return `${plural(Math.round(age / DAY), 'day')} ago`;
}

/** "1 of 5 workspaces running". Either count missing reads as unknown. */
export function capacityWords(capacity) {
  const running = Number(capacity?.running);
  const max = Number(capacity?.max);
  if (!Number.isFinite(running) || !Number.isFinite(max)) return 'capacity unknown';
  return `${running} of ${plural(max, 'workspace')} running`;
}

/** "12 compliant, 1 non-compliant" for the Arc machine's policy assignments. */
export function policyWords(policy) {
  const compliant = Number(policy?.compliant);
  const nonCompliant = Number(policy?.nonCompliant);
  if (!Number.isFinite(compliant) || !Number.isFinite(nonCompliant)) return 'not evaluated';
  return `${compliant} compliant, ${nonCompliant} non-compliant`;
}

/** "online, 2 jobs queued" for the vps-agent job runner. */
export function agentWords(agent) {
  if (!agent || typeof agent.online !== 'boolean') return 'not registered';
  const queued = Number(agent.queued);
  const queue = Number.isFinite(queued) ? `${plural(queued, 'job')} queued` : 'queue unknown';
  return `${agent.online ? 'online' : 'offline'}, ${queue}`;
}
