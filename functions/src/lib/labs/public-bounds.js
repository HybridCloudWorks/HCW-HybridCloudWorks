/**
 * The contract of the public lab submission (#672): the owner's switch, ADR
 * 0032 decision 6's bounds as constants, the door codes and the sentence for
 * each, the request body's checks, and the shape of the job document. Pure,
 * so each piece is a test of its own. The routes that apply it are
 * public-submit.js (the door and the submission) and public-job.js (the job
 * read); public-submit.js carries the header that explains the whole path,
 * and public-lock.js the lock to the site's pane (decision 6 as revised
 * 2026-09-28: the site's origin and a Cloudflare Turnstile token).
 */

import { LAB_JOB_TYPES } from '../labs.js';

/** The owner's switch. Exactly "true" opens the path; anything else is closed. */
export const PUBLIC_SUBMISSION_SWITCH = 'LABS_PUBLIC_SUBMISSION_ENABLED';

/** ADR 0032 decision 6, one constant per bound. */
export const PUBLIC_LAB_JOB_TYPE = 'terraform-validate';
export const PUBLIC_MAX_PAYLOAD_BYTES = 64 * 1024;
export const PUBLIC_PER_CLIENT_PER_HOUR = 2;
export const PUBLIC_PER_DAY = 50;
export const PUBLIC_QUEUE_CEILING = 20;
export const PUBLIC_JOB_TTL_SECONDS = 24 * 60 * 60;

/** The longest token Turnstile issues (Cloudflare's siteverify reference). */
export const TURNSTILE_TOKEN_MAX_CHARS = 2048;
/**
 * The JSON envelope around the payload: four short keys, their quotes, and a
 * Turnstile token of at most 2,048 characters.
 */
export const PUBLIC_MAX_BODY_BYTES = PUBLIC_MAX_PAYLOAD_BYTES + 1024 + TURNSTILE_TOKEN_MAX_CHARS;
/** The daily counter outlives its day, so a late request still finds it. */
export const PUBLIC_QUOTA_TTL_SECONDS = 2 * 24 * 60 * 60;
/**
 * `turnstileToken` is the lock's (public-lock.js), not the job's: it is read
 * off the body and never reaches the job document.
 */
export const PUBLIC_BODY_KEYS = Object.freeze(['type', 'payload', 'payloadEncoding', 'turnstileToken']);

/** Why the door is shut, as the codes a response carries. */
export const DOOR_CODES = Object.freeze({
  closed: 'PUBLIC_SUBMISSION_CLOSED',
  unconfigured: 'TURNSTILE_NOT_CONFIGURED',
  offline: 'LAB_AGENT_OFFLINE',
  full: 'LAB_QUEUE_FULL',
  unavailable: 'LAB_STATUS_UNAVAILABLE',
});

/**
 * The visitor's sentence for a shut door, per code (owner direction
 * 2026-09-28: public text speaks to visitors only). A visitor cannot act on
 * why the lab is closed, so every closed reason reads the same and points at
 * the download; only a full queue, which clears by itself, says to wait. The
 * code says which it is, for logs and the admin pages; the builder maps the
 * code to its own copy of these words and never renders this field.
 */
export const LAB_UNAVAILABLE_REASON =
  "Validation on the lab isn't available right now. You can still download the files and validate locally.";
export const LAB_BUSY_REASON =
  'The lab is busy right now. Try again in a few minutes, or download the files and validate locally.';

export const DOOR_REASONS = Object.freeze({
  [DOOR_CODES.closed]: LAB_UNAVAILABLE_REASON,
  [DOOR_CODES.unconfigured]: LAB_UNAVAILABLE_REASON,
  [DOOR_CODES.offline]: LAB_UNAVAILABLE_REASON,
  [DOOR_CODES.full]: LAB_BUSY_REASON,
  [DOOR_CODES.unavailable]: LAB_UNAVAILABLE_REASON,
});

/** The two limits a visitor can reach, as codes and the visitor's sentence for each. */
export const LIMIT_CODES = Object.freeze({
  client: 'LAB_RATE_LIMITED',
  daily: 'LAB_PAUSED_FOR_TODAY',
});

export const LIMIT_REASONS = Object.freeze({
  [LIMIT_CODES.client]: `You've reached the limit for validation on the lab for now (${PUBLIC_PER_CLIENT_PER_HOUR} an hour). Try again in about an hour.`,
  [LIMIT_CODES.daily]:
    "Validation on the lab has reached today's limit. Try again tomorrow, or download the files and validate locally.",
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

/** Whether the owner has opened the path. Read per request, never cached. */
export function publicSubmissionEnabled(env) {
  return env?.[PUBLIC_SUBMISSION_SWITCH] === 'true';
}

export function publicQuotaId(day) {
  return `lab-public-quota:${day}`;
}

/** A shut door: which code, and the sentence for it. */
export const shutDoor = (code, configured = true) => ({
  configured,
  open: false,
  code,
  reason: DOOR_REASONS[code],
});
export const CLOSED_DOOR = Object.freeze(shutDoor(DOOR_CODES.closed, false));
/** Switched on, but with no Turnstile secret the lock cannot check anyone, so nothing is taken. */
export const UNCONFIGURED_DOOR = Object.freeze(shutDoor(DOOR_CODES.unconfigured, false));

const BASE64 = /^[A-Za-z0-9+/=\s]*$/;
const PUBLIC_ENCODINGS = LAB_JOB_TYPES[PUBLIC_LAB_JOB_TYPE].payloadEncodings;
const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
 * The request body, or why not.
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

/**
 * The `lab_jobs` document for a public job: the admin enqueue's shape
 * (lib/labs.js), plus `public: true` and the one-day `ttl`, and no person
 * behind it.
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
