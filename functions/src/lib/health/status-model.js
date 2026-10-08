/**
 * status-model.js — the server's copy of the system status model (#1010,
 * #1011), for the health pulse and the probe-results routes.
 *
 * The model is written once, for people, in frontend/src/lib/status.js: five
 * states (healthy, degraded, critical, offline, unknown), the freshness
 * windows, the heartbeat rule and the critical-against-offline classifier.
 * This file repeats the parts the server needs, and the frontend's
 * pages/admin/health/statusParity.test.js imports both and fails if they
 * disagree, so the pulse can never judge by different rules than the page
 * that shows its results.
 *
 *   critical  it answered, but said no (a missing setting, a refused key, a
 *             failing check)
 *   offline   it could not be reached, or it has been silent past its
 *             heartbeat window
 *
 * Until 2026-10-08 those two were `misconfigured` and `unavailable`;
 * `normalizeStatus` still reads both, so a client on the old words keeps
 * working.
 */

export const SYSTEM_STATUS_IDS = Object.freeze([
  'healthy',
  'degraded',
  'critical',
  'offline',
  'unknown',
]);

/** The ids the model used until 2026-10-08, and the state each now means. */
export const LEGACY_SYSTEM_IDS = Object.freeze({
  misconfigured: 'critical',
  unavailable: 'offline',
});

/** A status id this model knows (new or legacy) as its current id, or null. */
export function normalizeStatus(value) {
  const id = String(value ?? '')
    .trim()
    .toLowerCase();
  if (SYSTEM_STATUS_IDS.includes(id)) return id;
  return LEGACY_SYSTEM_IDS[id] ?? null;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** How often the pulse runs: its schedule in schedulers.js is every five minutes. */
export const PULSE_INTERVAL_MS = 5 * MINUTE_MS;

/** Beats a heartbeat may miss before it is offline. */
export const MISSED_BEATS = 3;

/** The pulse is late after this long without a beat. */
export const PULSE_LATE_AFTER_MS = MISSED_BEATS * PULSE_INTERVAL_MS;

/** How long a result stays evidence, by where it came from (frontend/src/lib/status.js). */
export const FRESHNESS_MS = Object.freeze({
  pulse: PULSE_LATE_AFTER_MS,
  snapshot: PULSE_LATE_AFTER_MS,
  live: 24 * HOUR_MS,
  session: 24 * HOUR_MS,
});

const MISSING_SETTING = /not configured|is not set|not provisioned|no \S+( \S+)? (is )?configured/i;

const UNREACHABLE =
  /failed to fetch|networkerror|network error|load failed|timed out|\btimeout\b|did not answer|could not be reached|unreachable|not reachable|econnrefused|econnreset|enotfound|eai_again|getaddrinfo|socket hang up|no heartbeat|\bHTTP (502|503|504)\b/i;

const UNREACHABLE_STATUSES = new Set([502, 503, 504]);

/**
 * Critical or offline, for a check that failed: a missing setting is
 * critical; a network error, a timeout or a gateway status is offline;
 * anything else answered and said no, and is critical.
 */
export function classifyFailure(failure) {
  const message = String(failure?.message ?? failure ?? '');
  if (MISSING_SETTING.test(message)) return 'critical';
  if (UNREACHABLE_STATUSES.has(Number(failure?.status ?? failure?.code))) return 'offline';
  return UNREACHABLE.test(message) ? 'offline' : 'critical';
}
