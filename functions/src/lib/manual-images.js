/**
 * manual-images.js — the manual image RPC cluster (Blog Machine backlog #2;
 * the four remaining image entries in api-surface.json notImplemented).
 * Every one has been a live 404 the admin UI calls today:
 *
 *   - triggerAiImageGeneration — BlogReviewBoard's "regenerate cover":
 *     fire-and-forget by design; it arms `altCoverImageTrigger` (plus
 *     targets and prompt seed) and the existing content change feed
 *     (lib/triggers/ai-cover.js) does the work. No generation here.
 *   - generateReviewHeroImage — the queue's synchronous "generate hero":
 *     the SAME path the change feed runs (generateCoversForContent), called
 *     inline so the queue card can show the result immediately.
 *   - generateCuratedArticleImage — the public news grid's curated imagery
 *     (admin-generated, anonymously served via public/curated-image/{id}).
 *   - generatePreviewImages — the Submit URLs draft builder's per-slot
 *     preview generation (hero/secondary1-3), one slot per call.
 *
 * All four are editor-guarded. Distinct from the automatic ai-cover trigger
 * only in WHO asks; the generation path is shared, not duplicated.
 */
import {
  buildImagePrompt,
  generateCoversForContent,
  PROVIDER_THEMES,
} from './triggers/ai-cover.js';
import { mediaUrlFor } from './blob-paths.js';
import { fetchImage as defaultFetchImage } from './triggers/fetch-image.js';

