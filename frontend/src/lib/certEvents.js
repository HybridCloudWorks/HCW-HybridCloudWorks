/**
 * Certification lifecycle events from `GET public/cert-events`, shaped for
 * the education timeline and merged over the hand-maintained entries.
 *
 * The Friday Skills Hub RSS scraper (functions/src/lib/timers/skills-hub.js)
 * writes one `certEvents` document per feed item that matched a lifecycle
 * pattern: `{ id, type, certCodes, title, summary, link, pubDate,
 * mentionedDates, source }`. `pubDate` is the blog post's date; the dates the
 * post mentions are extracted as text and not interpreted. The Azure timeline
 * in src/data/azure/certifications.js was, until #461 item 4, a static array
 * whose comment claimed to come from that scraper while nothing read the
 * container. Now the page fetches the events and merges them here.
 *
 * Every function is pure and every date is a `YYYY-MM-DD` string compared as
 * text, matching lib/certStatus.js, so the pre-render, the hydrating render
 * and the tests agree. Every day that decides anything passes `isIsoDate`
 * first — the scraper's dates are text lifted from a blog post, and an
 * impossible day must not place a row. The static entries are the fallback:
 * when the list is empty or the request fails the page shows exactly what it
 * showed before.
 */
import { isIsoDate } from './certStatus';

const KNOWN_TYPES = new Set(['beta_launch', 'ga_launch', 'retirement', 'update']);

/**
 * `YYYY-MM-DD` for an ISO timestamp (`2026-05-01T09:00:00.000Z`), a bare ISO
 * day, or a written date (`June 30, 2026`, the form the scraper captures);
 * null for anything else, including a day that does not exist. Written dates
 * are placed on the UTC calendar so the day is the one printed, not the one
 * before it west of Greenwich.
 */
export function isoDayOf(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const candidate = /^\d{4}-\d{2}-\d{2}(T|$)/.test(text) ? text.slice(0, 10) : fromWritten(text);
  return isIsoDate(candidate) ? candidate : null;
}

function fromWritten(text) {
  // Only a written month-day-year form is accepted here: Date.parse would
  // read "30" as 1930 and "2026-02-30" as March 2, and neither is a date the
  // post named.
  if (!/^[A-Za-z]+ \d{1,2}, \d{4}$/.test(text)) return null;
  const ms = Date.parse(`${text} UTC`);
  if (Number.isNaN(ms)) return null;
  const day = new Date(ms).toISOString().slice(0, 10);
  // Round-trip: "February 30, 2026" parses to March 2, which is not the day
  // the post named, so the printed form must reproduce the input's day.
  const [month, dayOfMonth] = text.replace(',', '').split(' ');
  const printed = new Date(ms).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return printed.toLowerCase() === `${month} ${Number(dayOfMonth)}`.toLowerCase() ? day : null;
}

/**
 * The day an event sits on. A post announcing a retirement is dated the day
 * it was written and names the day the exam goes; the timeline wants the
 * latter. So: the earliest date the post mentions that is on or after its
 * publication day, and the publication day when it mentions none. A
 * mentioned date before publication is history the post refers to, not the
 * event.
 */
export function timelineDateFor(event) {
  const published = isoDayOf(event?.pubDate);
  if (!published) return null;
  const candidates = (Array.isArray(event.mentionedDates) ? event.mentionedDates : [])
    .map(isoDayOf)
    .filter((day) => day && day >= published)
    .sort();
  return candidates[0] || published;
}

/**
 * A `certEvents` document as a timeline entry, or null when it lacks an id
 * or a usable date. Unknown types render as "Updated" rather than being
 * dropped, so a pattern the scraper adds later still shows.
 */
export function certEventToTimelineEvent(doc) {
  if (!doc || typeof doc.id !== 'string' || !doc.id) return null;
  const date = timelineDateFor(doc);
  if (!date) return null;
  const certCodes = Array.isArray(doc.certCodes) ? doc.certCodes.filter(Boolean) : [];
  return {
    id: doc.id,
    date,
    type: KNOWN_TYPES.has(doc.type) ? doc.type : 'update',
    credentialType: 'certification',
    certCode: certCodes[0] || null,
    certCodes,
    title: String(doc.title || '').trim() || certCodes[0] || 'Certification update',
    description: String(doc.summary || '').trim(),
    sourceUrl: typeof doc.link === 'string' ? doc.link : '',
    publishedAt: isoDayOf(doc.pubDate),
    live: true,
  };
}

/**
 * The static entries with the live ones merged over them by id: a live event
 * whose id matches a static one replaces it, every other live event is added,
 * and the static entries stay when there are no live ones. Sorted by day.
 */
export function mergeTimelineEvents(staticEvents = [], liveEvents = []) {
  const byId = new Map();
  for (const event of staticEvents) {
    if (event && event.id) byId.set(event.id, event);
  }
  for (const event of liveEvents) {
    if (event && event.id) byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
