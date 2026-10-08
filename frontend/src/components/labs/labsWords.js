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
  return timeAgoWords(iso, nowMs, 'no heartbeat recorded');
}

/**
 * "3 days ago" for the moment a status began — Arc's last status change,
 * which is not a heartbeat: a host connected without a break for three days
 * changed status three days ago. Null is "not recorded".
 */
export function sinceWords(iso, nowMs) {
  return timeAgoWords(iso, nowMs, 'not recorded');
}

/** The age of `iso` in words, `missing` for null, "unknown" for anything unparseable. */
function timeAgoWords(iso, nowMs, missing) {
  if (iso === null || iso === undefined) return missing;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const reference = Number.isFinite(nowMs) ? nowMs : Date.now();
  return ageWords(reference - then);
}

/**
 * The unit an age is spoken in: the first row whose `below` the age is under.
 * Anything from a day up is days; there is no "weeks ago" because a heartbeat
 * that old is an incident, not a duration worth rounding.
 */
const AGE_UNITS = Object.freeze([
  { below: MINUTE, unit: SECOND, word: 'second' },
  { below: HOUR, unit: MINUTE, word: 'minute' },
  { below: DAY, unit: HOUR, word: 'hour' },
  { below: Infinity, unit: DAY, word: 'day' },
]);

/** "just now" under 45 seconds, otherwise "<n> <unit>s ago". */
export function ageWords(ageMs) {
  if (ageMs < 45 * SECOND) return 'just now';
  const { unit, word } = AGE_UNITS.find(({ below }) => ageMs < below);
  return `${plural(Math.round(ageMs / unit), word)} ago`;
}

/**
 * A count as the API sent it, or NaN when it sent none. Not `Number(value)`
 * alone: `Number(null)` is 0, and the status read sends `running: null` for a
 * count it does not know, which must never read as nobody running.
 */
const countOf = (value) => (value === null || value === undefined ? Number.NaN : Number(value));

/** "1 of 5 workspaces running". Either count missing reads as unknown. */
export function capacityWords(capacity) {
  const running = countOf(capacity?.running);
  const max = countOf(capacity?.max);
  if (!Number.isFinite(running) || !Number.isFinite(max)) return 'capacity unknown';
  return `${running} of ${plural(max, 'workspace')} running`;
}

/**
 * "12 compliant, 1 non-compliant" for the lab's policy checks, with ", 5 not
 * applicable to this lab" when some cannot evaluate here: checks for a
 * feature the lab does not use, which the estate read counts apart rather
 * than as failures. The clause is left out at zero, and for a response from
 * before the count existed.
 */
export function policyWords(policy) {
  const compliant = Number(policy?.compliant);
  const nonCompliant = Number(policy?.nonCompliant);
  if (!Number.isFinite(compliant) || !Number.isFinite(nonCompliant)) return 'not evaluated';
  const notApplicable = Number(policy?.notApplicable);
  const apart =
    Number.isFinite(notApplicable) && notApplicable > 0
      ? `, ${notApplicable} not applicable to this lab`
      : '';
  return `${compliant} compliant, ${nonCompliant} non-compliant${apart}`;
}

/** "online, 2 jobs queued" for the lab's job runner; "unavailable" when there is none. */
export function agentWords(agent) {
  if (!agent || typeof agent.online !== 'boolean') return 'unavailable';
  const queued = Number(agent.queued);
  const queue = Number.isFinite(queued) ? `${plural(queued, 'job')} queued` : 'queue unknown';
  return `${agent.online ? 'online' : 'offline'}, ${queue}`;
}

/**
 * The job runner's last heartbeat: "just now" / "1 minute ago" while it is
 * online. The estate read sends the time only for a runner that is online,
 * so null means none in the last minute and a half, said that way rather
 * than as an age that would describe a runner that had stopped.
 */
export function runnerHeartbeatWords(agent, nowMs) {
  if (!agent || typeof agent.online !== 'boolean') return 'unavailable';
  if (agent.lastHeartbeatAt === null || agent.lastHeartbeatAt === undefined) {
    return 'none in the last 90 seconds';
  }
  return heartbeatAgeWords(agent.lastHeartbeatAt, nowMs);
}

/**
 * How each provider hub is named in the labs' own prose: the list heading
 * ("Terraform labs"), the chips on a card, the groups on the index. The
 * `/:provider` segment is the key, so every VALID_PROVIDERS entry has a row
 * (labsWords.test.js checks) and a provider with no labs yet still has a
 * name for its empty list.
 */
export const PROVIDER_NAMES = Object.freeze({
  azure: 'Azure',
  aws: 'AWS',
  gcp: 'Google Cloud',
  github: 'GitHub',
  terraform: 'Terraform',
  finops: 'FinOps',
  vmware: 'VMware',
  ansible: 'Ansible',
  docker: 'Docker',
});

/** "Terraform" for `terraform`; the segment itself for a provider this map does not know. */
export function providerName(provider) {
  return PROVIDER_NAMES[provider] ?? String(provider ?? '');
}
