import { describe, it, expect, vi } from 'vitest';
import {
  createManualImageHandlers,
  buildCuratedPrompt,
  buildPreviewSlotPrompt,
  TRIGGER_MAX_CONTENT_IDS,
} from './manual-images.js';

const guardAs = (role) => ({
  requireRole: vi.fn(async () =>
    role ? { user: { oid: 'u1' }, role, error: null } : { error: { status: 403, body: '{}' } }
  ),
});
const request = (body) => ({ json: async () => body, headers: { get: () => null } });
const context = { error: vi.fn() };

function makeHandlers({ role = 'editor', doc, configured = true } = {}) {
  const store = {
    readDoc: vi.fn(async () => doc ?? null),
    patchDoc: vi.fn(async () => ({})),
    upsertDoc: vi.fn(async (c, d) => d),
  };
  const storage = { uploadBlob: vi.fn(async () => 'ok') };
  const replicate = { configured, generate: vi.fn(async () => 'https://replicate/img.png') };
  const fetchImage = vi.fn(async () => ({ buffer: Buffer.from('png'), contentType: 'image/png' }));
  let n = 0;
  const handlers = createManualImageHandlers({
    guard: guardAs(role),
    store,
    storage,
    replicate,
    fetchImage,
    now: () => new Date('2026-08-28T12:00:00Z'),
    uuid: () => `img-${++n}`,
  });
  return { handlers, store, storage, replicate };
}

describe('prompt builders', () => {
  it('curated prompt themes by provider and bans text overlays', () => {
    const prompt = buildCuratedPrompt({
      basePrompt: 'Isometric datacenter',
      articleTitle: 'AWS re:Invent recap',
      articleSummary: 'The launches that matter.',
      provider: 'AWS',
    });
    expect(prompt).toContain('Isometric datacenter');
    expect(prompt).toContain('orange and dark blue');
    expect(prompt).toContain('AWS re:Invent recap');
    expect(prompt).toContain('No text overlays');
  });

  it('preview prompt prefers the slot template, falls back to summary prompt, always names the slot', () => {
    const templated = buildPreviewSlotPrompt({
      slot: 'hero',
      template: 'A custom hero scene',
      summaryPrompt: 'ignored',
      title: 'T',
      provider: 'Azure',
    });
    expect(templated).toContain('A custom hero scene');
    expect(templated).not.toContain('ignored');
    expect(templated).toContain('Image slot: hero');

    const fallback = buildPreviewSlotPrompt({ slot: 'secondary1', title: 'My draft' });
    expect(fallback).toContain('My draft');
    expect(fallback).toContain('Image slot: secondary1');
  });
});

describe('triggerAiImageGeneration', () => {
  it('arms the change-feed flag with targets and seed, per id', async () => {
    const { handlers, store } = makeHandlers();
    const res = await handlers.triggerAiImageGeneration(
      request({ contentIds: ['c1', 'c2'], aiImageTargets: ['hero'], imagePromptSeed: ' seed ' }),
      context
    );
    expect(JSON.parse(res.body)).toEqual({ success: true, queued: 2, errors: [] });
    expect(store.patchDoc).toHaveBeenCalledWith('content', 'c1', {
      altCoverImageTrigger: true,
      aiImageTargets: ['hero'],
      altCoverImagePrompt: 'seed',
    });
  });

  it('rejects empty and oversized batches, reports per-id failures', async () => {
    const { handlers, store } = makeHandlers();
    expect((await handlers.triggerAiImageGeneration(request({}), context)).status).toBe(400);
    expect(
      (
        await handlers.triggerAiImageGeneration(
          request({ contentIds: Array.from({ length: TRIGGER_MAX_CONTENT_IDS + 1 }, (_, i) => `c${i}`) }),
          context
        )
      ).status
    ).toBe(400);

    store.patchDoc.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 404 }));
    const res = await handlers.triggerAiImageGeneration(
      request({ contentIds: ['ghost', 'c2'] }),
      context
    );
    const body = JSON.parse(res.body);
    expect(body.queued).toBe(1);
    expect(body.errors).toEqual([{ contentId: 'ghost', error: 'not found' }]);
  });
});

