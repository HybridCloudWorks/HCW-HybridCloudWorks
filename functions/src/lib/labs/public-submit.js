/**
 * Anonymous lab submission (#672, Phase 6 of #657): the Landing Zone
 * Builder's "Validate on the lab".
 *
 *   GET  /api/public/labs/submit        whether a submission would be taken now
 *   POST /api/public/labs/submit        queue one terraform-validate job
 *   GET  /api/public/labs/job?jobId=    that job's status and output
 *
 * Three modules: the contract (public-bounds.js: the switch, the bounds, the
 * door codes, the body's checks, the job document), the job read
 * (public-job.js), and this one, which carries the door and the submission
 * pipeline and wires all three routes. Everything a caller or a test needs
 * is re-exported here.
 *
 * ===========================================================================
 * CLOSED BY DEFAULT. ADR 0032 decision 6 keeps anonymous submission Gated.
 * ===========================================================================
 * Accepting ADR 0032 did not open this path, so nothing here runs until the
 * owner revises decision 6 and then sets one app setting:
 *
 *   LABS_PUBLIC_SUBMISSION_ENABLED = "true"
 *
 * Anything but that exact string is closed: absent (as it is today, since
 * nothing in infra/ sets it), "false", "TRUE", "1". While closed, every one
 * of the three routes answers `PUBLIC_SUBMISSION_CLOSED` before it reads the
 * body, the caller's identity or the store, so a closed path can never touch
 * the queue. The same rule as NEWSLETTER_SENDING_ENABLED in
 * lib/newsletter/admin-handlers.js.
 *
 * ===========================================================================
 * THE BOUNDS ARE DECISION 6's, AND NO WIDER. Each one is a test.
 * ===========================================================================
 *   - Only `terraform-validate`: a body naming any other type is 400.
 *   - A 64 KB payload, measured on the encoded string, the same cap as the
 *     admin enqueue (LAB_JOB_TYPES in lib/labs.js); larger is 413. A
 *     `Content-Length` over the envelope's cap is refused before the body is
 *     read at all.
 *   - 2 submissions an hour per client, through `enforceSubmissionQuota` on
 *     the Cloudflare-verified hashed identity every anonymous route uses
 *     (auth/client-identity.js; `lab-caller:<hash>` in submission_quota); the
 *     third is 429. The window is the helper's: it opens at a client's first
 *     submission and resets an hour later, as it does for every anonymous
 *     route.
 *   - 50 a day globally, a counter `lab-public-quota:<day>` in
 *     tool_service_cache taken with a compare-and-increment (lib/daily-cap.js,
 *     the explain route's counter); the fifty-first is 503 until tomorrow, UTC.
 *   - Refused outright while more than 20 jobs are queued: 503 LAB_QUEUE_FULL.
 *   - Written with `public: true` and a one-day `ttl`.
 *
 * FAIL CLOSED WHILE NO AGENT IS ONLINE. A job is queued only when a lab
 * agent registered for `terraform-validate` has heartbeated within the
 * admin snapshot's window (`isAgentOnline`, lib/labs.js), so a submission
 * never waits in a queue nobody drains. No agent is 503 LAB_AGENT_OFFLINE; a
 * failed read of the agents or the queue is 503 LAB_STATUS_UNAVAILABLE,
 * never "open".
 *
 * ORDER. Switch, body, identity, lab, then the two counters, then the write.
 * The lab check comes before the counters so a visitor is never charged for
 * a job the lab could not have run, the same reason the explain route checks
 * its provider before counting. The lab check reads the status route's
 * one-minute door first: a shut door there refuses without reading the lab,
 * so anonymous POSTs cannot drive the two reads while the lab is down or
 * full. Only a door that is open, or not cached, is read live, because the
 * queue ceiling needs a fresh count.
 *
 * WHAT IS NOT ENFORCED ATOMICALLY. The queue ceiling is a count read before
 * the write: Cosmos has no cross-document transaction here, so submissions
 * in flight at the same instant can each see 20 and each be written. The
 * overshoot is bounded by those simultaneous submissions that also pass both
 * counters, and the counters are exact, so the queue can never gain more
 * than 50 public jobs a day, nor more than 2 an hour from one client. Making
 * the ceiling exact needs a queued-count document the agent's claim
 * decrements (lib/lab-agent.js), which is a change to the agent protocol and
 * is not made here.
 *
 * THE ONE-DAY TTL. `lab_jobs` has TTL on at the container (default 30 days,
 * infra/cosmos-containers.json), so a document's own `ttl` governs it. Cosmos
 * counts it from the document's last write, so a job lives a day after it
 * finishes. The agent's claim spreads the job it replaces and its
 * completion is a patch (lib/lab-agent.js), so both keep `public` and `ttl`.
 * The job read (public-job.js) refuses a document past its day by its `_ts`.
 *
 * NOTHING REWRITES THE LEARNER'S FILES HERE. ADR 0032 decision 5: the
 * payload keeps its registry `source` and `version` lines, and the
 * `terraform-validate` capability rewrites them to the runner image's
 * vendored copies on its own tmpfs copy inside the job
 * (lab-image/bin/hcw-terraform-validate).
 */

