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
 *   - generatePromptSetSample (ADR 0033) — the Image Prompts page's "Generate"
 *     on a set: one hero through the same path, so a set can be tried without
 *     leaving the page. The row it writes carries the set's lineage and shows
 *     up under the set as its generation history.
 *
 * All are editor-guarded. Distinct from the automatic ai-cover trigger only
 * in WHO asks; the generation path is shared, not duplicated. Every prompt
 * composed here passes through the keyword matrix (`applyKeywordMatrix`),
 * which until ADR 0033 was configured in the admin and read by nothing.
 */
import {
  generateCoversForContent,
  generatedImageRecordFields,
  PROVIDER_THEMES,
  resolveCoverPrompt,
} from './triggers/ai-cover.js';
import {
  applyKeywordMatrix,
  composeSetPrompt,
  keywordMatrixLines,
  lineageFor,
  loadKeywordMatrix,
  normalizePromptConfigKey,
  promptTemplateVersionFor,
} from './cms/image-prompts.js';
import { mediaUrlFor } from './blob-paths.js';
import { fetchImage as defaultFetchImage } from './triggers/fetch-image.js';

export const TRIGGER_MAX_CONTENT_IDS = 25;
export const PREVIEW_SLOTS = ['hero', 'secondary1', 'secondary2', 'secondary3'];

/**
 * Why a sample cannot be generated, as the response to send, or null when it
 * can (PR #841). Checked in the order the page can act on: name the set,
 * configure the key, then the set itself.
 */
function sampleRefusal(setName, configured, set) {
  if (!setName) return json(400, { error: 'setName required' });
  if (!configured) return json(503, { error: 'REPLICATE_API_KEY is not configured' });
  if (!set) return json(404, { error: `Prompt set "${setName}" not found` });
  if (set.archivedAt) return json(409, { error: `Prompt set "${setName}" is archived` });
  return null;
}

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const compact = (iso) =>
  String(iso || '')
    .replace(/[-:TZ]/g, '')
    .replace(/\..*$/, '')
    .slice(0, 14);

/** The curated news-grid prompt: the caller's base, themed by provider. */
export function buildCuratedPrompt({
  basePrompt,
  articleTitle,
  articleSummary,
  provider,
  keywordLines = [],
}) {
  const theme = PROVIDER_THEMES[provider] || PROVIDER_THEMES.Multi;
  return [
    `${basePrompt || 'Professional technical illustration'} in a ${theme.color} color scheme with a ${theme.vibe} aesthetic.`,
    `Subject: ${articleTitle}.`,
    articleSummary ? `Context: ${articleSummary}` : '',
    ...keywordLines,
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
  keywordLines = [],
}) {
  const theme = PROVIDER_THEMES[provider] || PROVIDER_THEMES.Multi;
  const base = String(template || '').trim() || String(summaryPrompt || '').trim();
  const lines = [
    base ||
      `Professional technical illustration for a ${contentType || 'blog'} article titled "${title}".`,
    String(detailsPrompt || '').trim(),
    summary ? `Article context: ${summary}` : '',
    ...keywordLines,
    `Style: ${theme.color} color scheme, ${theme.vibe} aesthetic. No text overlays, labels, or written words.`,
    `Image slot: ${slot}. Keep composition distinct while preserving style continuity.`,
  ];
  return lines.filter(Boolean).join('\n');
}

/** What a caller is told about the model behind a generation. */
function modelInfo(replicate) {
  return {
    imageProvider: replicate?.provider || 'replicate',
    imageModel: replicate?.model || '',
    costPerImageUsd:
      typeof replicate?.costPerImageUsd === 'number' ? replicate.costPerImageUsd : null,
  };
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function, patchDoc: Function, upsertDoc: Function, queryDocs?: Function }} deps.store
 * @param {{ uploadBlob: Function }} deps.storage
 * @param {{ configured: boolean, generate: Function, model?: string }} deps.replicate
 */
