/**
 * The publish pipeline — pinned to processPublishContent (:1383-1600) and
 * publishContent (:6696). Load-bearing: the publishable-status table, both
 * gates persisting their failed reports, republish slug reuse vs
 * collision-only suffixing, metadata validation on new publishes only, the
 * cover trigger, and the batch accumulator's published/skipped/warning math.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createPublishHandlers,
  slugify,
  toPublicUrl,
  getPublicSectionForPublishTarget,
  validatePublishMetadata,
  applyPublishTimeCoverTrigger,
  accumulatePublishResult,
} from './publish.js';

const context = { log: vi.fn(), error: vi.fn() };

const USER = { oid: 'u1', email: 'pub@hcw.dev' };
const guardAs = (role) => ({ requireRole: vi.fn(async () => ({ user: USER, role, error: null })) });
const denyGuard = { requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })) };
const makeRequest = (body) => ({ headers: { get: () => 'vitest' }, json: async () => body ?? {} });

const NOW = new Date('2026-08-07T06:00:00.000Z');
const fixed = { now: () => NOW, uuid: () => 'fixed-uuid' };

/** A framework doc that clears both gates (mirrors the quality-test payload). */
const paragraph = (n) =>
  Array.from({ length: n }, (_, i) => `Sentence ${i} with concrete hybrid-cloud detail.`).join(' ');
const readyDoc = (over = {}) => ({
  id: 'c1',
  type: 'framework',
  publishTarget: 'framework',
  contentStatus: 'approved',
  Title: 'Migration Readiness Framework',
  summary: paragraph(6),
  overviewHtml: paragraph(30),
  frameworkConcepts: [
    { label: 'Discover', summary: 'Inventory.' },
    { label: 'Assess', summary: 'Score.' },
    { label: 'Mobilize', summary: 'Land.' },
  ],
  cloudProvider: 'Azure',
  publishedDate: '2026-08-01T00:00:00Z',
  ...over,
});

function makeStore(doc = readyDoc(), over = {}) {
  return {
    readDoc: vi.fn(async (container, id) =>
      container === 'content' && id === doc.id ? doc : null
    ),
    queryDocs: vi.fn(async () => []), // no slug clash by default
    upsertDoc: vi.fn(async (_c, d) => d),
    patchDoc: vi.fn(async (_c, id, u) => ({ id, ...u })),
    ...over,
  };
}

describe('pure helpers', () => {
  it('slugify/toPublicUrl/section mapping match the source', () => {
    expect(slugify('Designing a Hybrid Landing Zone!')).toBe('designing-a-hybrid-landing-zone');
    expect(toPublicUrl('azure/blog/x')).toBe('https://hybridcloudworks.com/azure/blog/x');
    expect(getPublicSectionForPublishTarget('framework')).toBe('frameworks');
    expect(getPublicSectionForPublishTarget('coder_corner')).toBe('code');
    expect(getPublicSectionForPublishTarget('nonsense')).toBe('blog');
  });

  it('validatePublishMetadata names each failure', () => {
    const errors = validatePublishMetadata({
      contentData: { publishedDate: 'junk' },
      publishTarget: 'blog',
      cloudProvider: 'oracle',
      slug: '',
    });
    expect(errors.join(' ')).toMatch(/cloud provider/);
    expect(errors.join(' ')).toMatch(/Missing slug/);
    expect(errors.join(' ')).toMatch(/Published At/);
    expect(
      validatePublishMetadata({
        contentData: {},
        publishTarget: 'framework',
        cloudProvider: 'azure',
        slug: 'ok',
      })
    ).toEqual([]);
  });

  it('cover trigger fires only when no cover exists and not already triggered', () => {
    const update = {};
    applyPublishTimeCoverTrigger(update, {});
    expect(update).toEqual({ altCoverImageTrigger: true, aiImageTargets: ['hero'] });

    const noop = {};
    applyPublishTimeCoverTrigger(noop, { heroImageUrl: 'x' });
    expect(noop).toEqual({});
    applyPublishTimeCoverTrigger(noop, { altCoverImageTrigger: true });
    expect(noop).toEqual({});
  });

  it('accumulatePublishResult buckets errors/reused/published with URL warnings', () => {
    const results = { published: 0, skipped: 0, errors: [], mappings: [], warnings: [] };
    accumulatePublishResult(results, 'a', { error: 'nope' });
    accumulatePublishResult(results, 'b', { blogId: 'b', reused: true, expectedPublicUrl: null });
    accumulatePublishResult(results, 'c', { blogId: 'c', reused: false, expectedPublicUrl: 'https://x' });
    expect(results.published).toBe(1);
    expect(results.skipped).toBe(1);
    expect(results.errors).toHaveLength(1);
    expect(results.warnings).toHaveLength(1); // reused-without-url
    expect(results.mappings).toHaveLength(2);
  });
});