import { randomUUID } from 'node:crypto';
import { CACHE_CONTAINER, utcDay } from '../cloud-tools/history.js';
import { takeDailyCap } from '../daily-cap.js';
import { isAgentOnline } from '../labs.js';
import { enforceSubmissionQuota } from '../submissions.js';
import { createMinuteCache, jsonResponse, MINUTE_CACHE_SECONDS } from './minute-cache.js';
import {
  CLOSED_DOOR,
  DOOR_CODES,
  PUBLIC_BOUNDS,
  PUBLIC_LAB_JOB_TYPE,
  PUBLIC_MAX_BODY_BYTES,
  PUBLIC_PER_CLIENT_PER_HOUR,
  PUBLIC_PER_DAY,
  PUBLIC_QUEUE_CEILING,
  PUBLIC_QUOTA_TTL_SECONDS,
  publicJobDocument,
  publicQuotaId,
  publicSubmissionEnabled,
  shutDoor,
  validatePublicSubmission,
} from './public-bounds.js';
import { getPublicJob } from './public-job.js';
import { LAB_JOBS_CONTAINER } from './rollup.js';

export * from './public-bounds.js';
export { getPublicJob, isLivePublicJob, projectPublicJob } from './public-job.js';

/** The door, cached a minute for the page's status read and the POST's first look. */
export const PUBLIC_STATUS_CACHE_ID = 'labs:public-submit';

/**
 * Whether a lab agent could run a public job now, and how deep the queue
 * is: the two reads getLabsSnapshot makes (lib/labs.js), plus the agent's
 * registered capabilities, because an online agent that is not registered
 * for terraform-validate would never claim one. A count that is not a
 * number throws, so an unreadable queue is "unavailable", never "empty".
 */
async function readReadiness({ store, now }) {
  const [agents, queued] = await Promise.all([
    store.queryDocs('lab_agents', 'SELECT TOP 200 c.lastSeenAt, c.capabilities FROM c', []),
    store.queryDocs(LAB_JOBS_CONTAINER, "SELECT VALUE COUNT(1) FROM c WHERE c.status = 'queued'", []),
  ]);
  const count = Number(Array.isArray(queued) ? queued[0] : Number.NaN);
  if (!Number.isFinite(count)) throw new Error('the queued-job count was not a number');
  const nowMs = now();
  const canRun = (agent) =>
    isAgentOnline(agent?.lastSeenAt, nowMs) &&
    Array.isArray(agent?.capabilities) &&
    agent.capabilities.includes(PUBLIC_LAB_JOB_TYPE);
  return { online: (Array.isArray(agents) ? agents : []).some(canRun), queued: count };
}

