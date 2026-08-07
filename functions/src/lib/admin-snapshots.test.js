/**
 * Dashboard/queue/publish snapshot RPCs — classification helpers pinned
 * verbatim against the source (:88-110, :2000-2130), queue filter shapes and
 * the seed/recalculate flows against :6038-6170 and :6300-6470.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createAdminSnapshotHandlers,
  isBlockedContentSource,
  matchesQueueStatus,
  matchesAdminContentType,
  summarizeDashboardItems,
  queueFilterFor,
  DASHBOARD_STATS_DOC_ID,
} from './admin-snapshots.js';

const context = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };

const allowGuard = (role = 'viewer') => ({
  requireRole: vi.fn(async () => ({
    user: { oid: 'u1', preferred_username: 'admin@hcw.dev' },
    role,
    error: null,
  })),
});
const denyGuard = {
  requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })),
};

const makeRequest = (body) => ({
  json: async () => {
    if (body === undefined) throw new SyntaxError('no body');
    return body;
  },
});

/** Store fake routing COUNT queries vs projected fetches. */
function makeStore({ count = 0, rows = [], doc = null } = {}) {
  return {
    queryDocs: vi.fn(async (_c, query) =>
      query.includes('VALUE COUNT') ? [count] : rows
    ),
    readDoc: vi.fn(async () => doc),
    upsertDoc: vi.fn(async (_c, d) => d),
  };
}

const fixed = { now: () => new Date('2026-08-07T03:00:00.000Z') };

describe('classification helpers', () => {
  it('blocks the blocked host across every URL field, www-insensitively', () => {
    expect(isBlockedContentSource({ sourceUrl: 'https://www.stackfeed.io/a' })).toBe(true);
    expect(isBlockedContentSource({ sourceUrls: ['https://stackfeed.io/x'] })).toBe(true);
    expect(isBlockedContentSource({ sourceFeed: 'https://stackfeed.io/rss' })).toBe(true);
    expect(isBlockedContentSource({ sourceUrl: 'https://example.com' })).toBe(false);
    expect(isBlockedContentSource({})).toBe(false);
  });

  it('matchesQueueStatus keeps the source nuances', () => {
    expect(matchesQueueStatus({ contentStatus: 'approved' }, 'ready_to_publish')).toBe(true);
    expect(matchesQueueStatus({ contentStatus: 'published', Live: true }, 'ready_to_publish')).toBe(false);
    expect(matchesQueueStatus({ contentStatus: 'editing' }, 'in_progress')).toBe(true);
    expect(matchesQueueStatus({ contentStatus: 'needs_rework' }, 'in_progress')).toBe(false);
    expect(matchesQueueStatus({ Live: true }, 'published_live')).toBe(true);
  });

  it('matchesAdminContentType folds news into the blog filter', () => {
    expect(matchesAdminContentType({ type: 'news' }, 'blog')).toBe(true);
    expect(matchesAdminContentType({ type: 'framework' }, 'blog')).toBe(false);
    expect(matchesAdminContentType({ publishTarget: 'coder_corner' }, 'coder_corner')).toBe(true);
  });

  it('summarizeDashboardItems buckets exactly like the source', () => {
    const stats = summarizeDashboardItems([
      { type: 'blog', contentStatus: 'ingested' }, // needsReview
      { type: 'blog', contentStatus: 'editing' }, // inProgress
      { type: 'blog', contentStatus: 'published', Live: true }, // published
      { type: 'framework', contentStatus: 'rejected' }, // rejected, no bucket total
      { type: 'blog', contentStatus: 'archived' }, // total only
      { type: 'news', contentStatus: 'draft', sourceUrl: 'https://stackfeed.io/x' }, // blocked, excluded
    ]);
    expect(stats.blog).toEqual({ needsReview: 1, inProgress: 1, published: 1, total: 4 });
    expect(stats.rejected).toBe(1);
    expect(stats.framework.total).toBe(0);
    expect(stats.news.total).toBe(0);
  });

  it('queueFilterFor maps each filter to the source query shape', () => {
    expect(queueFilterFor('needs_review')).toMatchObject({
      sortField: 'fetchedAt',
      params: [{ name: '@statuses', value: ['draft', 'ingested', 'inspected'] }],
    });
    expect(queueFilterFor('published_live')).toMatchObject({ where: 'c.Live = true', sortField: 'publishedAt' });
    expect(queueFilterFor('soft_deleted').params[0].value).toBe('rejected');
    expect(queueFilterFor('editing').params[0].value).toBe('editing'); // passthrough
  });
});