export function createManualImageHandlers({
  guard,
  store,
  storage,
  replicate,
  fetchImage = defaultFetchImage,
  now = () => new Date(),
  uuid,
  log = {},
}) {
  const coverDeps = { store, storage, replicate, fetchImage, now, uuid };

  /** The set (and prompt) a request names, when it names one and it exists. */
  async function readNamedSet(setName, promptName) {
    const set = normalizePromptConfigKey(setName);
    if (!set || typeof store.readDoc !== 'function') return { set: null, prompt: null };
    const setDoc = await store.readDoc('image_prompt_sets', set, set).catch(() => null);
    if (!setDoc) return { set: null, prompt: null };
    const prompt = normalizePromptConfigKey(promptName);
    const promptDoc = prompt
      ? await store.readDoc('image_prompt_sets_prompts', prompt, set).catch(() => null)
      : null;
    return { set: setDoc, prompt: promptDoc };
  }

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
            // An empty seed CLEARS a previous override so the library applies
            // again; a non-empty one is used verbatim (ADR 0033).
            altCoverImagePrompt: seed || null,
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

      const resolved = await resolveCoverPrompt({ store, log: context }, data);
      const { generatedUrls, update } = await generateCoversForContent(coverDeps, contentId, data, {
        targets: ['hero'],
        prompt: resolved.prompt,
        lineage: resolved.lineage,
        aspectRatio: resolved.aspectRatio,
      });
      await store.patchDoc('content', contentId, {
        ...update,
        altCoverImagePromptSource: resolved.source,
      });
      return json(200, {
        success: true,
        imageUrl: generatedUrls.hero,
        promptSource: resolved.source,
        promptSet: resolved.lineage?.promptSet || '',
        ...modelInfo(replicate),
      });
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
   * articleSummary, basePrompt, provider, articleUrl, promptSet?, promptName? }
   * → { success, imageUrl }. Writes the curated_article_images doc the
   * anonymous public/curated-image/{id} route serves.
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

      const articleSummary = String(body.articleSummary || '').trim();
      const keyword = await loadKeywordMatrix(store, context);
      const keywordLines = keywordMatrixLines(
        applyKeywordMatrix(`${articleTitle} ${articleSummary}`, keyword)
      );
      const prompt = buildCuratedPrompt({
        basePrompt: body.basePrompt,
        articleTitle,
        articleSummary,
        provider: body.provider,
        keywordLines,
      });
      const { set, prompt: promptDoc } = await readNamedSet(body.promptSet, body.promptName);
      const generated = await replicate.generate(prompt, {
        aspectRatio: set?.aspectRatio || undefined,
      });
      const fetched = await fetchImage(generated);
      // Not an image: fail the request rather than store it (#415). The outer
      // catch turns this into the 500 the editor already sees for a generation
      // that did not come back.
      if (fetched.refused) throw new Error(`Generated image refused: ${fetched.reason}`);
      const { buffer, contentType } = fetched;
      // The doc id IS the article id and the public route serves one image per
      // article, so this path stays stable: a regeneration replaces the
      // article's curated image rather than adding a second one.
      const blobPath = `curated-${articleId}.png`;
      await storage.uploadBlob('covers', blobPath, buffer, contentType, {
        articleId,
        slot: 'curated',
      });
      const imageUrl = mediaUrlFor('covers', blobPath);
      const nowIso = now().toISOString();

      await store.upsertDoc('curated_article_images', {
        id: articleId,
        imageUrl,
        articleTitle,
        title: articleTitle,
        altText: articleTitle,
        articleUrl: String(body.articleUrl || '').trim() || null,
        provider: String(body.provider || '').trim() || null,
        slot: 'curated',
        folder: 'default',
        archived: false,
        archivedAt: null,
        softDeletedAt: null,
        approvalStatus: 'approved',
        sourceCollection: 'curated_article_images',
        generatedAt: nowIso,
        createdAt: nowIso,
        ...generatedImageRecordFields({
          buffer,
          contentType,
          blobPath,
          replicate,
          lineage: lineageFor({
            set,
            prompt: promptDoc,
            promptText: prompt,
            slot: 'curated',
            source: set ? 'page' : 'curated',
          }),
        }),
      });
      return json(200, { success: true, imageUrl, ...modelInfo(replicate) });
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
        return json(400, {
          error: `aiImageTargets must name at least one of ${PREVIEW_SLOTS.join(', ')}`,
        });
      }
      if (!replicate.configured) {
        return json(503, { error: 'REPLICATE_API_KEY is not configured' });
      }

      const stamp = now().toISOString();
      const title = String(body.title || '').trim() || 'Untitled draft';
      const summary = String(body.summary || '').trim();
      const keyword = await loadKeywordMatrix(store, context);
      const keywordLines = keywordMatrixLines(applyKeywordMatrix(`${title} ${summary}`, keyword));
      const { set, prompt: promptDoc } = await readNamedSet(body.promptSet, body.promptName);
      const imageUrls = {};
      const imageRecords = {};
      const promptLogs = {};
      for (const slot of slots) {
        const prompt = buildPreviewSlotPrompt({
          slot,
          template: body.slotTemplates?.[slot],
          summaryPrompt: body.summaryPrompt,
          detailsPrompt: body.detailsPrompt,
          title,
          summary,
          provider: body.provider,
          contentType: body.contentType,
          keywordLines,
        });
        const generated = await replicate.generate(prompt, {
          aspectRatio: set?.aspectRatio || undefined,
        });
        const fetched = await fetchImage(generated);
        if (fetched.refused) throw new Error(`Generated ${slot} image refused: ${fetched.reason}`);
        const { buffer, contentType } = fetched;
        // Stamped, so re-generating a slot keeps the earlier preview's bytes
        // (ADR 0033 §6.2); old un-stamped paths still resolve.
        const blobPath = `preview-${articleId}-${slot}-${compact(stamp)}.png`;
        await storage.uploadBlob('covers', blobPath, buffer, contentType, {
          articleId,
          slot,
        });
        const imageUrl = mediaUrlFor('covers', blobPath);
        const imageId = uuid();
        const lineage = set
          ? lineageFor({ set, prompt: promptDoc, promptText: prompt, slot, source: 'content' })
          : {
              promptSetId: '',
              promptSet: String(body.promptSet || '').trim(),
              setId: '',
              promptName: String(body.promptName || '').trim(),
              promptTemplateVersion: String(body.promptTemplateVersion || '').trim(),
              prompt,
              promptSlot: slot,
              promptSource: 'preview',
            };
        await store.upsertDoc('generated_content_images', {
          id: imageId,
          contentId: articleId,
          articleId,
          slot,
          imageUrl,
          title,
          altText: title,
          provider: String(body.provider || '').trim() || '',
          contentType: String(body.contentType || '').trim() || 'blog',
          sourceUrl: String(body.sourceUrl || '').trim() || null,
          sourceCollection: 'preview',
          approvalStatus: 'draft',
          folder: 'default',
          customTags: [],
          createdAt: stamp,
          ...generatedImageRecordFields({ buffer, contentType, blobPath, replicate, lineage }),
        });
        imageUrls[slot] = imageUrl;
        imageRecords[slot] = { imageId, imageUrl };
        promptLogs[slot] = prompt;
      }
      return json(200, {
        success: true,
        imageUrls,
        imageRecords,
        promptLogs,
        ...modelInfo(replicate),
      });
    } catch (error) {
      context.error('generatePreviewImages failed:', error);
      return json(500, {
        error: 'Failed to generate preview images',
        message: error?.message || 'Unknown error',
      });
    }
  }

  /**
   * POST /api/cms/image-prompts/sample — { setName, promptName?, slot?,
   * title?, summary?, provider? } → { success, imageUrl, imageId, prompt,
   * imageProvider, imageModel, costPerImageUsd }. One image from a set, so a
   * set can be tried from the Image Prompts page. The row is a `preview`
   * under `promptset-{slug}` and carries the set's lineage.
   */
  async function generatePromptSetSample(request, context) {
    const auth = await guard.requireRole(request, 'editor');
    if (auth.error) return auth.error;
    try {
      const body = (await request.json().catch(() => null)) || {};
      const setName = normalizePromptConfigKey(body.setName);
      const slot = PREVIEW_SLOTS.includes(String(body.slot || '')) ? String(body.slot) : 'hero';
      const named =
        setName && replicate.configured ? await readNamedSet(setName, body.promptName) : {};
      const refusal = sampleRefusal(setName, replicate.configured, named.set);
      if (refusal) return refusal;
      const { set, prompt: promptDoc } = named;

      const article = {
        title: String(body.title || '').trim() || `${setName} sample`,
        summary: String(body.summary || '').trim(),
        cloudProvider: String(body.provider || '').trim(),
      };
      const keyword = await loadKeywordMatrix(store, context);
      const prompt = composeSetPrompt({ set, prompt: promptDoc, slot, article, keyword });
      const generated = await replicate.generate(prompt, {
        aspectRatio: set.aspectRatio || undefined,
      });
      const fetched = await fetchImage(generated);
      if (fetched.refused) throw new Error(`Generated sample refused: ${fetched.reason}`);
      const { buffer, contentType } = fetched;
      const stamp = now().toISOString();
      const slug = setName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
      const articleId = `promptset-${slug || 'set'}`;
      const blobPath = `${articleId}-${slot}-${compact(stamp)}.png`;
      await storage.uploadBlob('covers', blobPath, buffer, contentType, { articleId, slot });
      const imageUrl = mediaUrlFor('covers', blobPath);
      const imageId = uuid();
      await store.upsertDoc('generated_content_images', {
        id: imageId,
        contentId: articleId,
        articleId,
        slot,
        imageUrl,
        title: article.title,
        altText: article.title,
        provider: article.cloudProvider,
        contentType: 'sample',
        sourceCollection: 'preview',
        approvalStatus: 'draft',
        folder: 'default',
        customTags: cleanTagsOf(set.tags),
        createdAt: stamp,
        ...generatedImageRecordFields({
          buffer,
          contentType,
          blobPath,
          replicate,
          lineage: lineageFor({
            set,
            prompt: promptDoc,
            promptText: prompt,
            slot,
            source: 'sample',
          }),
        }),
      });
      return json(200, {
        success: true,
        imageUrl,
        imageId,
        prompt,
        promptTemplateVersion: promptTemplateVersionFor(set),
        ...modelInfo(replicate),
      });
    } catch (error) {
      context.error('generatePromptSetSample failed:', error);
      return json(500, {
        error: 'Failed to generate sample image',
        message: error?.message || 'Unknown error',
      });
    }
  }

  return {
    triggerAiImageGeneration,
    generateReviewHeroImage,
    generateCuratedArticleImage,
    generatePreviewImages,
    generatePromptSetSample,
  };
}

function cleanTagsOf(tags) {
  return Array.isArray(tags)
    ? tags
        .map((t) =>
          String(t || '')
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    : [];
}