/** The door, read live. The switch is checked by the caller first. */
async function readDoor(deps, context) {
  let readiness;
  try {
    readiness = await readReadiness(deps);
  } catch (error) {
    context?.warn?.(`labs public submit: readiness read failed: ${error?.message ?? error}`);
    return shutDoor(DOOR_CODES.unavailable);
  }
  if (!readiness.online) return { ...shutDoor(DOOR_CODES.offline), queued: readiness.queued };
  if (readiness.queued > PUBLIC_QUEUE_CEILING) {
    return { ...shutDoor(DOOR_CODES.full), queued: readiness.queued };
  }
  return { configured: true, open: true, code: null, reason: null, queued: readiness.queued };
}

/** The door from the minute cache, else live (and then cached). */
async function cachedDoor(deps, context) {
  let door = await deps.cache.read(context);
  if (!door) {
    door = await readDoor(deps, context);
    await deps.cache.write(door, context);
  }
  return door;
}

const reply = (status, body, headers = {}) => ({ status, body, headers });
const toResponse = ({ status, body, headers }) => ({
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const refusal = (status, code, error, headers) => reply(status, { ok: false, code, error }, headers);

/** `Content-Length` as a number, or 0 when absent or unparseable (admin-uploads.js's reading). */
function readContentLength(request) {
  const parsed = Number.parseInt(String(request?.headers?.get?.('content-length') ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * The submission pipeline, one module-scope step per bound, in the order
 * the header gives. Each `(deps, state)` either answers (returns a reply) or
 * fills in what the next needs (returns null).
 */

async function checkSwitch({ env }) {
  if (publicSubmissionEnabled(env)) return null;
  return reply(503, { ok: false, configured: false, code: DOOR_CODES.closed, error: CLOSED_DOOR.reason });
}

/** The raw body, bounded twice: by its declared length, then by what arrived. */
async function readBoundedBody(request) {
  const tooLarge = { error: `Body must be at most ${PUBLIC_MAX_BODY_BYTES} bytes` };
  if (readContentLength(request) > PUBLIC_MAX_BODY_BYTES) return tooLarge;
  const raw = String((await request.text().catch(() => '')) ?? '');
  return Buffer.byteLength(raw, 'utf8') > PUBLIC_MAX_BODY_BYTES ? tooLarge : { raw };
}

async function readRequest(_deps, state) {
  const read = await readBoundedBody(state.request);
  if (read.error) return refusal(413, 'PAYLOAD_TOO_LARGE', read.error);
  let body;
  try {
    body = JSON.parse(read.raw);
  } catch {
    return refusal(400, 'INVALID_BODY', 'Body must be valid JSON');
  }
  const validated = validatePublicSubmission(body);
  if (!validated.error) {
    state.value = validated.value;
    return null;
  }
  const code = validated.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_BODY';
  return refusal(validated.status, code, validated.error);
}

async function checkIdentity({ identity }, state) {
  try {
    state.clientKey = identity.anonymousKey(state.request).key;
    return null;
  } catch {
    state.context.warn?.('labs public submit rejected: unverified origin');
    return refusal(403, 'FORBIDDEN', 'Forbidden');
  }
}

async function checkLab(deps, state) {
  const cached = await deps.cache.read(state.context);
  const door = cached && !cached.open ? cached : await readDoor(deps, state.context);
  if (door !== cached) await deps.cache.write(door, state.context);
  if (door.open) return null;
  const headers = door.code === DOOR_CODES.full ? { 'Retry-After': '300' } : {};
  return refusal(503, door.code, door.reason, headers);
}

async function checkClientQuota({ store, now }, state) {
  try {
    await enforceSubmissionQuota(store, `lab-caller:${state.clientKey}`, {
      now: now(),
      limit: PUBLIC_PER_CLIENT_PER_HOUR,
    });
    return null;
  } catch (error) {
    if (error?.code !== 'SUBMISSION_RATE_LIMIT') throw error;
    return refusal(
      429,
      'LAB_RATE_LIMITED',
      `Validation on the lab is limited to ${PUBLIC_PER_CLIENT_PER_HOUR} an hour for each visitor. Try again in an hour.`,
      { 'Retry-After': '3600' }
    );
  }
}

async function checkDailyCap({ store, now }, state) {
  state.nowIso = new Date(now()).toISOString();
  const day = utcDay(state.nowIso);
  const allowed = await takeDailyCap(store, {
    container: CACHE_CONTAINER,
    id: publicQuotaId(day),
    kind: 'lab-public-quota',
    day,
    nowIso: state.nowIso,
    limit: PUBLIC_PER_DAY,
    ttlSeconds: PUBLIC_QUOTA_TTL_SECONDS,
  });
  if (allowed) return null;
  return refusal(
    503,
    'LAB_PAUSED_FOR_TODAY',
    `Validation on the lab is paused until tomorrow (UTC): today's ${PUBLIC_PER_DAY} public jobs have been used.`
  );
}

async function enqueue({ store, uuid }, state) {
  const jobId = uuid();
  await store.createDoc(LAB_JOBS_CONTAINER, publicJobDocument(jobId, state.value, state.nowIso));
  state.context.log?.('labs public submit queued', jobId);
  return reply(202, { ok: true, jobId, type: PUBLIC_LAB_JOB_TYPE, status: 'queued' });
}

const SUBMIT_STEPS = Object.freeze([
  checkSwitch,
  readRequest,
  checkIdentity,
  checkLab,
  checkClientQuota,
  checkDailyCap,
  enqueue,
]);

/** POST public/labs/submit: the pipeline above. */
async function submitJob(deps, request, context) {
  const state = { request, context };
  try {
    for (const step of SUBMIT_STEPS) {
      const outcome = await step(deps, state);
      if (outcome) return toResponse(outcome);
    }
    // `enqueue` always replies; reaching here is a programming error.
    throw new Error('labs public submit pipeline ended without a reply');
  } catch (error) {
    context.error?.('publicLabsSubmit failed:', error);
    return toResponse(reply(500, { ok: false, error: 'Failed to submit the lab job' }));
  }
}

/** GET public/labs/submit: the door, and the bounds behind it. No store read while closed. */
async function getSubmissionStatus(deps, _request, context) {
  try {
    const door = publicSubmissionEnabled(deps.env) ? await cachedDoor(deps, context) : CLOSED_DOOR;
    return jsonResponse(200, { ...door, bounds: PUBLIC_BOUNDS }, MINUTE_CACHE_SECONDS);
  } catch (error) {
    context.error?.('publicLabsSubmit status failed:', error);
    return jsonResponse(500, { error: 'Failed to read the lab submission status' });
  }
}

/**
 * @param {object} deps
 * @param {{ anonymousKey: Function }} deps.identity - auth/client-identity.js
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function, createDoc: Function, incrementIf: Function, replaceDocIfMatch: Function }} deps.store
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} [deps.env] - read per request
 * @param {() => number} [deps.now] - epoch ms
 * @param {() => string} [deps.uuid]
 */
export function createPublicSubmitHandlers({
  identity,
  store,
  env = process.env,
  now = () => Date.now(),
  uuid = randomUUID,
}) {
  const cache = createMinuteCache({
    store,
    id: PUBLIC_STATUS_CACHE_ID,
    kind: 'labs-public-submit',
    now,
    seconds: MINUTE_CACHE_SECONDS,
  });
  const deps = { identity, store, env, now, uuid, cache };

  return {
    getSubmissionStatus: (request, context) => getSubmissionStatus(deps, request, context),
    submitJob: (request, context) => submitJob(deps, request, context),
    getJob: (request, context) => getPublicJob(deps, request, context),
    /** The one registration for public/labs/submit: GET is the door, POST submits. */
    submitRoute: (request, context) =>
      String(request.method).toUpperCase() === 'POST'
        ? submitJob(deps, request, context)
        : getSubmissionStatus(deps, request, context),
  };
}
