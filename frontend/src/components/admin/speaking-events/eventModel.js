/**
 * The Speaking Events Hub's pure data rules (#573), moved out of
 * SpeakingEventsPage.jsx unchanged: how a Sessionize event pairs with its
 * stored override, what a sync writes, and what a save sends. The tabs only
 * add where a row belongs (upcoming or past) and what a sync would change.
 */

// Only the fields the user manually provides — Sessionize ID/name/date come from the API
export const EMPTY_FORM = Object.freeze({
  description: '',
  location: '',
  eventUrl: '',
  presentationUrl: '',
  eventImageUrl: '',
  display: true,
});

/** The public Sessionize read for one speaker. */
export function sessionizeUrl(speakerId) {
  return `https://sessionize.com/api/speaker/json/${speakerId}`;
}

export function parseDateValue(dateValue) {
  if (!dateValue) return null;
  if (typeof dateValue?.toDate === 'function') return dateValue.toDate();
  if (dateValue instanceof Date) return dateValue;
  if (typeof dateValue === 'string') {
    // Accept either YYYY-MM-DD or a full ISO timestamp; anchor at local noon.
    const match = dateValue.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, year, month, day] = match;
      return new Date(Number(year), Number(month) - 1, Number(day), 12);
    }
  }
  const parsed = new Date(dateValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toInputDate(isoOrStr) {
  if (!isoOrStr) return '';
  if (typeof isoOrStr === 'string') {
    // Match the leading YYYY-MM-DD even if a full ISO timestamp is supplied.
    const match = isoOrStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return match[0];
  }
  const d = parseDateValue(isoOrStr);
  if (!d) return '';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

// Format date as MM/DD/YYYY
export function formatShortDate(dateValue) {
  const d = parseDateValue(dateValue);
  if (!d) return '—';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}/${day}/${d.getFullYear()}`;
}

// Convert date value to timestamp for sorting
export function getDateTimestamp(dateValue) {
  const d = parseDateValue(dateValue);
  return d ? d.getTime() : 0;
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
  const v = fd.eventId ?? fd.sessionizeId;
  return v ? Number(v) : null;
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
 * Each Sessionize event paired with its stored override (matched by eventId
 * only — consistent with sync), and the stored docs no Sessionize event
 * matches. Both newest first.
 */
export function mergeEvents(sessionizeEvents, storedDocs) {
  const mergedEvents = sessionizeEvents
    .map((se) => ({
      ...se,
      _storedDoc: storedDocs.find((d) => fdNumericId(d) === Number(se.id)) || null,
    }))
    .sort(newestFirst);
  const manualEntries = storedDocs
    .filter((fd) => {
      const id = fdNumericId(fd);
      return !(id && sessionizeEvents.some((se) => Number(se.id) === id));
    })
    .sort(newestFirst);
  return { mergedEvents, manualEntries };
}

/**
 * Upcoming is today or later, in local time; an undated row is upcoming too,
 * because it has not been delivered as far as anyone recorded.
 */
export function isUpcoming(dateValue, now = new Date()) {
  const d = parseDateValue(dateValue);
  if (!d) return true;
  return d >= new Date(now.getFullYear(), now.getMonth(), now.getDate());
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

export function buildSyncPatch(existing, sessionizeEvent, sessionizeId) {
  const patch = {};
  if (!existing.eventId) patch.eventId = sessionizeId;
  if (!existing.sessionizeId) patch.sessionizeId = sessionizeId;
  if (!existing.eventName?.trim()) patch.eventName = sessionizeEvent.name;
  if (!existing.name?.trim()) patch.name = sessionizeEvent.name;
  if (!existing.date) patch.date = sessionizeEvent.date || null;
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
    date: sessionizeEvent.date || null,
    location: sessionizeEvent.location || null,
    eventUrl: sessionizeEvent.website || null,
    display: true,
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
    const existing = storedDocs.find((fd) => fdNumericId(fd) === seId);
    if (!existing) toCreate.push(se);
    else if (Object.keys(buildSyncPatch(existing, se, seId)).length > 0) toPatch.push(se);
  }
  return { toCreate, toPatch };
}

/**
 * Stored rows a publish would put in the public snapshot. The server's
 * sanitizer (functions/src/lib/snapshots-publish.js) keeps only
 * `display === true`, so a row with no flag is not published either.
 */
export function countPublishable(storedDocs) {
  const published = storedDocs.filter((fd) => fd.display === true).length;
  return { published, withheld: storedDocs.length - published };
}

function buildBaseSpeakingPayload(form) {
  return {
    description: form.description.trim() || null,
    location: form.location.trim() || null,
    eventUrl: form.eventUrl.trim() || null,
    presentationUrl: form.presentationUrl.trim() || null,
    eventImageUrl: form.eventImageUrl.trim() || null,
    display: form.display,
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
  if (!existingDoc?.date && editingEvent.date) payload.date = editingEvent.date;
  return payload;
}

export function buildSpeakingEventPayload(editingEvent, form) {
  const payload = buildBaseSpeakingPayload(form);
  const identity = editingEvent
    ? buildSessionizeSpeakingPayload(editingEvent)
    : buildManualSpeakingPayload(form);
  return Object.assign(payload, identity);
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
    _manualName: fd.eventName || fd.name || '',
    _manualDate: toInputDate(fd.date),
  };
}
