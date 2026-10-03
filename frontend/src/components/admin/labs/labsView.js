/**
 * The Labs Hub's constants and pure helpers (#577).
 *
 * No React and no fetch, so a tab can be read for what it renders rather than
 * for how it derives it. The staleness threshold, the terminal-status set and
 * the poll backoff are in lib/labsPolling.js — see that module's header.
 */
import { isAgentOnline, toMillis } from '@/lib/labsPolling';

export const CLOCK_TICK_MS = 5000;

// Fallback mirror of LAB_JOB_TYPES in functions/src/lib/labs.js. The Console
// prefers the live list returned by getLabsSnapshot; this keeps the select
// usable if that call fails. The server re-validates on enqueue either way.
// Mirrors LAB_JOB_TYPES in functions/src/lib/labs.js and CAPABILITIES in
// vps-agent/lib/capabilities.js: a job type lands in all three or not at all.
export const FALLBACK_JOB_TYPES = [
  {
    type: 'shell-echo',
    description: 'Smoke test — echoes the payload back from the sandbox.',
    payloadEncodings: ['text'],
  },
  {
    type: 'terraform-validate',
    description:
      'terraform init -backend=false && terraform validate on the payload HCL, with registry AVM sources rewritten to the vendored copies in the runner image. Text is one main.tf; tar is a whole root.',
    payloadEncodings: ['text', 'tar'],
  },
  {
    type: 'ansible-check',
    description:
      'ansible-playbook --syntax-check on the payload playbook YAML, with the ansible-core in the runner image and no collections: a module outside ansible.builtin does not resolve.',
    payloadEncodings: ['text'],
  },
  {
    type: 'helm-template',
    description:
      'helm template on a chart: the payload is the base64 of a tar of one chart directory, dependencies already under charts/. No repository, no cluster.',
    payloadEncodings: ['tar'],
  },
  {
    type: 'kubeconform',
    description:
      'kubeconform -strict on Kubernetes manifests against the schemas bundled in the runner image. Text is one manifest file; tar is a directory of them.',
    payloadEncodings: ['text', 'tar'],
  },
];

// One style per JOB_STATUSES entry (functions/src/lib/labs.js). There is no
// `running`: the agent writes `claimed`, then a terminal status, and the
// style this map carried for it coloured a state that was never stored.
export const STATUS_STYLES = {
  queued: 'border-sky-300 text-sky-600 dark:border-sky-700 dark:text-sky-400',
  claimed: 'border-violet-300 text-violet-600 dark:border-violet-700 dark:text-violet-400',
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

/**
 * The shared status vocabulary (lib/status.js) for the three concepts the
 * Dashboard defines (ADR 0033 "Labs"): the Agent from the fleet, the Desktop
 * from the public workspace read, the Lab from the catalogue.
 */

/** `fleetState(...)` as a system status word: online → healthy, stale → degraded, none → unavailable. */
export function fleetStatusWord(fleet) {
  if (fleet.state === 'online') return 'healthy';
  if (fleet.state === 'stale') return 'degraded';
  return 'unavailable';
}

/**
 * A catalogue status as a StatusBadge status: `available` is published and
 * healthy, `coming` is held back and says since when.
 */
export function labStatusInfo(lab) {
  if (lab.status === 'available') {
    return { id: 'available', label: 'Available', tone: 'ok', help: 'Listed on the public pages.' };
  }
  return {
    id: 'coming',
    label: 'Not yet listed',
    tone: 'warn',
    help: `Held back since ${lab.comingSince}: ${lab.comingReason}`,
  };
}

/** The payload hints the Console shows per job type. */
export const PAYLOAD_PLACEHOLDERS = {
  'terraform-validate': '# main.tf contents…',
  'ansible-check': '# playbook.yml contents…',
  'helm-template': 'base64 of a tar of the chart directory (tar -cz mychart | base64)…',
  kubeconform: '# manifests.yaml contents…',
};

/** The owner script that prints the two values Register agent asks for. */
export const REGISTER_SCRIPT = 'scripts/lab/Register-LabAgent.ps1';

// The server's rules (functions/src/lib/labs/agent-registry.js), repeated so
// the form can say what is wrong before a round trip. The server re-validates
// either way; these only decide what the form refuses to send.
export const AGENT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const OBJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What is wrong with a registration, as one sentence, or null when the form
 * may send it. Values are expected trimmed.
 *
 * @param {{agentId: string, oid: string, jobTypes: string[]}} registration
 * @returns {string|null}
 */
export function validateAgentRegistration({ agentId, oid, jobTypes }) {
  if (!AGENT_ID_PATTERN.test(agentId)) {
    return 'The agent id is the certificate CN, such as vps-hostinger-01: lower-case letters, digits and hyphens.';
  }
  if (!OBJECT_ID_PATTERN.test(oid)) {
    return 'The object id is a GUID: the object id of the agent service principal.';
  }
  if (jobTypes.length === 0) {
    return 'Tick at least one job type. To stop an agent taking work, deactivate it instead.';
  }
  return null;
}

/** The sentence a deactivated agent's registration toast ends with. */
const STILL_DEACTIVATED =
  ' It is still deactivated, so the API refuses it: Activate it on its card to let it take work.';

/**
 * The toast for what `POST cms/labs/agents` answered: registered, updated, or
 * already exactly this. A registration never reactivates an agent, so a
 * deactivated one is told so rather than left to look registered and working.
 *
 * @param {{created?: boolean, changed?: boolean, agent?: object}} res
 * @returns {{title: string, description: string}}
 */
export function registrationToast(res) {
  const agent = res?.agent || {};
  const id = agent.agentId || agent.id || 'The agent';
  const tail = agent.active === false ? STILL_DEACTIVATED : '';
  if (res?.created) {
    return {
      title: 'Agent registered',
      description: `${id} is bound to ${agent.oid} and active: the API admits its next heartbeat.`,
    };
  }
  if (res?.changed) {
    return { title: 'Agent updated', description: `${id} is now bound to ${agent.oid}.${tail}` };
  }
  return {
    title: 'Already registered',
    description: `${id} already holds exactly this; nothing changed.${tail}`,
  };
}

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
