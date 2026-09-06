import { describe, it, expect, vi } from 'vitest';
import {
  createPublerClient,
  createPublerReconcile,
  buildSocialPostSyncPatch,
  publerStateToSocialStatus,
  normalizePublerPost,
} from './publer-sync.js';
import {
  createBlogListingsScrape,
  scrapeListingPage,
  buildListingContentDoc,
  resolveArticleUrl,
} from './blog-listings.js';
import {
  createPodcastIngest,
  buildPodcastEpisode,
  normalizePodcastId,
  resolvePodcastFeeds,
  dedupeFeedsByProvider,
  isFeedGoneError,
  PODCAST_FEEDS,
} from './podcasts.js';

const NOW = new Date('2026-08-21T12:00:00.000Z');
const now = () => NOW;

function memStore(containers = {}, match = () => []) {
  const data = Object.fromEntries(
    Object.entries(containers).map(([k, v]) => [k, new Map(v.map((d) => [d.id, d]))])
  );
  const get = (c) => (data[c] ||= new Map());
  return {
    data,
    readDoc: vi.fn(async (c, id) => get(c).get(id) || null),
    upsertDoc: vi.fn(async (c, doc) => {
      get(c).set(doc.id, doc);
      return doc;
    }),
    patchDoc: vi.fn(async (c, id, u) => {
      const next = { ...(get(c).get(id) || { id }), ...u };
      get(c).set(id, next);
      return next;
    }),
    queryDocs: vi.fn(async (c, q, p) => match(c, q, p, [...get(c).values()])),
  };
}

describe('Publer reconcile', () => {
  const publer = (over) => ({
    id: 'p1',
    state: 'scheduled',
    text: 'hi',
    scheduled_at: '2026-08-22T10:00:00Z',
    account_id: 'acc',
    network: 'linkedin',
    job_id: 'job1',
    ...over,
  });

  it('normalizes posts, maps states, and builds the sync patch with aggregate status', () => {
    expect(
      normalizePublerPost({
        post_id: '9',
        status: 'Published',
        caption: 'c',
        scheduledAt: 'bad',
      })
    ).toMatchObject({
      id: '9',
      state: 'published',
      text: 'c',
      scheduledAt: null,
    });
    expect(publerStateToSocialStatus('failed_x')).toBe('failed');
    expect(publerStateToSocialStatus('')).toBe('unknown');
    const patch = buildSocialPostSyncPatch(
      publer({ state: 'published' }),
      { publerPostIds: ['p0'] },
      [publer({ state: 'published' }), publer({ id: 'p2', state: 'scheduled' })],
      NOW.toISOString()
    );
    expect(patch).toMatchObject({
      publerStatus: 'mixed',
      publerActivePostIds: ['p1', 'p2'],
      publerScheduledAt: '2026-08-22T10:00:00.000Z',
      publerPostIds: ['p0', 'p1'],
      publerJobId: 'job1',
      status: 'scheduled',
      syncStatus: 'synced',
      lastSyncedAt: NOW.toISOString(),
      syncError: null,
    });
  });

  it('skips when not configured; ignores Key Vault literals', async () => {
    const client = createPublerClient({
      env: {
        PUBLER_API_KEY: '@Microsoft.KeyVault(SecretUri=x)',
        PUBLER_WORKSPACE_ID: 'w',
      },
      fetch: vi.fn(),
    });
    expect(client.configured).toBe(false);
    expect(await createPublerReconcile({ store: memStore(), client, now }).run()).toMatchObject({
      skipped: true,
      reason: 'not_configured',
    });
  });

  it('pages Publer per state, updates matches, marks vanished posts deleted, creates unlinked ones', async () => {
    const fetch = vi.fn(async (url) => {
      const state = new URL(url).searchParams.get('state');
      const page = Number(new URL(url).searchParams.get('page'));
      const posts =
        state === 'scheduled'
          ? page === 0
            ? [publer()]
            : [publer({ id: 'p2', job_id: null })]
          : state === 'published'
            ? [publer({ id: 'p3', state: 'published', job_id: 'job3' })]
            : [];
      return {
        ok: true,
        json: async () => ({
          posts,
          total_pages: state === 'scheduled' ? 2 : 1,
        }),
      };
    });
    const client = createPublerClient({
      env: { PUBLER_API_KEY: 'k', PUBLER_WORKSPACE_ID: 'w' },
      fetch,
    });
    expect(fetch).not.toHaveBeenCalled();
    const store = memStore(
      {
        social_posts: [
          { id: 's1', publerPostIds: ['p1'], status: 'draft' },
          { id: 's2', publerJobId: 'job3', status: 'scheduled' },
          { id: 's3', publerPostIds: ['gone'], status: 'scheduled' },
          {
            id: 's4',
            publerPostIds: ['gone2'],
            status: 'scheduled',
            syncOrigin: 'publer',
          },
        ],
      },
      (c, q, p, rows) => rows
    );
    const r = await createPublerReconcile({ store, client, now }).run();
    expect(r).toEqual({ skipped: false, fetched: 3, updated: 3, created: 1 });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      `${'https://app.publer.com/api/v1'}/posts?state=scheduled&per_page=100&page=0`,
      `${'https://app.publer.com/api/v1'}/posts?state=scheduled&per_page=100&page=1`,
      `${'https://app.publer.com/api/v1'}/posts?state=published&per_page=100&page=0`,
      `${'https://app.publer.com/api/v1'}/posts?state=failed&per_page=100&page=0`,
    ]);
    expect(fetch.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer-API k',
      'Publer-Workspace-Id': 'w',
    });
    expect(store.data.social_posts.get('s1')).toMatchObject({
      status: 'scheduled',
      publerStatus: 'scheduled',
      syncOrigin: 'publer',
    });
    expect(store.data.social_posts.get('s2')).toMatchObject({
      status: 'published',
      publerPostIds: ['p3'],
    });
    expect(store.data.social_posts.get('s3')).toMatchObject({
      status: 'deleted',
      publerStatus: 'deleted',
    });
    expect(store.data.social_posts.get('s4').status).toBe('scheduled'); // Publer-origin posts are not re-deleted
    expect(store.data.social_posts.get('publer_p2')).toMatchObject({
      caption: 'hi',
      platforms: ['linkedin'],
      accountIds: ['acc'],
      status: 'scheduled',
      unlinkedFromCalendar: true,
      source: 'publer',
      createdAt: NOW.toISOString(),
    });
  });
});

