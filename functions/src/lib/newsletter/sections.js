/**
 * sections.js — what goes in a weekly issue, one registered section at a time
 * (ADR 0030 §2a).
 *
 * ## Adding a section
 *
 * Write one entry and put it in SECTIONS. Nothing else changes: the builder
 * collects every registered section, drops the empty ones, and the renderer
 * lays out whatever items come back. An entry is:
 *
 *   {
 *     id:      stable key, stored on the issue ('articles')
 *     title:   the heading readers see ('New on HybridCloudWorks')
 *     collect: async ({ store, since, until }) => Item[]
 *   }
 *
 * and an Item is `{ title, url, summary?, label? }` — plain text only. The
 * renderer escapes every field, so a section cannot put markup into the email,
 * and `url` must be absolute https or the item is dropped rather than rendered
 * as a link that goes nowhere.
 *
 * Every collector reads only what the public site already shows: published
 * articles, approved episodes, Microsoft's public feed. A newsletter is a
 * public surface, and nothing reaches it that the site itself would not render.
 */
import { publicUrlOf } from '../cms/publish.js';

export const SITE_ORIGIN = 'https://hybridcloudworks.com';

/** Most items any one section may carry; the rest are a link to the site. */
export const MAX_ITEMS_PER_SECTION = 12;

const MAX_SUMMARY_LENGTH = 280;

/** Trim, collapse whitespace, cap. Never returns markup — callers escape. */
export function plainText(value, max = MAX_SUMMARY_LENGTH) {
  const text = String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** An absolute https URL, or a site path made absolute; anything else is null. */
export function absoluteUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('/') && !raw.startsWith('//')) return `${SITE_ORIGIN}${raw}`;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Providers whose certifications have their own detail pages (App.jsx). */
const CERT_DETAIL_PROVIDERS = new Set(['aws', 'azure']);

const CERT_EVENT_LABELS = Object.freeze({
  ga_launch: 'Now available',
  beta_launch: 'Beta',
  retirement: 'Retiring',
  update: 'Updated',
});

export const articlesSection = Object.freeze({
  id: 'articles',
  title: 'New on HybridCloudWorks',
  async collect({ store, since, until }) {
    const rows = await store.queryDocs(
      'content',
      `SELECT TOP 50 c.Title, c.title, c.Summary, c.summary, c["Cloud Provider"], c.cloudProvider,
              c.publishedAt, c.publishedUrl, c.publicUrl, c.curatedSubpagePath, c.slugPageUrl
         FROM c WHERE c.Live = true AND c.publishedAt >= @since AND c.publishedAt < @until
         ORDER BY c.publishedAt DESC`,
      [
        { name: '@since', value: since.toISOString() },
        { name: '@until', value: until.toISOString() },
      ]
    );
    return (rows || [])
      .map((row) => ({
        title: plainText(row.Title || row.title, 160),
        summary: plainText(row.Summary || row.summary),
        // The URL publishing stored, never a guess: an article whose URL was
        // never recorded is left out rather than linked somewhere it is not.
        url: absoluteUrl(publicUrlOf(row)),
        label: plainText(row['Cloud Provider'] || row.cloudProvider, 40),
      }))
      .filter((item) => item.title && item.url);
  },
});

export const certificationNewsSection = Object.freeze({
  id: 'certification-news',
  title: 'Certification news',
  async collect({ store, since, until }) {
    const rows = await store.queryDocs(
      'certEvents',
      `SELECT TOP 50 c.type, c.certCodes, c.title, c.summary, c.link, c.pubDate, c.softDeletedAt
         FROM c WHERE c.pubDate >= @since AND c.pubDate < @until ORDER BY c.pubDate DESC`,
      [
        { name: '@since', value: since.toISOString() },
        { name: '@until', value: until.toISOString() },
      ]
    );
    return (rows || [])
      .filter((row) => !row.softDeletedAt)
      .map((row) => {
        const codes = Array.isArray(row.certCodes) ? row.certCodes.filter((c) => typeof c === 'string') : [];
        const kind = CERT_EVENT_LABELS[row.type] ?? 'News';
        return {
          title: plainText(row.title, 160),
          summary: plainText(row.summary),
          url: absoluteUrl(row.link),
          label: plainText([kind, codes.join(', ')].filter(Boolean).join(' · '), 80),
        };
      })
      .filter((item) => item.title && item.url);
  },
});

