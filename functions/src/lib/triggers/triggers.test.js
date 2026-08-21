import { describe, it, expect, vi } from 'vitest';
import { markerForFields, shouldProcessValue, PROCESS_REASONS } from './value-marker.js';
import {
  evaluateRisingEdgeClaim,
  claimRisingEdge,
  releaseRisingEdgeClaim,
  SKIP_REASONS,
  CLAIM_REASONS,
} from './rising-edge-claim.js';
import { evaluateActivationNotice } from './activation-notice.js';
import { fetchImage, isExternalUrlString, isPrivateIp, validateFetchUrl } from './fetch-image.js';
import { buildCoverSvg, wrapText, brandingFor } from './cover-svg.js';
import { createImageMirror, downloadUrlFor } from './image-mirror.js';
import {
  classifyContentBucket,
  buildDashboardStatsDeltas,
  applyDeltas,
  createDashboardStatsMaintainer,
} from './dashboard-stats.js';
import {
  createAiCoverGenerator,
  createReplicateClient,
  resolveAiCoverTargets,
} from './ai-cover.js';
import { createFeedHandlers, unpublishFromPubler, buildPublerUpdateBody } from './handlers.js';
import { createNotifier } from '../notify.js';

const NOW = new Date('2026-08-21T12:00:00.000Z');
const now = () => NOW;

function memStore(containers = {}) {
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
    replaceDocIfMatch: vi.fn(async (c, doc) => {
      const cur = get(c).get(doc.id);
      if (cur && cur._etag !== doc._etag) {
        const e = new Error('412');
        e.code = 412;
        throw e;
      }
      const next = { ...doc, _etag: `${doc._etag || 'e'}+` };
      get(c).set(doc.id, next);
      return next;
    }),
    deleteDoc: vi.fn(async (c, id) => {
      get(c).delete(id);
    }),
    queryDocs: vi.fn(async () => []),
  };
}

