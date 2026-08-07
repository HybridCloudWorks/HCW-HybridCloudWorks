/**
 * Labs platform RPCs — enqueueLabJob, getLabsSnapshot, cancelLabJob.
 * Ported from Site-Main labs-functions.js (all 319 lines reviewed).
 *
 * The VPS agent pulls jobs with its own credentials; the browser never writes
 * these collections directly — these endpoints are the only writers. The
 * server-side LAB_JOB_TYPES allowlist is carried verbatim: payloads are only
 * ever substituted into the agent's allowlisted command templates, so the
 * type allowlist plus per-type payload byte caps are the enqueue-side
 * containment.
 *
 * Adaptations:
 *   - Firestore's cancel transaction becomes read-then-conditional-patch.
 *     The race window (job claimed between read and patch) resolves the same
 *     way the source's did: the agent ignores cancellation on jobs it has
 *     already claimed, so a lost race means the job simply runs — annoying,
 *     not unsafe.
 *   - lastSeenAt/createdAt arrive as ISO strings in Cosmos; the snapshot's
 *     online/staleness math parses them (Timestamp .toMillis in the source).
 *   - submitPublicLabJob is deliberately NOT ported here: it authenticates
 *     plain Firebase users (not admins), which belongs to the frontend auth
 *     swap phase; it is also outside the api-surface RPC contract.
 */
import { randomUUID } from 'node:crypto';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Verbatim — must stay in sync with vps-agent capability config. */
export const LAB_JOB_TYPES = Object.freeze({
  'shell-echo': {
    description: 'Smoke test — echoes the payload back from the sandbox.',
    maxPayloadBytes: 4 * 1024,
  },
  'terraform-validate': {
    description: 'Runs `terraform init -backend=false && terraform validate` on the payload HCL.',
    maxPayloadBytes: 64 * 1024,
  },
  'ansible-check': {
    description: 'Runs `ansible-playbook --syntax-check` on the payload playbook YAML.',
    maxPayloadBytes: 64 * 1024,
  },
});

export const JOB_STATUSES = [
  'queued',
  'claimed',
  'running',
  'succeeded',
  'failed',
  'timeout',
  'cancelled',
];