export const TRIGGER_MAX_CONTENT_IDS = 25;
export const PREVIEW_SLOTS = ['hero', 'secondary1', 'secondary2', 'secondary3'];

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** The curated news-grid prompt: the caller's base, themed by provider. */
export function buildCuratedPrompt({ basePrompt, articleTitle, articleSummary, provider }) {
  const theme = PROVIDER_THEMES[provider] || PROVIDER_THEMES.Multi;
  return [
    `${basePrompt || 'Professional technical illustration'} in a ${theme.color} color scheme with a ${theme.vibe} aesthetic.`,
    `Subject: ${articleTitle}.`,
    articleSummary ? `Context: ${articleSummary}` : '',
    'No text overlays, labels, or written words in the image.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The preview-slot prompt: the owner's slot template when one was written,
 * otherwise composed from the draft's own summary/details prompts.
 */
export function buildPreviewSlotPrompt({
  slot,
  template,
  summaryPrompt,
  detailsPrompt,
  title,
  summary,
  provider,
  contentType,
}) {
  const theme = PROVIDER_THEMES[provider] || PROVIDER_THEMES.Multi;
  const base = String(template || '').trim() || String(summaryPrompt || '').trim();
  const lines = [
    base ||
      `Professional technical illustration for a ${contentType || 'blog'} article titled "${title}".`,
    String(detailsPrompt || '').trim(),
    summary ? `Article context: ${summary}` : '',
    `Style: ${theme.color} color scheme, ${theme.vibe} aesthetic. No text overlays, labels, or written words.`,
    `Image slot: ${slot}. Keep composition distinct while preserving style continuity.`,
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function, patchDoc: Function, upsertDoc: Function }} deps.store
 * @param {{ uploadBlob: Function }} deps.storage
 * @param {{ configured: boolean, generate: Function }} deps.replicate
 */
export function createManualImageHandlers({
  guard,
  store,
  storage,
  replicate,
  fetchImage = defaultFetchImage,
  now = () => new Date(),
  uuid,
}) {
  const coverDeps = { store, storage, replicate, fetchImage, now, uuid };

  /**
   * POST /api/triggerAiImageGeneration — { contentIds[], aiImageTargets?,
   * imagePromptSeed? } → { success, queued, errors }. Queues by arming the
   * change-feed flag; the Images panel updates when the feed lands the file.
   */
  async function triggerAiImageGeneration(request, context) {
    const auth = await guard.requireRole(request, 'editor');
    if (auth.error) return auth.error;
    try {
      const body = (await request.json().catch(() => null)) || {};
      const contentIds = [
        ...new Set(
          (Array.isArray(body.contentIds) ? body.contentIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
        ),
      ];
      if (!contentIds.length) return json(400, { error: 'contentIds required' });
      if (contentIds.length > TRIGGER_MAX_CONTENT_IDS) {
        return json(400, { error: `At most ${TRIGGER_MAX_CONTENT_IDS} contentIds per request` });
      }
      const targets = Array.isArray(body.aiImageTargets)
        ? body.aiImageTargets.map(String).filter(Boolean).slice(0, 4)
        : null;
      const seed = String(body.imagePromptSeed || '').trim();

      const errors = [];
      let queued = 0;
      for (const contentId of contentIds) {
        try {
          await store.patchDoc('content', contentId, {
            altCoverImageTrigger: true,
            ...(targets?.length ? { aiImageTargets: targets } : {}),
            ...(seed ? { altCoverImagePrompt: seed } : {}),
          });
          queued += 1;
        } catch (error) {
          errors.push({ contentId, error: error?.message || 'patch failed' });
        }
      }
      return json(queued > 0 ? 200 : 404, { success: queued > 0, queued, errors });
    } catch (error) {
      context.error('triggerAiImageGeneration failed:', error);
      return json(500, { error: 'Failed to queue image generation' });
    }
  }

  /**
   * POST /api/generateReviewHeroImage — { contentId } → { success, imageUrl }.
   * Synchronous hero generation for a queue card, through the shared cover
   * path; the doc patch matches what the change-feed trigger would write.
   */
  async function generateReviewHeroImage(request, context) {
    const auth = await guard.requireRole(request, 'editor');
    if (auth.error) return auth.error;
    try {
      const body = (await request.json().catch(() => null)) || {};
      const contentId = String(body.contentId || '').trim();
      if (!contentId) return json(400, { error: 'contentId required' });
      if (!replicate.configured) {
        return json(503, { error: 'REPLICATE_API_KEY is not configured' });
      }
      const data = await store.readDoc('content', contentId, contentId);
      if (!data) return json(404, { error: `Content ${contentId} not found` });

      const provided =
        typeof data.altCoverImagePrompt === 'string' && data.altCoverImagePrompt.trim();
      const prompt = provided || buildImagePrompt(data);
      const { generatedUrls, update } = await generateCoversForContent(coverDeps, contentId, data, {
        targets: ['hero'],
        prompt,
      });
      await store.patchDoc('content', contentId, update);
      return json(200, { success: true, imageUrl: generatedUrls.hero });
    } catch (error) {
      context.error('generateReviewHeroImage failed:', error);
      return json(500, {
        error: 'Failed to generate hero image',
        message: error?.message || 'Unknown error',
      });
    }
  }

  /**
   * POST /api/generateCuratedArticleImage — { articleId, articleTitle,
   * articleSummary, basePrompt, provider, articleUrl } → { success, imageUrl }.
   * Writes the curated_article_images doc the anonymous
   * public/curated-image/{id} route serves.
   */
  async function generateCuratedArticleImage(request, context) {
    const auth = await guard.requireRole(request, 'editor');
    if (auth.error) return auth.error;
    try {
      const body = (await request.json().catch(() => null)) || {};
      const articleId = String(body.articleId || '').trim();
      const articleTitle = String(body.articleTitle || '').trim();
      if (!articleId || !articleTitle) {
        return json(400, { error: 'articleId and articleTitle required' });
      }
      if (!replicate.configured) {
        return json(503, { error: 'REPLICATE_API_KEY is not configured' });
      }

      const prompt = buildCuratedPrompt({
        basePrompt: body.basePrompt,
        articleTitle,
        articleSummary: String(body.articleSummary || '').trim(),
        provider: body.provider,
      });
      const generated = await replicate.generate(prompt);
      const { buffer, contentType } = await fetchImage(generated);
      const blobPath = `curated-${articleId}.png`;
      await storage.uploadBlob('covers', blobPath, buffer, contentType || 'image/png', {
        articleId,
        slot: 'curated',
      });
      const imageUrl = mediaUrlFor('covers', blobPath);

      // The doc id IS the article id — that is the public route's lookup key.
      await store.upsertDoc('curated_article_images', {
        id: articleId,
        imageUrl,
        articleTitle,
        articleUrl: String(body.articleUrl || '').trim() || null,
        provider: String(body.provider || '').trim() || null,
        prompt,
        folder: 'default',
        archived: false,
        generatedAt: now().toISOString(),
      });
      return json(200, { success: true, imageUrl });
    } catch (error) {
      context.error('generateCuratedArticleImage failed:', error);
      return json(500, {
        error: 'Failed to generate curated image',
        message: error?.message || 'Unknown error',
      });
    }
  }

  /**
   * POST /api/generatePreviewImages — the Submit URLs draft builder. One or
   * more slots per call (the page sends one at a time) →
   * { success, imageUrls: {slot: url}, imageRecords: {slot: {imageId,
   * imageUrl}}, promptLogs: {slot: prompt} }.
   */
  async function generatePreviewImages(request, context) {
    const auth = await guard.requireRole(request, 'editor');
    if (auth.error) return auth.error;
    try {
      const body = (await request.json().catch(() => null)) || {};
      const articleId = String(body.articleId || '').trim();
      const slots = (Array.isArray(body.aiImageTargets) ? body.aiImageTargets : [])
        .map(String)
        .filter((slot) => PREVIEW_SLOTS.includes(slot));
      if (!articleId) return json(400, { error: 'articleId required' });
      if (!slots.length) {
        return json(400, { error: `aiImageTargets must name at least one of ${PREVIEW_SLOTS.join(', ')}` });
      }
      if (!replicate.configured) {
        return json(503, { error: 'REPLICATE_API_KEY is not configured' });
      }

      const stamp = now().toISOString();
      const imageUrls = {};
      const imageRecords = {};
      const promptLogs = {};
      for (const slot of slots) {
        const prompt = buildPreviewSlotPrompt({
          slot,
          template: body.slotTemplates?.[slot],
          summaryPrompt: body.summaryPrompt,
          detailsPrompt: body.detailsPrompt,
          title: String(body.title || '').trim() || 'Untitled draft',
          summary: String(body.summary || '').trim(),
          provider: body.provider,
          contentType: body.contentType,
        });
        const generated = await replicate.generate(prompt);
        const { buffer, contentType } = await fetchImage(generated);
        const blobPath = `preview-${articleId}-${slot}.png`;
        await storage.uploadBlob('covers', blobPath, buffer, contentType || 'image/png', {
          articleId,
          slot,
        });
        const imageUrl = mediaUrlFor('covers', blobPath);
        const imageId = uuid();
        await store.upsertDoc('generated_content_images', {
          id: imageId,
          contentId: articleId,
          articleId,
          slot,
          imageUrl,
          prompt,
          title: String(body.title || '').trim() || 'Untitled draft',
          provider: String(body.provider || '').trim() || '',
          contentType: String(body.contentType || '').trim() || 'blog',
          sourceUrl: String(body.sourceUrl || '').trim() || null,
          sourceCollection: 'preview',
          createdAt: stamp,
        });
        imageUrls[slot] = imageUrl;
        imageRecords[slot] = { imageId, imageUrl };
        promptLogs[slot] = prompt;
      }
      return json(200, { success: true, imageUrls, imageRecords, promptLogs });
    } catch (error) {
      context.error('generatePreviewImages failed:', error);
      return json(500, {
        error: 'Failed to generate preview images',
        message: error?.message || 'Unknown error',
      });
    }
  }

  return {
    triggerAiImageGeneration,
    generateReviewHeroImage,
    generateCuratedArticleImage,
    generatePreviewImages,
  };
}
