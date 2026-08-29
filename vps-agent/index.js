/**
 * HCW Labs VPS Agent
 *
 * Pull-based job executor. No inbound ports: the agent dials out to the
 * Functions API, asks for a job it is registered to run, executes it in a
 * sandboxed Docker container (lib/docker-runner.js), and posts the result back.
 *
 * ===========================================================================
 * WHAT CHANGED FROM THE VERSION THIS REPLACES
 * ===========================================================================
 * The file that was here held a Cosmos DB **account primary key** — read/write
 * over all 71 containers — in an environment variable on a third-party VPS
 * (TODO.md T-401). It also never worked: `pollJobs` was a TODO,
 * there was no heartbeat interval, no job execution, and the module used ESM
 * syntax in a package with no `"type": "module"`.
 *
 * This version holds no database credential at all. Three consequences worth
 * knowing when reading the loop below:
 *
 *  - **The server decides what this agent may run.** Capabilities come from the
 *    `lab_agents` registry document, not from configuration here. The old agent
 *    sent its own capability list and filtered client-side, which meant an
 *    agent could claim any job type it felt like.
 *  - **Claiming is one API call, not a transaction.** The atomicity that the
 *    Firestore version got from `runTransaction` now lives server-side in an
 *    ETag-guarded write. Losing the race is not an error here — the server
 *    simply hands back the next candidate, or none.
 *  - **The agent cannot invent a status.** `succeeded`, `failed` and `timeout`
 *    are the only outcomes the API accepts; `cancelled` belongs to the operator.
 *
 * Configuration is all environment; nothing is baked in. See .env.example.
 */

import os from 'node:os';
import { readFileSync } from 'node:fs';
import { CAPABILITIES } from './lib/capabilities.js';
import { runInDocker } from './lib/docker-runner.js';
import { createApiClient } from './lib/api.js';

const AGENT_VERSION = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
).version;

// ── Config ────────────────────────────────────────────────────────────────────

const config = {
  apiBase: (process.env.LABS_AGENT_API_BASE || '').replace(/\/+$/, ''),
  tenantId: process.env.LABS_AGENT_TENANT_ID,
  clientId: process.env.LABS_AGENT_CLIENT_ID,
  certificatePath: process.env.LABS_AGENT_CERT_PATH,
  scope: process.env.LABS_AGENT_API_SCOPE,
  agentId: process.env.LABS_AGENT_ID || os.hostname(),
  heartbeatIntervalMs: 30 * 1000,
  pollIntervalMs: Number(process.env.LABS_AGENT_POLL_MS || 15000),
  maxConcurrentJobs: Number(process.env.LABS_AGENT_MAX_CONCURRENT || 1),
  limits: {
    memory: process.env.LABS_AGENT_JOB_MEMORY || '256m',
    cpus: process.env.LABS_AGENT_JOB_CPUS || '0.5',
    pidsLimit: Number(process.env.LABS_AGENT_JOB_PIDS || 128),
  },
};

const missing = [
  ['LABS_AGENT_API_BASE', config.apiBase],
  ['LABS_AGENT_TENANT_ID', config.tenantId],
  ['LABS_AGENT_CLIENT_ID', config.clientId],
  ['LABS_AGENT_CERT_PATH', config.certificatePath],
  ['LABS_AGENT_API_SCOPE', config.scope],
].filter(([, v]) => !v);

if (missing.length > 0) {
  console.error(`Missing required configuration: ${missing.map(([k]) => k).join(', ')}`);
  process.exit(1);
}

const api = createApiClient(config);
const log = (...args) => console.log(new Date().toISOString(), `[${config.agentId}]`, ...args);

// ── State ─────────────────────────────────────────────────────────────────────

let activeJobs = 0;
// Claims in flight: decided on, not yet owned by executeJob. Counted separately
// from activeJobs so the concurrency guard cannot be raced by a slow claim
// (T-744).
let pendingClaims = 0;
let shuttingDown = false;

// ── Heartbeat ─────────────────────────────────────────────────────────────────