describe('generateReviewHeroImage', () => {
  it('generates through the shared cover path and patches the doc like the feed would', async () => {
    const { handlers, store } = makeHandlers({
      doc: { id: 'c1', Title: 'T', 'Cloud Provider': 'AWS' },
    });
    const res = await handlers.generateReviewHeroImage(request({ contentId: 'c1' }), context);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ success: true, imageUrl: '/api/public/media/covers/c1-ai-hero.png' });
    // Gallery record via the shared path…
    expect(store.upsertDoc).toHaveBeenCalledWith(
      'generated_content_images',
      expect.objectContaining({ slot: 'hero', sourceCollection: 'content' })
    );
    // …and the same update fields the change-feed trigger writes.
    expect(store.patchDoc).toHaveBeenCalledWith(
      'content',
      'c1',
      expect.objectContaining({
        altCoverImage: '/api/public/media/covers/c1-ai-hero.png',
        altCoverImageError: null,
      })
    );
  });

  it('404s a missing doc and 503s when Replicate is unconfigured', async () => {
    const missing = makeHandlers();
    expect(
      (await missing.handlers.generateReviewHeroImage(request({ contentId: 'ghost' }), context))
        .status
    ).toBe(404);
    const unconfigured = makeHandlers({ configured: false, doc: { id: 'c1' } });
    expect(
      (await unconfigured.handlers.generateReviewHeroImage(request({ contentId: 'c1' }), context))
        .status
    ).toBe(503);
  });
});

describe('generateCuratedArticleImage', () => {
  it('stores the blob and the doc the public curated-image route serves', async () => {
    const { handlers, store, storage } = makeHandlers();
    const res = await handlers.generateCuratedArticleImage(
      request({
        articleId: 'a1',
        articleTitle: 'Title',
        articleSummary: 'Sum',
        basePrompt: 'Base',
        provider: 'GCP',
        articleUrl: 'https://src',
      }),
      context
    );
    const body = JSON.parse(res.body);
    expect(body).toEqual({ success: true, imageUrl: '/api/public/media/covers/curated-a1.png' });
    expect(storage.uploadBlob.mock.calls[0][1]).toBe('curated-a1.png');
    // Doc id IS the article id — the public route's lookup key.
    expect(store.upsertDoc).toHaveBeenCalledWith(
      'curated_article_images',
      expect.objectContaining({
        id: 'a1',
        imageUrl: '/api/public/media/covers/curated-a1.png',
        archived: false,
      })
    );
  });

  it('400s without an articleId or title', async () => {
    const { handlers } = makeHandlers();
    expect(
      (await handlers.generateCuratedArticleImage(request({ articleTitle: 'T' }), context)).status
    ).toBe(400);
  });
});

describe('generatePreviewImages', () => {
  it('returns the slot-keyed triple the Submit URLs page reads', async () => {
    const { handlers, store } = makeHandlers();
    const res = await handlers.generatePreviewImages(
      request({
        articleId: 'draft-1',
        aiImageTargets: ['hero'],
        slotTemplates: { hero: 'Hero template' },
        title: 'Draft',
        provider: 'Azure',
        contentType: 'blog',
        sourceUrl: 'https://src',
      }),
      context
    );
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.imageUrls.hero).toBe('/api/public/media/covers/preview-draft-1-hero.png');
    expect(body.imageRecords.hero).toEqual({
      imageId: 'img-1',
      imageUrl: '/api/public/media/covers/preview-draft-1-hero.png',
    });
    expect(body.promptLogs.hero).toContain('Hero template');
    expect(store.upsertDoc).toHaveBeenCalledWith(
      'generated_content_images',
      expect.objectContaining({ id: 'img-1', slot: 'hero', sourceCollection: 'preview' })
    );
  });

  it('rejects unknown slots and missing articleId', async () => {
    const { handlers } = makeHandlers();
    expect(
      (
        await handlers.generatePreviewImages(
          request({ articleId: 'a', aiImageTargets: ['banner'] }),
          context
        )
      ).status
    ).toBe(400);
    expect(
      (await handlers.generatePreviewImages(request({ aiImageTargets: ['hero'] }), context)).status
    ).toBe(400);
  });
});

describe('authorization', () => {
  it('every handler refuses without the editor role', async () => {
    const { handlers } = makeHandlers({ role: null });
    for (const [name, body] of [
      ['triggerAiImageGeneration', { contentIds: ['c1'] }],
      ['generateReviewHeroImage', { contentId: 'c1' }],
      ['generateCuratedArticleImage', { articleId: 'a', articleTitle: 'T' }],
      ['generatePreviewImages', { articleId: 'a', aiImageTargets: ['hero'] }],
    ]) {
      expect((await handlers[name](request(body), context)).status).toBe(403);
    }
  });
});
