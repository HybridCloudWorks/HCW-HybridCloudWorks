/**
 * The contract of the public lab submission (#672): the owner's switch, ADR
 * 0032 decision 6's bounds as constants, the door codes and the sentence for
 * each, the request body's checks, and the shape of the job document. Pure,
 * so each piece is a test of its own. The routes that apply it are
 * public-submit.js (the door and the submission) and public-job.js (the job
 * read); public-submit.js carries the header that explains the whole path.
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

/** The JSON envelope around the payload: three short keys and their quotes. */
export const PUBLIC_MAX_BODY_BYTES = PUBLIC_MAX_PAYLOAD_BYTES + 1024;
/** The daily counter outlives its day, so a late request still finds it. */
export const PUBLIC_QUOTA_TTL_SECONDS = 2 * 24 * 60 * 60;
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