describe('getQueueSnapshot', () => {
  it('denies without touching the store', async () => {
    const store = makeStore();
    const h = createAdminSnapshotHandlers({ guard: denyGuard, store, ...fixed });
    expect((await h.getQueueSnapshot(makeRequest({}), context)).status).toBe(403);
    expect(store.queryDocs).not.toHaveBeenCalled();
  });

  it('filters blocked sources, applies JS-side status nuance, sorts desc', async () => {
    const rows = [
      { id: 'stale', contentStatus: 'approved', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'fresh', contentStatus: 'approved', updatedAt: '2026-06-01T00:00:00Z' },
      { id: 'live-already', contentStatus: 'published', Live: true, updatedAt: '2026-07-01T00:00:00Z' },
      { id: 'blocked', contentStatus: 'approved', sourceUrl: 'https://stackfeed.io/x', updatedAt: '2026-08-01T00:00:00Z' },
    ];
    const store = makeStore({ count: 10, rows });
    const h = createAdminSnapshotHandlers({ guard: allowGuard(), store, ...fixed });
    const res = await h.getQueueSnapshot(makeRequest({ statusFilter: 'ready_to_publish' }), context);
    const body = JSON.parse(res.body);
    expect(body.items.map((i) => i.id)).toEqual(['fresh', 'stale']); // Live filtered, blocked dropped, desc
    expect(body.totalCount).toBe(9); // count minus blocked-in-page
  });

  it('uses projected, parameterized queries — never SELECT *', async () => {
    const store = makeStore();
    const h = createAdminSnapshotHandlers({ guard: allowGuard(), store, ...fixed });
    await h.getQueueSnapshot(makeRequest({ statusFilter: 'needs_review', itemLimit: 50 }), context);
    const fetchCall = store.queryDocs.mock.calls.find(([, q]) => !q.includes('VALUE COUNT'));
    expect(fetchCall[1]).toContain('c["contentStatus"]');
    expect(fetchCall[1]).not.toContain('SELECT *');
    expect(fetchCall[1]).toContain('ARRAY_CONTAINS(@statuses, c.contentStatus)');
  });
});

describe('getPublishSnapshot', () => {
  it('returns both buckets with totals and Live filtered out of ready', async () => {
    const store = {
      queryDocs: vi.fn(async (_c, query, params) => {
        if (query.includes('VALUE COUNT')) return [7];
        if (params.length > 0) {
          // ready bucket fetch
          return [
            { id: 'r1', contentStatus: 'approved', updatedAt: '2026-05-01T00:00:00Z' },
            { id: 'r-live', contentStatus: 'published', Live: true, updatedAt: '2026-06-01T00:00:00Z' },
          ];
        }
        return [{ id: 'p1', publishedAt: '2026-04-01T00:00:00Z' }];
      }),
      readDoc: vi.fn(),
      upsertDoc: vi.fn(),
    };
    const h = createAdminSnapshotHandlers({ guard: allowGuard(), store, ...fixed });
    const body = JSON.parse((await h.getPublishSnapshot(makeRequest({}), context)).body);
    expect(body.readyTotal).toBe(7);
    expect(body.readyCandidates.map((i) => i.id)).toEqual(['r1']);
    expect(body.publishedItems.map((i) => i.id)).toEqual(['p1']);
  });
});

describe('getAdminDashboardSnapshot', () => {
  it('serves the fast path from the stats doc, projected to the UI shape', async () => {
    const store = makeStore({
      doc: {
        id: DASHBOARD_STATS_DOC_ID,
        blog: { needsReview: 3, inProgress: 2, published: 5, total: 10 },
        rejected: 4,
        totalDocs: 99,
        schemaVersion: 1,
        _ts: 123,
      },
    });
    const h = createAdminSnapshotHandlers({ guard: allowGuard(), store, ...fixed });
    const body = JSON.parse((await h.getAdminDashboardSnapshot(makeRequest({}), context)).body);
    expect(body.stats.blog).toEqual({ needsReview: 3, inProgress: 2, published: 5, total: 10 });
    expect(body.stats.rejected).toBe(4);
    expect(body.stats).not.toHaveProperty('totalDocs'); // UI shape, not doc shape
    expect(store.upsertDoc).not.toHaveBeenCalled(); // no reseed on the fast path
  });

  it('falls back to a live scan and seeds the doc when unseeded', async () => {
    const store = makeStore({
      doc: null,
      rows: [{ id: 'a', contentStatus: 'ingested', type: 'blog', fetchedAt: '2026-01-01T00:00:00Z' }],
    });
    const h = createAdminSnapshotHandlers({ guard: allowGuard(), store, ...fixed });
    const body = JSON.parse((await h.getAdminDashboardSnapshot(makeRequest({}), context)).body);
    expect(body.stats.blog.needsReview).toBe(1);
    const seeded = store.upsertDoc.mock.calls[0][1];
    expect(seeded.id).toBe(DASHBOARD_STATS_DOC_ID);
    expect(seeded.blog.needsReview).toBe(1);
    expect(body.recentNeedsReview.map((i) => i.id)).toEqual(['a']);
  });
});

describe('recalculateDashboardStats', () => {
  it('requires editor, scans, and fully overwrites the stats doc', async () => {
    const store = makeStore({
      rows: [
        { id: 'a', contentStatus: 'published', Live: true, type: 'framework' },
        { id: 'b', contentStatus: 'rejected', type: 'blog' },
      ],
    });
    const h = createAdminSnapshotHandlers({ guard: allowGuard('editor'), store, ...fixed });
    const res = await h.recalculateDashboardStats(makeRequest({}), context);
    const body = JSON.parse(res.body);
    expect(body.totalDocs).toBe(2);
    expect(body.stats.framework.published).toBe(1);
    expect(body.stats.rejected).toBe(1);

    const doc = store.upsertDoc.mock.calls[0][1];
    expect(doc).toMatchObject({
      id: DASHBOARD_STATS_DOC_ID,
      totalDocs: 2,
      recalculatedAt: '2026-08-07T03:00:00.000Z',
      recalculatedBy: 'admin@hcw.dev',
    });
  });

  it('denies non-editors without scanning', async () => {
    const store = makeStore();
    const h = createAdminSnapshotHandlers({ guard: denyGuard, store, ...fixed });
    expect((await h.recalculateDashboardStats(makeRequest({}), context)).status).toBe(403);
    expect(store.queryDocs).not.toHaveBeenCalled();
  });
});
