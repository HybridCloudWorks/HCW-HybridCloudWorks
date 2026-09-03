/**
 * podcasts.js — `fetchPodcastFeeds`, every 2 hours: PodBean episode feeds
 * into `podcasts`, one document per episode, upserted by a normalized id.
 *
 * Ported from Site-Main index.js (088f458). `publishedAt` is an ISO string
 * here (the public list sorts on it — public-reads.js listPodcasts).
 */

export const PODCAST_FEEDS = Object.freeze([
  { provider: 'azure', url: 'https://feed.podbean.com/PublicCloudWorks/feed.xml' },
]);

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
 */
export function createPodcastIngest({
  store,
  parser,
  feeds = PODCAST_FEEDS,
  now = () => new Date(),
  log = {},
}) {
  async function processFeed(provider, feedUrl) {
    const feed = await parser.parseURL(feedUrl);
    const results = { processed: 0, errors: [] };
    for (const item of feed.items || []) {
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
        results.errors.push({ title: item?.title || null, error: message });
        // Warning, not Information: host.json gates `Function` at Warning
        // (#321), so anything logged below this level never reaches the
        // workspace. The witness for this timer is a fresh `updatedAt`; when
        // that is missing, this line is what says the run happened at all.
        log.warn?.(`[fetchPodcastFeeds] ${provider}: episode ${item?.title || '(untitled)'} failed: ${message}`);
      }
    }
    if (results.processed === 0 && results.errors.length === 0) {
      log.warn?.(`[fetchPodcastFeeds] ${provider}: feed at ${feedUrl} returned no items`);
    }
    return results;
  }

  async function run() {
    const summary = {};
    for (const cfg of feeds) {
      try {
        summary[cfg.provider] = await processFeed(cfg.provider, cfg.url);
      } catch (err) {
        const message = String(err?.message || err);
        summary[cfg.provider] = { processed: 0, error: message };
        log.error?.(`[fetchPodcastFeeds] ${cfg.provider}: feed at ${cfg.url} failed: ${message}`);
      }
    }
    log.log?.(`[fetchPodcastFeeds] ${JSON.stringify(summary)}`);
    return summary;
  }
  return { run, processFeed };
}
