/**
 * One episode shape for the podcast page (#349).
 *
 * Two audio systems feed a provider's podcast page and they store different
 * documents: the host's RSS ingest writes `podcasts` rows (`mediaUrl`, an
 * `itunes:duration` string, `publishedAt`), and Listen & Learn writes
 * `listen_and_learn_episodes` rows (`audioUrl`, `durationSeconds`,
 * `approvedAt`). The page renders one list and one player, so both are
 * normalised here — pure functions, tested without React — and the page never
 * asks which system a row came from except to label it.
 *
 * `source` is the label's key, not a rendering hint: `host` rows link out to
 * the host's episode page, `listen-and-learn` rows link to the certification
 * the episode teaches.
 */
import { resolveMediaUrl } from '@/lib/functionsBase';

export const SOURCE = Object.freeze({
  host: 'host',
  listenAndLearn: 'listen-and-learn',
});

export const SOURCE_LABELS = Object.freeze({
  [SOURCE.host]: 'Podcast feed',
  [SOURCE.listenAndLearn]: 'Listen & Learn',
});

/**
 * Seconds from whatever a feed put in `itunes:duration`: `540`, `"540"`,
 * `"9:00"` or `"1:02:03"`. Null for anything else, so a missing duration is
 * shown as unknown rather than as 0:00.
 *
 * @param {unknown} raw
 * @returns {number|null}
 */
export function parseDurationSeconds(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  const text = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    return n > 0 ? Math.round(n) : null;
  }
  const parts = text.split(':').map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return seconds > 0 ? seconds : null;
}

/** ISO string and locale date for a value that may not parse; both null when it does not. */
function publishedFields(raw) {
  const value = raw?.toDate ? raw.toDate() : raw;
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return { publishedAtISO: null, publishedAtString: null };
  }
  return { publishedAtISO: parsed.toISOString(), publishedAtString: parsed.toLocaleDateString() };
}

/**
 * A `podcasts` row (timers/podcasts.js `buildPodcastEpisode`) as the page's shape.
 *
 * @param {object} doc
 * @returns {object}
 */
export function normalizeHostEpisode(doc) {
  const dates = publishedFields(doc?.publishedAt);
  return {
    id: `host:${doc?.id ?? ''}`,
    source: SOURCE.host,
    sourceLabel: SOURCE_LABELS[SOURCE.host],
    title: doc?.title || '',
    description: doc?.description || '',
    longDescription: doc?.longDescription || '',
    // Host media is an absolute CDN URL and is played as stored; the host
    // answers its own byte ranges.
    mediaUrl: doc?.mediaUrl || null,
    durationSeconds: parseDurationSeconds(doc?.duration),
    image: doc?.image || null,
    link: doc?.link || null,
    ...dates,
  };
}

/** `Listen & Learn · AZ-104`, or the bare label when the row carries no exam. */
function listenAndLearnLabel(examCode) {
  const base = SOURCE_LABELS[SOURCE.listenAndLearn];
  return examCode ? `${base} · ${examCode}` : base;
}

/** `Azure Administrator — Manage identities`, from whichever parts exist. */
function listenAndLearnDescription(doc, examCode) {
  const cert = doc?.certTitle || examCode;
  if (!cert) return '';
  return doc?.areaName ? `${cert} — ${doc.areaName}` : cert;
}

/** The certification page an episode teaches toward, when the row names it. */
function listenAndLearnLink(doc) {
  const provider = String(doc?.provider || '').toLowerCase();
  return provider && doc?.certSlug ? `/${provider}/education/${doc.certSlug}` : null;
}

function positiveSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

/**
 * A `listen_and_learn_episodes` listing row (GET public/listen-and-learn/
 * episodes) as the page's shape.
 *
 * `resolveMediaUrl` is not optional. The API stores audio as the
 * site-relative `/api/public/media/...` path so a topology change cannot
 * invalidate every episode already generated — which means it resolves
 * against the SPA's own origin unless it is rewritten, and a cross-origin
 * deployment would serve index.html to an `<audio>` element.
 *
 * @param {object} doc
 * @returns {object}
 */
export function normalizeListenAndLearnEpisode(doc) {
  const examCode = doc?.examCode ? String(doc.examCode).toUpperCase() : '';
  return {
    id: `listen-and-learn:${doc?.setId ?? ''}/${doc?.id ?? ''}`,
    source: SOURCE.listenAndLearn,
    sourceLabel: listenAndLearnLabel(examCode),
    title: doc?.title || doc?.areaName || '',
    description: doc?.summary || '',
    longDescription: listenAndLearnDescription(doc, examCode),
    mediaUrl: doc?.audioUrl ? resolveMediaUrl(doc.audioUrl) : null,
    durationSeconds: positiveSeconds(doc?.durationSeconds),
    image: null,
    link: listenAndLearnLink(doc),
    ...publishedFields(doc?.approvedAt || doc?.generatedAt),
  };
}

/** Newest first; undated rows last, in their given order. */
export function sortNewestFirst(episodes) {
  const time = (e) => (e.publishedAtISO ? new Date(e.publishedAtISO).getTime() : -Infinity);
  return [...episodes].sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    return ta === tb ? 0 : tb - ta;
  });
}

/**
 * Both sources as one date-sorted list.
 *
 * @param {{host?: object[], listenAndLearn?: object[]}} sources
 * @returns {object[]}
 */
export function mergeAudioEpisodes({ host = [], listenAndLearn = [] } = {}) {
  return sortNewestFirst([
    ...host.map(normalizeHostEpisode),
    ...listenAndLearn.map(normalizeListenAndLearnEpisode),
  ]);
}

/** `9:00` / `1:02:03` for a player's time labels; `—` when unknown. */
export function formatSeconds(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
