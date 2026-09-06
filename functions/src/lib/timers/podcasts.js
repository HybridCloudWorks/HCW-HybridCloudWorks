/**
 * podcasts.js — `fetchPodcastFeeds`, every 2 hours: podcast RSS feeds into
 * `podcasts`, one document per episode, upserted by a normalized id.
 *
 * Ported from Site-Main index.js (088f458). `publishedAt` is an ISO string
 * here (the public list sorts on it — public-reads.js listPodcasts).
 *
 * Which feeds (#348): `admin_config/podcast_feeds`, shape
 * `{ feeds: [{ provider, url }] }`, read on every run so a new host is a
 * document write rather than a deploy. `PODCAST_FEEDS` below is the fallback
 * when the document is absent. It is empty on purpose: the one feed it used
 * to hold, PodBean's, returned HTTP 410 Gone from 2026-09-05 and the timer
 * errored on every firing for as long as the constant named it. The next host
 * (issue #349) is seeded into the document, not written back here.
 */
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';

export const PODCAST_FEEDS = Object.freeze([]);

export const PODCAST_FEEDS_CONFIG_ID = 'podcast_feeds';

/** The production parser, with the podcast custom fields. Lazy so tests never load rss-parser. */
export async function createPodcastParser() {
  const { default: RssParser } = await import('rss-parser');
  return new RssParser({
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 HybridCloudWorks-Bot/1.0' },
    customFields: {
      item: [
        'enclosure',
        ['itunes:duration', 'itunes:duration'],
        ['itunes:image', 'itunes:image'],
        ['media:content', 'media:content'],
      ],
    },
  });
}

/**
 * rss-parser surfaces a non-2xx as `Error("Status code 410")`. 410 is the
 * host saying the feed is gone for good, so retrying it every two hours is
 * not a transient failure to page on — it is configuration that needs a
 * human. The run reports it at Warning (visible, not an Error alert) and
 * moves on. Exported so the test pins the exact shape it matches.
 */
export function isFeedGoneError(err) {
  return /\bStatus code 410\b|^410$/.test(String(err?.message || err).trim());
}

/** A usable feed row: a provider slug and an https URL, nothing else assumed. */
export function isValidFeedEntry(entry) {
  return (
    !!entry &&
    typeof entry.provider === 'string' &&
    /^[a-z0-9-]+$/.test(entry.provider) &&
    typeof entry.url === 'string' &&
    /^https:\/\//.test(entry.url)
  );
}

/**
 * The feed list for this run: `admin_config/podcast_feeds` when it exists and
 * carries a `feeds` array (invalid rows dropped), else `fallback`.
 * Returns `{ feeds, source }` so the summary line can say which one ran.
 */
export async function resolvePodcastFeeds(store, fallback = PODCAST_FEEDS) {
  const doc = await store.readDoc('admin_config', PODCAST_FEEDS_CONFIG_ID, ADMIN_CONFIG_PARTITION);
  if (doc && Array.isArray(doc.feeds)) {
    return {
      feeds: doc.feeds.filter(isValidFeedEntry),
      source: 'admin_config',
    };
  }
  return { feeds: [...fallback], source: 'default' };
}