describe('blog listings (Firecrawl)', () => {
  it('calls the v1 scrape endpoint with the schema and resolves relative URLs', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          extract: {
            articles: [
              { url: '/blog/a', title: 'A' },
              { url: 'https://x/b', title: 'B' },
            ],
          },
        },
      }),
    }));
    const articles = await scrapeListingPage(
      { apiKey: 'fc', fetch },
      'https://aws.amazon.com/blogs/'
    );
    expect(articles).toEqual([
      { url: 'https://aws.amazon.com/blog/a', title: 'A' },
      { url: 'https://x/b', title: 'B' },
    ]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.firecrawl.dev/v1/scrape');
    expect(init.headers.Authorization).toBe('Bearer fc');
    expect(JSON.parse(init.body)).toMatchObject({
      url: 'https://aws.amazon.com/blogs/',
      formats: ['extract'],
    });
    expect(resolveArticleUrl('x/y', 'https://h.test/l/')).toBe('https://h.test/x/y');
    const failing = vi.fn(async () => ({
      ok: false,
      status: 402,
      json: async () => ({ error: 'quota' }),
    }));
    await expect(scrapeListingPage({ apiKey: 'fc', fetch: failing }, 'https://s')).rejects.toThrow(
      'Firecrawl scrape failed for https://s: quota'
    );
  });

  it('writes the RSS content shape with source firecrawl, dedups, skips when unconfigured, isolates source failures', async () => {
    const doc = buildListingContentDoc({
      article: {
        url: 'https://x/a',
        title: 'T',
        description: 'd',
        publishedAt: '2026-08-01',
        author: 'Au',
        imageUrl: 'https://i',
      },
      source: {
        provider: 'aws',
        name: 'AWS Blogs Index',
        url: 'https://aws.amazon.com/blogs/',
      },
      dedupFields: { urlKey: 'k' },
      now: NOW,
      uuid: () => 'u1',
    });
    expect(doc).toMatchObject({
      id: 'u1',
      urlKey: 'k',
      Title: 'T',
      'Cloud Provider': 'Aws',
      Author: 'Au',
      'CD Url': 'https://x/a',
      'Published At': '2026-08-01T00:00:00.000Z',
      source: 'firecrawl',
      sourceFeed: 'https://aws.amazon.com/blogs/',
      contentStatus: 'ingested',
      inspectTrigger: true,
      contentImageUrl: 'https://i',
      readTime: '3 min',
    });

    const store = memStore();
    const dedup = {
      findDuplicateContent: vi.fn(async (_s, { url }) => ({
        duplicate: url.endsWith('/dup'),
      })),
      buildDedupFields: vi.fn(() => ({ urlKey: 'k' })),
    };
    const fetch = vi.fn(async (_u, init) => {
      const { url } = JSON.parse(init.body);
      if (url.includes('broken')) return { ok: false, status: 500, json: async () => ({}) };
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            extract: {
              articles: [
                { url: 'https://x/new', title: 'N' },
                { url: 'https://x/dup', title: 'D' },
                { url: 'javascript:void', title: 'bad' },
              ],
            },
          },
        }),
      };
    });
    const sources = [
      { provider: 'aws', name: 'ok', url: 'https://ok/' },
      { provider: 'gcp', name: 'broken', url: 'https://broken/' },
    ];
    const r = await createBlogListingsScrape({
      store,
      dedup,
      fetch,
      env: { FIRECRAWL_API_KEY: 'fc' },
      sources,
      now,
      uuid: () => 'u2',
    }).run();
    expect(r).toEqual({
      skipped: false,
      scraped: 1,
      newArticles: 1,
      errors: 1,
      failures: [
        {
          source: 'broken',
          error: 'Firecrawl scrape failed for https://broken/: HTTP 500',
        },
      ],
    });
    expect(store.upsertDoc).toHaveBeenCalledTimes(1);
    expect(dedup.findDuplicateContent.mock.calls[0][1]).toMatchObject({
      url: 'https://x/new',
      title: 'N',
      publishedMs: NOW.getTime(),
    });
    expect(
      await createBlogListingsScrape({
        store,
        dedup,
        fetch,
        env: {},
        sources,
        now,
      }).run()
    ).toMatchObject({ skipped: true, reason: 'not_configured' });
  });
});

