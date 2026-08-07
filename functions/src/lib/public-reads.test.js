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
    await h.listContent(
      makeRequest({ query: { type: 'coder_corner', provider: 'gcp' } }),
      context
    );
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
