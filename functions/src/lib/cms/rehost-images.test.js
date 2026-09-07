/**
 * cms/content/rehost-images (#374 backfill): the candidate list never carries
 * a body, counts distinct URLs and hosts the way the publish step will, and
 * the write hands every id to processPublishContent under the re-host reason
 * and reports each document's summary, skip or error by id.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createRehostImageHandlers,
  normalizeContentIds,
  summarizeCandidate,
  sortCandidates,
  toRehostResult,
  MAX_BATCH,
  PUBLISHED_STATUSES,
} from './rehost-images.js';
import { REHOST_IMAGES_REASON } from './publish.js';

const context = { log: vi.fn(), error: vi.fn() };
const USER = { oid: 'u1', email: 'pub@hcw.dev' };
const guardAs = (role) => ({ requireRole: vi.fn(async () => ({ user: USER, role, error: null })) });
const denyGuard = {
  requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })),
};
const makeRequest = (body) => ({ headers: { get: () => 'vitest' }, json: async () => body ?? {} });

const UPSTREAM_A = 'https://techcommunity.microsoft.com/t5/image/a.png';
const UPSTREAM_B = 'https://cdn-dynmedia-1.microsoft.com/is/image/b.webp';
const HOSTED = '/api/public/media/covers/c1/inline/abcdef0123456789.png';

describe('summarizeCandidate', () => {
  it('counts distinct URLs across fields, names hosts, and carries no body', () => {
    const row = summarizeCandidate({
      id: 'c1',
      Title: 'Arc updates',
      slug: 'arc-updates',
      Live: true,
      publishedUrl: 'https://hybridcloudworks.com/azure/blog/arc-updates',
      Content: `<p>stub</p><img src="${UPSTREAM_A}">`,
      content: `![a](${UPSTREAM_A}) ![b](${UPSTREAM_B}) ![own](${HOSTED})`,
      inlineImages: { fields: ['content'], rewritten: 0, failed: 2, failedUrls: [], at: 'x' },
    });
    expect(row).toEqual({
      id: 'c1',
      title: 'Arc updates',
      slug: 'arc-updates',
      publicUrl: 'https://hybridcloudworks.com/azure/blog/arc-updates',
      live: true,
      fields: ['Content', 'content'],
      urlCount: 2,
      hosts: ['cdn-dynmedia-1.microsoft.com', 'techcommunity.microsoft.com'],
      lastRun: { fields: ['content'], rewritten: 0, failed: 2, failedUrls: [], at: 'x' },
    });
    expect(JSON.stringify(row)).not.toContain('stub');
    expect(JSON.stringify(row)).not.toContain(UPSTREAM_A);
  });

  it('is null for a document whose images are already the site’s own', () => {
    expect(summarizeCandidate({ id: 'c2', content: `<img src="${HOSTED}">` })).toBeNull();
    expect(summarizeCandidate({ id: 'c3', content: 'no images at all' })).toBeNull();
  });

  it('sorts most images first, then by title', () => {
    const rows = sortCandidates([
      { title: 'B', urlCount: 2 },
      { title: 'A', urlCount: 2 },
      { title: 'Z', urlCount: 9 },
    ]);
    expect(rows.map((r) => r.title)).toEqual(['Z', 'A', 'B']);
  });
});

describe('normalizeContentIds / toRehostResult', () => {
  it('dedupes, trims, and rejects non-string entries', () => {
    expect(normalizeContentIds([' a ', 'b', 'a', ''])).toEqual(['a', 'b']);
    expect(normalizeContentIds(['a', 1])).toBeNull();
    expect(normalizeContentIds('a')).toBeNull();
  });

  it('shapes error, skip and success by id', () => {
    expect(toRehostResult('a', { error: 'nope' })).toEqual({ contentId: 'a', error: 'nope' });
    expect(toRehostResult('b', { skipped: true, reason: 'none' })).toEqual({
      contentId: 'b',
      skipped: true,
      reason: 'none',
    });
    expect(toRehostResult('c', { rehosted: true, inlineImages: { rewritten: 1 } })).toEqual({
      contentId: 'c',
      inlineImages: { rewritten: 1 },
    });
  });
});

describe('GET candidates', () => {
  const docs = [
    { id: 'p1', Title: 'One image', contentStatus: 'published', content: `![](${UPSTREAM_A})` },
    { id: 'p2', Title: 'Clean', contentStatus: 'published', content: `![](${HOSTED})` },
    {
      id: 'p3',
      Title: 'Two images',
      contentStatus: 'published_both',
      Content: `<img src="${UPSTREAM_A}"><img src='${UPSTREAM_B}'>`,
    },
  ];

  it('queries the published statuses and returns only hotlinking documents, most first', async () => {
    const store = { queryDocs: vi.fn(async () => docs) };
    const h = createRehostImageHandlers({
      guard: guardAs('editor'),
      store,
      processPublishContent: vi.fn(),
    });
    const res = await h.listCandidates(makeRequest(), context);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(store.queryDocs.mock.calls[0][0]).toBe('content');
    expect(store.queryDocs.mock.calls[0][1]).toContain('ARRAY_CONTAINS(@statuses');
    expect(store.queryDocs.mock.calls[0][2]).toEqual([
      { name: '@statuses', value: [...PUBLISHED_STATUSES] },
    ]);
    expect(body.scanned).toBe(3);
    expect(body.total).toBe(2);
    expect(body.candidates.map((c) => c.id)).toEqual(['p3', 'p1']);
    expect(body.candidates[0].hosts).toEqual([
      'cdn-dynmedia-1.microsoft.com',
      'techcommunity.microsoft.com',
    ]);
    expect(res.body).not.toContain(UPSTREAM_A);
  });

  it('denies without reading and 500s a failed query', async () => {
    const store = { queryDocs: vi.fn(async () => docs) };
    const denied = createRehostImageHandlers({
      guard: denyGuard,
      store,
      processPublishContent: vi.fn(),
    });
    expect((await denied.listCandidates(makeRequest(), context)).status).toBe(403);
    expect(store.queryDocs).not.toHaveBeenCalled();

    const broken = createRehostImageHandlers({
      guard: guardAs('editor'),
      store: {
        queryDocs: vi.fn(async () => {
          throw new Error('cosmos down');
        }),
      },
      processPublishContent: vi.fn(),
    });
    expect((await broken.listCandidates(makeRequest(), context)).status).toBe(500);
  });
});

describe('POST rehost', () => {
  const summary = { fields: ['content'], rewritten: 2, failed: 1, failedUrls: ['x'], at: 't' };
  const pipeline = vi.fn(async (contentId) => {
    if (contentId === 'ok')
      return { blogId: 'ok', reused: true, rehosted: true, inlineImages: summary };
    if (contentId === 'clean')
      return { skipped: true, reason: 'No third-party image URLs in the body fields' };
    return { error: 'Content not found' };
  });

  it('runs each id through the pipeline under the re-host reason and reports by id', async () => {
    const log = { log: vi.fn() };
    const h = createRehostImageHandlers({
      guard: guardAs('publisher'),
      store: { queryDocs: vi.fn() },
      processPublishContent: pipeline,
      log,
    });
    const res = await h.rehostImages(
      makeRequest({ contentIds: ['ok', 'clean', 'missing'] }),
      context
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(pipeline).toHaveBeenCalledWith('ok', { user: USER, reason: REHOST_IMAGES_REASON });
    expect(body).toEqual({
      success: true,
      results: [
        { contentId: 'ok', inlineImages: summary },
        {
          contentId: 'clean',
          skipped: true,
          reason: 'No third-party image URLs in the body fields',
        },
        { contentId: 'missing', error: 'Content not found' },
      ],
      rehosted: 1,
      skipped: 1,
      failed: 1,
    });
    // The log carries counts and nothing from the documents.
    expect(log.log.mock.calls[0][0]).toBe(
      '[rehostImages] 3 requested: 1 re-hosted, 1 skipped, 1 failed'
    );
  });

  it('400s a missing, malformed or oversized batch, and denies before the pipeline runs', async () => {
    const run = vi.fn();
    const h = createRehostImageHandlers({
      guard: guardAs('publisher'),
      store: { queryDocs: vi.fn() },
      processPublishContent: run,
    });
    expect((await h.rehostImages(makeRequest({}), context)).status).toBe(400);
    expect((await h.rehostImages(makeRequest({ contentIds: [] }), context)).status).toBe(400);
    expect((await h.rehostImages(makeRequest({ contentIds: [7] }), context)).status).toBe(400);
    const tooMany = Array.from({ length: MAX_BATCH + 1 }, (_, i) => `id-${i}`);
    const over = await h.rehostImages(makeRequest({ contentIds: tooMany }), context);
    expect(over.status).toBe(400);
    expect(JSON.parse(over.body).error).toMatch(/25 per request/);
    expect(run).not.toHaveBeenCalled();

    const denied = createRehostImageHandlers({
      guard: denyGuard,
      store: { queryDocs: vi.fn() },
      processPublishContent: run,
    });
    expect((await denied.rehostImages(makeRequest({ contentIds: ['ok'] }), context)).status).toBe(
      403
    );
    expect(run).not.toHaveBeenCalled();
  });
});
