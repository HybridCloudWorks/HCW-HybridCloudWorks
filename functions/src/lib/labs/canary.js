/**
 * canary.js — `labCanary`, one real lab job an hour, run end to end (#1009,
 * "PR 2: prevent recurrence", item 2).
 *
 * From 2026-10-07T04:35Z no lab job ran for days and nothing said so: the
 * admin Labs probe enqueues a job and cancels it, so it passes with no agent
 * at all, and the LAB-5 job path had never run a real job in production. This
 * runs one: a `shell-echo` job with a fixed, tiny payload, enqueued exactly as
 * enqueueLabJob writes one, then waited for until the agent has claimed it,
 * run it in its sandbox and reported the result. The output must be the
 * payload, byte for byte, or the run failed.
 *
 * Behind its own flag, FEATURE_FLAG_LAB_CANARY, armed by adding LAB_CANARY to
 * the `enabled_timers` workspace variable, as every timer is
 * (functions/schedulers.js). It is a real job on the owner's host every hour,
 * so it runs only once the owner has said so.
 *
 * NEVER LEAVES A JOB BEHIND. The job is deleted once it has a terminal status,
 * under the ETag of the read that saw it terminal. One still queued at the
 * deadline is cancelled and deleted, each under its ETag; if the agent claims
 * it in between, the 412 says so and it is left to finish. One claimed but
 * not finished is left alone (the agent holds it, and a job pulled from under
 * a running agent only turns into agent errors), its id kept as
 * `pendingJobId`; the next run deletes it once it has finished, or, past the
 * claim lease and a grace, cancels and deletes it, since no agent is then
 * coming back for it. While it is still legitimately running, the next run
 * enqueues nothing and says so. So the Labs job list holds at most one canary
 * job at a time, and only while it is in flight.
 *
 * THE ID IS RESERVED BEFORE THE JOB EXISTS (CodeRabbit, #1055). A run writes
 * the new job's id to the record as `pendingJobId`, under the record's ETag,
 * and only then creates the job; the run's last write clears it or keeps it.
 * So an invocation that dies, or a record that cannot be written, after the
 * create still leaves the id where the next run looks, and that run settles
 * the job before it enqueues anything. A reservation for a job that was never
 * created is read as gone, and costs nothing.
 *
 * ONE RUN HOLDS THE RECORD AT A TIME (CodeRabbit, #1056). The ETag on the
 * record does not fence runs from each other: each write re-reads first, so
 * a second invocation that read the first's reservation could replace it
 * with its own, and its last write could then clear it, losing a job. So the
 * reservation also names its owner, `activeRun: { jobId, since }`. A run
 * that finds another run's `activeRun` younger than CANARY_RUN_HOLD_MS
 * touches nothing (no settling, no reservation, no record) and says so; a
 * run's last write clears `activeRun` only when it is its own, and keeps
 * another run's `activeRun` and `pendingJobId` as they are. An `activeRun`
 * older than the hold is a run that died, and the next run takes over,
 * settling its job through `pendingJobId` as above. The Functions host runs
 * a timer as a singleton, so two runs at once are not expected; this holds
 * if they ever are (a manual run, a second deployment slot).
 *
 * NOT ENQUEUED INTO A VOID. With no active agent registered for `shell-echo`,
 * or none online, the run records that (a registry or an outage, which the
 * lab-agents probe already reports) and enqueues nothing, so a host that is
 * down does not collect a queue of canaries to run when it returns.
 *
 * WHAT IT RECORDS. One document, admin_config/lab_canary: the last run's
 * outcome with its timings (claim latency, run time, total), the last
 * success, the last failure, how many failed in a row, and any job still in
 * flight. Written read-merge-write under the document's ETag. The Health
 * Hub's `lab-canary` probe judges it (labs/lab-checks.js), recorded by the
 * pulse every five minutes; failure is raised there, not healed here.
 *
 * Telemetry is content-free: a warn line names the outcome, never the job's
 * id, the agent's or the payload.
 */
import { randomUUID } from 'node:crypto';

import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { isAgentOnline } from '../labs.js';
import { CLAIM_LEASE_MS } from '../lab-agent.js';

