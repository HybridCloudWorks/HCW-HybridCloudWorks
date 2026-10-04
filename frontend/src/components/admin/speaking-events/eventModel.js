/**
 * The Speaking Events Hub's pure data rules (#573, ADR 0033 Spotlight slice):
 * how a Sessionize event pairs with its stored override, what a sync writes,
 * what a save sends, and which rows a search or status filter keeps.
 *
 * The rules the public widget must share — dates, the upcoming definition,
 * the id-then-name match, the status vocabulary — live in lib/speakingEvents
 * and are re-exported here so the hub's imports read as before.
 */
import {
  SPEAKING_STATUSES,
  SPEAKING_STATUS_INFO,
  derivedStatus,
  getDateTimestamp,
  isUpcoming,
  matchStoredRow,
  parseDateValue,
  speakingStatusInfo,
  storedSessionizeId,
  toInputDate,
} from '@/lib/speakingEvents';

export {
  SPEAKING_STATUSES,
  SPEAKING_STATUS_INFO,
  derivedStatus,
  getDateTimestamp,
  isUpcoming,
  parseDateValue,
  speakingStatusInfo,
  toInputDate,
};

export const EMPTY_SESSION = Object.freeze({
  title: '',
  abstract: '',
  slidesUrl: '',
  videoUrl: '',
});
export const EMPTY_EVIDENCE = Object.freeze({ label: '', url: '' });

// Only the fields the user provides — Sessionize ID/name/date come from the API.
export const EMPTY_FORM = Object.freeze({
  description: '',
  location: '',
  eventUrl: '',
  presentationUrl: '',
  eventImageUrl: '',
  display: true,
  status: 'idea',
  cfpDeadline: '',
  audience: '',
  topic: '',
  attendance: '',
  feedback: '',
  sessions: [],
  evidence: [],
});

/**
 * The public Sessionize read for one speaker. The ID is a stored setting, so it
 * is encoded as one path segment: a `/`, `?` or `#` in it cannot reach another
 * path or turn into a query.
 */
export function sessionizeUrl(speakerId) {
  return `https://sessionize.com/api/speaker/json/${encodeURIComponent(String(speakerId ?? ''))}`;
}