describe('pure decisions', () => {
  it('value marker: two-tier, reads live only on disagreement', async () => {
    const m = markerForFields({ caption: 'a', accountIds: ['x', 'y'] }, ['caption', 'accountIds']);
    expect(m).toHaveLength(32);
    expect(
      markerForFields({ caption: 'a', accountIds: ['y', 'x'] }, ['caption', 'accountIds'])
    ).not.toBe(m);
    const live = vi.fn(async () => 'u');
    expect(
      await shouldProcessValue({ value: 'u', snapshotMarker: 'u', readLiveMarker: live })
    ).toEqual({ process: false, reason: PROCESS_REASONS.UNCHANGED_IN_EVENT });
    expect(live).not.toHaveBeenCalled();
    expect(
      (await shouldProcessValue({ value: 'u', snapshotMarker: 'old', readLiveMarker: live })).reason
    ).toBe(PROCESS_REASONS.UNCHANGED_IN_LIVE_STATE);
    expect(
      (await shouldProcessValue({ value: 'v', snapshotMarker: 'old', readLiveMarker: live }))
        .process
    ).toBe(true);
  });

  it('rising-edge claim: flag, duplicate event, fresh vs stale vs undated claims', () => {
    const spec = {
      flagField: 'f',
      claimField: 'c',
      claimedAtField: 'at',
      eventId: 'e1',
      now: NOW.getTime(),
    };
    expect(evaluateRisingEdgeClaim(null, spec).reason).toBe(SKIP_REASONS.DOCUMENT_MISSING);
    expect(evaluateRisingEdgeClaim({ f: false }, spec).reason).toBe(SKIP_REASONS.FLAG_NOT_SET);
    expect(evaluateRisingEdgeClaim({ f: true }, spec)).toEqual({
      claim: true,
      reason: CLAIM_REASONS.CLAIMED,
    });
    expect(evaluateRisingEdgeClaim({ f: true, c: 'e1' }, spec).reason).toBe(
      SKIP_REASONS.ALREADY_RUN_BY_THIS_EVENT
    );
    expect(
      evaluateRisingEdgeClaim(
        { f: true, c: 'e0', at: new Date(NOW.getTime() - 60000).toISOString() },
        spec
      ).reason
    ).toBe(SKIP_REASONS.CLAIMED_BY_ANOTHER_RUN);
    expect(
      evaluateRisingEdgeClaim(
        { f: true, c: 'e0', at: new Date(NOW.getTime() - 16 * 60000).toISOString() },
        spec
      ).reason
    ).toBe(CLAIM_REASONS.RECLAIMED_STALE);
    expect(evaluateRisingEdgeClaim({ f: true, c: 'e0' }, spec).reason).toBe(
      SKIP_REASONS.CLAIM_TIMESTAMP_UNREADABLE
    );
    expect(releaseRisingEdgeClaim(spec)).toEqual({ c: null, at: null });
  });

  it('claimRisingEdge writes the claim with an etag replace and retries on 412', async () => {
    const store = memStore({ content: [{ id: 'c1', altCoverImageTrigger: true, _etag: 'e' }] });
    store.replaceDocIfMatch.mockImplementationOnce(async () => {
      const e = new Error('412');
      e.code = 412;
      throw e;
    });
    const r = await claimRisingEdge(store, 'content', 'c1', {
      flagField: 'altCoverImageTrigger',
      claimField: 'runId',
      claimedAtField: 'runAt',
      eventId: 'ev',
      now,
    });
    expect(r.claim).toBe(true);
    expect(store.replaceDocIfMatch).toHaveBeenCalledTimes(2);
    expect(store.data.content.get('c1')).toMatchObject({ runId: 'ev', runAt: NOW.toISOString() });
  });

  it('activation notice', () => {
    expect(evaluateActivationNotice(null).send).toBe(false);
    expect(evaluateActivationNotice({ active: false }).send).toBe(false);
    expect(evaluateActivationNotice({ active: true, activationNotifiedAt: '2026' }).send).toBe(
      false
    );
    expect(evaluateActivationNotice({ active: true, activationNotifiedAt: null }).send).toBe(true);
  });
});

