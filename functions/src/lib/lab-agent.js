/**
 * The Labs agent API — the three operations the VPS agent is allowed to
 * perform, and nothing else.
 *
 * This replaces the agent's direct Cosmos access (T-401). The reasoning for the
 * credential model is in `auth/require-agent.js`; this file is what that model
 * buys. The blast radius of a credential stolen off the VPS is these three
 * handlers, under the constraints written into them, rather than read/write
 * over two containers:
 *
 *   claimLabJob      — take at most one queued job, only of a type the agent
 *                      is registered for, only if nobody else took it first
 *   heartbeatAgent   — write liveness for *this* agent only
 *   completeLabJob   — write a terminal result, only for a job this agent
 *                      currently holds
 *
 * The API owns the job claim and completion rules. The standalone `vps-agent/`
 * process only polls these handlers with its scoped Entra credential; it never
 * receives a Cosmos or database credential.
 */

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

import { AGENT_OFFLINE_SOURCE } from './timers/agent-health.js';

/**
 * Statuses a completing agent may report.
 *
 * Deliberately not the whole of `JOB_STATUSES` from labs.js. `queued` and
 * `claimed` are not terminal, and `cancelled` belongs to the admin
 * `cancelLabJob` path — an agent reporting `cancelled` would let a compromised
 * VPS silently discard work and make it look like an operator decision.
 */
export const AGENT_TERMINAL_STATUSES = Object.freeze(['succeeded', 'failed', 'timeout']);

/** Matches the source agent's OUTPUT_CAP_BYTES (lib/docker-runner.js). */
export const OUTPUT_CAP_BYTES = 64 * 1024;

/** How long a claimed job may sit before another agent may take it over. */
export const CLAIM_LEASE_MS = 15 * 60 * 1000;

/** Bounded scan for claimable work. */
const CLAIM_SCAN_LIMIT = 20;

const clampOutput = (value) => String(value ?? '').slice(0, OUTPUT_CAP_BYTES);

/**
 * Every agent request's first two steps, in this order: the body must be
 * JSON (400 otherwise), then `requireAgent` checks the credential against
 * the agent the body names. The body and the registry record on success,
 * the response on refusal.
 */
async function authenticatedAgentBody(guard, request) {
  let body;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return { error: json(400, { ok: false, error: 'Body must be valid JSON' }) };
  }

  const auth = await guard.requireAgent(request, body.agentId);
  if (auth.error) return { error: auth.error };
  return { body, agent: auth.agent };
}

/**
 * The claimable jobs for these capabilities, oldest first.
 *
 * Two claimable shapes: never claimed, or claimed by an agent that has since
 * gone away. Without the second, a host that dies mid-claim strands its jobs
 * permanently, as jobs stuck in 'claimed' forever.
 *
 * FIFO in the query itself (ADR 0033 inventory): without ORDER BY, TOP 20
 * was whichever 20 candidates Cosmos returned, so with more than twenty
 * queued the oldest could wait behind newer ones indefinitely. Every
 * lab_jobs document carries createdAt (enqueueLabJob and the public submit
 * both write it), so the sort drops nothing.
 */
async function claimCandidates(store, capabilities, now) {
  const staleBefore = new Date(now().getTime() - CLAIM_LEASE_MS).toISOString();
  const candidates = await store.queryDocs(
    'lab_jobs',
    `SELECT TOP @limit * FROM c
        WHERE ARRAY_CONTAINS(@types, c.type)
          AND (c.status = 'queued'
               OR (c.status = 'claimed' AND (NOT IS_DEFINED(c.claimedAt) OR c.claimedAt < @staleBefore)))
        ORDER BY c.createdAt ASC`,
    [
      { name: '@limit', value: CLAIM_SCAN_LIMIT },
      { name: '@types', value: capabilities },
      { name: '@staleBefore', value: staleBefore },
    ]
  );

  // Oldest first, again in memory, so a store that ignores ORDER BY (a test
  // double, a future mirror) still hands out the oldest.
  return [...candidates].sort((a, b) =>
    String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
  );
}

/** The claimed job as the agent receives it. */
function claimedJobBody(claimed) {
  return {
    id: claimed.id,
    type: claimed.type,
    payload: typeof claimed.payload === 'string' ? claimed.payload : '',
    // Written by enqueueLabJob from its allowlist; a document from
    // before #675 has none and is a text payload.
    payloadEncoding: claimed.payloadEncoding === 'tar' ? 'tar' : 'text',
  };
}