export function normalizePodcastId(guid, title) {
  return String(guid || title || '')
    .toLowerCase()
    .replace(/https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** `mediaUrl` / `mimeType` / `fileLength` from `enclosure`, then `media:content`. */
export function extractPodcastMediaFields(item) {
  if (item.enclosure && item.enclosure.url) {
    return {
      mediaUrl: item.enclosure.url,
      mimeType: item.enclosure.type || null,
      fileLength: item.enclosure.length || null,
    };
  }
  if (item['media:content']) {
    const mc = item['media:content'];
    return {
      mediaUrl: (mc.$ && mc.$.url) || mc.url || null,
      mimeType: (mc.$ && mc.$.type) || mc.type || null,
      fileLength: (mc.$ && mc.$.fileSize) || mc.fileSize || null,
    };
  }
  return { mediaUrl: null, mimeType: null, fileLength: null };
}

export function extractPodcastImage(item) {
  return (
    (item.itunes && item.itunes.image && item.itunes.image.href) ||
    (item.itunes && typeof item.itunes.image === 'string' && item.itunes.image) ||
    (item.image && item.image.url) ||
    (item['itunes:image'] && item['itunes:image'].href) ||
    null
  );
}

export function parsePodcastPublishedDate(item) {
  const raw = item.isoDate || item.pubDate;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildPodcastEpisode(provider, item, now) {
  const guid = item.guid || item.id || item.link || item.title;
  const publishedAt = parsePodcastPublishedDate(item);
  const { mediaUrl, mimeType, fileLength } = extractPodcastMediaFields(item);
  return {
    id: normalizePodcastId(guid, item.title),
    provider,
    title: item.title || '',
    description: item.contentSnippet || item.summary || '',
    longDescription: item['content:encoded'] || item.content || '',
    mediaUrl,
    mimeType,
    length: fileLength,
    duration: (item.itunes && item.itunes.duration) || item['itunes:duration'] || null,
    image: extractPodcastImage(item),
    link: item.link || null,
    guid: guid || null,
    publishedAt: publishedAt ? publishedAt.toISOString() : null,
    updatedAt: now.toISOString(),
  };
}

/**
 * @param {object} deps
 * @param {{ readDoc: Function, upsertDoc: Function }} deps.store
 * @param {{ parseURL: (url: string) => Promise<{items?: object[]}> }} deps.parser
 * @param {Array<{provider: string, url: string}>} [deps.feeds] Pinned list; when
 *   omitted the run resolves it from `admin_config/podcast_feeds` (see above).
 */
export function createPodcastIngest({ store, parser, feeds, now = () => new Date(), log = {} }) {
  async function processFeed(provider, feedUrl) {
    const feed = await parser.parseURL(feedUrl);
    const results = { processed: 0, errors: [] };
    const items = feed.items || [];
    for (const [index, item] of items.entries()) {
      try {
        const episode = buildPodcastEpisode(provider, item, now());
        const existing = await store.readDoc('podcasts', episode.id, episode.id);
        await store.upsertDoc('podcasts', {
          ...(existing || {}),
          ...episode,
          createdAt: existing?.createdAt || episode.updatedAt,
        });
        results.processed += 1;
      } catch (err) {
        const message = String(err?.message || err);
        // Position, not title, for the same reason as the Warning below: this
        // array is JSON-stringified into the summary line.
        results.errors.push({ position: index + 1, error: message });
        // Warning, not Information: host.json gates `Function` at Warning
        // (#321), so anything logged below this level never reaches the
        // workspace. The witness for this timer is a fresh `updatedAt`; when
        // that is missing, this line is what says the run happened at all.
        // Position, not title: the title is third-party text and the trace
        // stays content-free. The feed itself is named by its provider —
        // one URL per provider in the feed list.
        log.warn?.(
          `[fetchPodcastFeeds] ${provider}: episode ${index + 1} of ${items.length} failed: ${message}`
        );
      }
    }
    if (results.processed === 0 && results.errors.length === 0) {
      log.warn?.(`[fetchPodcastFeeds] ${provider}: feed returned no items`);
    }
    return results;
  }

  async function run() {
    const resolved = feeds ? { feeds, source: 'pinned' } : await resolvePodcastFeeds(store);
    if (resolved.feeds.length === 0) {
      // Warning, so the empty state is distinguishable from a timer that never
      // fired — the same reason the empty-feed case above is a Warning.
      log.warn?.(
        `[fetchPodcastFeeds] no feeds configured (source: ${resolved.source}) — seed admin_config/${PODCAST_FEEDS_CONFIG_ID} as { feeds: [{ provider, url }] }`
      );
      return {};
    }
    const summary = {};
    for (const cfg of resolved.feeds) {
      try {
        summary[cfg.provider] = await processFeed(cfg.provider, cfg.url);
      } catch (err) {
        const message = String(err?.message || err);
        if (isFeedGoneError(err)) {
          summary[cfg.provider] = { processed: 0, skipped: 'gone' };
          log.warn?.(
            `[fetchPodcastFeeds] ${cfg.provider}: feed gone (410) — remove it from admin_config/${PODCAST_FEEDS_CONFIG_ID} or replace the URL`
          );
          continue;
        }
        summary[cfg.provider] = { processed: 0, error: message };
        log.error?.(`[fetchPodcastFeeds] ${cfg.provider}: feed failed: ${message}`);
      }
    }
    log.log?.(`[fetchPodcastFeeds] (${resolved.source}) ${JSON.stringify(summary)}`);
    return summary;
  }
  return { run, processFeed };
}