describe('fetch-image', () => {
  it('refuses private targets, non-http, Firebase URLs; follows redirects with re-validation', async () => {
    expect(isPrivateIp('10.1.2.3')).toBe(true);
    expect(isPrivateIp('172.31.0.1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    await expect(
      validateFetchUrl('ftp://x', { resolve: async () => ({ address: '1.1.1.1' }) })
    ).rejects.toThrow('Invalid protocol');
    await expect(
      validateFetchUrl('https://internal.test', {
        resolve: async () => ({ address: '192.168.1.1' }),
      })
    ).rejects.toThrow('Private IP');
    expect(isExternalUrlString('https://firebasestorage.googleapis.com/v0/b/x/o/y')).toBe(false);
    expect(isExternalUrlString('https://cdn.test/a.png')).toBe(true);
    expect(isExternalUrlString([{ downloadURL: 'x' }])).toBe(false);
    const fetch = vi.fn(async (url) =>
      url === 'https://a.test/img'
        ? { status: 302, headers: new Map([['location', '/real.png']]) }
        : {
            status: 200,
            headers: new Map([['content-type', 'image/png; charset=binary']]),
            arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
          }
    );
    const r = await fetchImage('https://a.test/img', {
      fetch,
      resolve: async () => ({ address: '1.1.1.1' }),
    });
    expect(r.contentType).toBe('image/png');
    expect(r.buffer.length).toBe(2);
    expect(fetch.mock.calls[1][0]).toBe('https://a.test/real.png');
    const bad = vi.fn(async () => ({ status: 404, headers: new Map() }));
    await expect(
      fetchImage('https://a.test/x', { fetch: bad, resolve: async () => ({ address: '1.1.1.1' }) })
    ).rejects.toThrow('HTTP 404');
  });
});

describe('cover svg + image mirror', () => {
  it('wraps titles, escapes XML, brands by provider', () => {
    expect(wrapText('one two three four five six seven eight nine ten eleven twelve', 12)).toEqual([
      'one two',
      'three four',
      'five six',
    ]);
    expect(wrapText('')).toEqual(['Untitled']);
    const svg = buildCoverSvg('aws', 'Cut <costs> & "win"', 'Cost');
    expect(svg).toContain('Cut &lt;costs&gt; &amp; &quot;win&quot;');
    expect(svg).toContain('#ff9900');
    expect(brandingFor('VMware').label).toBe('VMWARE');
    expect(brandingFor('nope').label).toBe('AZURE');
  });

  it('mirrors a new external URL once, writes the Rowy field + marker, keeps speakerevents private', async () => {
    const store = memStore({
      blogs: [{ id: 'b1', contentImageUrl: 'https://cdn.test/c.jpg' }],
      speakerevents: [{ id: 's1', eventImageUrl: 'https://cdn.test/e.svg' }],
    });
    const storage = { uploadBlob: vi.fn(async () => 'https://blob/x') };
    const fetchImage = vi.fn(async (url) => ({
      buffer: Buffer.from('img'),
      contentType: url.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg',
    }));
    const mirror = createImageMirror({ store, storage, fetchImage });
    expect(await mirror.mirror('blogs', store.data.blogs.get('b1'))).toEqual({
      mirrored: true,
      reason: 'mirrored',
    });
    expect(storage.uploadBlob).toHaveBeenCalledWith(
      'blogs',
      'b1/images/cover.jpg',
      expect.any(Buffer),
      'image/jpeg',
      { sourceUrl: 'https://cdn.test/c.jpg' }
    );
    expect(store.data.blogs.get('b1')).toMatchObject({
      contentImageSourceUrl: 'https://cdn.test/c.jpg',
      'Cover Image': [
        {
          downloadURL: '/api/public/media/blogs/b1/images/cover.jpg',
          name: 'cover.jpg',
          type: 'image/jpeg',
          size: 3,
          ref: 'b1/images/cover.jpg',
        },
      ],
    });
    expect((await mirror.mirror('blogs', store.data.blogs.get('b1'))).reason).toBe(
      'unchanged_in_event'
    );
    expect(
      (await mirror.mirror('blogs', { id: 'b1', contentImageUrl: 'https://cdn.test/c.jpg' })).reason
    ).toBe('unchanged_in_live_state');
    await mirror.mirror('speakerevents', store.data.speakerevents.get('s1'));
    expect(store.data.speakerevents.get('s1').images[0]).toMatchObject({
      downloadURL: 'https://cdn.test/e.svg',
      ref: 's1/images/event-image.svg',
    });
    expect(downloadUrlFor('certifications', 'c/images/b.png', 'https://src')).toBe(
      '/api/public/media/certifications/c/images/b.png'
    );
    fetchImage.mockRejectedValueOnce(new Error('HTTP 403'));
    expect(
      (await mirror.mirror('blogs', { id: 'b2', contentImageUrl: 'https://cdn.test/z.png' })).reason
    ).toBe('error: HTTP 403');
    expect(store.data.blogs.get('b2')).toBeUndefined(); // no marker on failure
  });

  it('generates a template SVG cover only for a titled blog with no image source and no cover', async () => {
    const store = memStore({
      blogs: [{ id: 'b1', Title: 'T', 'Cloud Provider': 'Aws', category: 'Cost' }],
    });
    const storage = { uploadBlob: vi.fn(async () => 'u') };
    const mirror = createImageMirror({ store, storage, fetchImage: vi.fn() });
    expect(await mirror.generateTemplateCover(store.data.blogs.get('b1'))).toEqual({
      generated: true,
      reason: 'generated',
    });
    expect(storage.uploadBlob.mock.calls[0].slice(0, 2)).toEqual([
      'blogs',
      'b1/images/generated-cover.svg',
    ]);
    expect(storage.uploadBlob.mock.calls[0][3]).toBe('image/svg+xml');
    expect(store.data.blogs.get('b1')).toMatchObject({
      generatedCover: true,
      'Cover Image': [{ downloadURL: '/api/public/media/blogs/b1/images/generated-cover.svg' }],
    });
    expect((await mirror.generateTemplateCover(store.data.blogs.get('b1'))).reason).toBe(
      'has_cover'
    );
    expect(
      (await mirror.generateTemplateCover({ id: 'x', Title: 'T', contentImageUrl: 'https://i' }))
        .reason
    ).toBe('has_content_image_url');
    expect((await mirror.generateTemplateCover({ id: 'x' })).reason).toBe('no_title');
  });
});

describe('dashboard stats', () => {
  it('classifies like the snapshot summary and diffs positions', () => {
    expect(classifyContentBucket({ contentStatus: 'rejected' })).toBe('rejected');
    expect(classifyContentBucket({ contentStatus: 'archived' })).toBeNull();
    expect(classifyContentBucket({ Live: true, contentStatus: 'published' })).toBe('published');
    expect(classifyContentBucket({ contentStatus: 'ingested' })).toBe('needsReview');
    expect(classifyContentBucket({ contentStatus: 'approved' })).toBe('inProgress');
    expect(
      buildDashboardStatsDeltas(
        { exists: true, bucket: 'needsReview', type: 'blog' },
        { exists: true, bucket: 'published', type: 'blog' }
      )
    ).toEqual({ 'blog.needsReview': -1, 'blog.published': 1 });
    expect(
      buildDashboardStatsDeltas(null, { exists: true, bucket: 'rejected', type: 'blog' })
    ).toEqual({ totalDocs: 1, rejected: 1 });
    expect(
      buildDashboardStatsDeltas({ exists: true, bucket: 'inProgress', type: 'news' }, null)
    ).toEqual({ totalDocs: -1, 'news.inProgress': -1, 'news.total': -1 });
    expect(applyDeltas({ blog: { total: 1 } }, { 'blog.total': -2, totalDocs: 1 })).toEqual({
      blog: { total: 0 },
      totalDocs: 1,
    });
  });

  it('moves counters via the marker, idempotently, and handles deletes', async () => {
    const store = memStore();
    const m = createDashboardStatsMaintainer({ store, now });
    const doc = { id: 'c1', contentStatus: 'ingested', type: 'blog' };
    expect(await m.applyTransition({ contentId: 'c1', afterData: doc })).toEqual({
      totalDocs: 1,
      'blog.needsReview': 1,
      'blog.total': 1,
    });
    expect(store.data.content_stats_markers.get('c1')).toMatchObject({
      bucket: 'needsReview',
      type: 'blog',
    });
    expect(store.data.system.get('dashboard_stats_v1')).toMatchObject({
      totalDocs: 1,
      blog: { needsReview: 1, total: 1 },
    });
    expect(await m.applyTransition({ contentId: 'c1', afterData: doc })).toEqual({}); // redelivery
    expect(await m.applyTransition({ contentId: 'c1', afterData: { ...doc, Live: true } })).toEqual(
      { 'blog.needsReview': -1, 'blog.published': 1 }
    );
    expect(await m.applyTransition({ contentId: 'c1', afterData: null })).toEqual({
      totalDocs: -1,
      'blog.published': -1,
      'blog.total': -1,
    });
    expect(store.data.content_stats_markers.get('c1')).toBeUndefined();
    expect(store.data.system.get('dashboard_stats_v1')).toMatchObject({
      totalDocs: 0,
      blog: { needsReview: 0, published: 0, total: 0 },
    });
  });
});

describe('AI cover', () => {
  it('replicate client: not configured, retries 429, polls until succeeded', async () => {
    expect(createReplicateClient({ env: {} }).configured).toBe(false);
    await expect(createReplicateClient({ env: {} }).generate('p')).rejects.toThrow(
      'REPLICATE_API_KEY'
    );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'p1', status: 'processing', urls: { get: 'https://r/p1' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'p1', status: 'succeeded', output: ['https://img/1.png'] }),
      });
    const client = createReplicateClient({
      env: { REPLICATE_API_KEY: 'k' },
      fetch,
      sleep: async () => {},
    });
    expect(await client.generate('p')).toBe('https://img/1.png');
    expect(fetch.mock.calls[0][0]).toBe(
      'https://api.replicate.com/v1/models/google/imagen-4-fast/predictions'
    );
    expect(resolveAiCoverTargets({ aiImageTargets: ['hero', 'a', 'b', 'c', 'd'] })).toHaveLength(4);
  });

  it('claims, generates per target, persists images, releases the claim; releases on failure too', async () => {
    const store = memStore({
      content: [
        {
          id: 'c1',
          altCoverImageTrigger: true,
          Title: 'T',
          'Cloud Provider': 'AWS',
          aiImageTargets: ['hero', 'card'],
          _etag: 'e',
        },
      ],
    });
    const storage = { uploadBlob: vi.fn(async () => 'u') };
    const replicate = { generate: vi.fn(async () => 'https://img/x.png') };
    const fetchImage = vi.fn(async () => ({
      buffer: Buffer.from('png'),
      contentType: 'image/png',
    }));
    let n = 0;
    const gen = createAiCoverGenerator({
      store,
      storage,
      replicate,
      fetchImage,
      now,
      uuid: () => `g${++n}`,
    });
    const r = await gen.run('c1', 'ev1');
    expect(r).toEqual({ ran: true, reason: 'generated', targets: ['hero', 'card'] });
    expect(replicate.generate).toHaveBeenCalledTimes(2);
    expect(replicate.generate.mock.calls[0][0]).toMatch(/Lego minifigure[\s\S]*Image slot: hero/);
    expect(storage.uploadBlob.mock.calls.map((c) => c[1])).toEqual([
      'c1-ai-hero.png',
      'c1-ai-card.png',
    ]);
    const doc = store.data.content.get('c1');
    expect(doc).toMatchObject({
      altCoverImageTrigger: false,
      altCoverImageRunId: null,
      altCoverImage: '/api/public/media/covers/c1-ai-hero.png',
      aiImageUrls: {
        hero: '/api/public/media/covers/c1-ai-hero.png',
        card: '/api/public/media/covers/c1-ai-card.png',
      },
      altCoverImageError: null,
    });
    expect(doc.aiImageHistory.hero).toEqual(['/api/public/media/covers/c1-ai-hero.png']);
    expect(store.data.generated_content_images.size).toBe(2);
    expect((await gen.run('c1', 'ev1')).reason).toBe(SKIP_REASONS.FLAG_NOT_SET);

    store.data.content.set('c2', { id: 'c2', altCoverImageTrigger: true, _etag: 'e' });
    replicate.generate.mockRejectedValueOnce(new Error('Replicate HTTP 503'));
    expect((await gen.run('c2', 'ev2')).reason).toBe('error: Replicate HTTP 503');
    expect(store.data.content.get('c2')).toMatchObject({
      altCoverImageTrigger: false,
      altCoverImageRunId: null,
      altCoverImageError: 'Replicate HTTP 503',
    });
  });
});

