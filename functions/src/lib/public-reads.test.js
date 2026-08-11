/**
 * Public read endpoints — semantics pinned to the frontend consumers they
 * replace (useCoderCornerData, detail templates, usePodcastData, useNewsData,
 * AboutPage/_snapshots). The load-bearing assertions are the negative ones:
 * a draft, soft-deleted, or internal-field leak here is an anonymous data
 * exposure, because Firestore rules no longer stand in front of these reads.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createPublicReadHandlers,
  PUBLIC_CONTENT_LIST_FIELDS,
  isSoftDeleted,
  isPublicDocument,
  resolvePublishedDateValue,
  stripInternalFields,
} from './public-reads.js';

const context = { log: vi.fn(), error: vi.fn() };

const makeRequest = ({ query = {}, params = {} } = {}) => ({
  method: 'GET',
  query: { get: (k) => query[k] ?? null },
  params,
});

const publicDoc = (over = {}) => ({
  id: 'p1',
  Title: 'Public',
  Live: true,
  slug: 'public-1',
  publishedAt: '2026-01-15T00:00:00Z',
  ...over,
});

describe('isPublicDocument', () => {
  it('admits Live, Status=Live, and every published-status spelling', () => {
    expect(isPublicDocument({ Live: true })).toBe(true);
    expect(isPublicDocument({ Status: 'Live' })).toBe(true);
    expect(isPublicDocument({ contentStatus: 'published' })).toBe(true); // new state machine
    expect(isPublicDocument({ contentStatus: 'published_blog' })).toBe(true); // frontend legacy
  });

  it('rejects drafts and anything soft-deleted, even if Live', () => {
    expect(isPublicDocument({ contentStatus: 'draft' })).toBe(false);
    expect(isPublicDocument({ contentStatus: 'in_review' })).toBe(false);
    expect(isPublicDocument({ Live: true, softDeletedAt: '2026-01-01' })).toBe(false);
    expect(isPublicDocument({ Live: true, softDeleteExpiresAt: '2026-01-01' })).toBe(false);
    expect(isPublicDocument({})).toBe(false);
    expect(isPublicDocument(null)).toBe(false);
  });
});

describe('resolvePublishedDateValue', () => {
  it('honors the alias priority and tolerates garbage', () => {
    expect(
      resolvePublishedDateValue({ publishedAt: '2026-03-01', publishedDate: '2026-02-01' })
    ).toBe(new Date('2026-02-01').getTime());
    expect(resolvePublishedDateValue({ publishedAt: 'junk' })).toBe(0);
    expect(resolvePublishedDateValue({})).toBe(0);
  });
});

describe('stripInternalFields', () => {
  it('removes review/audit fields and Cosmos system properties', () => {
    const out = stripInternalFields({
      id: 'x',
      Title: 'T',
      reviewNotes: 'secret',
      contentQuality: { score: 1 },
      createdBy: 'someone@x',
      _rid: 'abc',
      _ts: 123,
    });
    expect(out).toEqual({ id: 'x', Title: 'T' });
  });
});

describe('listContent', () => {
  /** Capture the SQL listContent issues, alongside a benign row. */
  const captureQuery = async (request = makeRequest()) => {
    const store = { queryDocs: vi.fn(async () => [publicDoc()]), readDoc: vi.fn() };
    const h = createPublicReadHandlers({ store });
    await h.listContent(request, context);
    const [, query, parameters] =
      store.queryDocs.mock.calls[0].length === 3
        ? store.queryDocs.mock.calls[0]
        : [null, store.queryDocs.mock.calls[0][1], store.queryDocs.mock.calls[0][2]];
    return { query, parameters };
  };

  describe('the window counts published documents, not all documents (T-206)', () => {
    it('filters public status and soft-deletion in SQL, before TOP applies', async () => {
      // The defect: `SELECT TOP 1000 *` with no WHERE returned an ARBITRARY
      // 1000 of a ~1k-document container, so published articles vanished
      // non-deterministically once the count crossed the window. The filter
      // must narrow the window server-side.
      const { query } = await captureQuery();
      expect(query).toMatch(/^SELECT TOP 1000 /);
      expect(query).toContain('c.Live = true');
      expect(query).toContain('c.Status = "Live"');
      expect(query).toContain(
        'c.contentStatus IN ("published", "published_blog", "published_news", "published_both")'
      );
      expect(query).toContain('softDeletedAt');
      expect(query).toContain('softDeleteExpiresAt');
    });

    it('errs WIDE where SQL and JS truthiness could disagree', async () => {
      // A soft-delete marker holding '', false or 0 is NOT deleted to
      // isSoftDeleted (JS truthiness). The SQL must admit those rows and let
      // the JS filter decide — erring narrow would drop a published article,
      // which is the finding's defect reintroduced through its own fix.
      const { query } = await captureQuery();
      expect(query).toContain('c.softDeletedAt = ""');
      expect(query).toContain('c.softDeletedAt = false');
      expect(query).toContain('c.softDeletedAt = 0');
    });

    it('keeps the type and provider narrowing alongside the public filter', async () => {
      const { query, parameters } = await captureQuery(
        makeRequest({ query: { type: 'coder_corner', provider: 'gcp' } })
      );
      expect(query).toContain('LOWER(c.type) = @type');
      expect(query).toContain('ARRAY_CONTAINS(@providers');
      expect(parameters.find((x) => x.name === '@providers').value).toContain('Google Cloud');
    });

    it('still applies the JS filter as the authority', async () => {
      // The SQL layer only shapes the window; a fake store that ignores the
      // query (as this one does) must still never leak a draft. This is the
      // two-layer contract stated on SQL_PUBLIC_CLAUSE.
      const store = {
        queryDocs: vi.fn(async () => [publicDoc(), { id: 'd', contentStatus: 'draft' }]),
        readDoc: vi.fn(),
      };
      const h = createPublicReadHandlers({ store });
      const res = await h.listContent(makeRequest(), context);
      expect(JSON.parse(res.body).items.map((i) => i.id)).toEqual(['p1']);
    });
  });

  describe('the projection replaces SELECT * (T-206)', () => {
    it('projects explicit fields — never the whole document', async () => {
      const { query } = await captureQuery();
      expect(query).not.toContain('SELECT TOP 1000 *');
      for (const field of PUBLIC_CONTENT_LIST_FIELDS) {
        expect(query, `projection lost ${field}`).toContain(`c["${field}"]`);
      }
    });

    it('leaves article bodies out of list responses', async () => {
      // The RU story: full documents averaged ~20 KB, dominated by bodies no
      // list consumer reads. The audit found exactly one heavy field with a
      // list reader — `explanation` (useCoderCornerData excerpt fallback) —
      // and these eight with none.
      for (const heavy of [
        'content',
        'Content',
        'postContent',
        'blogDraft',
        'overviewHtml',
        'codeSnippet',
        'commandExample',
        'sidebarContent',
      ]) {
        expect(PUBLIC_CONTENT_LIST_FIELDS, `${heavy} has no list consumer`).not.toContain(heavy);
      }
      expect(PUBLIC_CONTENT_LIST_FIELDS).toContain('explanation');
    });

    it('covers every audited consumer requirement', () => {
      // Each entry names the consumer that reads it; losing one silently
      // blanks a public page. This is the audit, pinned — extend it when a
      // consumer starts reading a new field.
      const required = {
        // the server's own filter and sort
        Live: 'isPublicDocument',
        Status: 'isPublicDocument',
        contentStatus: 'isPublicDocument',
        softDeletedAt: 'isSoftDeleted',
        softDeleteExpiresAt: 'isSoftDeleted',
        publishedDate: 'resolvePublishedDateValue',
        datePublished: 'resolvePublishedDateValue',
        'Published At': 'resolvePublishedDateValue',
        blogPublishedAt: 'resolvePublishedDateValue',
        publishedAt: 'resolvePublishedDateValue',
        // cards
        explanation: 'useCoderCornerData:41,:53 excerpt fallback',
        language: 'useCoderCornerData card',
        repoUrl: 'useCoderCornerData card',
        altCoverImageVariants: 'useBlogData:174-179 image race',
        costAnalysis: 'ArchitecturePage doc.costAnalysis?.estimatedMonthly',
        frameworkPillars: 'useFrameworkData:93-101',
        keyTopics: 'useBlogData tags',
        'CD Url': 'useBlogData url resolution',
        'Source URL': 'useBlogData url resolution',
        curatedSubpagePath: 'SocialHubPage getLiveUrl',
        slugPageUrl: 'SocialHubPage getLiveUrl',
        // delete/dedup identity on LivePagesPage
        sourceContentId: 'LivePagesPage delete path',
        publishedContentId: 'LivePagesPage delete path',
        publishedBlogId: 'LivePagesPage delete path',
        blogId: 'LivePagesPage delete path',
      };
      const missing = Object.entries(required)
        .filter(([field]) => !PUBLIC_CONTENT_LIST_FIELDS.includes(field))
        .map(([field, consumer]) => `${field} (${consumer})`);
      expect(missing).toEqual([]);
    });
  });

  it('filters non-public docs server-side and sorts by resolved date desc', async () => {
    const store = {
      queryDocs: vi.fn(async () => [
        publicDoc({ id: 'old', publishedAt: '2026-01-01T00:00:00Z' }),
        { id: 'draft', contentStatus: 'draft', Title: 'Secret draft' },
        publicDoc({ id: 'new', publishedAt: undefined, 'Published At': '2026-06-01T00:00:00Z' }),
        publicDoc({ id: 'deleted', softDeletedAt: '2026-01-01' }),
      ]),
      readDoc: vi.fn(),
    };
    const h = createPublicReadHandlers({ store });
    const res = await h.listContent(makeRequest(), context);
    const body = JSON.parse(res.body);
    expect(body.items.map((i) => i.id)).toEqual(['new', 'old']); // alias date sorts first
  });

  it('builds parameterized type and provider-alias clauses', async () => {
    const store = { queryDocs: vi.fn(async () => []), readDoc: vi.fn() };
    const h = createPublicReadHandlers({ store });
    await h.listContent(makeRequest({ query: { type: 'coder_corner', provider: 'gcp' } }), context);
    const [container, query, params] = store.queryDocs.mock.calls[0];
    expect(container).toBe('content');
    expect(query).toContain('LOWER(c.type) = @type');
    expect(query).toContain('ARRAY_CONTAINS(@providers');
    expect(params).toContainEqual({ name: '@type', value: 'coder_corner' });
    expect(params.find((p) => p.name === '@providers').value).toContain('Google Cloud');
  });

  it('returns full documents with internal fields stripped', async () => {
    const store = {
      queryDocs: vi.fn(async () => [
        publicDoc({
          frameworkConcepts: [{ label: 'Pillar' }],
          featured: true,
          reviewNotes: 'internal',
          _rid: 'abc',
        }),
      ]),
      readDoc: vi.fn(),
    };
    const h = createPublicReadHandlers({ store });
    const res = await h.listContent(makeRequest(), context);
    const [item] = JSON.parse(res.body).items;
    // Fields outside any card projection survive — the list consumers
    // (useFrameworkData, useProviderLandingContent) read them.
    expect(item.frameworkConcepts).toEqual([{ label: 'Pillar' }]);
    expect(item.featured).toBe(true);
    expect(item).not.toHaveProperty('reviewNotes');
    expect(item).not.toHaveProperty('_rid');
  });

  it('serves the legacy blogs container only via the source allowlist', async () => {
    const store = { queryDocs: vi.fn(async () => []), readDoc: vi.fn() };
    const h = createPublicReadHandlers({ store });

    await h.listContent(makeRequest({ query: { source: 'blogs' } }), context);
    expect(store.queryDocs.mock.calls[0][0]).toBe('blogs');

    const denied = await h.listContent(
      makeRequest({ query: { source: 'admin_settings' } }),
      context
    );
    expect(denied.status).toBe(400);
    expect(store.queryDocs).toHaveBeenCalledTimes(1); // rejected before any read
  });

  it('applies offset/limit after the sort and clamps the limit', async () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      publicDoc({ id: `d${i}`, publishedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z` })
    );
    const store = { queryDocs: vi.fn(async () => docs), readDoc: vi.fn() };
    const h = createPublicReadHandlers({ store });
    const res = await h.listContent(makeRequest({ query: { limit: '3', offset: '2' } }), context);
    expect(JSON.parse(res.body).items.map((i) => i.id)).toEqual(['d7', 'd6', 'd5']);

    await h.listContent(makeRequest({ query: { limit: '5000' } }), context);
    expect(store.queryDocs).toHaveBeenCalledTimes(2); // clamped internally, no crash
  });
});

describe('getContent', () => {
  it('resolves by id in content first and strips internal fields', async () => {
    const store = {
      readDoc: vi.fn(async (c, id) =>
        c === 'content' && id === 'abc' ? publicDoc({ id: 'abc', reviewNotes: 'x' }) : null
      ),
      queryDocs: vi.fn(async () => []),
    };
    const h = createPublicReadHandlers({ store });
    const res = await h.getContent(makeRequest({ params: { slugOrId: 'abc' } }), context);
    const body = JSON.parse(res.body);
    expect(body.source).toBe('content');
    expect(body.item.id).toBe('abc');
    expect(body.item).not.toHaveProperty('reviewNotes');
  });

  it('falls through id → slug → Slug → legacy blogs, like the templates', async () => {
    const legacy = publicDoc({ id: 'legacy-1', Slug: 'my-post' });
    const store = {
      readDoc: vi.fn(async () => null),
      queryDocs: vi.fn(async (container, query) =>
        container === 'blogs' && query.includes('c["Slug"]') ? [legacy] : []
      ),
    };
    const h = createPublicReadHandlers({ store });
    const res = await h.getContent(makeRequest({ params: { slugOrId: 'my-post' } }), context);
    const body = JSON.parse(res.body);
    expect(body.source).toBe('blogs');
    expect(body.item.id).toBe('legacy-1');
  });

  it('404s a non-public document exactly like a missing one', async () => {
    const store = {
      readDoc: vi.fn(async () => ({ id: 'x', contentStatus: 'in_review', Title: 'Draft' })),
      queryDocs: vi.fn(async () => []),
    };
    const h = createPublicReadHandlers({ store });
    const res = await h.getContent(makeRequest({ params: { slugOrId: 'x' } }), context);
    expect(res.status).toBe(404);
    expect(res.body).not.toContain('Draft');
  });

  it('serves the published document when a draft shares its slug', async () => {
    // The T-305 defect: `SELECT TOP 1` picked arbitrarily among duplicates and
    // the public filter ran afterwards, so a live article 404'd whenever an
    // unpublished document sharing its slug happened to come back first.
    const draft = { id: 'draft-1', slug: 'shared', contentStatus: 'in_review', Title: 'Draft' };
    const live = publicDoc({ id: 'live-1', slug: 'shared', Title: 'Live' });
    const store = {
      readDoc: vi.fn(async () => null),
      queryDocs: vi.fn(async () => [draft, live]),
    };
    const h = createPublicReadHandlers({ store });
    const res = await h.getContent(makeRequest({ params: { slugOrId: 'shared' } }), context);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).item.id).toBe('live-1');
    expect(res.body).not.toContain('Draft');
  });

  it('orders slug candidates deterministically and bounds them', async () => {
    // Without ORDER BY the winner among duplicates is whatever the engine
    // returns; `_ts` is a system property present on every document, so it is
    // one of the few fields this codebase may sort on without dropping rows.
    const store = {
      readDoc: vi.fn(async () => null),
      queryDocs: vi.fn(async () => []),
    };
    const h = createPublicReadHandlers({ store });
    await h.getContent(makeRequest({ params: { slugOrId: 'anything' } }), context);

    for (const [, query] of store.queryDocs.mock.calls) {
      expect(query).toMatch(/ORDER BY c\._ts DESC/);
      expect(query).toMatch(/SELECT TOP \d+ /);
      expect(query).not.toMatch(/SELECT TOP 1 /);
    }
  });

  it('still 404s when every same-slug document is non-public', async () => {
    const store = {
      readDoc: vi.fn(async () => null),
      queryDocs: vi.fn(async () => [
        { id: 'a', slug: 'shared', contentStatus: 'in_review', Title: 'DraftA' },
        { id: 'b', slug: 'shared', Live: true, softDeletedAt: '2026-01-01', Title: 'DeletedB' },
      ]),
    };
    const h = createPublicReadHandlers({ store });
    const res = await h.getContent(makeRequest({ params: { slugOrId: 'shared' } }), context);

    expect(res.status).toBe(404);
    expect(res.body).not.toContain('DraftA');
    expect(res.body).not.toContain('DeletedB');
  });
});

/**
 * The public news pages were calling the EDITOR-gated cache lookup, so an
 * anonymous visitor's requests threw at token acquisition and no curated
 * imagery rendered (TODO.md T-210). The assertions that matter are about what
 * this endpoint does NOT return: the admin equivalent answers with the whole
 * document, and the document is not public.
 */
describe('getCuratedImage', () => {
  const cached = (over = {}) => ({
    id: 'a1',
    imageUrl: 'https://cdn.example/img/a1.png',
    storagePath: 'curated/internal/a1.png',
    promptSet: 'house-style-v3',
    promptName: 'news-hero',
    promptTemplateVersion: 7,
    theme: 'cool-blue',
    style: 'cinematic',
    ...over,
  });

  const handlersFor = (doc) =>
    createPublicReadHandlers({
      store: { readDoc: vi.fn(async () => doc), queryDocs: vi.fn() },
    });

  it('returns the image url', async () => {
    const h = handlersFor(cached());
    const res = await h.getCuratedImage(makeRequest({ params: { id: 'a1' } }), context);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).imageUrl).toBe('https://cdn.example/img/a1.png');
  });

  it('returns ONLY the image url — never the document', async () => {
    // storagePath is an internal blob path and the prompt fields are editorial
    // IP. Neither is needed to render an <img>, and an allowlist of one field
    // cannot leak a field added to the container later.
    const h = handlersFor(cached());
    const res = await h.getCuratedImage(makeRequest({ params: { id: 'a1' } }), context);
    const body = JSON.parse(res.body);

    expect(Object.keys(body).sort()).toEqual(['imageUrl', 'success']);
    expect(res.body).not.toContain('storagePath');
    expect(res.body).not.toContain('house-style-v3');
    expect(res.body).not.toContain('cinematic');
  });

  it('answers 200 with a null url when nothing is cached', async () => {
    // The caller's question is "is there a cached image?", and "no" is a
    // successful answer to it — the hook treats absence as "not cached", not
    // as an error, so a 404 here would show up in its error path.
    const h = handlersFor(null);
    const res = await h.getCuratedImage(makeRequest({ params: { id: 'missing' } }), context);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).imageUrl).toBeNull();
  });

  it('withholds an archived image', async () => {
    // Not asked for by the finding. `archived` is set by an admin explicitly
    // retiring an image, and the only thing this can do is stop a retired
    // image appearing on a public page.
    const h = handlersFor(cached({ archived: true }));
    const res = await h.getCuratedImage(makeRequest({ params: { id: 'a1' } }), context);
    expect(JSON.parse(res.body).imageUrl).toBeNull();
  });

  it('treats a document with no usable url as uncached', async () => {
    // Whitespace-only included: untrimmed, it is truthy, and would reach the
    // browser as an `<img src=" ">` that resolves back to the page itself.
    for (const over of [
      { imageUrl: '' },
      { imageUrl: '   ' },
      { imageUrl: null },
      { imageUrl: { url: 'x' } },
    ]) {
      const h = handlersFor(cached(over));
      const res = await h.getCuratedImage(makeRequest({ params: { id: 'a1' } }), context);
      expect(JSON.parse(res.body).imageUrl).toBeNull();
    }
  });

  it('rejects an empty id without reading', async () => {
    const store = { readDoc: vi.fn(), queryDocs: vi.fn() };
    const h = createPublicReadHandlers({ store });
    const res = await h.getCuratedImage(makeRequest({ params: { id: '  ' } }), context);
    expect(res.status).toBe(400);
    expect(store.readDoc).not.toHaveBeenCalled();
  });

  it('trims the stored url', async () => {
    const h = handlersFor(cached({ imageUrl: '  https://cdn.example/img/a1.png  ' }));
    const res = await h.getCuratedImage(makeRequest({ params: { id: 'a1' } }), context);
    expect(JSON.parse(res.body).imageUrl).toBe('https://cdn.example/img/a1.png');
  });

  it('caches a hit hard — it is hit up to twelve times per news page load', async () => {
    const h = handlersFor(cached());
    const res = await h.getCuratedImage(makeRequest({ params: { id: 'a1' } }), context);
    expect(res.headers['Cache-Control']).toBe('public, max-age=3600');
  });

  it('caches a miss only briefly, so a new image is not hidden for an hour', async () => {
    // Negative caching at the hit's TTL would mean that after an admin
    // generates an image, visitors and any CDN in front of them keep being
    // told there is none until the hour is out — a slower version of the bug
    // this endpoint exists to fix.
    const hit = await handlersFor(cached()).getCuratedImage(
      makeRequest({ params: { id: 'a1' } }),
      context
    );
    const miss = await handlersFor(null).getCuratedImage(
      makeRequest({ params: { id: 'a1' } }),
      context
    );

    const seconds = (res) => Number(/max-age=(\d+)/.exec(res.headers['Cache-Control'])[1]);
    expect(seconds(miss)).toBeGreaterThan(0);
    expect(seconds(miss)).toBeLessThan(seconds(hit));
  });

  it('caches an archived image as a miss, not as a hit', async () => {
    // Otherwise retiring an image would be cached for an hour at the TTL meant
    // for a stable URL.
    const h = handlersFor(cached({ archived: true }));
    const res = await h.getCuratedImage(makeRequest({ params: { id: 'a1' } }), context);
    expect(res.headers['Cache-Control']).toBe('public, max-age=60');
  });

  it('500s rather than leaking a store error to an anonymous caller', async () => {
    const h = createPublicReadHandlers({
      store: {
        readDoc: vi.fn(async () => {
          throw new Error('cosmos exploded with connection string in it');
        }),
        queryDocs: vi.fn(),
      },
    });
    const res = await h.getCuratedImage(makeRequest({ params: { id: 'a1' } }), context);
    expect(res.status).toBe(500);
    expect(res.body).not.toContain('connection string');
  });
});

describe('getSnapshot', () => {
  it('serves only the allowlisted snapshot ids', async () => {
    const store = {
      readDoc: vi.fn(async (_c, id) => ({ id, items: [1, 2] })),
      queryDocs: vi.fn(),
    };
    const h = createPublicReadHandlers({ store });
    const ok = await h.getSnapshot(makeRequest({ params: { id: 'certifications' } }), context);
    expect(JSON.parse(ok.body).snapshot.items).toEqual([1, 2]);

    const denied = await h.getSnapshot(makeRequest({ params: { id: 'admin_settings' } }), context);
    expect(denied.status).toBe(404);
    expect(store.readDoc).toHaveBeenCalledTimes(1); // denylist short-circuits before the read
  });

  it('strips internal fields from inside items[], not just the wrapper', async () => {
    // stripInternalFields used to be applied to the wrapper only, so createdBy
    // and updatedBy on each item were never reached — the read-path half of
    // TODO.md T-201.
    const store = {
      readDoc: vi.fn(async (_c, id) => ({
        id,
        updatedBy: 'wrapper-admin@example.com',
        items: [
          { id: 'a', name: 'Visible', createdBy: 'admin@example.com', _etag: '"x"' },
          { id: 'b', name: 'Also visible', updatedBy: 'other@example.com' },
        ],
      })),
      queryDocs: vi.fn(),
    };
    const h = createPublicReadHandlers({ store });
    const res = await h.getSnapshot(makeRequest({ params: { id: 'speakerevents' } }), context);
    const { snapshot } = JSON.parse(res.body);

    expect(snapshot).not.toHaveProperty('updatedBy');
    for (const item of snapshot.items) {
      expect(item).not.toHaveProperty('createdBy');
      expect(item).not.toHaveProperty('updatedBy');
      expect(item).not.toHaveProperty('_etag');
    }
    expect(JSON.stringify(snapshot)).not.toContain('@example.com');
    // The fields consumers need survive.
    expect(snapshot.items.map((i) => i.name)).toEqual(['Visible', 'Also visible']);
  });

  it('leaves non-object entries in items[] alone', async () => {
    const store = {
      readDoc: vi.fn(async (_c, id) => ({ id, items: [1, 'two', null, ['x']] })),
      queryDocs: vi.fn(),
    };
    const h = createPublicReadHandlers({ store });
    const res = await h.getSnapshot(makeRequest({ params: { id: 'certifications' } }), context);
    expect(JSON.parse(res.body).snapshot.items).toEqual([1, 'two', null, ['x']]);
  });
});

describe('T-202 — anonymous feeds filter deletions, not publication status', () => {
  const handlers = (rows) =>
    createPublicReadHandlers({
      store: {
        queryDocs: vi.fn(async (container) => rows[container] ?? []),
        readDoc: vi.fn(),
      },
    });

  it('listPodcasts drops soft-deleted episodes', async () => {
    const h = handlers({
      podcasts: [
        { id: 'live', title: 'Kept', publishedAt: '2026-01-02' },
        { id: 'gone', title: 'Removed', publishedAt: '2026-01-03', softDeletedAt: '2026-02-01' },
        { id: 'expiring', title: 'Also removed', softDeleteExpiresAt: '2026-03-01' },
      ],
    });
    const body = JSON.parse((await h.listPodcasts(makeRequest(), context)).body);
    expect(body.items.map((i) => i.id)).toEqual(['live']);
  });

  it('listPodcasts still serves episodes that carry no publication status', async () => {
    // The outage guard. Podcasts have no contentStatus/Live/Status, so
    // filtering them on isPublicDocument — which is what T-202 literally
    // prescribed — would return an empty page for every provider.
    const h = handlers({
      podcasts: [
        { id: 'a', title: 'Episode A', publishedAt: '2026-01-01' },
        { id: 'b', title: 'Episode B', publishedAt: '2026-01-02' },
      ],
    });
    const body = JSON.parse((await h.listPodcasts(makeRequest(), context)).body);
    expect(body.items).toHaveLength(2);
  });

  it('getFeed drops soft-deleted cache documents and insights', async () => {
    const h = handlers({
      rss_cache: [
        { id: 'c1', provider: 'azure', feedName: 'Azure Blog', items: [] },
        { id: 'c2', provider: 'azure', feedName: 'Stale', items: [], softDeletedAt: '2026-02-01' },
      ],
      ai_insights: [
        { id: 'i1', provider: 'azure', active: true, summary: 'Kept' },
        {
          id: 'i2',
          provider: 'azure',
          active: true,
          summary: 'Deleted',
          softDeletedAt: '2026-02-01',
        },
        { id: 'i3', provider: 'azure', active: false, summary: 'Hidden' },
      ],
    });
    const req = makeRequest({ query: { provider: 'azure' } });
    const body = JSON.parse((await h.getFeed(req, context)).body);

    expect(body.rssCache.map((d) => d.id)).toEqual(['c1']);
    // A soft-deleted insight passed `active !== false` — that was the half of
    // T-202 that leaked.
    expect(body.insights.map((d) => d.id)).toEqual(['i1']);
  });

  it('getFeed still serves cache documents, which never carry a status', async () => {
    const h = handlers({
      rss_cache: [{ id: 'c1', provider: 'azure', feedName: 'Azure Blog', items: [{ title: 'x' }] }],
      ai_insights: [{ id: 'i1', provider: 'azure', summary: 'No active flag set' }],
    });
    const req = makeRequest({ query: { provider: 'azure' } });
    const body = JSON.parse((await h.getFeed(req, context)).body);

    expect(body.rssCache).toHaveLength(1);
    // `active` absent means visible — only an explicit false hides an insight.
    expect(body.insights).toHaveLength(1);
  });
});

describe('T-203 — the feed endpoint is bounded', () => {
  const capture = () => {
    const queries = [];
    return {
      queries,
      store: {
        queryDocs: vi.fn(async (container, query) => {
          queries.push({ container, query });
          return [];
        }),
        readDoc: vi.fn(),
      },
    };
  };

  it('bounds both containers, which were unbounded on an anonymous endpoint', async () => {
    const { queries, store } = capture();
    const h = createPublicReadHandlers({ store });
    await h.getFeed(makeRequest({ query: { provider: 'azure' } }), context);

    expect(queries).toHaveLength(2);
    for (const { query } of queries) {
      expect(query).toMatch(/SELECT TOP \d+ /);
    }
  });

  it('bounds documents well above any plausible feed count, not at the render count', async () => {
    // The ceiling is a runaway guard, not a page size. One rss_cache document
    // is one feed holding many items; useNewsData renders 30 *items* after
    // flattening. Sizing the document bound to 30 would drop whole feeds.
    const { queries, store } = capture();
    const h = createPublicReadHandlers({ store });
    await h.getFeed(makeRequest({ query: { provider: 'azure' } }), context);

    for (const { query } of queries) {
      const bound = Number(query.match(/SELECT TOP (\d+) /)[1]);
      expect(bound).toBeGreaterThanOrEqual(100);
    }
  });

  it('does not order the feed queries', async () => {
    // Rule 2: ORDER BY drops documents missing the sort key, and lastFetched /
    // generatedAt are only in the composite indexes — presence is not
    // guaranteed. An arbitrary TOP N is acceptable because N only binds once a
    // container has run away.
    const { queries, store } = capture();
    const h = createPublicReadHandlers({ store });
    await h.getFeed(makeRequest({ query: { provider: 'azure' } }), context);

    for (const { query } of queries) {
      expect(query).not.toMatch(/ORDER BY/i);
    }
  });

  it('still parameterises the provider rather than interpolating it', async () => {
    const store = {
      queryDocs: vi.fn(async () => []),
      readDoc: vi.fn(),
    };
    const h = createPublicReadHandlers({ store });
    await h.getFeed(makeRequest({ query: { provider: "azure' OR 1=1--" } }), context);

    for (const call of store.queryDocs.mock.calls) {
      expect(call[1]).not.toContain('OR 1=1');
      expect(call[2]).toEqual([{ name: '@provider', value: "azure' OR 1=1--" }]);
    }
  });
});

describe('isSoftDeleted', () => {
  it('is the universal half of isPublicDocument', () => {
    expect(isSoftDeleted({ softDeletedAt: '2026-01-01' })).toBe(true);
    expect(isSoftDeleted({ softDeleteExpiresAt: '2026-01-01' })).toBe(true);
    expect(isSoftDeleted({})).toBe(false);
    expect(isSoftDeleted(null)).toBe(false);
  });

  it('does not require a publication status, unlike isPublicDocument', () => {
    // This is the distinction T-202 turned on: a cache document has no
    // contentStatus, so isPublicDocument rejects it while isSoftDeleted admits
    // it. Filtering rss_cache/podcasts/ai_insights on the former would have
    // emptied three public pages.
    const cacheDoc = { provider: 'azure', feedName: 'Azure Blog', items: [] };
    expect(isSoftDeleted(cacheDoc)).toBe(false);
    expect(isPublicDocument(cacheDoc)).toBe(false);
  });
});

describe('listPodcasts', () => {
  it('filters by provider and sorts newest first', async () => {
    const store = {
      queryDocs: vi.fn(async () => [
        { id: 'a', publishedAt: '2026-01-01T00:00:00Z' },
        { id: 'b', publishedAt: '2026-05-01T00:00:00Z' },
      ]),
      readDoc: vi.fn(),
    };
    const h = createPublicReadHandlers({ store });
    const res = await h.listPodcasts(makeRequest({ query: { provider: 'aws' } }), context);
    expect(JSON.parse(res.body).items.map((i) => i.id)).toEqual(['b', 'a']);
    const [, query, params] = store.queryDocs.mock.calls[0];
    expect(query).toContain('c.provider = @provider');
    expect(params).toContainEqual({ name: '@provider', value: 'aws' });
  });
});

describe('getFeed', () => {
  it('requires a provider and returns rss cache plus active insights', async () => {
    const store = {
      queryDocs: vi.fn(async (container) =>
        container === 'rss_cache'
          ? [{ id: 'cache1', provider: 'aws', items: [] }]
          : [
              { id: 'i1', provider: 'aws', active: true },
              { id: 'i2', provider: 'aws', active: false },
            ]
      ),
      readDoc: vi.fn(),
    };
    const h = createPublicReadHandlers({ store });

    expect((await h.getFeed(makeRequest(), context)).status).toBe(400);

    const res = await h.getFeed(makeRequest({ query: { provider: 'aws' } }), context);
    const body = JSON.parse(res.body);
    expect(body.rssCache.map((d) => d.id)).toEqual(['cache1']);
    expect(body.insights.map((d) => d.id)).toEqual(['i1']); // active:false excluded
  });
});
