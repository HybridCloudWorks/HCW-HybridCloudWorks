/**
 * The rules the Speaking Events Hub and the public speaking widget must
 * agree on (ADR 0033, Spotlight slice). Until 2026-10-03 each had its own:
 * the admin paired a Sessionize event with its stored row by eventId only
 * while the widget also fell back to the name; the admin called today
 * "upcoming" while the widget called it past; the admin wrote `YYYY-MM-DD`
 * while the server stored UTC midnight. One stored row then looked different
 * on the two pages. Every function here is pure, so both import it and the
 * tests pin it once.
 *
 * Dates: an event date is a calendar day. It is stored as plain `YYYY-MM-DD`
 * (functions/src/lib/admin-identity.js normalises every write to that form)
 * and read by its leading day, anchored at local noon, so the day shown is
 * the day named in every zone.
 */

export const SPEAKING_STATUSES = Object.freeze([
  'idea',
  'proposed',
  'accepted',
  'declined',
  'delivered',
]);

/** StatusBadge input per status (lib/status.js shape: label, tone, help). */
export const SPEAKING_STATUS_INFO = Object.freeze({
  idea: {
    id: 'idea',
    label: 'Idea',
    tone: 'muted',
    help: 'A talk worth proposing; nothing sent yet.',
  },
  proposed: {
    id: 'proposed',
    label: 'Proposed',
    tone: 'warn',
    help: 'Submitted to a call for papers; waiting on the organiser.',
  },
  accepted: {
    id: 'accepted',
    label: 'Accepted',
    tone: 'ok',
    help: 'On the agenda. Sessionize events start here.',
  },
  declined: { id: 'declined', label: 'Declined', tone: 'bad', help: 'Not selected this time.' },
  delivered: {
    id: 'delivered',
    label: 'Delivered',
    tone: 'ok',
    help: 'Given. Add slides, a recording and attendance as evidence.',
  },
});

export function speakingStatusInfo(status) {
  return SPEAKING_STATUS_INFO[status] || SPEAKING_STATUS_INFO.idea;
}

/**
 * The status to show for a row that has none stored: a Sessionize-backed row
 * is accepted (it is on the agenda); a manual entry is an idea; and either,
 * once its date has passed, is delivered unless it says otherwise.
 */
export function derivedStatus(row, { sessionizeBacked = false, now = new Date() } = {}) {
  if (SPEAKING_STATUSES.includes(row?.status)) return row.status;
  const base = sessionizeBacked ? 'accepted' : 'idea';
  if (row?.date && !isUpcoming(row.date, now)) return 'delivered';
  return base;
}

export function parseDateValue(dateValue) {
  if (!dateValue) return null;
  if (typeof dateValue?.toDate === 'function') return dateValue.toDate();
  if (dateValue instanceof Date) return dateValue;
  if (typeof dateValue === 'string') {
    const match = dateValue.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, year, month, day] = match;
      return new Date(Number(year), Number(month) - 1, Number(day), 12);
    }
  }
  const parsed = new Date(dateValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `YYYY-MM-DD` for a stored value, from its leading day where it has one. */
export function toInputDate(isoOrStr) {
  if (!isoOrStr) return '';
  if (typeof isoOrStr === 'string') {
    const match = isoOrStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return match[0];
  }
  const d = parseDateValue(isoOrStr);
  if (!d) return '';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export function getDateTimestamp(dateValue) {
  const d = parseDateValue(dateValue);
  return d ? d.getTime() : 0;
}

/**
 * Upcoming is today or later, in local time; an undated row is upcoming too,
 * because it has not been delivered as far as anyone recorded. The one
 * definition for the hub's Upcoming tab and the widget's "Coming soon".
 */
export function isUpcoming(dateValue, now = new Date()) {
  const d = parseDateValue(dateValue);
  if (!d) return true;
  return d >= new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The Sessionize id a stored row carries, as a number, or null. */
export function storedSessionizeId(row) {
  const v = row?.eventId ?? row?.sessionizeId ?? row?.sessionize_id;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+\(copy\)$/, '');
}

/**
 * The stored row for one Sessionize event: by Sessionize id first, then by
 * normalised name. The SAME two steps in the hub and the widget, so a row
 * enriched on the admin is the row the public page shows.
 */
export function matchStoredRow(sessionizeEvent, storedRows) {
  const id = Number(sessionizeEvent?.id);
  if (Number.isFinite(id)) {
    const byId = storedRows.find((row) => storedSessionizeId(row) === id);
    if (byId) return byId;
  }
  const name = normalizeName(sessionizeEvent?.name || sessionizeEvent?.title);
  if (!name) return null;
  return (
    storedRows.find((row) => normalizeName(row.eventName || row.name || row.Name) === name) || null
  );
}

/**
 * A snapshot tombstone: the sanitizer publishes `{ id, sessionizeId,
 * display: false }` for a Sessionize-backed row the editor has hidden, so the
 * widget can drop the event Sessionize still lists.
 */
export function isTombstone(row) {
  return row?.display === false && storedSessionizeId(row) !== null;
}

/**
 * Which of two published snapshots to render: the newer by its stamp. The
 * build-time `/data/*.json` is the cheap path; the live `_snapshots` read is
 * what Publish snapshot writes, and it wins when it is newer so a publish has
 * an effect before the next deploy (ADR 0033 §1). Either side may be null.
 */
export function newerSnapshot(staticDoc, liveDoc) {
  const stamp = (doc) =>
    Date.parse(doc?.publishedAt || doc?.generatedAt || '') || (doc?.items?.length ? 0 : -1);
  if (!staticDoc?.items?.length)
    return liveDoc?.items?.length ? liveDoc : staticDoc || liveDoc || null;
  if (!liveDoc?.items?.length) return staticDoc;
  return stamp(liveDoc) > stamp(staticDoc) ? liveDoc : staticDoc;
}