export const LAB_CANARY_DOC_ID = 'lab_canary';
export const LAB_CANARY_DOC_TYPE = 'lab_canary';
/** The smoke-test capability: `cat` of the payload in the pinned alpine image (vps-agent/lib/capabilities.js). */
export const CANARY_JOB_TYPE = 'shell-echo';
/** Who the job document names as its requester: not a person. */
export const CANARY_REQUESTER = 'lab-canary';
/**
 * How long to wait for the job. The agent polls every 15 s, a shell-echo run
 * takes a few seconds, and one visitor job may be ahead of it (the host runs
 * one at a time); two and a half minutes covers that with room.
 */
export const CANARY_WAIT_MS = 150_000;
export const CANARY_POLL_MS = 5_000;
/** A claimed job older than the claim lease and this is one no agent is finishing. */
export const CANARY_ABANDON_GRACE_MS = 5 * 60_000;
/**
 * How long a run's hold on the record (`activeRun`) counts as live. A run
 * lasts the 150 s wait plus a few reads and writes; one still holding after
 * ten minutes has died.
 */
export const CANARY_RUN_HOLD_MS = 10 * 60_000;
const WRITE_ATTEMPTS = 3;

/** Outcomes that mean nothing ran the job, as against a job that ran and failed. */
export const UNREACHED_OUTCOMES = Object.freeze(['no-agent', 'not-claimed']);

const TERMINAL = Object.freeze(['succeeded', 'failed', 'timeout', 'cancelled']);
const PK = { partitionKey: ADMIN_CONFIG_PARTITION };
const isRace = (error) => error?.code === 412 || error?.code === 409 || error?.code === 404;
const msOf = (value) => {
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? ms : null;
};
const between = (from, to) => {
  const a = msOf(from);
  const b = msOf(to);
  return a !== null && b !== null ? Math.max(0, b - a) : null;
};
const seconds = (ms) => Math.round(ms / 100) / 10;

/** The fixed payload: a marker and the job's own id, so the echo cannot be another job's. */
export const canaryPayload = (jobId) => `hcw-canary ${jobId}`;

/** The job document, as enqueueLabJob writes one (lib/labs.js), plus `canary: true`. */
export function canaryJob(jobId, createdAt) {
  return {
    id: jobId,
    type: CANARY_JOB_TYPE,
    payload: canaryPayload(jobId),
    payloadEncoding: 'text',
    status: 'queued',
    requestedBy: CANARY_REQUESTER,
    requestedByEmail: null,
    createdAt,
    claimedAt: null,
    finishedAt: null,
    agentId: null,
    exitCode: null,
    output: null,
    canary: true,
  };
}

/** What a finished job says about the run, with its timings. Pure. */
export function judgeJob(job, payload) {
  const timings = {
    claimMs: between(job.createdAt, job.claimedAt),
    runMs: between(job.claimedAt, job.finishedAt),
  };
  if (job.status === 'succeeded') {
    if (String(job.output ?? '').trim() === payload) {
      return { ok: true, outcome: 'succeeded', timings, reason: 'the agent ran it and echoed the payload' };
    }
    return {
      ok: false,
      outcome: 'mismatch',
      timings,
      reason: 'the agent reported success, but the output was not the payload',
    };
  }
  if (job.status === 'cancelled') {
    return { ok: false, outcome: 'cancelled', timings, reason: 'the job was cancelled before it ran' };
  }
  const exit = Number.isInteger(job.exitCode) ? ` with exit ${job.exitCode}` : '';
  return {
    ok: false,
    outcome: job.status === 'timeout' ? 'timeout' : 'failed',
    timings,
    reason: `the agent reported ${job.status}${exit}`,
  };
}

/**
 * @param {object} deps
 * @param {{ readDoc: Function, createDoc: Function, replaceDocIfMatch: Function,
 *   deleteDocIfMatch: Function, queryDocs: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {() => string} [deps.uuid]
 * @param {object} [deps.log] the invocation context
 * @param {() => Promise<unknown>} [deps.checkCoderToken] the scheduled token
 *   check (coder-status.js checkToken), once per run: it asks Coder directly,
 *   never through the anonymous minute cache, so the status-token check has
 *   evidence whatever visitors do (CodeRabbit, #1056); never fatal
 */