/**
 * The first candidate this agent wins. The contended write is a single
 * document, so an ETag-guarded replace is the whole of the locking: two
 * agents racing for the same job produce one 412, and the loser simply
 * tries the next candidate.
 */
async function claimFirstAvailable({ store, now }, context, agentId, ordered) {
  for (const job of ordered) {
    try {
      const claimed = await store.replaceDocIfMatch('lab_jobs', {
        ...job,
        status: 'claimed',
        agentId,
        claimedAt: now().toISOString(),
      });
      return json(200, { ok: true, job: claimedJobBody(claimed) });
    } catch (err) {
      // 412: someone else claimed it between our read and our write. Try the
      // next candidate rather than failing the poll.
      if (err?.code === 412) continue;
      context.error('claimLabJob write failed:', err?.message);
      return json(500, { ok: false, error: 'Failed to claim job' });
    }
  }
  return json(200, { ok: true, job: null });
}

/**
 * Claim one queued job.
 *
 * Capabilities come from the registry record, NOT from the request. The
 * source agent sent its own capability list and filtered client-side; an
 * agent that can name its own capabilities can claim any job type, which
 * makes the enqueue-side `LAB_JOB_TYPES` allowlist decorative.
 */
async function claimLabJob(ctx, request, context) {
  const parsed = await authenticatedAgentBody(ctx.guard, request);
  if (parsed.error) return parsed.error;
  const { agent } = parsed;

  const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities : [];
  if (capabilities.length === 0) {
    // Not an error: an agent registered with no capabilities has nothing to
    // do, and should keep heartbeating rather than crash-loop.
    return json(200, { ok: true, job: null });
  }

  const ordered = await claimCandidates(ctx.store, capabilities, ctx.now);
  return claimFirstAvailable(ctx, context, agent.agentId, ordered);
}

/**
 * Record liveness for this agent.
 *
 * Writes `lastSeenAt`. The stub agent wrote `lastPing` while `labs.js:188`
 * read `lastSeenAt`, so the Labs "connected" indicator could never be true
 * (T-401). Fixing it here rather than in the agent is deliberate:
 * the field name is now the server's business, and no future agent can get
 * it wrong.
 *
 * `capabilities` and `oid` are NOT writable through this path — they are
 * the registry's authorization inputs, and an endpoint the VPS can reach
 * must not be able to grant the VPS new job types or rebind its identity.
 */
/**
 * The owner is told on Telegram when an agent announces its own shutdown.
 * A `systemctl stop` sends SIGTERM and the agent heartbeats `stopping` then
 * `offline` itself (vps-agent/index.js), so the five-minute health timer
 * never sees a stale agent to mark and its notification never fires — the
 * owner's first test of LAB-2 on 2026-10-06 produced no message for exactly
 * this reason. Same source as the timer, so the cooldown makes a stop
 * followed by the timer's own mark one message, not two. Best effort: the
 * heartbeat is recorded whether or not the message goes.
 */
async function tellOwnerAgentStopped(notifier, agent, at, context) {
  if (!notifier?.notifyTelegram) return;
  try {
    await notifier.notifyTelegram({
      title: 'Lab agent offline (1)',
      message: `${agent.agentId} (${agent.hostname || 'host unknown'}) reported its own shutdown at ${at}. Public lab submission fails closed until it is back.`,
      severity: 'critical',
      source: AGENT_OFFLINE_SOURCE,
    });
  } catch (error) {
    context.warn?.(`heartbeatAgent: owner notification failed: ${error?.message || error}`);
  }
}

