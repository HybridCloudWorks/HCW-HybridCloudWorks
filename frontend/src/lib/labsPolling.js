/**
 * The rules the Labs console polls by.
 *
 * Extracted from LabsPage.jsx because two of them had already drifted apart
 * inside that one file: the output pane treated four statuses as terminal and
 * the poll loop treated three, so a job that timed out kept the poll running
 * forever while the pane it fed said the job was finished (T-308).
 * A constant that two call sites must agree on belongs in one place, and a
 * rule worth agreeing on is worth testing.
 */

import { toMillis } from '@/lib/dateUtils';

/**
 * Statuses after which a lab job will never change again.
 *
 * A subset of `JOB_STATUSES` in `functions/src/lib/labs.js`; the complement is
 * `queued`, `claimed` and `running`. Note this is a different set from
 * `AGENT_TERMINAL_STATUSES` in `functions/src/lib/lab-agent.js`, which
 * deliberately excludes `cancelled` because an agent may not report it — the
 * console, reading rather than writing, must recognize all four.
 */
export const TERMINAL_JOB_STATUSES = Object.freeze(['succeeded', 'failed', 'timeout', 'cancelled']);

/**
 * @param {unknown} status
 * @returns {boolean}
 */
export function isTerminalJobStatus(status) {
  return TERMINAL_JOB_STATUSES.includes(status);
}

/** Steady-state interval between `getLabJob` polls while a job is running. */
export const JOB_POLL_BASE_MS = 5000;

/** Ceiling for the backoff, so a long outage settles at one call a minute. */
export const JOB_POLL_MAX_MS = 60000;

/**
 * How long to wait before the next `getLabJob` call.
 *
 * Doubles per consecutive transport failure and resets on the first success.
 * The poll is never abandoned: the job is still running on the agent, and
 * giving up would mean the operator never learns how it ended.
 *
 * @param {number} consecutiveErrors - 0 after a successful poll.
 * @returns {number} Milliseconds.
 */
export function jobPollDelay(consecutiveErrors) {
  if (!(consecutiveErrors > 0)) return JOB_POLL_BASE_MS;
  return Math.min(JOB_POLL_BASE_MS * 2 ** consecutiveErrors, JOB_POLL_MAX_MS);
}

/**
 * Three missed 30 s heartbeats. Must match `getLabsSnapshot` in
 * `functions/src/lib/labs.js`.
 */
export const STALE_AFTER_MS = 90 * 1000;

/**
 * Re-exported so LabsPage has one import for the rules it polls by. The
 * implementation is in lib/dateUtils.js — this was the eighth copy of it, and
 * T-304 collapsed all of them.
 */
export { toMillis };

/**
 * The statuses an agent heartbeats about its own shutdown. Must match
 * `AGENT_DOWN_STATUSES` in `functions/src/lib/labs.js`.
 */
export const AGENT_DOWN_STATUSES = Object.freeze(['stopping', 'offline']);

/**
 * Whether an agent has heartbeated recently enough to be considered online,
 * and that heartbeat did not announce its own shutdown: the `offline`
 * heartbeat writes `lastSeenAt` too, so freshness alone showed a stopped
 * agent as connected for 90 seconds (#1009). Nor is a deactivated agent
 * online: the guard refuses it at once, while its last heartbeat stays fresh
 * for 90 seconds (review of #1018). The server's rule is the same
 * (`isAgentOnline` in `functions/src/lib/labs.js`).
 *
 * `now` is passed in rather than read from the clock so the caller controls
 * where it comes from. That is the whole point of T-309: when `now` advanced
 * only on a successful snapshot fetch, an outage froze it, `now - lastSeen`
 * stopped growing, and the dashboard went on reporting "connected" for
 * precisely as long as nothing was reachable.
 *
 * @param {{lastSeenAt?: unknown, status?: unknown, active?: unknown}} agent
 * @param {number} now - epoch ms
 * @returns {boolean}
 */
export function isAgentOnline(agent, now) {
  if (agent?.active === false) return false;
  if (AGENT_DOWN_STATUSES.includes(agent?.status)) return false;
  const lastSeen = toMillis(agent?.lastSeenAt);
  return lastSeen > 0 && now - lastSeen < STALE_AFTER_MS;
}
