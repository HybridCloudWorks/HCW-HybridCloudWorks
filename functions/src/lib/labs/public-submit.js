/**
 * Anonymous lab submission (#672, Phase 6 of #657): the Landing Zone
 * Builder's "Validate on the lab".
 *
 *   GET  /api/public/labs/submit        whether a submission would be taken now
 *   POST /api/public/labs/submit        queue one terraform-validate job
 *   GET  /api/public/labs/job?jobId=    that job's status and output
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
 *     admin enqueue (LAB_JOB_TYPES in lib/labs.js) and the agent's
 *     (vps-agent/lib/capabilities.js); larger is 413.
 *   - 2 submissions an hour per client, through `enforceSubmissionQuota` on
 *     the Cloudflare-verified hashed identity every anonymous route uses
 *     (auth/client-identity.js; `lab-caller:<hash>` in submission_quota); the
 *     third is 429.
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
 * its provider before counting.
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
 * Deletion is asynchronous, so the job read also refuses a document past
 * its day by its `_ts`, rather than serving one Cosmos has not reaped yet.
 *
 * THE JOB READ is for `public: true` documents only. A missing job, an admin
 * job and an expired job all answer the identical 404, so the route is not
 * an oracle for which ids exist, and a `jobId` that is not a UUID (the only
 * ids the server issues) is refused before any read. The answer is the
 * status, the exit code, the agent's output and the three timestamps: never
 * the payload, the agent id or anything about who submitted it.
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
import { LAB_JOB_TYPES, isAgentOnline } from '../labs.js';
import { enforceSubmissionQuota } from '../submissions.js';
import { createMinuteCache, jsonResponse, MINUTE_CACHE_SECONDS } from './minute-cache.js';
import { LAB_JOBS_CONTAINER } from './rollup.js';

/** The owner's switch. Exactly "true" opens the path; anything else is closed. */
export const PUBLIC_SUBMISSION_SWITCH = 'LABS_PUBLIC_SUBMISSION_ENABLED';

/** ADR 0032 decision 6, one constant per bound. */
export const PUBLIC_LAB_JOB_TYPE = 'terraform-validate';
export const PUBLIC_MAX_PAYLOAD_BYTES = 64 * 1024;
export const PUBLIC_PER_CLIENT_PER_HOUR = 2;
export const PUBLIC_PER_DAY = 50;
export const PUBLIC_QUEUE_CEILING = 20;
export const PUBLIC_JOB_TTL_SECONDS = 24 * 60 * 60;

/** The JSON envelope around the payload: three short keys and their quotes. */
export const PUBLIC_MAX_BODY_BYTES = PUBLIC_MAX_PAYLOAD_BYTES + 1024;
/** The daily counter outlives its day, so a late request still finds it. */
export const PUBLIC_QUOTA_TTL_SECONDS = 2 * 24 * 60 * 60;
/** The door, cached a minute for the page's status read. */
export const PUBLIC_STATUS_CACHE_ID = 'labs:public-submit';
export const PUBLIC_BODY_KEYS = Object.freeze(['type', 'payload', 'payloadEncoding']);

/** Why the door is shut, as the codes a response carries. */
export const DOOR_CODES = Object.freeze({
  closed: 'PUBLIC_SUBMISSION_CLOSED',
  offline: 'LAB_AGENT_OFFLINE',
  full: 'LAB_QUEUE_FULL',
  unavailable: 'LAB_STATUS_UNAVAILABLE',
});

/** The one line the builder shows under a disabled button, per code. */
export const DOOR_REASONS = Object.freeze({
  [DOOR_CODES.closed]: 'The lab is not taking public jobs yet: public submission is switched off.',
  [DOOR_CODES.offline]: 'The lab is not taking jobs yet: no lab agent is online to run them.',
  [DOOR_CODES.full]: `The lab's queue is full (more than ${PUBLIC_QUEUE_CEILING} jobs waiting). Try again in a few minutes.`,
  [DOOR_CODES.unavailable]: "The lab's status could not be read, so it is not taking jobs right now.",
});

/** Every bound, as the status read reports them, so the page can say them. */
export const PUBLIC_BOUNDS = Object.freeze({
  jobType: PUBLIC_LAB_JOB_TYPE,
  maxPayloadBytes: PUBLIC_MAX_PAYLOAD_BYTES,
  perClientPerHour: PUBLIC_PER_CLIENT_PER_HOUR,
  perDay: PUBLIC_PER_DAY,
  queueCeiling: PUBLIC_QUEUE_CEILING,
  jobTtlSeconds: PUBLIC_JOB_TTL_SECONDS,
});

/** `randomUUID()` output, the only job id the server issues. */
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64 = /^[A-Za-z0-9+/=\s]*$/;

