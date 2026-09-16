/**
 * The Labs Hub's constants and pure helpers (#577).
 *
 * No React and no fetch, so a tab can be read for what it renders rather than
 * for how it derives it. The staleness threshold, the terminal-status set and
 * the poll backoff are in lib/labsPolling.js — see that module's header.
 */
import { isAgentOnline, toMillis } from '@/lib/labsPolling';

export const CLOCK_TICK_MS = 5000;

// Fallback mirror of LAB_JOB_TYPES in functions/labs-functions.js. The Console
// prefers the live list returned by getLabsSnapshot; this keeps the select
// usable if that call fails. The server re-validates on enqueue either way.
export const FALLBACK_JOB_TYPES = [
  { type: 'shell-echo', description: 'Smoke test — echoes the payload back from the sandbox.' },
  {
    type: 'terraform-validate',
    description: 'terraform init -backend=false && terraform validate on the payload HCL.',
  },
  {
    type: 'ansible-check',
    description: 'ansible-playbook --syntax-check on the payload playbook YAML.',
  },
];

export const STATUS_STYLES = {
  queued: 'border-sky-300 text-sky-600 dark:border-sky-700 dark:text-sky-400',
  claimed: 'border-violet-300 text-violet-600 dark:border-violet-700 dark:text-violet-400',
  running: 'border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400',
  succeeded: 'border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400',
  failed: 'border-rose-300 text-rose-600 dark:border-rose-700 dark:text-rose-400',
  timeout: 'border-orange-300 text-orange-600 dark:border-orange-700 dark:text-orange-400',
  cancelled: 'border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400',
};

export function formatDuration(job) {
  const start = toMillis(job.claimedAt) || toMillis(job.createdAt);
  const end = toMillis(job.finishedAt);
  if (!start || !end || end < start) return '—';
  const seconds = (end - start) / 1000;
  return seconds < 60
    ? `${seconds.toFixed(1)}s`
    : `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function formatTime(ts) {
  const ms = toMillis(ts);
  return ms ? new Date(ms).toLocaleString() : '—';
}

/**
 * Polling view of lab_agents + recent lab_jobs (admin read-only) — the
 * getLabsSnapshot RPC every 15s replaces the two legacy subscription streams,
 * and also supplies the server's job-type allowlist.
 */

/** The payload hints the Console shows per job type. */
export const PAYLOAD_PLACEHOLDERS = {
  'terraform-validate': '# main.tf contents…',
  'ansible-check': '# playbook.yml contents…',
};

/**
 * How many agents are online, and the one sentence that describes the fleet.
 *
 * Three states, not two. "Registered but offline" is the one that matters: an
 * agent that has heartbeated before and stopped is a different problem from
 * one that never connected, and the Agents tab offers a different fix for
 * each. Collapsing them into "not connected" sends an operator to reinstall
 * something that is already installed.
 */
export function fleetState(agents, now) {
  const online = agents.filter((agent) => isAgentOnline(agent, now));
  if (online.length > 0) {
    return { state: 'online', online, label: `${online.length} agent(s) connected` };
  }
  if (agents.length > 0) {
    return { state: 'stale', online, label: 'Agent registered but offline (stale heartbeat)' };
  }
  return { state: 'none', online, label: 'No agent connected yet' };
}
