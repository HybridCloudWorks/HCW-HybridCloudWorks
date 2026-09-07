/**
 * The publish pipeline — pinned to processPublishContent (:1383-1600) and
 * publishContent (:6696). Load-bearing: the publishable-status table, both
 * gates persisting their failed reports, slug assignment (see the
 * 'slug assignment (#400)' block), metadata validation on new publishes only,
 * the cover trigger, and the batch accumulator's published/skipped/warning
 * math.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createPublishHandlers,
  resolveSlug,
  slugify,
  toPublicUrl,
  getPublicSectionForPublishTarget,
  validatePublishMetadata,
  applyPublishTimeCoverTrigger,
  accumulatePublishResult,
  REHOST_IMAGES_REASON,
} from './publish.js';

const context = { log: vi.fn(), error: vi.fn() };

const USER = { oid: 'u1', email: 'pub@hcw.dev' };
const guardAs = (role) => ({ requireRole: vi.fn(async () => ({ user: USER, role, error: null })) });
const denyGuard = {
  requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })),
};
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
    accumulatePublishResult(results, 'c', {
      blogId: 'c',
      reused: false,
      expectedPublicUrl: 'https://x',
    });
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
    await h.publishContent(
      makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
      context
    );

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
      (
        await h.publishContent(
          makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
          context
        )
      ).body
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
      (
        await h.publishContent(
          makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
          context
        )
      ).body
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
    const republished = makeStore(readyDoc({ socialCaptionGeneratedAt: '2026-08-20T00:00:00Z' }));
    const h2 = createPublishHandlers({ guard: guardAs('publisher'), store: republished, ...fixed });
    await h2.processPublishContent('c1', { markLive: true });
    expect(
      republished.patchDoc.mock.calls.find(([c]) => c === 'content')[2].socialCaptionTrigger
    ).toBeUndefined();
  });
});

describe('slug assignment (#400)', () => {
  const ID = 'abcdef123';

  it('resolveSlug: bare on a clean probe, suffixed on a clash, and null read per path', () => {
    // A clean probe keeps the bare slug — the readable URL is the point, and
    // what a clean probe cannot prove is documented at resolveSlug and caught
    // by scripts/report-slug-collisions.mjs.
    expect(resolveSlug({ candidate: 'a-title', contentId: ID, holders: [] })).toBe('a-title');
    expect(resolveSlug({ candidate: 'a-title', contentId: ID, holders: [ID] })).toBe('a-title');

    // Another document holds it: suffixed with the document id, either path.
    expect(resolveSlug({ candidate: 'a-title', contentId: ID, holders: [ID, 'other'] })).toBe(
      'a-title-abcdef'
    );

    // `holders: null` — the probe could not answer — is read differently by
    // the two paths, on purpose.
    expect(resolveSlug({ candidate: 'a-title', contentId: ID, holders: null })).toBe(
      'a-title-abcdef' // first assignment: ugly but always unique, never blocked
    );
    expect(resolveSlug({ candidate: 'a-title', contentId: ID, reuse: true, holders: null })).toBe(
      'a-title' // republish: a failed lookup must not move a live URL
    );

    // No candidate at all: the id is the whole slug (unchanged behaviour).
    expect(resolveSlug({ candidate: '', contentId: ID })).toBe('abcdef');
  });

  it('a first publish keeps its bare slug when the probe finds no other holder', async () => {
    const store = makeStore(); // queryDocs returns [] — a clean probe
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    await h.publishContent(
      makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
      context
    );
    expect(store.queryDocs).toHaveBeenCalledTimes(1);
    expect(store.patchDoc.mock.calls.find(([c]) => c === 'content')[2].slug).toBe(
      'migration-readiness-framework'
    );
  });

  it('a second document with the same title is suffixed, because the probe now sees the first', async () => {
    // The shape of #400: the generator wrote one site title onto more than one
    // article. The second publish probes, finds the first, and moves off.
    const docs = [
      readyDoc({ id: 'aaa111', Title: 'One Shared Title' }),
      readyDoc({ id: 'bbb222', Title: 'One Shared Title' }),
    ];
    const taken = [];
    const store = makeStore(docs[0], {
      readDoc: vi.fn(async (c, id) => (c === 'content' ? docs.find((d) => d.id === id) : null)),
      queryDocs: vi.fn(async () => taken.map((id) => ({ id }))),
      patchDoc: vi.fn(async (c, id, u) => {
        if (c === 'content' && u.slug === 'one-shared-title') taken.push(id);
        return { id, ...u };
      }),
    });
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    await h.publishContent(
      makeRequest({ contentIds: ['aaa111', 'bbb222'], publishTarget: 'framework' }),
      context
    );
    const slugs = store.patchDoc.mock.calls
      .filter(([c]) => c === 'content')
      .map(([, , u]) => u.slug);
    expect(slugs).toEqual(['one-shared-title', 'one-shared-title-bbb222']);
  });

  it('a first publish takes the always-unique slug when the probe throws', async () => {
    // The source's rule, kept: a lookup failure must not block a publish, and
    // with nothing established the suffixed slug is the only safe answer.
    const store = makeStore(readyDoc(), {
      queryDocs: vi.fn(async () => {
        throw new Error('Cosmos unavailable');
      }),
    });
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    const body = JSON.parse(
      (
        await h.publishContent(
          makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
          context
        )
      ).body
    );
    expect(body.published).toBe(1);
    expect(store.patchDoc.mock.calls.find(([c]) => c === 'content')[2].slug).toBe(
      'migration-readiness-framework-c1'
    );
  });

  it('a republish moves off a slug another document holds, probing Slug as well as slug', async () => {
    const store = makeStore(readyDoc({ contentStatus: 'published', slug: 'shared-slug' }), {
      queryDocs: vi.fn(async () => [{ id: 'c1' }, { id: '7MCkl1cSf7GGCgJxlCwZ' }]),
    });
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    await h.publishContent(
      makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
      context
    );
    const [, query, params] = store.queryDocs.mock.calls[0];
    // Both fields. `slug` and `Slug` carry different values on ten of the
    // twenty-two published articles, and the manifest routes on `slug || Slug`.
    expect(query).toBe('SELECT TOP 2 c.id FROM c WHERE c.slug = @slug OR c.Slug = @slug');
    expect(params).toEqual([{ name: '@slug', value: 'shared-slug' }]);
    const patch = store.patchDoc.mock.calls.find(([c]) => c === 'content')[2];
    expect(patch.slug).toBe('shared-slug-c1');
    expect(patch.Slug).toBe('shared-slug-c1');
  });

  it('a republish reads its slug from Slug when the document has no lowercase slug', async () => {
    const store = makeStore(readyDoc({ contentStatus: 'published', Slug: 'legacy-slug' }), {
      queryDocs: vi.fn(async () => [{ id: 'c1' }, { id: 'other' }]),
    });
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    await h.publishContent(
      makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
      context
    );
    expect(store.queryDocs.mock.calls[0][2]).toEqual([{ name: '@slug', value: 'legacy-slug' }]);
    expect(store.patchDoc.mock.calls.find(([c]) => c === 'content')[2].slug).toBe('legacy-slug-c1');
  });

  it('a probe that throws leaves a republished URL alone and still publishes', async () => {
    const store = makeStore(readyDoc({ contentStatus: 'published', slug: 'existing-slug' }), {
      queryDocs: vi.fn(async () => {
        throw new Error('Cosmos unavailable');
      }),
    });
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    const body = JSON.parse(
      (
        await h.publishContent(
          makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
          context
        )
      ).body
    );
    expect(body.errors).toEqual([]);
    expect(store.patchDoc.mock.calls.find(([c]) => c === 'content')[2].slug).toBe('existing-slug');
  });
});

describe('publishContent', () => {
  it('publishes a ready item: status, slug, URLs, provider, version row', async () => {
    const store = makeStore();
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    const res = await h.publishContent(
      makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
      context
    );
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
    const body = JSON.parse(
      (
        await h.publishContent(
          makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
          context
        )
      ).body
    );
    expect(body.errors[0].error).toMatch(/Cannot publish from status 'in_review'/);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('quality-gate failure persists the report and errors (bypass overrides)', async () => {
    const thin = readyDoc({ overviewHtml: 'Too short.', summary: 'x', frameworkConcepts: [] });
    const store = makeStore(thin);
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });

    const body = JSON.parse(
      (
        await h.publishContent(
          makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
          context
        )
      ).body
    );
    expect(body.errors[0].error).toMatch(/quality gate failed/);
    // The failed report was persisted onto the doc.
    expect(store.patchDoc.mock.calls[0][2]).toHaveProperty('contentQuality');
    expect(store.patchDoc.mock.calls[0][2].contentQuality.ready).toBe(false);

    const bypass = makeStore(thin);
    const h2 = createPublishHandlers({ guard: guardAs('publisher'), store: bypass, ...fixed });
    const ok = JSON.parse(
      (
        await h2.publishContent(
          makeRequest({
            contentIds: ['c1'],
            publishTarget: 'framework',
            forceQualityBypass: true,
            forceImageBypass: true,
          }),
          context
        )
      ).body
    );
    expect(ok.published).toBe(1);
  });

  it('republish reuses the stored slug and counts as skipped', async () => {
    const store = makeStore(readyDoc({ contentStatus: 'published', slug: 'existing-slug' }));
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    const body = JSON.parse(
      (
        await h.publishContent(
          makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
          context
        )
      ).body
    );
    expect(body.skipped).toBe(1);
    expect(body.mappings[0].slug).toBe('existing-slug');
    // version row says republished
    expect(
      store.upsertDoc.mock.calls.find(([c]) => c === 'content_versions')[1].versionReason
    ).toBe('republished');
  });

  it('surfaces the scrapedImages warning without blocking the publish', async () => {
    const store = makeStore(readyDoc({ scrapedImages: [{ url: 'x', stored: false }] }));
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    const body = JSON.parse(
      (
        await h.publishContent(
          makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
          context
        )
      ).body
    );
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
    await h.publishContent(
      makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
      context
    );
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
    await h.publishContent(
      makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
      context
    );
    const statsUpsert = store.upsertDoc.mock.calls.find(([c]) => c === 'admin_config');
    expect(statsUpsert[1]).toMatchObject({ id: 'forge_stats', configScope: 'admin_config' });
  });

  it('400s an empty batch and denies without store calls', async () => {
    const store = makeStore();
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    expect((await h.publishContent(makeRequest({ contentIds: [] }), context)).status).toBe(400);

    const denied = createPublishHandlers({ guard: denyGuard, store, ...fixed });
    expect(
      (
        await denied.publishContent(
          makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
          context
        )
      ).status
    ).toBe(403);
    expect(store.readDoc).not.toHaveBeenCalled();
  });
});

describe('inline body images at publish time (#374)', () => {
  const UPSTREAM = 'https://devblogs.microsoft.com/foundry/wp-content/uploads/rubric.png';
  const HOSTED = '/api/public/media/covers/c1/inline/abcdef0123456789.png';
  const doc = () =>
    readyDoc({
      Content: `<p>${paragraph(2)}</p><img src="${UPSTREAM}" alt="Rubric"> ![d](https://cdn.example.org/d.webp)`,
    });

  it('rewrites the rendered body field and records the summary in the publish patch', async () => {
    const store = makeStore(doc());
    const inlineImages = vi.fn(async ({ bodies }) => ({
      bodies: Object.fromEntries(
        Object.entries(bodies).map(([f, b]) => [f, b.replace(UPSTREAM, HOSTED)])
      ),
      rewritten: [{ from: UPSTREAM, to: HOSTED }],
      failed: [{ url: 'https://cdn.example.org/d.webp', reason: 'HTTP 403' }],
    }));
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, inlineImages, ...fixed });
    await h.publishContent(
      makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
      context
    );

    expect(inlineImages).toHaveBeenCalledWith({
      contentId: 'c1',
      bodies: { Content: doc().Content },
    });
    const publishPatch = store.patchDoc.mock.calls.find(
      ([c, , u]) => c === 'content' && u.contentStatus === 'published'
    );
    expect(publishPatch[2].Content).toContain(HOSTED);
    expect(publishPatch[2].Content).not.toContain(UPSTREAM);
    expect(publishPatch[2].Content).toContain('https://cdn.example.org/d.webp');
    expect(publishPatch[2].inlineImages).toEqual({
      fields: ['Content'],
      rewritten: 1,
      failed: 1,
      failedUrls: ['https://cdn.example.org/d.webp'],
      at: NOW.toISOString(),
    });
    // The version snapshot carries the rewritten body too.
    const version = store.upsertDoc.mock.calls.find(([c]) => c === 'content_versions');
    expect(version[1].draft).toContain(HOSTED);
  });

  it('publishes the body untouched when no rehoster is injected', async () => {
    const store = makeStore(doc());
    const h = createPublishHandlers({ guard: guardAs('publisher'), store, ...fixed });
    const body = JSON.parse(
      (
        await h.publishContent(
          makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
          context
        )
      ).body
    );
    expect(body.published).toBe(1);
    const publishPatch = store.patchDoc.mock.calls.find(
      ([c, , u]) => c === 'content' && u.contentStatus === 'published'
    );
    expect(publishPatch[2].Content).toBeUndefined();
    expect(publishPatch[2].inlineImages).toBeUndefined();
  });

  it('still publishes when the rehoster throws whole', async () => {
    const store = makeStore(doc());
    const inlineImages = vi.fn(async () => {
      throw new Error('storage unreachable');
    });
    const log = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };
    const h = createPublishHandlers({
      guard: guardAs('publisher'),
      store,
      inlineImages,
      log,
      ...fixed,
    });
    const body = JSON.parse(
      (
        await h.publishContent(
          makeRequest({ contentIds: ['c1'], publishTarget: 'framework' }),
          context
        )
      ).body
    );
    expect(body.published).toBe(1);
    expect(body.errors).toEqual([]);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

describe('reason: rehost-images — the #374 backfill republish', () => {
  const UPSTREAM = 'https://techcommunity.microsoft.com/t5/image/serverpage/a.png';
  const HOSTED = '/api/public/media/covers/c1/inline/abcdef0123456789.png';
  // A live article as the backfill finds it: published, no cover of its own
  // (so a full republish would arm cover generation), never social-posted
  // (so a live republish would arm the caption trigger), forged (so a first
  // publish would bump the stats), and hotlinking one image.
  const liveDoc = (over = {}) =>
    readyDoc({
      contentStatus: 'published',
      Live: true,
      slug: 'existing-slug',
      curatedSubpagePath: '/azure/frameworks/existing-slug',
      publishedUrl: 'https://hybridcloudworks.com/azure/frameworks/existing-slug',
      publishedAt: '2026-08-01T00:00:00.000Z',
      forgeMeta: { formatKey: 'deep dive' },
      _etag: '"v7"',
      Content: `<p>${paragraph(2)}</p><img src="${UPSTREAM}" alt="a">`,
      ...over,
    });
  const rehoster = () =>
    vi.fn(async ({ bodies }) => ({
      bodies: Object.fromEntries(
        Object.entries(bodies).map(([f, b]) => [f, b.replace(UPSTREAM, HOSTED)])
      ),
      rewritten: [{ from: UPSTREAM, to: HOSTED }],
      failed: [],
    }));
  const handlers = (store, inlineImages = rehoster()) =>
    createPublishHandlers({ guard: guardAs('publisher'), store, inlineImages, ...fixed });

  it('a plain republish of that article re-arms both triggers — the reason exists to stop that', async () => {
    const store = makeStore(liveDoc());
    await handlers(store).processPublishContent('c1', { markLive: true });
    const patch = store.patchDoc.mock.calls.find(([c]) => c === 'content')[2];
    expect(patch.altCoverImageTrigger).toBe(true);
    expect(patch.socialCaptionTrigger).toBe(true);
    expect(patch.contentStatus).toBe('published');
  });

  it('writes only the rewritten body, the summary and updatedAt, conditioned on the ETag', async () => {
    const store = makeStore(liveDoc());
    const result = await handlers(store).processPublishContent('c1', {
      user: USER,
      markLive: true,
      reason: REHOST_IMAGES_REASON,
    });

    const contentWrites = store.patchDoc.mock.calls.filter(([c]) => c === 'content');
    expect(contentWrites).toHaveLength(1);
    const [, id, patch, options] = contentWrites[0];
    expect(id).toBe('c1');
    expect(Object.keys(patch).sort()).toEqual(['Content', 'inlineImages', 'updatedAt']);
    expect(patch.Content).toContain(HOSTED);
    expect(patch.Content).not.toContain(UPSTREAM);
    expect(patch.inlineImages).toEqual({
      fields: ['Content'],
      rewritten: 1,
      failed: 0,
      failedUrls: [],
      at: NOW.toISOString(),
    });
    expect(patch.updatedAt).toBe(NOW.toISOString());
    expect(options).toEqual({ ifMatch: '"v7"' });

    // No forge stats, no slug probe; the version row names the reason.
    expect(store.patchDoc.mock.calls.some(([c]) => c === 'admin_config')).toBe(false);
    expect(store.queryDocs).not.toHaveBeenCalled();
    const version = store.upsertDoc.mock.calls.find(([c]) => c === 'content_versions')[1];
    expect(version.versionReason).toBe(REHOST_IMAGES_REASON);
    expect(version.draft).toContain(HOSTED);
    expect(version.versionCreatedBy).toBe('pub@hcw.dev');

    // The caller gets the summary and the document's own identity, unchanged.
    expect(result.rehosted).toBe(true);
    expect(result.reused).toBe(true);
    expect(result.inlineImages).toEqual(patch.inlineImages);
    expect(result.slug).toBe('existing-slug');
    expect(result.expectedPublicUrl).toBe(
      'https://hybridcloudworks.com/azure/frameworks/existing-slug'
    );
  });

  it('refuses anything that is not already published, without writing', async () => {
    const store = makeStore(liveDoc({ contentStatus: 'approved', Live: false }));
    const result = await handlers(store).processPublishContent('c1', {
      reason: REHOST_IMAGES_REASON,
    });
    expect(result.error).toMatch(/Only a published document can be re-hosted/);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('skips an article with nothing to re-host, without writing', async () => {
    const store = makeStore(liveDoc({ Content: `<p>${paragraph(2)}</p><img src="${HOSTED}">` }));
    const inlineImages = rehoster();
    const result = await handlers(store, inlineImages).processPublishContent('c1', {
      reason: REHOST_IMAGES_REASON,
    });
    expect(result).toEqual({
      skipped: true,
      reason: 'No third-party image URLs in the body fields',
    });
    expect(inlineImages).not.toHaveBeenCalled();
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('errors, rather than reporting a re-host, when no rehoster is wired or it throws whole', async () => {
    const unwired = createPublishHandlers({
      guard: guardAs('publisher'),
      store: makeStore(liveDoc()),
      ...fixed,
    });
    expect(
      (await unwired.processPublishContent('c1', { reason: REHOST_IMAGES_REASON })).error
    ).toMatch(/not configured/);

    const store = makeStore(liveDoc());
    const broken = createPublishHandlers({
      guard: guardAs('publisher'),
      store,
      inlineImages: vi.fn(async () => {
        throw new Error('storage unreachable');
      }),
      log: { warn: vi.fn() },
      ...fixed,
    });
    const result = await broken.processPublishContent('c1', { reason: REHOST_IMAGES_REASON });
    expect(result.error).toMatch(/Re-hosting failed/);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('reports a lost race as skipped', async () => {
    const conflict = Object.assign(new Error('precondition failed'), { code: 412 });
    const store = makeStore(liveDoc(), {
      patchDoc: vi.fn(async () => {
        throw conflict;
      }),
    });
    const result = await handlers(store).processPublishContent('c1', {
      reason: REHOST_IMAGES_REASON,
    });
    expect(result).toEqual({
      skipped: true,
      reason: 'Content changed while re-hosting; not retried',
    });
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });
});