/** Whether the owner has opened the path. Read per request, never cached. */
export function publicSubmissionEnabled(env) {
  return env?.[PUBLIC_SUBMISSION_SWITCH] === 'true';
}

export function publicQuotaId(day) {
  return `lab-public-quota:${day}`;
}

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const PUBLIC_ENCODINGS = LAB_JOB_TYPES[PUBLIC_LAB_JOB_TYPE].payloadEncodings;
const encodingOf = (body) => body.payloadEncoding ?? 'text';
const unknownKeys = (body) => Object.keys(body).filter((key) => !PUBLIC_BODY_KEYS.includes(key));

/**
 * The body's checks, in order, each `[status, sentence]` for a refusal or
 * null to pass. The payload's size is measured last, on the encoded string,
 * exactly as the admin enqueue measures it.
 */
const BODY_CHECKS = Object.freeze([
  (body) => (isPlainObject(body) ? null : [400, 'Body must be a JSON object']),
  (body) => {
    const unknown = unknownKeys(body);
    if (!unknown.length) return null;
    return [400, `Unknown field(s): ${unknown.join(', ')}. Allowed: ${PUBLIC_BODY_KEYS.join(', ')}`];
  },
  (body) =>
    body.type === PUBLIC_LAB_JOB_TYPE
      ? null
      : [400, `Only ${PUBLIC_LAB_JOB_TYPE} jobs may be submitted publicly`],
  (body) =>
    typeof body.payload === 'string' && body.payload.trim()
      ? null
      : [400, 'payload must be a non-empty string'],
  (body) =>
    PUBLIC_ENCODINGS.includes(encodingOf(body))
      ? null
      : [400, `payloadEncoding must be one of ${PUBLIC_ENCODINGS.join(', ')}`],
  (body) =>
    encodingOf(body) !== 'tar' || BASE64.test(body.payload)
      ? null
      : [400, 'a tar payload must be base64'],
  (body) => {
    const bytes = Buffer.byteLength(body.payload, 'utf8');
    if (bytes <= PUBLIC_MAX_PAYLOAD_BYTES) return null;
    return [
      413,
      `Payload too large (${bytes} bytes; max ${PUBLIC_MAX_PAYLOAD_BYTES} for ${PUBLIC_LAB_JOB_TYPE})`,
    ];
  },
]);

/**
 * The request body, or why not. Pure, and exported for the tests.
 *
 * @param {unknown} body
 * @returns {{ value: { type: string, payload: string, payloadEncoding: string } } | { status: number, error: string }}
 */
export function validatePublicSubmission(body) {
  for (const check of BODY_CHECKS) {
    const refused = check(body);
    if (refused) return { status: refused[0], error: refused[1] };
  }
  return {
    value: { type: PUBLIC_LAB_JOB_TYPE, payload: body.payload, payloadEncoding: encodingOf(body) },
  };
}

/** A shut door: which code, and the sentence for it. */
const shut = (code, configured = true) => ({
  configured,
  open: false,
  code,
  reason: DOOR_REASONS[code],
});
const CLOSED_DOOR = Object.freeze(shut(DOOR_CODES.closed, false));

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
  const online = (Array.isArray(agents) ? agents : []).some(
    (agent) =>
      isAgentOnline(agent?.lastSeenAt, nowMs) &&
      Array.isArray(agent?.capabilities) &&
      agent.capabilities.includes(PUBLIC_LAB_JOB_TYPE)
  );
  return { online, queued: count };
}

/** The door, read live. The switch is checked by the caller first. */
async function readDoor(deps, context) {
  let readiness;
  try {
    readiness = await readReadiness(deps);
  } catch (error) {
    context?.warn?.(`labs public submit: readiness read failed: ${error?.message ?? error}`);
    return shut(DOOR_CODES.unavailable);
  }
  if (!readiness.online) return { ...shut(DOOR_CODES.offline), queued: readiness.queued };
  if (readiness.queued > PUBLIC_QUEUE_CEILING) {
    return { ...shut(DOOR_CODES.full), queued: readiness.queued };
  }
  return { configured: true, open: true, code: null, reason: null, queued: readiness.queued };
}