// Format date as MM/DD/YYYY
export function formatShortDate(dateValue) {
  const d = parseDateValue(dateValue);
  if (!d) return '—';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}/${day}/${d.getFullYear()}`;
}

// Safely convert any value to a display string — handles structured location objects.
export function safeString(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;
  // Structured location: { _lat, _long } or { latitude, longitude }
  if (typeof val === 'object') {
    const lat = val._lat ?? val.latitude;
    const lng = val._long ?? val.longitude;
    if (lat !== undefined && lng !== undefined) return `${lat}, ${lng}`;
    return null; // unknown object — don't render it
  }
  return String(val);
}

/** The value if it is an absolute http(s) URL, else null. */
export function httpUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

// Resolve the canonical numeric ID from a stored record.
export function fdNumericId(fd) {
  return storedSessionizeId(fd);
}

/** Sessionize's speaker JSON, reduced to the fields the hub uses. */
export function mapSessionizeEvents(data) {
  return (data?.events || []).map((e) => ({
    id: e.id,
    name: e.name || '',
    date: e.eventStartDate || null,
    location: e.location || null,
    website: e.website || null,
  }));
}

const newestFirst = (a, b) => getDateTimestamp(b.date) - getDateTimestamp(a.date);

/**
 * Each Sessionize event paired with its stored override — by Sessionize id,
 * then by name, the same two steps the public widget takes — and the stored
 * docs no Sessionize event matches. Both newest first. When Sessionize is
 * unreachable `sessionizeEvents` is empty and every stored row is listed
 * here, so an outage never hides what the store holds.
 */
export function mergeEvents(sessionizeEvents, storedDocs) {
  const matched = new Set();
  const mergedEvents = sessionizeEvents
    .map((se) => {
      const stored = matchStoredRow(se, storedDocs);
      if (stored) matched.add(stored._docId ?? stored.id);
      return { ...se, _storedDoc: stored || null };
    })
    .sort(newestFirst);
  const manualEntries = storedDocs
    .filter((fd) => !matched.has(fd._docId ?? fd.id))
    .sort(newestFirst);
  return { mergedEvents, manualEntries };
}

/** Soonest first, undated last. */
const soonestFirst = (a, b) =>
  (getDateTimestamp(a.date) || Infinity) - (getDateTimestamp(b.date) || Infinity);

/** Rows split into upcoming (soonest first) and past (newest first). */
export function splitByDate(rows, now = new Date()) {
  const upcoming = rows.filter((row) => isUpcoming(row.date, now)).sort(soonestFirst);
  const past = rows.filter((row) => !isUpcoming(row.date, now)).sort(newestFirst);
  return { upcoming, past };
}

/** The status a Sessionize row shows: its override's, or accepted (delivered once past). */
export function sessionizeRowStatus(ev, now = new Date()) {
  return derivedStatus(
    { ...ev._storedDoc, date: ev._storedDoc?.date || ev.date },
    {
      sessionizeBacked: true,
      now,
    }
  );
}

/** The status a manual row shows: its own, or idea (delivered once past). */
export function manualRowStatus(fd, now = new Date()) {
  return derivedStatus(fd, { sessionizeBacked: false, now });
}

/**
 * The rows a search box and a status filter keep. Search is over name,
 * location, topic and audience; the status filter is over the shown status,
 * so a Sessionize row with no override is found under "accepted".
 */
export function filterRows(rows, { search = '', status = '' } = {}, now = new Date()) {
  const q = search.trim().toLowerCase();
  const keep = (text) =>
    !q ||
    String(text || '')
      .toLowerCase()
      .includes(q);
  const mergedEvents = rows.mergedEvents.filter((ev) => {
    const fd = ev._storedDoc;
    if (status && sessionizeRowStatus(ev, now) !== status) return false;
    return keep(
      [ev.name, safeString(fd?.location), safeString(ev.location), fd?.topic, fd?.audience].join(
        ' '
      )
    );
  });
  const manualEntries = rows.manualEntries.filter((fd) => {
    if (status && manualRowStatus(fd, now) !== status) return false;
    return keep([fd.eventName, fd.name, safeString(fd.location), fd.topic, fd.audience].join(' '));
  });
  return { mergedEvents, manualEntries };
}

export function buildSyncPatch(existing, sessionizeEvent, sessionizeId) {
  const patch = {};
  if (!existing.eventId) patch.eventId = sessionizeId;
  if (!existing.sessionizeId) patch.sessionizeId = sessionizeId;
  if (!existing.eventName?.trim()) patch.eventName = sessionizeEvent.name;
  if (!existing.name?.trim()) patch.name = sessionizeEvent.name;
  if (!existing.date) patch.date = toInputDate(sessionizeEvent.date) || null;
  if (!existing.location && sessionizeEvent.location) patch.location = sessionizeEvent.location;
  if (!existing.eventUrl && sessionizeEvent.website) patch.eventUrl = sessionizeEvent.website;
  return patch;
}

export function buildSessionizeCreatePayload(sessionizeEvent, sessionizeId) {
  return {
    eventId: sessionizeId,
    sessionizeId,
    eventName: sessionizeEvent.name,
    name: sessionizeEvent.name,
    date: toInputDate(sessionizeEvent.date) || null,
    location: sessionizeEvent.location || null,
    eventUrl: sessionizeEvent.website || null,
    display: true,
    status: 'accepted',
  };
}

/**
 * What "Sync from Sessionize" would do now: the events with no stored record
 * (created), and the stored records with an empty field Sessionize can fill
 * (patched). Nothing else is ever written by a sync.
 */
export function syncDifferences(sessionizeEvents, storedDocs) {
  const toCreate = [];
  const toPatch = [];
  for (const se of sessionizeEvents) {
    const seId = Number(se.id);
    const existing = matchStoredRow(se, storedDocs);
    if (!existing) toCreate.push(se);
    else if (Object.keys(buildSyncPatch(existing, se, seId)).length > 0) toPatch.push(se);
  }
  return { toCreate, toPatch };
}

/**
 * Stored rows a publish would put in the public snapshot. The server's
 * sanitizer (functions/src/lib/snapshots-publish.js) keeps only
 * `display === true`; a Sessionize-backed row unticked becomes a tombstone
 * that hides the Sessionize entry publicly; any other row without the flag is
 * withheld.
 */
export function countPublishable(storedDocs) {
  const published = storedDocs.filter((fd) => fd.display === true).length;
  const tombstones = storedDocs.filter(
    (fd) => fd.display === false && storedSessionizeId(fd) !== null
  ).length;
  return { published, tombstones, withheld: storedDocs.length - published - tombstones };
}

const trimmedOrNull = (value) => String(value ?? '').trim() || null;

function cleanSessions(sessions) {
  return (sessions || [])
    .map((s) => ({
      title: String(s.title || '').trim(),
      abstract: String(s.abstract || '').trim(),
      slidesUrl: httpUrl(s.slidesUrl),
      videoUrl: httpUrl(s.videoUrl),
    }))
    .filter((s) => s.title);
}

function cleanEvidence(evidence) {
  return (evidence || [])
    .map((e) => ({ label: String(e.label || '').trim(), url: httpUrl(e.url) }))
    .filter((e) => e.url)
    .map((e) => ({ label: e.label || e.url, url: e.url }));
}

function buildBaseSpeakingPayload(form) {
  const attendance = Number(form.attendance);
  return {
    description: trimmedOrNull(form.description),
    location: trimmedOrNull(form.location),
    eventUrl: trimmedOrNull(form.eventUrl),
    presentationUrl: trimmedOrNull(form.presentationUrl),
    eventImageUrl: trimmedOrNull(form.eventImageUrl),
    display: form.display,
    status: SPEAKING_STATUSES.includes(form.status) ? form.status : 'idea',
    cfpDeadline: form.cfpDeadline || null,
    audience: trimmedOrNull(form.audience),
    topic: trimmedOrNull(form.topic),
    attendance:
      form.attendance === '' || form.attendance === null || !Number.isFinite(attendance)
        ? null
        : Math.max(0, Math.floor(attendance)),
    feedback: trimmedOrNull(form.feedback),
    sessions: cleanSessions(form.sessions),
    evidence: cleanEvidence(form.evidence),
  };
}

function buildManualSpeakingPayload(form) {
  return {
    eventName: (form._manualName || '').trim(),
    name: (form._manualName || '').trim(),
    date: form._manualDate || null,
  };
}

function buildSessionizeSpeakingPayload(editingEvent) {
  const payload = {};
  const existingDoc = editingEvent._storedDoc || null;
  if (!existingDoc?.eventId) payload.eventId = Number(editingEvent.id);
  if (!existingDoc?.sessionizeId) payload.sessionizeId = Number(editingEvent.id);
  if (!existingDoc?.eventName?.trim()) payload.eventName = editingEvent.name;
  if (!existingDoc?.name?.trim()) payload.name = editingEvent.name;
  if (!existingDoc?.date && editingEvent.date) payload.date = toInputDate(editingEvent.date);
  return payload;
}

export function buildSpeakingEventPayload(editingEvent, form) {
  const payload = buildBaseSpeakingPayload(form);
  const identity = editingEvent
    ? buildSessionizeSpeakingPayload(editingEvent)
    : buildManualSpeakingPayload(form);
  return Object.assign(payload, identity);
}

/** The structured fields of a stored row, as the form holds them. */
function formDetails(fd, fallbackStatus) {
  return {
    status: SPEAKING_STATUSES.includes(fd?.status) ? fd.status : fallbackStatus,
    cfpDeadline: toInputDate(fd?.cfpDeadline),
    audience: fd?.audience || '',
    topic: fd?.topic || '',
    attendance:
      fd?.attendance === null || fd?.attendance === undefined ? '' : String(fd.attendance),
    feedback: fd?.feedback || '',
    sessions: Array.isArray(fd?.sessions)
      ? fd.sessions.map((s) => ({
          ...EMPTY_SESSION,
          ...s,
          slidesUrl: s.slidesUrl || '',
          videoUrl: s.videoUrl || '',
        }))
      : [],
    evidence: Array.isArray(fd?.evidence)
      ? fd.evidence.map((e) => ({ ...EMPTY_EVIDENCE, ...e }))
      : [],
  };
}

/** The form for enriching a Sessionize event, prefilled from its override. */
export function formFromSessionize(sessionizeEvent) {
  const fd = sessionizeEvent._storedDoc;
  return {
    description: fd?.description || '',
    location: safeString(fd?.location) || safeString(sessionizeEvent.location) || '',
    eventUrl: fd?.eventUrl || sessionizeEvent.website || '',
    presentationUrl: fd?.presentationUrl || '',
    eventImageUrl: fd?.eventImageUrl || '',
    display: fd?.display !== false,
    ...formDetails(fd, 'accepted'),
  };
}

/** The form for editing a stored-only (manual) entry. */
export function formFromManual(fd) {
  return {
    description: fd.description || '',
    location: safeString(fd.location) || '',
    eventUrl: fd.eventUrl || '',
    presentationUrl: fd.presentationUrl || '',
    eventImageUrl: fd.eventImageUrl || '',
    display: fd.display !== false,
    ...formDetails(fd, 'idea'),
    _manualName: fd.eventName || fd.name || '',
    _manualDate: toInputDate(fd.date),
  };
}