describe('podcasts', () => {
  // Pinned so these cases test ingestion, not feed resolution (below).
  const feeds = [{ provider: 'azure', url: 'https://feeds.example.test/hcw.xml' }];
  it('builds episodes from enclosure or media:content, keeps createdAt across upserts, isolates item errors', async () => {
    expect(normalizePodcastId('https://podbean.com/e/Ep-1!', 't')).toBe('podbean-com-e-ep-1');
    const item = {
      guid: 'g1',
      title: 'Ep 1',
      contentSnippet: 's',
      'content:encoded': '<p>long</p>',
      enclosure: { url: 'https://m/1.mp3', type: 'audio/mpeg', length: '123' },
      itunes: { duration: '10:00', image: { href: 'https://img' } },
      link: 'https://l',
      isoDate: '2026-08-20T00:00:00.000Z',
    };
    const ep = buildPodcastEpisode('azure', item, NOW);
    expect(ep).toEqual({
      id: 'g1',
      provider: 'azure',
      title: 'Ep 1',
      description: 's',
      longDescription: '<p>long</p>',
      mediaUrl: 'https://m/1.mp3',
      mimeType: 'audio/mpeg',
      length: '123',
      duration: '10:00',
      image: 'https://img',
      link: 'https://l',
      guid: 'g1',
      publishedAt: '2026-08-20T00:00:00.000Z',
      updatedAt: NOW.toISOString(),
    });
    const mc = buildPodcastEpisode(
      'azure',
      {
        guid: 'g2',
        title: 'Ep 2',
        'media:content': {
          $: { url: 'https://m/2.mp3', type: 'audio/mpeg', fileSize: '9' },
        },
        pubDate: 'nope',
      },
      NOW
    );
    expect(mc).toMatchObject({
      mediaUrl: 'https://m/2.mp3',
      length: '9',
      publishedAt: null,
      image: null,
    });

    const store = memStore({
      podcasts: [{ id: 'g1', createdAt: '2026-01-01T00:00:00.000Z', title: 'old' }],
    });
    const parser = {
      parseURL: vi.fn(async () => ({
        items: [item, { guid: 'g2', title: 'Ep 2' }, null],
      })),
    };
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const r = await createPodcastIngest({
      store,
      parser,
      feeds,
      now,
      log,
    }).run();
    expect(r.azure.processed).toBe(2);
    expect(r.azure.errors).toEqual([{ position: 3, error: expect.any(String) }]);
    // The one bad episode must reach the workspace at Warning, because
    // host.json gates `Function` at Warning (#321) and the Information summary
    // below it does not.
    expect(log.warn).toHaveBeenCalledTimes(1);
    // Position in the feed, never the title: the trace stays content-free.
    expect(log.warn.mock.calls[0][0]).toMatch(
      /^\[fetchPodcastFeeds\] azure: episode 3 of 3 failed:/
    );
    expect(log.warn.mock.calls[0][0]).not.toContain('Ep ');
    expect(log.error).not.toHaveBeenCalled();
    expect(store.data.podcasts.get('g1')).toMatchObject({
      title: 'Ep 1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(store.data.podcasts.get('g2').createdAt).toBe(NOW.toISOString());
    const broken = {
      parseURL: vi.fn(async () => {
        throw new Error('504');
      }),
    };
    const brokenLog = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(
      await createPodcastIngest({
        store,
        parser: broken,
        feeds,
        now,
        log: brokenLog,
      }).run()
    ).toEqual({
      azure: { processed: 0, error: '504' },
    });
    expect(brokenLog.error).toHaveBeenCalledTimes(1);
    // Provider, never the URL: the feed list names the feed from the provider.
    expect(brokenLog.error.mock.calls[0][0]).toBe('[fetchPodcastFeeds] azure: feed failed: 504');
  });

  it('fetchPodcastFeeds says so at Warning when the feed is reachable but empty', async () => {
    // The third silent state: no throw, no episode, no write. Without this
    // line an empty feed and a timer that never fired look identical to the
    // updatedAt witness.
    const store = memStore({ podcasts: [] });
    const parser = { parseURL: vi.fn(async () => ({ items: [] })) };
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const r = await createPodcastIngest({
      store,
      parser,
      feeds,
      now,
      log,
    }).run();
    expect(r).toEqual({ azure: { processed: 0, errors: [] } });
    expect(log.warn).toHaveBeenCalledWith('[fetchPodcastFeeds] azure: feed returned no items');
    expect(log.error).not.toHaveBeenCalled();
  });

  it('treats HTTP 410 as the feed being gone: Warning, skipped, no Error (#348)', async () => {
    // PodBean's feed returned 410 from 2026-09-05 and the timer logged an
    // Error every two hours. Gone is configuration, not an outage.
    expect(isFeedGoneError(new Error('Status code 410'))).toBe(true);
    expect(isFeedGoneError(new Error('Status code 504'))).toBe(false);
    expect(isFeedGoneError(new Error('410 Gone but phrased differently'))).toBe(false);
    const store = memStore({ podcasts: [] });
    const parser = {
      parseURL: vi.fn(async () => {
        throw new Error('Status code 410');
      }),
    };
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const r = await createPodcastIngest({
      store,
      parser,
      feeds,
      now,
      log,
    }).run();
    expect(r).toEqual({ azure: { processed: 0, skipped: 'gone' } });
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatch(
      /^\[fetchPodcastFeeds\] azure: feed gone \(410\) — remove it from admin_config\/podcast_feeds/
    );
    expect(log.warn.mock.calls[0][0]).not.toContain('https://');
  });

  it('reads the feed list from admin_config/podcast_feeds, dropping rows it cannot use', async () => {
    const store = memStore({
      admin_config: [
        {
          id: 'podcast_feeds',
          configScope: 'admin_config',
          feeds: [
            { provider: 'azure', url: 'https://media.rss.com/hcw/feed.xml' },
            { provider: 'azure', url: 'https://second.example/feed.xml' },
            { provider: 'aws', url: 'http://insecure.example/feed.xml' },
            { provider: 'Bad Slug', url: 'https://x.example/feed.xml' },
            { url: 'https://no-provider.example/feed.xml' },
            null,
          ],
        },
      ],
    });
    // The duplicate azure row is dropped: the summary is keyed by provider, so
    // two rows would fetch twice and report once.
    expect(await resolvePodcastFeeds(store)).toEqual({
      feeds: [{ provider: 'azure', url: 'https://media.rss.com/hcw/feed.xml' }],
      source: 'admin_config',
    });
    expect(
      dedupeFeedsByProvider([
        { provider: 'a', url: 'https://1' },
        { provider: 'b', url: 'https://2' },
        { provider: 'a', url: 'https://3' },
      ])
    ).toEqual([
      { provider: 'a', url: 'https://1' },
      { provider: 'b', url: 'https://2' },
    ]);
    expect(store.readDoc).toHaveBeenCalledWith('admin_config', 'podcast_feeds', 'admin_config');
    // The run uses what the document says, not the constant.
    const parser = {
      parseURL: vi.fn(async () => ({ items: [{ guid: 'g1', title: 'Ep 1' }] })),
    };
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const r = await createPodcastIngest({ store, parser, now, log }).run();
    expect(parser.parseURL).toHaveBeenCalledWith('https://media.rss.com/hcw/feed.xml');
    expect(r).toEqual({ azure: { processed: 1, errors: [] } });
    expect(log.log.mock.calls[0][0]).toMatch(/^\[fetchPodcastFeeds\] \(admin_config\) /);
  });

  it('with no document and an empty default, says so at Warning and writes nothing', async () => {
    // The default is empty on purpose: the dead PodBean feed must not come
    // back as a fallback. Silence here would be indistinguishable from a
    // timer that never fired.
    expect(PODCAST_FEEDS).toEqual([]);
    const store = memStore({ podcasts: [] });
    const parser = { parseURL: vi.fn() };
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(await resolvePodcastFeeds(store)).toEqual({
      feeds: [],
      source: 'default',
    });
    const r = await createPodcastIngest({ store, parser, now, log }).run();
    expect(r).toEqual({});
    expect(parser.parseURL).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      '[fetchPodcastFeeds] no feeds configured (source: default) — seed admin_config/podcast_feeds as { feeds: [{ provider, url }] }'
    );
    expect(log.error).not.toHaveBeenCalled();
  });
});