const toMs = (v) => {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};
const toIsoOrNull = (v) => (toMs(v) ? new Date(toMs(v)).toISOString() : null);

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function, patchDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createLabHandlers({ guard, store, now = () => new Date(), uuid = randomUUID }) {
  return {
    /** POST /api/enqueueLabJob — editor; allowlisted type + payload cap. */
    async enqueueLabJob(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { type, payload = '' } = body;
        const spec = LAB_JOB_TYPES[type];
        if (!spec) {
          return json(400, {
            error: `Unknown job type. Allowed: ${Object.keys(LAB_JOB_TYPES).join(', ')}`,
          });
        }
        if (typeof payload !== 'string') {
          return json(400, { error: 'payload must be a string' });
        }
        const payloadBytes = Buffer.byteLength(payload, 'utf8');
        if (payloadBytes > spec.maxPayloadBytes) {
          return json(413, {
            error: `Payload too large (${payloadBytes} bytes; max ${spec.maxPayloadBytes} for ${type})`,
          });
        }

        const jobId = uuid();
        await store.upsertDoc('lab_jobs', {
          id: jobId,
          type,
          payload,
          status: 'queued',
          requestedBy: user.oid ?? user.sub,
          requestedByEmail: user.email || user.preferred_username || null,
          createdAt: now().toISOString(),
          claimedAt: null,
          finishedAt: null,
          agentId: null,
          exitCode: null,
          output: null,
        });

        context.log('enqueueLabJob', jobId, type);
        return json(200, { jobId, type, status: 'queued' });
      } catch (error) {
        context.error('enqueueLabJob failed:', error);
        return json(500, { error: 'Failed to enqueue job', message: error?.message || 'Unknown error' });
      }
    },

    /**
     * GET|POST /api/getLabJob — viewer; one job with its output. The console
     * tab watches the job it just enqueued (this replaces the browser's
     * onSnapshot on lab_jobs/{id}); output is agent-written text, returned
     * only to authenticated viewers.
     */
    async getLabJob(request, context) {
      const auth = await guard.requireRole(request, 'viewer');
      if (auth.error) return auth.error;

      try {
        let jobId;
        if (String(request.method).toUpperCase() === 'GET') {
          jobId = request.query.get('jobId');
        } else {
          const body = await request.json().catch(() => null);
          jobId = body?.jobId;
        }
        jobId = String(jobId || '').trim();
        if (!jobId) return json(400, { error: 'jobId required' });

        const data = await store.readDoc('lab_jobs', jobId, jobId);
        if (!data) return json(404, { error: `job ${jobId} not found` });

        return json(200, {
          job: {
            id: data.id,
            type: data.type,
            status: data.status,
            output: data.output ?? null,
            exitCode: data.exitCode ?? null,
            agentId: data.agentId || null,
            requestedByEmail: data.requestedByEmail || null,
            createdAt: toIsoOrNull(data.createdAt),
            claimedAt: toIsoOrNull(data.claimedAt),
            finishedAt: toIsoOrNull(data.finishedAt),
          },
        });
      } catch (error) {
        context.error('getLabJob failed:', error);
        return json(500, { error: 'Failed to get lab job' });
      }
    },

    /** GET|POST /api/getLabsSnapshot — viewer; agents + jobs + queue depth. */
    async getLabsSnapshot(request, context) {
      const auth = await guard.requireRole(request, 'viewer');
      if (auth.error) return auth.error;

      try {
        const STALE_AFTER_MS = 90 * 1000; // 3 missed 30s heartbeats
        const nowMs = now().getTime();

        const [agentRows, jobRows, queuedCount] = await Promise.all([
          store.queryDocs('lab_agents', 'SELECT TOP 200 * FROM c', []),
          store.queryDocs('lab_jobs', 'SELECT TOP 100 * FROM c', []),
          store.queryDocs(
            'lab_jobs',
            "SELECT VALUE COUNT(1) FROM c WHERE c.status = 'queued'",
            []
          ),
        ]);

        const agents = agentRows.map((data) => {
          const lastSeenMs = toMs(data.lastSeenAt);
          return {
            agentId: data.id,
            hostname: data.hostname || null,
            version: data.version || null,
            capabilities: data.capabilities || [],
            status: data.status || 'unknown',
            lastSeenAt: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
            online: lastSeenMs > 0 && nowMs - lastSeenMs < STALE_AFTER_MS,
          };
        });

        const jobs = [...jobRows]
          .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
          .slice(0, 25)
          .map((data) => ({
            id: data.id,
            type: data.type,
            status: data.status,
            requestedByEmail: data.requestedByEmail || null,
            agentId: data.agentId || null,
            exitCode: data.exitCode ?? null,
            createdAt: toIsoOrNull(data.createdAt),
            claimedAt: toIsoOrNull(data.claimedAt),
            finishedAt: toIsoOrNull(data.finishedAt),
          }));

        return json(200, {
          agents,
          jobs,
          queueDepth: Number(queuedCount[0]) || 0,
          jobTypes: Object.entries(LAB_JOB_TYPES).map(([type, spec]) => ({
            type,
            description: spec.description,
            maxPayloadBytes: spec.maxPayloadBytes,
          })),
          statuses: JOB_STATUSES,
          generatedAt: now().toISOString(),
        });
      } catch (error) {
        context.error('getLabsSnapshot failed:', error);
        return json(500, { error: 'Failed to build labs snapshot', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/cancelLabJob — editor; only while still queued. */
    async cancelLabJob(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const jobId = String(body.jobId || '').trim();
        if (!jobId) return json(400, { error: 'jobId is required' });

        const job = await store.readDoc('lab_jobs', jobId, jobId);
        if (!job) return json(404, { error: 'Job not found' });
        if (job.status !== 'queued') {
          return json(409, { error: 'Job is no longer queued and cannot be cancelled' });
        }

        await store.patchDoc('lab_jobs', jobId, {
          status: 'cancelled',
          finishedAt: now().toISOString(),
          cancelledBy: user.oid ?? user.sub,
        });

        context.log('cancelLabJob', jobId);
        return json(200, { jobId, status: 'cancelled' });
      } catch (error) {
        context.error('cancelLabJob failed:', error);
        return json(500, { error: 'Cancel failed', message: error?.message || 'Unknown error' });
      }
    },
  };
}
