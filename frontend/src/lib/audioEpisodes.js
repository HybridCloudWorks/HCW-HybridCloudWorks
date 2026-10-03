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
 *
 * A third source arrived with the site's own show: `podcasts` rows the ingest
 * filed under the reserved provider `main` are the site's show rather than any
 * provider's, `GET public/podcasts` returns them to every provider, and
 * `mergeAudioEpisodes` puts them at the head of the list so the page leads
 * with them. They are `podcasts` rows in every other respect, which is why
 * `normalizeHostEpisode` reads both and only the label differs.
 */
import { resolveMediaUrl } from '@/lib/functionsBase';

/**
 * The `provider` the API files the site's show under. A copy of
 * `MAIN_FEED_PROVIDER` in functions/src/lib/timers/podcasts.js — the browser
 * cannot import from the Functions app, and the value travels between them on
 * every episode row.
 */
export const MAIN_FEED_PROVIDER = 'main';

export const SOURCE = Object.freeze({
  main: 'main',
  host: 'host',
  listenAndLearn: 'listen-and-learn',
});

export const SOURCE_LABELS = Object.freeze({
  [SOURCE.main]: 'The show',
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

/**
 * Plain text from a feed's HTML description. Tag removal repeats until
 * stable: a single pass leaves residues for overlapping constructs like
 * `<scr<script>ipt>`. Host feeds wrap descriptions in `<p>`, and both the
 * list row and the player render them as text.
 */
export function stripHtml(html) {
  if (!html) return '';
  let prev;
  let out = String(html);
  do {
    prev = out;
    out = out.replace(/<[^>]*>/g, '');
  } while (out !== prev);
  return out.trim();
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
 * A `podcasts` row (timers/podcasts.js `buildPodcastEpisode`) as the page's
 * shape, from either feed.
 *
 * The row's own `provider` decides which: `main` is the site's show, anything
 * else is that provider's feed. The id keeps the `host:` prefix for both,
 * because it exists to keep the two CONTAINERS' ids apart — a `podcasts` id
 * and a `listen_and_learn_episodes` id can collide, two `podcasts` ids cannot
 * — and re-prefixing by source would change the id of every episode already
 * rendered for no gain.
 *
 * @param {object} doc
 * @returns {object}
 */
export function normalizeHostEpisode(doc) {
  const dates = publishedFields(doc?.publishedAt);
  const source = doc?.provider === MAIN_FEED_PROVIDER ? SOURCE.main : SOURCE.host;
  return {
    id: `host:${doc?.id ?? ''}`,
    source,
    sourceLabel: SOURCE_LABELS[source],
    title: doc?.title || '',
    description: stripHtml(doc?.description),
    longDescription: stripHtml(doc?.longDescription),
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
 * Every source as one list: the site's show first, then everything else,
 * each group newest first.
 *
 * The show leads rather than taking its place in the dates, and that is the
 * owner's decision, not a tidiness one — it is the site's own programme and
 * the reason a provider with no feed of its own has an audio page worth
 * visiting at all. The page renders `visible[0]` in the player, so leading the
 * list is also what puts the newest episode of the show under the play button
 * on every provider page.
 *
 * Within each group the order is unchanged, so a provider's own episodes still
 * read newest first below the show.
 *
 * @param {{host?: object[], listenAndLearn?: object[]}} sources
 * @returns {object[]}
 */
export function mergeAudioEpisodes({ host = [], listenAndLearn = [] } = {}) {
  const all = [
    ...host.map(normalizeHostEpisode),
    ...listenAndLearn.map(normalizeListenAndLearnEpisode),
  ];
  const isMain = (episode) => episode.source === SOURCE.main;
  return [
    ...sortNewestFirst(all.filter(isMain)),
    ...sortNewestFirst(all.filter((e) => !isMain(e))),
  ];
}

// ── playback position (ADR 0033 §4) ─────────────────────────────────────────
//
// Where a listener left off in a chapter, remembered per chapter in this
// browser only. A convenience, never a requirement: every read and write is
// wrapped so a private window, blocked storage or a pre-render context
// behaves exactly as if nothing had been remembered.

const POSITION_PREFIX = 'hcw:audio-position:';

/** How close to the end still counts as "finished", so it restarts from 0. */
const FINISHED_WITHIN_SECONDS = 5;

/** The storage key for one episode: its list id, which is unique across sources. */
export function playbackPositionKey(episodeId) {
  const id = String(episodeId || '').trim();
  return id ? `${POSITION_PREFIX}${id}` : '';
}

/**
 * The remembered position in seconds, or 0 when none, when it was finished,
 * or when storage cannot be read.
 *
 * @param {string} episodeId
 * @param {Storage} [storage]
 */
export function readPlaybackPosition(episodeId, storage) {
  const key = playbackPositionKey(episodeId);
  if (!key) return 0;
  try {
    const store = storage || globalThis.localStorage;
    const raw = store?.getItem(key);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    const seconds = Number(parsed?.t);
    const duration = Number(parsed?.d);
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    if (
      Number.isFinite(duration) &&
      duration > 0 &&
      duration - seconds <= FINISHED_WITHIN_SECONDS
    ) {
      return 0;
    }
    return seconds;
  } catch {
    return 0;
  }
}

/**
 * Remember a position. A position at or near the end clears the entry so the
 * next visit starts from the top. Never throws.
 *
 * @param {string} episodeId
 * @param {number} seconds
 * @param {number|null} [duration]
 * @param {Storage} [storage]
 */
export function savePlaybackPosition(episodeId, seconds, duration = null, storage) {
  const key = playbackPositionKey(episodeId);
  if (!key) return;
  try {
    const store = storage || globalThis.localStorage;
    if (!store) return;
    const t = Number(seconds);
    const d = Number(duration);
    const finished = Number.isFinite(d) && d > 0 && d - t <= FINISHED_WITHIN_SECONDS;
    if (!Number.isFinite(t) || t <= 0 || finished) {
      store.removeItem(key);
      return;
    }
    store.setItem(
      key,
      JSON.stringify({
        t: Math.floor(t),
        ...(Number.isFinite(d) && d > 0 ? { d: Math.floor(d) } : {}),
      })
    );
  } catch {
    // remembering is a convenience, never a requirement
  }
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