async function sendHeartbeat(status = 'idle') {
  try {
    await api.heartbeat({
      status,
      activeJobs,
      hostname: os.hostname(),
      version: AGENT_VERSION,
    });
  } catch (err) {
    // Never fatal. A heartbeat gap shows as "offline" in the Labs dashboard,
    // which is the correct thing for it to show if the API is unreachable.
    log('heartbeat failed:', err.message);
  }
}

// ── Job execution ─────────────────────────────────────────────────────────────

async function executeJob(job) {
  const capability = CAPABILITIES[job.type];

  // Defence in depth. The server already restricts claims to the agent's
  // registered capabilities, but this process is the thing that would actually
  // run the command, so it refuses anything it has no allowlisted recipe for
  // rather than trusting the response.
  if (!capability) {
    log(`refusing job ${job.id}: no local capability for type ${job.type}`);
    await api
      .completeJob({
        jobId: job.id,
        status: 'failed',
        exitCode: -1,
        output: `agent has no capability for job type ${job.type}`,
      })
      .catch((err) => log(`could not report refusal for ${job.id}:`, err.message));
    return;
  }

  activeJobs += 1;
  log(`running job ${job.id} (${job.type})`);

  try {
    const result = await runInDocker(capability, job.payload, config.limits);
    const status = result.timedOut ? 'timeout' : result.exitCode === 0 ? 'succeeded' : 'failed';

    await api.completeJob({
      jobId: job.id,
      status,
      exitCode: result.exitCode,
      output: result.output,
    });
    log(`job ${job.id} -> ${status} (exit ${result.exitCode})`);
  } catch (err) {
    log(`job ${job.id} errored:`, err.message);
    // Best effort: if this also fails the job's claim lease expires server-side
    // and another agent picks it up, which is why the lease exists.
    await api
      .completeJob({
        jobId: job.id,
        status: 'failed',
        exitCode: -1,
        output: `agent error: ${err.message}`,
      })
      .catch((reportErr) => log(`could not report failure for ${job.id}:`, reportErr.message));
  } finally {
    activeJobs -= 1;
    sendHeartbeat();
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function poll() {
  // The slot is reserved BEFORE the await, not after (T-744). activeJobs is
  // only incremented inside executeJob, which runs after claimJob resolves —
  // and claimJob's timeout (20s) is longer than the poll interval (15s), so a
  // slow claim let a second poll pass this guard with the counter still at its
  // old value. With the documented LABS_AGENT_MAX_CONCURRENT=1 and a
  // 256 MB / 0.5 CPU budget, two concurrent Terraform containers is a real
  // resource-exhaustion path on a small VPS.
  //
  // pendingClaims covers exactly the window between "we decided to claim" and
  // "executeJob owns the slot", so the guard reflects work already committed
  // to rather than only work already started.
  if (shuttingDown || activeJobs + pendingClaims >= config.maxConcurrentJobs) return;

  pendingClaims += 1;
  try {
    const job = await api.claimJob();
    if (!job) return;
    executeJob(job); // intentionally not awaited — the poll interval continues
  } catch (err) {
    log('claim failed:', err.message);
  } finally {
    // Released in every path. On the path that takes a slot, executeJob
    // reaches `activeJobs += 1` with no await in front of it, so the handoff
    // from pendingClaims to activeJobs has no gap. Its one earlier await is in
    // the "no capability for this job type" branch, which returns without
    // taking a slot — nothing to hand over there.
    pendingClaims -= 1;
  }
}

async function start() {
  log(`agent v${AGENT_VERSION} starting against ${config.apiBase}`);
  log(
    `capabilities are assigned server-side; local recipes: ${Object.keys(CAPABILITIES).join(', ')}`
  );

  await sendHeartbeat('idle');
  setInterval(() => sendHeartbeat(), config.heartbeatIntervalMs);
  setInterval(poll, config.pollIntervalMs);
  poll();
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received; finishing active jobs (${activeJobs})...`);
  await sendHeartbeat('stopping');

  const deadline = Date.now() + 60_000;
  while (activeJobs > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
  }

  await sendHeartbeat('offline');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  console.error('Fatal agent error:', err);
  process.exit(1);
});