describe('feed handlers', () => {
  function deps(store) {
    return {
      store,
      mirror: {
        mirror: vi.fn(async () => ({ mirrored: false, reason: 'not_external_url' })),
        generateTemplateCover: vi.fn(async () => ({ generated: false, reason: 'no_title' })),
      },
      inspector: { executeInspection: vi.fn(async () => ({ contentStatus: 'inspected' })) },
      aiCover: { run: vi.fn(async () => ({ ran: true, reason: 'generated' })) },
      dashboardStats: { applyTransition: vi.fn(async () => ({})) },
      notifier: { notifyTelegram: vi.fn(async () => ({ sent: true })) },
      publer: { configured: true, request: vi.fn(async () => ({})) },
      now,
    };
  }

  it('blogs: mirror, template cover, and the claimed slug page', async () => {
    const store = memStore({
      blogs: [
        {
          id: 'b1',
          Title: 'Hello World',
          createSlugPageTrigger: true,
          'Cloud Provider': 'AWS',
          _etag: 'e',
        },
      ],
    });
    const d = deps(store);
    const h = createFeedHandlers(d);
    const [r] = await h.blogs([store.data.blogs.get('b1')], {});
    expect(r).toMatchObject({ mirrored: 'not_external_url', cover: 'no_title', slug: 'created' });
    expect(store.data.blogs.get('b1')).toMatchObject({
      slug: 'hello-world-b1',
      curatedSubpagePath: '/aws/blog/hello-world-b1',
      createSlugPageTrigger: false,
      createSlugPageRunId: null,
      curatedSubpage: true,
    });
    const [again] = await h.blogs([store.data.blogs.get('b1')], {});
    expect(again.slug).toBe(SKIP_REASONS.FLAG_NOT_SET);
  });

  it('content: inspect on flag (recording errors), AI cover on flag, counters always', async () => {
    const store = memStore({
      content: [{ id: 'c1', inspectTrigger: true, altCoverImageTrigger: true, url: 'https://s' }],
    });
    const d = deps(store);
    const h = createFeedHandlers(d);
    const ctx = { error: vi.fn() };
    expect(await h.content([store.data.content.get('c1'), { id: 'c2' }], ctx)).toEqual([
      { id: 'c1', inspected: 'inspected', aiCover: 'generated', statsMoved: false },
      { id: 'c2', statsMoved: false },
    ]);
    expect(d.dashboardStats.applyTransition).toHaveBeenCalledTimes(2);
    d.inspector.executeInspection.mockRejectedValueOnce(new Error('Status code 403'));
    const [r] = await h.content([{ id: 'c3', inspectTrigger: true }], ctx);
    expect(r.inspected).toBe('error');
    expect(store.data.content.get('c3')).toMatchObject({
      inspectTrigger: false,
      inspectError: 'Status code 403',
      inspectErrorAt: NOW.toISOString(),
    });
  });

  it('workflow alerts: announces once per activation, stamps after a successful send only', async () => {
    const store = memStore({
      workflow_alerts: [
        {
          id: 'a1',
          active: true,
          alertType: 'link_rot_detected',
          severity: 'warning',
          brokenCount: 2,
          _etag: 'e',
        },
      ],
    });
    const d = deps(store);
    const h = createFeedHandlers(d);
    expect((await h.workflowAlerts([store.data.workflow_alerts.get('a1')], {}))[0]).toEqual({
      id: 'a1',
      sent: true,
      reason: 'sent',
    });
    expect(d.notifier.notifyTelegram.mock.calls[0][0]).toMatchObject({
      title: 'Workflow alert: link_rot_detected',
      severity: 'warning',
    });
    expect(JSON.parse(d.notifier.notifyTelegram.mock.calls[0][0].message)).toEqual({
      severity: 'warning',
      brokenCount: 2,
    });
    expect(store.data.workflow_alerts.get('a1').activationNotifiedAt).toBe(NOW.toISOString());
    expect((await h.workflowAlerts([store.data.workflow_alerts.get('a1')], {}))[0].reason).toBe(
      'snapshot'
    );
    d.notifier.notifyTelegram.mockResolvedValueOnce({ sent: false, reason: 'not_configured' });
    store.data.workflow_alerts.set('a2', { id: 'a2', active: true });
    expect((await h.workflowAlerts([store.data.workflow_alerts.get('a2')], {}))[0]).toEqual({
      id: 'a2',
      sent: false,
      reason: 'not_configured',
    });
    expect(store.data.workflow_alerts.get('a2').activationNotifiedAt).toBeUndefined();
  });

  it('social posts: pushes calendar edits once, skips Publer-origin, records failures; unpublish on delete', async () => {
    const store = memStore({
      social_posts: [
        {
          id: 's1',
          caption: 'hi',
          url: 'https://u',
          scheduledAt: '2026-09-01T10:00:00Z',
          publerPostIds: ['p1'],
          publerActivePostIds: ['p1', 'p2'],
        },
        { id: 's2', caption: 'x', publerPostIds: ['p9'], syncOrigin: 'publer' },
        { id: 's3', caption: 'y' },
      ],
    });
    const d = deps(store);
    const h = createFeedHandlers(d);
    const rs = await h.socialPosts([...store.data.social_posts.values()], { error: vi.fn() });
    expect(rs.map((r) => r.reason)).toEqual(['pushed', 'origin_publer', 'no_publer_ids']);
    expect(d.publer.request.mock.calls.map((c) => c[0])).toEqual(['/posts/p1', '/posts/p2']);
    expect(d.publer.request.mock.calls[0][2]).toEqual({
      post: { text: 'hi\n\nhttps://u', scheduled_at: '2026-09-01T10:00:00.000Z' },
    });
    expect(store.data.social_posts.get('s1')).toMatchObject({
      syncStatus: 'synced',
      syncOrigin: 'calendar',
      syncError: null,
    });
    expect((await h.socialPosts([store.data.social_posts.get('s1')], {}))[0].reason).toBe(
      'unchanged_in_event'
    );
    d.publer.request.mockRejectedValueOnce(new Error('Publer PUT failed'));
    store.data.social_posts.set('s4', { id: 's4', caption: 'z', publerPostIds: ['p4'] });
    expect(
      (await h.socialPosts([store.data.social_posts.get('s4')], { error: vi.fn() }))[0].reason
    ).toBe('error');
    expect(store.data.social_posts.get('s4')).toMatchObject({
      syncStatus: 'failed',
      syncOrigin: 'system',
      syncError: 'Publer PUT failed',
    });
    expect(() => buildPublerUpdateBody({})).toThrow(/caption or URL/);
    d.publer.request.mockResolvedValue({});
    expect(await unpublishFromPubler(d.publer, { publerPostIds: ['p1', 'p2'] })).toEqual({
      attempted: 2,
      removed: 2,
    });
    expect(await unpublishFromPubler({ configured: false }, { publerPostIds: ['p1'] })).toEqual({
      attempted: 0,
      removed: 0,
    });
  });
});

