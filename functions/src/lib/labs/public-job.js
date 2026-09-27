/**
 * GET /api/public/labs/job?jobId= — one public lab job's status and output,
 * for the page that queued it (#672). Behind the same switch as the
 * submission (public-bounds.js), and closed the same way.
 *
 * `public: true` documents only. A missing job, an admin job, a job of
 * another type and a job past its day all answer the identical 404, so the
 * route is not an oracle for which ids exist, and a `jobId` that is not a
 * UUID (the only ids the server issues) is refused before any read. The
 * answer is the status, the exit code, the agent's output and the three
 * timestamps: never the payload, the agent id or anything about who
 * submitted it. `Cache-Control: no-store`, because the point of the call is
 * to see the status move.
 *
 * Cosmos deletes a document after its `ttl` asynchronously, so a job is
 * refused here by its `_ts` (the last write) once a day has passed, rather
 * than served until the reaper gets to it.
 */

import {
  PUBLIC_JOB_TTL_SECONDS,
  PUBLIC_LAB_JOB_TYPE,
  CLOSED_DOOR,
  DOOR_CODES,
  publicSubmissionEnabled,
} from './public-bounds.js';
import { LAB_JOBS_CONTAINER } from './rollup.js';

/** `randomUUID()` output, the only job id the server issues. */
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const NO_STORE = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const respond = (status, body) => ({ status, headers: NO_STORE, body: JSON.stringify(body) });

const toIsoOrNull = (value) => {
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/** A public job that is still inside its day, or false. */
export function isLivePublicJob(doc, nowMs) {
  if (!doc || doc.public !== true || doc.type !== PUBLIC_LAB_JOB_TYPE) return false;
  const writtenAt = Number(doc._ts);
  return !(Number.isFinite(writtenAt) && nowMs / 1000 - writtenAt >= PUBLIC_JOB_TTL_SECONDS);
}

/** What the job read discloses: never the payload, the agent or the requester. */
export function projectPublicJob(doc) {
  return {
    id: doc.id,
    type: doc.type,
    status: doc.status,
    exitCode: Number.isInteger(doc.exitCode) ? doc.exitCode : null,
    output: typeof doc.output === 'string' ? doc.output : null,
    createdAt: toIsoOrNull(doc.createdAt),
    claimedAt: toIsoOrNull(doc.claimedAt),
    finishedAt: toIsoOrNull(doc.finishedAt),
  };
}

/** The refusal owed before any read: the switch, then the id's shape. Null when neither applies. */
function refusalBeforeRead(env, jobId) {
  if (!publicSubmissionEnabled(env)) {
    return [503, { ok: false, configured: false, code: DOOR_CODES.closed, error: CLOSED_DOOR.reason }];
  }
  if (!JOB_ID.test(jobId)) {
    return [400, { ok: false, code: 'INVALID_JOB_ID', error: 'jobId must be the id the submission returned' }];
  }
  return null;
}

const NOT_FOUND = Object.freeze({ ok: false, code: 'JOB_NOT_FOUND', error: 'Job not found' });

/**
 * The handler. `deps` is `{ store, env, now }` from createPublicSubmitHandlers.
 *
 * @param {{ store: { readDoc: Function }, env: object, now: () => number }} deps
 */
export async function getPublicJob({ store, env, now }, request, context) {
  const jobId = String(request.query?.get?.('jobId') ?? '').trim();
  const refused = refusalBeforeRead(env, jobId);
  if (refused) return respond(...refused);
  try {
    const doc = await store.readDoc(LAB_JOBS_CONTAINER, jobId, jobId);
    return isLivePublicJob(doc, now())
      ? respond(200, { ok: true, job: projectPublicJob(doc) })
      : respond(404, NOT_FOUND);
  } catch (error) {
    context.error?.('publicGetLabJob failed:', error);
    return respond(500, { ok: false, error: 'Failed to read the lab job' });
  }
}