describe('concurrent publish protection (T-301)', () => {
  it('conditions the content write on the ETag it read', async () => {
    // Everything above the write — the status gate, the quality and image
    // reports, the slug — was decided from the document read at the top of
    // processPublishContent. Without the precondition two concurrent runs both
    // pass the gate and both publish, which the scheduled publisher turns from
    // theoretical into reachable.
    const store = makeStore(readyDoc({ _etag: '"abc"' }));
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    await h.publishContent(makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }), context);

    const call = store.patchDoc.mock.calls.find(([c]) => c === 'content');
    expect(call[3]).toEqual({ ifMatch: '"abc"' });
  });

  it('reports a lost race as skipped, not published', async () => {
    const conflict = Object.assign(new Error('precondition failed'), { code: 412 });
    const store = makeStore(readyDoc({ _etag: '"abc"' }), {
      patchDoc: vi.fn(async (container) => {
        if (container === 'content') throw conflict;
        return {};
      }),
    });
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    const body = JSON.parse(
      (await h.publishContent(makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }), context))
        .body
    );

    expect(body.published).toBe(0);
    expect(body.skipped).toBe(1);
    // No mapping: nothing was written, so there is no published URL to report.
    expect(body.mappings).toEqual([]);
    expect(body.errors).toEqual([]);
  });

  it('still surfaces a non-412 write failure as an error, not a skip', async () => {
    // Only a lost race is a skip. A genuine write failure has to reach the
    // operator, or the batch reports a publish that did not happen.
    const store = makeStore(readyDoc({ _etag: '"abc"' }), {
      patchDoc: vi.fn(async (container) => {
        if (container === 'content') throw new Error('cosmos down');
        return {};
      }),
    });
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    const body = JSON.parse(
      (await h.publishContent(makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }), context))
        .body
    );

    expect(body.published).toBe(0);
    expect(body.skipped).toBe(0);
    expect(body.errors).toEqual([{ contentId: 'c1', error: 'cosmos down' }]);
  });

  it('exposes processPublishContent for the scheduler, without registering a route', async () => {
    const store = makeStore();
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    expect(typeof h.processPublishContent).toBe('function');

    // No publishTarget, exactly as the scheduler calls it — it falls back to
    // the document's own, which is what makes a timer-driven publish match an
    // operator-driven one.
    const result = await h.processPublishContent('c1', { markLive: true });
    expect(result.error).toBeUndefined();
    expect(store.patchDoc.mock.calls.find(([c]) => c === 'content')[2].Live).toBe(true);
  });

  it('arms the social-caption trigger only once, and only for a live publish', async () => {
    // Not live: staging a publish must not queue a social post.
    const staged = makeStore();
    const h1 = createPublishHandlers({ guard: guardAs('publisher'), store: staged, ...fixed });
    await h1.processPublishContent('c1', { markLive: false });
    expect(
      staged.patchDoc.mock.calls.find(([c]) => c === 'content')[2].socialCaptionTrigger
    ).toBeUndefined();

    // Republish of a document that already posted: never a second post.
    const republished = makeStore(
      readyDoc({ socialCaptionGeneratedAt: '2026-08-20T00:00:00Z' })
    );
    const h2 = createPublishHandlers({ guard: guardAs('publisher'), store: republished, ...fixed });
    await h2.processPublishContent('c1', { markLive: true });
    expect(
      republished.patchDoc.mock.calls.find(([c]) => c === 'content')[2].socialCaptionTrigger
    ).toBeUndefined();
  });
});

