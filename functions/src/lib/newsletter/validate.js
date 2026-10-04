/**
 * validate.js — request bodies of the newsletter admin routes, parsed into
 * what the handler needs or `{ error }` with the sentence the page shows
 * (ADR 0033 Amplify slice; split out for PR #841).
 *
 * Each parser is pure: it takes the body (and the clock as a number where a
 * date is judged) and never reads a store or Resend, so a handler has one
 * guard — `if (parsed.error) return badRequest(parsed.error)` — and one happy
 * path, and the rules are tested here without a request.
 */
import { normalizeEmail } from './email.js';

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** A reschedule may not land inside the next minute: Resend refuses a past `scheduled_at`. */
export const RESCHEDULE_LEAD_MS = 60 * 1000;

/**
 * `scheduledAt` of a reschedule body: an ISO instant at least a minute ahead
 * of `nowMs`, returned normalised to UTC.
 */
export function parseScheduledAt(value, nowMs) {
  const when = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(when)) return { error: 'scheduledAt must be an ISO instant' };
  if (when <= nowMs + RESCHEDULE_LEAD_MS) {
    return { error: 'scheduledAt must be at least a minute ahead' };
  }
  return { value: new Date(when).toISOString() };
}

/**
 * The body of PUT newsletter-sender: `{ from }`, where `from` is a string or
 * absent. The address itself is judged by the handler against Resend's
 * domains; this only settles the shape and trims it. An empty `from` means
 * "back to the default".
 */
export function parseSenderBody(body) {
  if (!isPlainObject(body)) return { error: 'Body must be a JSON object' };
  if (body.from !== undefined && typeof body.from !== 'string') {
    return { error: 'from must be a string' };
  }
  return { from: String(body.from ?? '').trim() };
}

export const ADD_CONTACT_MODES = Object.freeze(['invite', 'confirmed']);
const ADD_CONTACT_FIELDS = Object.freeze(['email', 'mode', 'consentRecordedOn', 'source']);

/**
 * `consentRecordedOn` of a confirmed add: the date consent was given, as a
 * parseable date that is not in the future, returned as an ISO instant.
 */
export function parseConsentRecordedOn(value, nowMs) {
  const when = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(when)) {
    return {
      error: 'consentRecordedOn is required for a confirmed add: the date consent was given',
    };
  }
  if (when > nowMs) return { error: 'consentRecordedOn cannot be in the future' };
  return { value: new Date(when).toISOString() };
}

/** Each rule of an add-contact body in the order it is judged; the first sentence wins. */
const ADD_CONTACT_CHECKS = [
  (body) => (isPlainObject(body) ? null : 'Send a JSON body { email, mode, consentRecordedOn? }'),
  (body) => {
    const unknown = Object.keys(body).filter((key) => !ADD_CONTACT_FIELDS.includes(key));
    return unknown.length ? `Unknown field(s): ${unknown.join(', ')}` : null;
  },
  (body) => (normalizeEmail(body.email) ? null : 'email must be a valid address'),
  (body) =>
    ADD_CONTACT_MODES.includes(body.mode)
      ? null
      : "mode must be 'invite' (send a confirmation link) or 'confirmed' (consent recorded)",
];

/**
 * The body of POST mailing-list/audience: `{ email, mode, consentRecordedOn? }`
 * as `{ email, mode, consentRecordedOn }` (the date null for an invite), or
 * `{ error }`.
 */
export function parseAddContactBody(body, nowMs) {
  for (const check of ADD_CONTACT_CHECKS) {
    const error = check(body);
    if (error) return { error };
  }
  const consent =
    body.mode === 'confirmed'
      ? parseConsentRecordedOn(body.consentRecordedOn, nowMs)
      : { value: null };
  if (consent.error) return consent;
  return { email: normalizeEmail(body.email), mode: body.mode, consentRecordedOn: consent.value };
}