describe('notifier', () => {
  it('skips when unconfigured, honours the per-source cooldown, stamps state after a send', async () => {
    const store = memStore({
      system: [
        {
          id: 'notify_state',
          checkLiveLinks: { lastNotifiedAt: new Date(NOW.getTime() - 60000).toISOString() },
        },
      ],
    });
    const fetch = vi.fn(async () => ({ ok: true }));
    expect(
      await createNotifier({ store, env: {}, fetch, now }).notifyTelegram({
        title: 't',
        message: 'm',
      })
    ).toEqual({ sent: false, reason: 'not_configured' });
    const n = createNotifier({
      store,
      env: { TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '1' },
      fetch,
      now,
    });
    expect(await n.notifyTelegram({ title: 't', message: 'm', source: 'checkLiveLinks' })).toEqual({
      sent: false,
      reason: 'cooldown',
    });
    expect(
      await n.notifyTelegram({
        title: 't',
        message: 'm',
        severity: 'critical',
        source: 'workflow_alerts',
      })
    ).toEqual({ sent: true });
    expect(fetch.mock.calls[0][0]).toBe('https://api.telegram.org/bottok/sendMessage');
    expect(JSON.parse(fetch.mock.calls[0][1].body).text).toMatch(
      /^🔴 t\n\nm\n\nReported by the workflow alert monitor\.$/
    );
    expect(store.data.system.get('notify_state').workflow_alerts.lastNotifiedAt).toBe(
      NOW.toISOString()
    );
  });
});