describe('publishContent', () => {
  it('publishes a ready item: status, slug, URLs, provider, version row', async () => {
    const store = makeStore();
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    const res = await h.publishContent(makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }), context);
    const body = JSON.parse(res.body);
    expect(body.published).toBe(1);
    expect(body.errors).toEqual([]);

    const patch = store.patchDoc.mock.calls.find(([c]) => c === 'content')[2];
    expect(patch.contentStatus).toBe('published');
    expect(patch.Live).toBe(true); // markLive defaults true
    // A live publish arms the social-caption auto-queue trigger (backlog #1).
    expect(patch.socialCaptionTrigger).toBe(true);
    expect(patch.slug).toBe('migration-readiness-framework');
    expect(patch.curatedSubpagePath).toBe('/azure/frameworks/migration-readiness-framework');
    expect(patch.publicUrl).toBe(
      'https://hybridcloudworks.com/azure/frameworks/migration-readiness-framework'
    );
    expect(patch['Published At']).toBe('2026-08-01T00:00:00.000Z');
    expect(patch['Cloud Provider']).toBe('Azure');

    const version = store.upsertDoc.mock.calls.find(([c]) => c === 'content_versions')[1];
    expect(version.versionReason).toBe('published');
    expect(version.contentId).toBe('c1');
  });

  it('refuses non-publishable statuses via the single table', async () => {
    const store = makeStore(readyDoc({ contentStatus: 'in_review' }));
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    const body = JSON.parse((await h.publishContent(makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }), context)).body);
    expect(body.errors[0].error).toMatch(/Cannot publish from status 'in_review'/);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('quality-gate failure persists the report and errors (bypass overrides)', async () => {
    const thin = readyDoc({ overviewHtml: 'Too short.', summary: 'x', frameworkConcepts: [] });
    const store = makeStore(thin);
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });

    const body = JSON.parse((await h.publishContent(makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }), context)).body);
    expect(body.errors[0].error).toMatch(/quality gate failed/);
    // The failed report was persisted onto the doc.
    expect(store.patchDoc.mock.calls[0][2]).toHaveProperty('contentQuality');
    expect(store.patchDoc.mock.calls[0][2].contentQuality.ready).toBe(false);

    const bypass = makeStore(thin);
    const h2 = createPublishHandlers({ guard: guardAs('publisher'), store: bypass, ...fixed });
    const ok = JSON.parse(
      (
        await h2.publishContent(
          makeRequest({ contentIds: ['c1'], publishTarget: 'framework', forceQualityBypass: true, forceImageBypass: true }),
          context
        )
      ).body
    );
    expect(ok.published).toBe(1);
  });

  it('republish reuses the stored slug and counts as skipped', async () => {
    const store = makeStore(readyDoc({ contentStatus: 'published', slug: 'existing-slug' }));
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    const body = JSON.parse((await h.publishContent(makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }), context)).body);
    expect(body.skipped).toBe(1);
    expect(body.mappings[0].slug).toBe('existing-slug');
    expect(store.queryDocs).not.toHaveBeenCalled(); // no collision probe on republish
    // version row says republished
    expect(store.upsertDoc.mock.calls.find(([c]) => c === 'content_versions')[1].versionReason).toBe(
      'republished'
    );
  });

  it('suffixes the slug only on a real collision by another doc', async () => {
    const store = makeStore(readyDoc(), {
      queryDocs: vi.fn(async () => [{ id: 'someone-else' }]),
    });
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    await h.publishContent(makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }), context);
    const patch = store.patchDoc.mock.calls.find(([c]) => c === 'content')[2];
    expect(patch.slug).toBe('migration-readiness-framework-c1'); // suffixed with id fragment
  });

  it('surfaces the scrapedImages warning without blocking the publish', async () => {
    const store = makeStore(readyDoc({ scrapedImages: [{ url: 'x', stored: false }] }));
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    const body = JSON.parse((await h.publishContent(makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }), context)).body);
    expect(body.published).toBe(1);
    expect(body.warnings.some((w) => /scrapedImages/.test(w.warning))).toBe(true);
  });

  it('bumps forge stats for forged first-publishes via read-modify-write', async () => {
    const store = makeStore(readyDoc({ forgeMeta: { formatKey: 'deep dive' } }), {
      readDoc: vi.fn(async (container, id) => {
        if (container === 'content') return readyDoc({ forgeMeta: { formatKey: 'deep dive' } });
        if (container === 'admin_config') return { id: 'forge_stats', totals: { published: 4 } };
        return null;
      }),
    });
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    await h.publishContent(makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }), context);
    const statsPatch = store.patchDoc.mock.calls.find(([c]) => c === 'admin_config');
    expect(statsPatch[2].totals.published).toBe(5);
    expect(statsPatch[2].formats['deep dive'].published).toBe(1);
    // admin_config is partitioned on a constant (/configScope) — defaulting
    // the partition key to the document id would write into the wrong logical
    // partition, so the call must pass it explicitly.
    expect(statsPatch[3]).toEqual({ partitionKey: 'admin_config' });
  });

  it('stamps configScope when creating forge stats, so the doc lands in the constant partition', async () => {
    const store = makeStore(readyDoc({ forgeMeta: { formatKey: 'deep dive' } }), {
      readDoc: vi.fn(async (container) => {
        if (container === 'admin_config') return null;
        return readyDoc({ forgeMeta: { formatKey: 'deep dive' } });
      }),
    });
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    await h.publishContent(makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }), context);
    const statsUpsert = store.upsertDoc.mock.calls.find(([c]) => c === 'admin_config');
    expect(statsUpsert[1]).toMatchObject({ id: 'forge_stats', configScope: 'admin_config' });
  });

  it('400s an empty batch and denies without store calls', async () => {
    const store = makeStore();
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    expect((await h.publishContent(makeRequest({ contentIds: [] }), context)).status).toBe(400);

    const denied = createPublishHandlers({ guard: denyGuard, store, ...fixed });
    expect((await denied.publishContent(makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }), context)).status).toBe(403);
    expect(store.readDoc).not.toHaveBeenCalled();
  });
});
