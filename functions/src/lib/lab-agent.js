/**
 * The Labs agent API — the three operations the VPS agent is allowed to
 * perform, and nothing else.
 *
 * This replaces the agent's direct Cosmos access (REVIEW.md §0.4,
 * TODO.md T-401). The reasoning for the credential model is in
 * `auth/require-agent.js`; this file is what that model buys. The blast radius
 * of a credential stolen off the VPS is these three handlers, under the
 * constraints written into them, rather than read/write over two containers:
 *
 *   claimLabJob      — take at most one queued job, only of a type the agent
 *                      is registered for, only if nobody else took it first
 *   heartbeatAgent   — write liveness for *this* agent only
 *   completeLabJob   — write a terminal result, only for a job this agent
 *                      currently holds
 *
 * Ported from the source agent's own logic (`frontend/labs/vps-agent/index.js`
 * lines 82-134), which ran client-side against Firestore. Moving it here is
 * what makes the constraints enforceable: the agent used to decide for itself
 * which jobs matched its capabilities and what status to write.
 */

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

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
 * @param {object} deps
 * @param {{ requireAgent: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, patchDoc: Function, replaceDocIfMatch: Function }} deps.store
 * @param {() => Date} [deps.now]
 */
export function createLabAgentHandlers({ guard, store, now = () => new Date() }) {
  /**
   * Claim one queued job.
   *
   * The source used a Firestore transaction (`index.js:84-97`). Cosmos has no
   * cross-document transaction here, and does not need one: the contended
   * write is a single document, so an ETag-guarded replace gives the same
   * guarantee. Two agents racing for the same job produce one 412, and the
   * loser simply tries the next candidate — which is exactly what the source's
   * `return null` on a lost transaction did.
   *
   * Capabilities come from the registry record, NOT from the request. The
   * source agent sent its own capability list and filtered client-side; an
   * agent that can name its own capabilities can claim any job type, which
   * makes the enqueue-side `LAB_JOB_TYPES` allowlist decorative.
   */
  async function claimLabJob(request, context) {
    let body;
    try {
      body = (await request.json()) ?? {};
    } catch {
      return json(400, { ok: false, error: 'Body must be valid JSON' });
    }

    const auth = await guard.requireAgent(request, body.agentId);
    if (auth.error) return auth.error;

    const capabilities = Array.isArray(auth.agent.capabilities) ? auth.agent.capabilities : [];
    if (capabilities.length === 0) {
      // Not an error: an agent registered with no capabilities has nothing to
      // do, and should keep heartbeating rather than crash-loop.
      return json(200, { ok: true, job: null });
    }

    const nowMs = now().getTime();
    const staleBefore = new Date(nowMs - CLAIM_LEASE_MS).toISOString();

    // Two claimable shapes: never claimed, or claimed by an agent that has
    // since gone away. Without the second, a VPS that dies mid-claim strands
    // its jobs permanently — the source had the same hole, and it showed up as
    // jobs stuck in 'claimed' forever.
    const candidates = await store.queryDocs(
      'lab_jobs',
      `SELECT TOP @limit * FROM c
        WHERE ARRAY_CONTAINS(@types, c.type)
          AND (c.status = 'queued'
               OR (c.status = 'claimed' AND (NOT IS_DEFINED(c.claimedAt) OR c.claimedAt < @staleBefore)))`,
      [
        { name: '@limit', value: CLAIM_SCAN_LIMIT },
        { name: '@types', value: capabilities },
        { name: '@staleBefore', value: staleBefore },
      ]
    );

    // Oldest first. Sorted in memory rather than with ORDER BY, because
    // createdAt is not guaranteed present on every historical document and
    // Cosmos drops documents missing the sort field from the result set.
    const ordered = [...candidates].sort((a, b) =>
      String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
    );

    for (const job of ordered) {
      try {
        const claimed = await store.replaceDocIfMatch('lab_jobs', {
          ...job,
          status: 'claimed',
          agentId: auth.agent.agentId,
          claimedAt: now().toISOString(),
        });
        return json(200, {
          ok: true,
          job: {
            id: claimed.id,
            type: claimed.type,
            payload: typeof claimed.payload === 'string' ? claimed.payload : '',
          },
        });
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
   * Record liveness for this agent.
   *
   * Writes `lastSeenAt`. The stub agent wrote `lastPing` while `labs.js:188`
   * read `lastSeenAt`, so the Labs "connected" indicator could never be true
   * (TODO.md T-401). Fixing it here rather than in the agent is deliberate:
   * the field name is now the server's business, and no future agent can get
   * it wrong.
   *
   * `capabilities` and `oid` are NOT writable through this path — they are
   * the registry's authorization inputs, and an endpoint the VPS can reach
   * must not be able to grant the VPS new job types or rebind its identity.
   */
  async function heartbeatAgent(request, context) {
    let body;
    try {
      body = (await request.json()) ?? {};
    } catch {
      return json(400, { ok: false, error: 'Body must be valid JSON' });
    }

    const auth = await guard.requireAgent(request, body.agentId);
    if (auth.error) return auth.error;

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
    const updates = {
      status: activeJobs > 0 ? 'busy' : status,
      activeJobs,
      lastSeenAt: now().toISOString(),
    };
    if (typeof body.hostname === 'string') updates.hostname = body.hostname.slice(0, 255);
    if (typeof body.version === 'string') updates.version = body.version.slice(0, 64);

    try {
      await store.patchDoc('lab_agents', auth.agent.agentId, updates, {
        partitionKey: auth.agent.agentId,
      });
    } catch (err) {
      context.error('heartbeatAgent failed:', err?.message);
      return json(500, { ok: false, error: 'Failed to record heartbeat' });
    }

    return json(200, { ok: true });
  }

  /**
   * Write a terminal result for a job this agent holds.
   *
   * The ownership check is the point. Without it a compromised VPS could
   * overwrite any job's output — including jobs run by other agents — which
   * turns the results surface into an arbitrary write.
   */
  async function completeLabJob(request, context) {
    let body;
    try {
      body = (await request.json()) ?? {};
    } catch {
      return json(400, { ok: false, error: 'Body must be valid JSON' });
    }

    const auth = await guard.requireAgent(request, body.agentId);
    if (auth.error) return auth.error;

    const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
    if (!jobId) return json(400, { ok: false, error: 'jobId is required' });

    if (!AGENT_TERMINAL_STATUSES.includes(body.status)) {
      return json(400, {
        ok: false,
        error: `status must be one of ${AGENT_TERMINAL_STATUSES.join(', ')}`,
      });
    }

    const job = await store.readDoc('lab_jobs', jobId, jobId);
    if (!job) return json(404, { ok: false, error: 'Job not found' });

    if (job.agentId !== auth.agent.agentId) {
      context.warn?.(`agent ${auth.agent.agentId} tried to complete job ${jobId} it does not hold`);
      return json(403, { ok: false, error: 'Job is not held by this agent' });
    }

    // A job the operator cancelled, or one already reported, must not be
    // reopened by a late-arriving result.
    if (!['claimed', 'running'].includes(job.status)) {
      return json(409, { ok: false, error: `Job is ${job.status}` });
    }

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

  return { claimLabJob, heartbeatAgent, completeLabJob };
}