export function createLabCanary({
  store,
  now = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  uuid = randomUUID,
  log = {},
  checkCoderToken = null,
}) {
  const readState = () => store.readDoc('admin_config', LAB_CANARY_DOC_ID, ADMIN_CONFIG_PARTITION);

  /** Another run's live hold on the record, or null. `ownJobId` is this run's reservation, if any. */
  function heldElsewhere(state, ownJobId) {
    const hold = state?.activeRun;
    if (!hold?.jobId || hold.jobId === ownJobId) return null;
    const since = msOf(hold.since);
    return since !== null && now().getTime() - since < CANARY_RUN_HOLD_MS ? hold : null;
  }

  /** Delete a job under the ETag it was read with. True when it is gone. */
  async function remove(job) {
    try {
      await store.deleteDocIfMatch('lab_jobs', job.id, job._etag, job.id);
      return true;
    } catch (error) {
      if (error?.code === 404) return true;
      if (error?.code === 412) return false;
      throw error;
    }
  }

  /** Cancel a queued job, then delete it, each under its ETag. True when it is gone. */
  async function withdraw(job) {
    let cancelled;
    try {
      cancelled = await store.replaceDocIfMatch(
        'lab_jobs',
        { ...job, status: 'cancelled', finishedAt: now().toISOString(), cancelledBy: CANARY_REQUESTER },
        { partitionKey: job.id }
      );
    } catch (error) {
      if (isRace(error)) return false;
      throw error;
    }
    return remove(cancelled ?? job);
  }

  /**
   * The job a previous run could not delete: gone, deleted now, or still in
   * flight (`{ inFlight: true }`), which stops this run enqueueing another.
   */
  async function settleLeftover(jobId) {
    if (!jobId) return { inFlight: false };
    const job = await store.readDoc('lab_jobs', jobId, jobId);
    if (!job) return { inFlight: false };
    if (TERMINAL.includes(job.status)) return { inFlight: !(await remove(job)) };
    if (job.status === 'queued') return { inFlight: !(await withdraw(job)) };
    // Claimed. Past the lease and a grace, no agent is finishing it (a live one
    // would have, and a dead one's claim is what the lease is for), so it is
    // withdrawn; within it, it is still running and is left alone.
    const claimedMs = msOf(job.claimedAt) ?? msOf(job.createdAt) ?? 0;
    if (now().getTime() - claimedMs > CLAIM_LEASE_MS + CANARY_ABANDON_GRACE_MS) {
      return { inFlight: !(await withdraw(job)) };
    }
    return { inFlight: true, since: job.claimedAt ?? job.createdAt };
  }

  /** Why no job should be enqueued now, as an outcome; null when one should. */
  async function precondition(nowMs) {
    const agents = await store.queryDocs(
      'lab_agents',
      'SELECT TOP 200 c.id, c.active, c.capabilities, c.status, c.lastSeenAt FROM c',
      []
    );
    const able = (agents || []).filter(
      (agent) =>
        agent?.active === true &&
        Array.isArray(agent.capabilities) &&
        agent.capabilities.includes(CANARY_JOB_TYPE)
    );
    if (able.length === 0) {
      return {
        ok: false,
        outcome: 'no-capability',
        reason: `no active agent is registered for ${CANARY_JOB_TYPE}, so nothing could claim the job; nothing was enqueued`,
      };
    }
    if (!able.some((agent) => isAgentOnline(agent, nowMs))) {
      return {
        ok: false,
        outcome: 'no-agent',
        reason: `no agent registered for ${CANARY_JOB_TYPE} is online; nothing was enqueued`,
      };
    }
    return null;
  }

  /** Poll the job until it is terminal or the deadline passes. The last read either way. */
  async function waitFor(jobId, deadlineMs) {
    let job = null;
    for (;;) {
      job = await store.readDoc('lab_jobs', jobId, jobId);
      if (!job || TERMINAL.includes(job.status)) return job;
      if (now().getTime() >= deadlineMs) return job;
      await sleep(CANARY_POLL_MS);
    }
  }

  /** The run's verdict on a job that did not finish in time, and whether it is still in flight. */
  async function giveUp(job) {
    if (job?.status === 'queued' && (await withdraw(job))) {
      return {
        result: {
          ok: false,
          outcome: 'not-claimed',
          reason: `no agent claimed it within ${CANARY_WAIT_MS / 1000} s; it was cancelled and deleted`,
        },
        pendingJobId: null,
      };
    }
    return {
      result: {
        ok: false,
        outcome: 'not-completed',
        reason: `an agent claimed it but did not finish it within ${CANARY_WAIT_MS / 1000} s; the next run deletes it once it ends`,
      },
      pendingJobId: job?.id ?? null,
    };
  }

  /**
   * Write the job's id to the record as `pendingJobId`, and this run as its
   * owner (`activeRun`), before the job exists, under the record's ETag. False
   * when another run holds the record, and then nothing is enqueued. Throws
   * when it cannot write: a job whose id is not recorded is one no later run
   * can find.
   */
  async function reserve(jobId) {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const current = await readState();
      if (heldElsewhere(current, jobId)) return false;
      const next = {
        ...(current ?? {
          id: LAB_CANARY_DOC_ID,
          configScope: ADMIN_CONFIG_PARTITION,
          docType: LAB_CANARY_DOC_TYPE,
          jobType: CANARY_JOB_TYPE,
        }),
        pendingJobId: jobId,
        activeRun: { jobId, since: now().toISOString() },
      };
      try {
        if (current) await store.replaceDocIfMatch('admin_config', { ...next, _etag: current._etag }, PK);
        else await store.createDoc('admin_config', next);
        return true;
      } catch (error) {
        if (error?.code !== 412 && error?.code !== 409) throw error;
      }
    }
    throw Object.assign(new Error('The lab canary record kept changing while it was reserved'), {
      code: 'CONFLICT',
    });
  }

  /** What a run that finds the record held by another reports. Nothing is written. */
  const overlap = () => ({
    result: {
      ok: false,
      outcome: 'overlap',
      reason: 'another canary run holds the record; this run left it alone',
    },
    pendingJobId: null,
    ownJobId: null,
    unrecorded: true,
  });

  /** Reserve, enqueue, wait, judge, clean up: `{ result, pendingJobId, ownJobId }`. */
  async function runJob(startedMs) {
    const jobId = uuid();
    if (!(await reserve(jobId))) return overlap();
    await store.createDoc('lab_jobs', canaryJob(jobId, new Date(startedMs).toISOString()));
    const outcome = await runReserved(jobId, startedMs);
    return { ...outcome, ownJobId: jobId };
  }

  /** The job exists: follow it to the end, keeping its id whatever fails. */
  async function runReserved(jobId, startedMs) {
    // From here the job exists, so whatever fails while it is followed, its id
    // must reach the record: the next run settles it, and enqueues nothing new
    // while it may still be queued or running (CodeRabbit, #1055).
    try {
      return await followJob(jobId, startedMs);
    } catch (error) {
      log.warn?.(
        `[labCanary] the canary job could not be followed after it was created (${error?.code ?? 'error'}); the next run settles it`
      );
      return {
        result: {
          ok: false,
          outcome: 'error',
          reason: 'the job could not be read or cleaned up after it was created; the next run settles it',
          totalMs: now().getTime() - startedMs,
        },
        pendingJobId: jobId,
      };
    }
  }

  /** Wait for a created job, judge it, clean it up: `{ result, pendingJobId }`. May throw. */
  async function followJob(jobId, startedMs) {
    const payload = canaryPayload(jobId);
    const job = await waitFor(jobId, startedMs + CANARY_WAIT_MS);
    const totalMs = now().getTime() - startedMs;
    if (!job) {
      return {
        result: { ok: false, outcome: 'error', reason: 'the job disappeared before it finished', totalMs },
        pendingJobId: null,
      };
    }
    if (!TERMINAL.includes(job.status)) {
      const { result, pendingJobId } = await giveUp(job);
      return { result: { ...result, totalMs }, pendingJobId };
    }
    const deleted = await remove(job);
    return {
      result: { ...judgeJob(job, payload), totalMs, jobStatus: job.status },
      pendingJobId: deleted ? null : job.id,
    };
  }

  /**
   * The state after this run: the last result, the streak, and any job still
   * in flight. Another run's live hold, and the job it reserved, are kept as
   * they are; this run's own hold, or a dead one, is cleared.
   */
  function nextState(current, result, pendingJobId, atIso, ownJobId) {
    const ok = result.ok === true;
    const foreign = heldElsewhere(current, ownJobId);
    return {
      id: LAB_CANARY_DOC_ID,
      configScope: ADMIN_CONFIG_PARTITION,
      docType: LAB_CANARY_DOC_TYPE,
      jobType: CANARY_JOB_TYPE,
      lastRunAt: atIso,
      lastResult: { ...result, finishedAt: now().toISOString() },
      lastSuccessAt: ok ? atIso : (current?.lastSuccessAt ?? null),
      lastFailureAt: ok ? (current?.lastFailureAt ?? null) : atIso,
      consecutiveFailures: ok ? 0 : (Number(current?.consecutiveFailures) || 0) + 1,
      pendingJobId: foreign ? (current.pendingJobId ?? null) : (pendingJobId ?? null),
      activeRun: foreign ? current.activeRun : null,
    };
  }

  /** Read, merge, write under the ETag; another writer in between means read again. */
  async function record(result, pendingJobId, atIso, ownJobId) {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const current = await readState();
      const next = nextState(current, result, pendingJobId, atIso, ownJobId);
      try {
        if (current) await store.replaceDocIfMatch('admin_config', { ...next, _etag: current._etag }, PK);
        else await store.createDoc('admin_config', next);
        return next;
      } catch (error) {
        if (error?.code !== 412 && error?.code !== 409) throw error;
      }
    }
    throw Object.assign(new Error('The lab canary record kept changing while it was written'), {
      code: 'CONFLICT',
    });
  }

  async function checkCoder() {
    if (!checkCoderToken) return;
    try {
      await checkCoderToken();
    } catch (error) {
      log.warn?.(`[labCanary] the scheduled token check failed (${error?.code ?? 'error'})`);
    }
  }

  async function run() {
    const started = now();
    const startedMs = started.getTime();
    const atIso = started.toISOString();
    const state = await readState();
    if (heldElsewhere(state, null)) {
      log.warn?.('[labCanary] another canary run holds the record; this run left it alone');
      return { ok: false, outcome: 'overlap', claimSeconds: null, runSeconds: null, jobLeftInFlight: false };
    }

    const leftover = await settleLeftover(state?.pendingJobId);
    let outcome;
    if (leftover.inFlight) {
      outcome = {
        result: {
          ok: false,
          outcome: 'previous-in-flight',
          reason: `the previous canary job has been in flight since ${leftover.since ?? 'an unknown time'}; nothing new was enqueued`,
        },
        pendingJobId: state.pendingJobId,
      };
    } else {
      const refusal = await precondition(startedMs);
      outcome = refusal ? { result: refusal, pendingJobId: null } : await runJob(startedMs);
    }

    if (outcome.unrecorded) {
      log.warn?.('[labCanary] another canary run holds the record; this run left it alone');
      return { ok: false, outcome: 'overlap', claimSeconds: null, runSeconds: null, jobLeftInFlight: false };
    }
    const recorded = await record(outcome.result, outcome.pendingJobId, atIso, outcome.ownJobId ?? null);
    await checkCoder();

    const { result } = outcome;
    if (!result.ok) {
      log.warn?.(
        `[labCanary] the end-to-end lab job did not pass (${result.outcome}); ${recorded.consecutiveFailures} run(s) in a row`
      );
    }
    return {
      ok: result.ok === true,
      outcome: result.outcome,
      claimSeconds: Number.isFinite(result.timings?.claimMs) ? seconds(result.timings.claimMs) : null,
      runSeconds: Number.isFinite(result.timings?.runMs) ? seconds(result.timings.runMs) : null,
      jobLeftInFlight: Boolean(outcome.pendingJobId),
    };
  }

  return { run };
}
