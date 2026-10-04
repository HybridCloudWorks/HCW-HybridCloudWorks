/**
 * speaker-event-rules.js — what `upsertSpeakerEvent` accepts (ADR 0033 §4).
 * Pure: the handlers are in ./speaker-events.js, and admin-identity.js
 * re-exports the public names so callers and tests are unchanged.
 */

/** The UTC calendar day of a Date, or null for an invalid one. */
const utcDay = (date) => (Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10));

/**
 * A date string's calendar day. A leading `YYYY-MM-DD` is kept as written
 * (an invalid day such as 02-30 is refused rather than rolled forward);
 * anything else is whatever `Date` makes of it.
 */
function dateOfString(value) {
  const head = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return new Date(value);
  const [y, m, d] = head.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return utcDay(probe) === head ? probe : new Date(NaN);
}

/** A Firestore-shaped `{ seconds, nanoseconds }` (or `_seconds`) as a Date. */
function dateOfTimestamp(value) {
  const seconds = value.seconds ?? value._seconds;
  const nanos = value.nanoseconds ?? value._nanoseconds ?? 0;
  return new Date(seconds * 1000 + Math.floor(nanos / 1e6));
}

const hasSeconds = (value) => typeof (value.seconds ?? value._seconds) === 'number';

/** The date shapes accepted, each with the parser that turns it into a Date. */
const SPEAKER_DATE_SHAPES = [
  { accepts: (value) => typeof value === 'string', parse: dateOfString },
  { accepts: (value) => value instanceof Date, parse: (value) => value },
  { accepts: (value) => typeof value === 'number', parse: (value) => new Date(value) },
  { accepts: (value) => typeof value === 'object' && hasSeconds(value), parse: dateOfTimestamp },
];

/**
 * A speaker event's calendar date as plain `YYYY-MM-DD` (ADR 0033 §4).
 *
 * Until 2026-10-03 this produced a UTC-midnight ISO timestamp, which the
 * admin and the public widget then read in local time — a day early west of
 * Greenwich. An event date is a calendar day, so the day is what is stored:
 * the leading day of a string is kept as written, and a Date, epoch or
 * Firestore-shaped `{ seconds }` takes its UTC day. Null for nothing usable.
 */
export function normalizeSpeakerEventDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const shape = SPEAKER_DATE_SHAPES.find((candidate) => candidate.accepts(value));
  return shape ? utcDay(shape.parse(value)) : null;
}

export const SPEAKER_EVENT_STATUSES = Object.freeze([
  'idea',
  'proposed',
  'accepted',
  'declined',
  'delivered',
]);

/**
 * The fields `upsertSpeakerEvent` accepts (ADR 0033 §4). Positive, like the
 * snapshot sanitizer's list: the write side had no allowlist, so anything an
 * editor's client sent was stored, and the sanitizer was the only thing
 * between it and the public snapshot. `images[]` is absent on purpose — the
 * image-mirror trigger writes it from the server, never a client.
 */
export const SPEAKER_EVENT_FIELDS = Object.freeze([
  'eventId',
  'sessionizeId',
  'eventName',
  'name',
  'date',
  'location',
  'location_coords',
  'eventUrl',
  'presentationUrl',
  'eventImageUrl',
  'description',
  'display',
  'status',
  'cfpDeadline',
  'sessions',
  'audience',
  'topic',
  'evidence',
  'feedback',
  'attendance',
]);

const SPEAKER_EVENT_FIELD_SET = new Set(SPEAKER_EVENT_FIELDS);
const SPEAKER_EVENT_DATE_FIELDS = ['date', 'cfpDeadline'];

const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim());
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function cleanSessions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      title: text(s.title, 300),
      abstract: text(s.abstract, 8000),
      slidesUrl: isHttpUrl(s.slidesUrl) ? s.slidesUrl.trim() : null,
      videoUrl: isHttpUrl(s.videoUrl) ? s.videoUrl.trim() : null,
    }))
    .filter((s) => s.title)
    .slice(0, 50);
}

function cleanEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((e) => e && typeof e === 'object' && isHttpUrl(e.url))
    .map((e) => ({ label: text(e.label, 200) || e.url.trim(), url: e.url.trim() }))
    .slice(0, 50);
}

/**
 * The body of `upsertSpeakerEvent` with every key checked: unknown keys are a
 * refusal (`error`), dates become calendar days, URLs must be http(s), the
 * status must be one of SPEAKER_EVENT_STATUSES, and the structured lists are
 * reduced to their declared shape. Returns `{ value }` or `{ error }`.
 */
export function validateSpeakerEventData(data) {
  const unknown = Object.keys(data).filter(
    (key) => key !== 'id' && !SPEAKER_EVENT_FIELD_SET.has(key)
  );
  if (unknown.length) return { error: `Unknown speaker event field(s): ${unknown.join(', ')}` };
  const out = { ...data };
  delete out.id;
  for (const step of SPEAKER_EVENT_STEPS) {
    const error = step(out);
    if (error) return { error };
  }
  return { value: out };
}

const SPEAKER_EVENT_URL_FIELDS = ['eventUrl', 'presentationUrl', 'eventImageUrl'];
const isBlank = (value) => value === undefined || value === null || value === '';

/** Each step cleans `out` in place and answers an error sentence, or null. */
function cleanSpeakerEventDates(out) {
  for (const key of SPEAKER_EVENT_DATE_FIELDS) {
    if (Object.hasOwn(out, key)) out[key] = normalizeSpeakerEventDate(out[key]);
  }
  return null;
}

function cleanSpeakerEventUrls(out) {
  for (const key of SPEAKER_EVENT_URL_FIELDS) {
    if (isBlank(out[key])) continue;
    if (!isHttpUrl(out[key])) return `${key} must be an http(s) URL`;
    out[key] = out[key].trim();
  }
  return null;
}

function checkSpeakerEventStatus(out) {
  const unset = out.status === undefined || out.status === null;
  if (unset || SPEAKER_EVENT_STATUSES.includes(out.status)) return null;
  return `status must be one of ${SPEAKER_EVENT_STATUSES.join(', ')}`;
}

function cleanSpeakerEventShapes(out) {
  if ('sessions' in out) out.sessions = cleanSessions(out.sessions);
  if ('evidence' in out) out.evidence = cleanEvidence(out.evidence);
  if ('attendance' in out) out.attendance = cleanAttendance(out.attendance);
  if ('display' in out) out.display = out.display === true;
  return null;
}

/** A whole count of people, or null for nothing usable. */
function cleanAttendance(value) {
  const n = Number(value);
  if (value === null || value === '' || !Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

/** In the order their errors are reported. */
const SPEAKER_EVENT_STEPS = [
  cleanSpeakerEventDates,
  cleanSpeakerEventUrls,
  checkSpeakerEventStatus,
  cleanSpeakerEventShapes,
];

/**
 * The body of an upsert, checked: `{ docId, value, merge }` or `{ error }`.
 * The route/docId is the key, never the body; every other key must be one
 * the hub declares (ADR 0033 §4), or the write is refused.
 */
export function checkSpeakerEventUpsert(body) {
  const { docId, data = {}, merge = true } = body;
  if (!docId || typeof docId !== 'string') return { error: 'docId required' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'data object required' };
  }
  const checked = validateSpeakerEventData(data);
  return checked.error ? checked : { docId, value: checked.value, merge };
}