export const episodesSection = Object.freeze({
  id: 'episodes',
  title: 'Listen & learn',
  async collect({ store, since, until }) {
    const params = [
      { name: '@since', value: since.toISOString() },
      { name: '@until', value: until.toISOString() },
    ];
    const [episodes, podcasts] = await Promise.all([
      store.queryDocs(
        'listen_and_learn_episodes',
        `SELECT TOP 50 c.setId, c.provider, c.title, c.summary, c.approvedAt, c.audioUrl
           FROM c WHERE c.status = 'published' AND c.approvedAt >= @since AND c.approvedAt < @until
           ORDER BY c.approvedAt DESC`,
        params
      ),
      store.queryDocs(
        'podcasts',
        `SELECT TOP 50 c.provider, c.title, c.description, c.link, c.publishedAt, c.softDeletedAt, c.mediaUnavailableAt
           FROM c WHERE c.publishedAt >= @since AND c.publishedAt < @until ORDER BY c.publishedAt DESC`,
        params
      ),
    ]);

    // One read per certification, not per episode: a set usually publishes
    // several episodes at once.
    const setIds = [...new Set((episodes || []).map((e) => e.setId).filter(Boolean))];
    const sets = new Map(
      await Promise.all(
        setIds.map(async (id) => [id, await store.readDoc('listen_and_learn', id, id).catch(() => null)])
      )
    );

    const study = (episodes || [])
      .filter((episode) => episode.audioUrl)
      .map((episode) => {
        const provider = String(episode.provider || '').toLowerCase();
        const set = sets.get(episode.setId);
        const path =
          CERT_DETAIL_PROVIDERS.has(provider) && set?.certSlug
            ? `/${provider}/education/${set.certSlug}`
            : `/${provider}/education`;
        return {
          title: plainText(episode.title, 160),
          summary: plainText(episode.summary),
          url: provider ? absoluteUrl(path) : null,
          label: plainText(set?.certTitle ? `Study episode · ${set.certTitle}` : 'Study episode', 80),
        };
      });

    const shows = (podcasts || [])
      .filter((row) => !row.softDeletedAt && !row.mediaUnavailableAt)
      .map((row) => {
        const provider = String(row.provider || '').toLowerCase();
        const page = provider && provider !== 'main' ? `/${provider}/audio` : '/azure/audio';
        return {
          title: plainText(row.title, 160),
          summary: plainText(row.description),
          url: absoluteUrl(row.link) ?? absoluteUrl(page),
          label: 'Podcast',
        };
      });

    return [...shows, ...study].filter((item) => item.title && item.url);
  },
});

/** The registry, in the order sections appear in the email. */
export const SECTIONS = Object.freeze([articlesSection, certificationNewsSection, episodesSection]);

/**
 * Collect every registered section for the window. A section that throws is
 * reported and left out rather than sinking the issue: one unreadable
 * container should cost a heading, not the week's newsletter.
 */
export async function collectSections({ store, since, until, sections = SECTIONS, log }) {
  const out = [];
  const problems = [];
  for (const section of sections) {
    try {
      const items = (await section.collect({ store, since, until })).slice(0, MAX_ITEMS_PER_SECTION);
      if (items.length > 0) out.push({ id: section.id, title: section.title, items });
    } catch (error) {
      problems.push(`${section.id}: ${error?.message ?? error}`);
      log?.warn?.(`[newsletter] section ${section.id} failed: ${error?.message ?? error}`);
    }
  }
  return { sections: out, problems };
}