async function heartbeatAgent({ guard, store, now, notifier }, request, context) {
  const parsed = await authenticatedAgentBody(guard, request);
  if (parsed.error) return parsed.error;
  const { body, agent } = parsed;

  const activeJobs =
    Number.isInteger(body.activeJobs) && body.activeJobs >= 0 ? body.activeJobs : 0;
  const status = ['idle', 'busy', 'stopping', 'offline'].includes(body.status)
    ? body.status
    : 'idle';

  // Built conditionally, not with `undefined` placeholders: patchDoc treats
  // an undefined value as a field DELETION, so spreading absent optionals
  // would wipe the stored hostname and version on every heartbeat — and
  // would route each one through the read-modify-write path, turning a
  // 30-second poll into two round trips instead of one.
  // `offline` is terminal and wins over the job-derived `busy`: the agent
  // sends `offline` with activeJobs > 0 when its shutdown deadline expires
  // with work still running, and that is exactly the moment to say so.
  let effective = status;
  if (status !== 'offline' && activeJobs > 0) effective = 'busy';
  const updates = {
    status: effective,
    activeJobs,
    lastSeenAt: now().toISOString(),
  };
  if (typeof body.hostname === 'string') updates.hostname = body.hostname.slice(0, 255);
  if (typeof body.version === 'string') updates.version = body.version.slice(0, 64);

  // The transition the health timer would otherwise have recorded: the
  // record said the agent was up, and this heartbeat says it has gone.
  const goingOffline = updates.status === 'offline' && agent.status !== 'offline';
  if (goingOffline) updates.offlineSince = updates.lastSeenAt;

  try {
    await store.patchDoc('lab_agents', agent.agentId, updates, {
      partitionKey: agent.agentId,
    });
  } catch (err) {
    context.error('heartbeatAgent failed:', err?.message);
    return json(500, { ok: false, error: 'Failed to record heartbeat' });
  }

  if (goingOffline) {
    await tellOwnerAgentStopped(
      notifier,
      { ...agent, hostname: updates.hostname ?? agent.hostname },
      updates.lastSeenAt,
      context
    );
  }

  return json(200, { ok: true });
}

/** The 400s a completion body earns before any read: no jobId, or a status an agent may not report. */
function completionRefusal(jobId, status) {
  if (!jobId) return json(400, { ok: false, error: 'jobId is required' });
  if (!AGENT_TERMINAL_STATUSES.includes(status)) {
    return json(400, {
      ok: false,
      error: `status must be one of ${AGENT_TERMINAL_STATUSES.join(', ')}`,
    });
  }
  return null;
}

/**
 * Why this agent may not complete this job, or null when it may.
 *
 * The ownership check is the point. Without it a compromised VPS could
 * overwrite any job's output — including jobs run by other agents — which
 * turns the results surface into an arbitrary write.
 */
function heldJobRefusal(job, jobId, agent, context) {
  if (!job) return json(404, { ok: false, error: 'Job not found' });

  if (job.agentId !== agent.agentId) {
    context.warn?.(`agent ${agent.agentId} tried to complete job ${jobId} it does not hold`);
    return json(403, { ok: false, error: 'Job is not held by this agent' });
  }

  // A job the operator cancelled, or one already reported, must not be
  // reopened by a late-arriving result. `claimed` is the only state a held
  // job is ever in: the agent reports nothing between claim and completion
  // (JOB_STATUSES in labs.js).
  if (job.status !== 'claimed') {
    return json(409, { ok: false, error: `Job is ${job.status}` });
  }
  return null;
}

/** Write a terminal result for a job this agent holds. */
async function completeLabJob({ guard, store, now }, request, context) {
  const parsed = await authenticatedAgentBody(guard, request);
  if (parsed.error) return parsed.error;
  const { body, agent } = parsed;

  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
  const refused = completionRefusal(jobId, body.status);
  if (refused) return refused;

  const job = await store.readDoc('lab_jobs', jobId, jobId);
  const notHeld = heldJobRefusal(job, jobId, agent, context);
  if (notHeld) return notHeld;

  try {
    await store.patchDoc(
      'lab_jobs',
      jobId,
      {
        status: body.status,
        exitCode: Number.isInteger(body.exitCode) ? body.exitCode : -1,
        output: clampOutput(body.output),
        finishedAt: now().toISOString(),
      },
      { partitionKey: jobId }
    );
  } catch (err) {
    context.error('completeLabJob failed:', err?.message);
    return json(500, { ok: false, error: 'Failed to record result' });
  }

  return json(200, { ok: true });
}

/**
 * @param {object} deps
 * @param {{ requireAgent: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, patchDoc: Function, replaceDocIfMatch: Function }} deps.store
 * @param {() => Date} [deps.now]
 */
export function createLabAgentHandlers({ guard, store, now = () => new Date(), notifier = null }) {
  const ctx = { guard, store, now, notifier };
  return {
    claimLabJob: (request, context) => claimLabJob(ctx, request, context),
    heartbeatAgent: (request, context) => heartbeatAgent(ctx, request, context),
    completeLabJob: (request, context) => completeLabJob(ctx, request, context),
  };
}