const reply = (status, body, headers = {}) => ({ status, body, headers });
const toResponse = ({ status, body, headers }) => ({
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const refusal = (status, code, error, headers) => reply(status, { ok: false, code, error }, headers);
const closedReply = () =>
  reply(503, { ok: false, configured: false, code: DOOR_CODES.closed, error: CLOSED_DOOR.reason });

/**
 * The submission pipeline, one module-scope step per bound, in the order
 * the header gives. Each `(deps, state)` either answers (returns a reply) or
 * fills in what the next needs (returns null).
 */

async function checkSwitch({ env }) {
  return publicSubmissionEnabled(env) ? null : closedReply();
}

async function readRequest(_deps, state) {
  const raw = String((await state.request.text().catch(() => '')) ?? '');
  if (Buffer.byteLength(raw, 'utf8') > PUBLIC_MAX_BODY_BYTES) {
    return refusal(413, 'PAYLOAD_TOO_LARGE', `Body must be at most ${PUBLIC_MAX_BODY_BYTES} bytes`);
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return refusal(400, 'INVALID_BODY', 'Body must be valid JSON');
  }
  const validated = validatePublicSubmission(body);
  if (validated.error) {
    const code = validated.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_BODY';
    return refusal(validated.status, code, validated.error);
  }
  state.value = validated.value;
  return null;
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
  const door = await readDoor(deps, state.context);
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

/**
 * The `lab_jobs` document for a public job: the admin enqueue's shape
 * (lib/labs.js), plus `public: true` and the one-day `ttl`, and no person
 * behind it. Exported so the test can hold the shape.
 */
export function publicJobDocument(jobId, { type, payload, payloadEncoding }, nowIso) {
  return {
    id: jobId,
    type,
    payload,
    payloadEncoding,
    status: 'queued',
    public: true,
    ttl: PUBLIC_JOB_TTL_SECONDS,
    requestedBy: 'public',
    requestedByEmail: null,
    requestedVia: 'public/labs/submit',
    createdAt: nowIso,
    claimedAt: null,
    finishedAt: null,
    agentId: null,
    exitCode: null,
    output: null,
  };
}

const toIsoOrNull = (value) => {
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/** A public job that is still inside its day, or false. */
export function isLivePublicJob(doc, nowMs) {
  if (!doc || doc.public !== true || doc.type !== PUBLIC_LAB_JOB_TYPE) return false;
  const writtenAt = Number(doc._ts);
  if (Number.isFinite(writtenAt) && nowMs / 1000 - writtenAt >= PUBLIC_JOB_TTL_SECONDS) return false;
  return true;
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

const NO_STORE = { 'Cache-Control': 'no-store' };

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
  const deps = { identity, store, env, now, uuid };
  const cache = createMinuteCache({
    store,
    id: PUBLIC_STATUS_CACHE_ID,
    kind: 'labs-public-submit',
    now,
    seconds: MINUTE_CACHE_SECONDS,
  });

  /** GET public/labs/submit: the door, and the bounds behind it. */
  async function getSubmissionStatus(_request, context) {
    try {
      if (!publicSubmissionEnabled(env)) {
        // No store read at all while closed.
        return jsonResponse(200, { ...CLOSED_DOOR, bounds: PUBLIC_BOUNDS }, MINUTE_CACHE_SECONDS);
      }
      let door = await cache.read(context);
      if (!door) {
        door = await readDoor(deps, context);
        await cache.write(door, context);
      }
      return jsonResponse(200, { ...door, bounds: PUBLIC_BOUNDS }, MINUTE_CACHE_SECONDS);
    } catch (error) {
      context.error?.('publicLabsSubmit status failed:', error);
      return jsonResponse(500, { error: 'Failed to read the lab submission status' });
    }
  }

  /** POST public/labs/submit: the pipeline above. */
  async function submitJob(request, context) {
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

  /** GET public/labs/job?jobId=: one public job, or the identical 404. */
  async function getJob(request, context) {
    try {
      if (!publicSubmissionEnabled(env)) return toResponse({ ...closedReply(), headers: NO_STORE });
      const jobId = String(request.query?.get?.('jobId') ?? '').trim();
      if (!JOB_ID.test(jobId)) {
        return toResponse(refusal(400, 'INVALID_JOB_ID', 'jobId must be the id the submission returned', NO_STORE));
      }
      const doc = await store.readDoc(LAB_JOBS_CONTAINER, jobId, jobId);
      if (!isLivePublicJob(doc, now())) {
        return toResponse(refusal(404, 'JOB_NOT_FOUND', 'Job not found', NO_STORE));
      }
      return toResponse(reply(200, { ok: true, job: projectPublicJob(doc) }, NO_STORE));
    } catch (error) {
      context.error?.('publicGetLabJob failed:', error);
      return toResponse(reply(500, { ok: false, error: 'Failed to read the lab job' }, NO_STORE));
    }
  }

  return {
    getSubmissionStatus,
    submitJob,
    getJob,
    /** The one registration for public/labs/submit: GET is the door, POST submits. */
    async submitRoute(request, context) {
      return String(request.method).toUpperCase() === 'POST'
        ? submitJob(request, context)
        : getSubmissionStatus(request, context);
    },
  };
}
