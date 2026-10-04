import { useState, useCallback, useMemo } from 'react';
import { getFunctionsBase } from '@/lib/functionsBase';
import { useImagePrompts } from './useImagePrompts';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { fetchPublicCuratedImage, fetchPublicCuratedImages } from '@/lib/publicApi';
import { postJSON } from '@/lib/api';

const DEFAULT_PROMPT_BY_PROVIDER = {
  AWS: 'Cinematic AWS cloud architecture illustration with modern enterprise infrastructure, warm amber accents, clean geometric composition, no text overlay, high-detail digital art',
  AZURE:
    'Professional Microsoft Azure cloud platform illustration with modern architecture motifs, cool blue palette, clean geometric composition, no text overlay, high-detail digital art',
  GCP: 'Modern Google Cloud Platform infrastructure illustration with distributed systems motifs, vibrant cloud-native visual language, clean composition, no text overlay, high-detail digital art',
  GITHUB:
    'Developer-focused GitHub platform illustration featuring code collaboration, automation workflows, and AI-assisted engineering motifs, clean composition, no text overlay, high-detail digital art',
  TERRAFORM:
    'Infrastructure-as-code themed Terraform illustration with modular cloud architecture motifs, purple-accented technical aesthetic, clean composition, no text overlay, high-detail digital art',
  FINOPS:
    'FinOps cloud cost optimization illustration with financial analytics and cloud operations motifs, modern dashboard-inspired composition, no text overlay, high-detail digital art',
};

const FALLBACK_PROMPT =
  'Professional technical illustration for cloud infrastructure with clean, modern design';

function isFunctionsBaseUnavailable(functionsBase) {
  return !functionsBase || functionsBase.includes('localhost') || functionsBase.includes('5173');
}

function getArticleUrl(article = {}) {
  return [article.sourceUrl, article['CD Url'], article.url, article.link].find(Boolean) ?? '';
}

function buildImageRequestBody(article, basePrompt, provider, lineage = {}) {
  return {
    articleTitle: article.title || 'AWS News Article',
    articleSummary: article.summary || article.description || '',
    basePrompt: basePrompt || 'Professional technical illustration',
    provider: provider || 'AWS',
    articleId: article.id,
    articleUrl: getArticleUrl(article),
    // The set and prompt the page resolved, so the curated row records its
    // lineage and shows under the set on Image Prompts (ADR 0033).
    promptSet: lineage.setName || '',
    promptName: lineage.promptName || '',
  };
}

/**
 * The hook's machinery, as module-level functions over a `ctx` the hook
 * builds (PR #841): `{ functionsBase, provider, pagePath, canGenerate,
 * resolvePromptForPage, setImageMap, setLoading, setError }`. The hook keeps
 * the state and the role gate; these keep the request logic, and each is
 * small enough to read on its own.
 */

/** Anonymous cache read — see the hook's header. */
export async function readCachedImageUrl(articleId) {
  try {
    return await fetchPublicCuratedImage(articleId);
  } catch (err) {
    console.error(`[generateCuratedImages] Error fetching cache for ${articleId}:`, err.message);
    return null;
  }
}

/** Whether an article can be looked up at all: it needs an id and a reachable Functions host. */
function canAttemptImage(ctx, article) {
  if (!article?.id) {
    console.warn(`[generateCuratedImages] Article missing ID, skipping generation`);
    return false;
  }
  // Skip if functionsBase is not configured (empty, localhost, or vite dev server)
  if (isFunctionsBaseUnavailable(ctx.functionsBase)) {
    console.warn(
      `[generateCuratedImages] Cloud Functions not available (${ctx.functionsBase}), skipping for ${article.id}`
    );
    return false;
  }
  return true;
}

/** The admin action: ask the server for a new image. postJSON injects the Entra access token (lib/api.js). */
async function requestGeneratedImage(ctx, article, basePrompt, lineage) {
  console.warn(`[generateCuratedImages] Generating new image for article: ${article.id}`);
  const requestBody = buildImageRequestBody(article, basePrompt, ctx.provider, lineage);
  const { imageUrl } = await postJSON('generateCuratedArticleImage', requestBody);
  return imageUrl || null;
}

/**
 * Generate a unique image for a single curated article.
 * @param {Object} ctx - The hook's context (see above)
 * @param {Object} article - Curated article object with id, title, summary
 * @param {string} basePrompt - Base prompt from image_prompts
 * @returns {Promise<string|null>} Image URL or null if generation failed
 */
export async function generateArticleImageWith(
  ctx,
  article,
  basePrompt,
  { cachedUrl: knownCached, lineage } = {}
) {
  try {
    if (!canAttemptImage(ctx, article)) return null;

    // Check the server-side image cache first — anonymous, so this is the
    // part that works for a public visitor.
    //
    // `knownCached` is the batched answer from generateImagesForArticles,
    // which asks once for the whole grid (T-739). It is honoured even when
    // null, because "the batch said this one has no cover" is an answer;
    // re-asking per id is exactly the N+1 that was removed. A lone caller
    // that passes nothing still gets the single-id read.
    const cachedUrl =
      knownCached !== undefined ? knownCached : await readCachedImageUrl(article.id);
    if (cachedUrl) {
      ctx.setImageMap((prev) => ({ ...prev, [article.id]: cachedUrl }));
      return cachedUrl;
    }

    // Not cached. Generating one is an admin action behind the role guard,
    // so an anonymous visitor stops here with whatever the cache had rather
    // than issuing a request that cannot succeed.
    if (!ctx.canGenerate) return null;

    return await requestGeneratedImage(ctx, article, basePrompt, lineage);
  } catch (err) {
    console.error(`[generateCuratedImages] Failed for article ${article?.id}:`, err.message || err);
    return null;
  }
}

/** The prompt text and lineage from a resolved page assignment. */
function promptFromAssignment(promptData) {
  const additionalParameters = promptData.additionalParameters?.trim();
  const basePrompt = additionalParameters
    ? `${promptData.primaryPrompt}\n\nAdditional Style Constraints:\n${additionalParameters}`
    : promptData.primaryPrompt;
  console.warn(
    `[generateCuratedImages] Using prompt set: ${promptData.setName} / ${promptData.promptName || 'primary'}`
  );
  return {
    basePrompt,
    lineage: { setName: promptData.setName, promptName: promptData.promptName },
  };
}

/**
 * The prompt the page generates with: the assigned set's, or the provider
 * default. The prompt is editor-only configuration and is only ever an input
 * to generation, so an anonymous visitor neither can nor needs to read it.
 * Attempting it was pure cost: the call threw, the default prompt was
 * substituted, and the default was then used for nothing, because
 * generation is gated too.
 */
export async function resolveBasePrompt(ctx) {
  const providerKey = String(ctx.provider || 'AWS').toUpperCase();
  const fallback = {
    basePrompt: DEFAULT_PROMPT_BY_PROVIDER[providerKey] || FALLBACK_PROMPT,
    lineage: {},
  };
  if (!ctx.canGenerate) return fallback;

  try {
    const promptData = await ctx.resolvePromptForPage(ctx.pagePath);
    if (promptData?.primaryPrompt) return promptFromAssignment(promptData);
    console.warn('[generateCuratedImages] No prompt assignment configured for this page');
  } catch (promptErr) {
    console.warn(
      '[generateCuratedImages] Could not fetch prompts, using default:',
      promptErr.message
    );
    // Continue with default prompt
  }
  return fallback;
}

/**
 * One batched cache read for the whole grid, before anything else (T-739).
 * This used to be one GET per card — twelve round trips for a twelve-card
 * grid, on a route that had already fetched the feed, and repeated on every
 * remount before the request-layer cache existed.
 *
 * Failure is non-fatal and yields an empty map: an editor then falls through
 * to generation as before, and an anonymous visitor sees cards without
 * covers, which is what they would have seen anyway.
 */
async function readBatchedCache(articles) {
  try {
    return await fetchPublicCuratedImages(articles.map((a) => a?.id));
  } catch (cacheErr) {
    console.warn(
      '[generateCuratedImages] Batched cache read failed; falling back per article:',
      cacheErr.message
    );
    return {};
  }
}

/** `{ articleId: imageUrl }` for every article that got a url. */
function toImageMap(results) {
  const newImageMap = {};
  for (const { id, url } of results) {
    if (url) newImageMap[id] = url;
  }
  return newImageMap;
}

/** The grid's images, one request per uncached article, in parallel. */
async function generateGrid(ctx, articles) {
  const { basePrompt, lineage } = await resolveBasePrompt(ctx);
  const cachedUrls = await readBatchedCache(articles);

  console.warn(`[generateCuratedImages] Generating images for ${articles.length} articles...`);
  const results = await Promise.all(
    articles.map((article) =>
      generateArticleImageWith(ctx, article, basePrompt, {
        // `undefined` (not null) when the batch had no answer for this id,
        // so generateArticleImageWith falls back to its single-id read
        // rather than treating a failed batch as "definitely no cover".
        cachedUrl: article?.id in cachedUrls ? cachedUrls[article.id] : undefined,
        lineage,
      }).then((url) => ({ id: article.id, url }))
    )
  );
  console.warn(`[generateCuratedImages] All ${articles.length} image requests completed`);

  const newImageMap = toImageMap(results);
  console.warn(
    `[generateCuratedImages] Success: ${Object.keys(newImageMap).length}/${articles.length} images ready`
  );
  return newImageMap;
}

/**
 * Generate images for multiple curated articles.
 * Fetches the prompt for the page and generates unique images.
 * @param {Object} ctx - The hook's context (see above)
 * @param {Array} articles - Array of curated article objects
 * @returns {Promise<Object>} Map of articleId -> imageUrl
 */
export async function generateImagesForArticlesWith(ctx, articles) {
  if (!articles || articles.length === 0) {
    console.warn('[generateCuratedImages] No articles to process');
    return {};
  }

  ctx.setLoading(true);
  ctx.setError(null);
  try {
    console.warn(`[generateCuratedImages] Processing ${articles.length} articles`);
    const newImageMap = await generateGrid(ctx, articles);
    ctx.setImageMap((prev) => ({ ...prev, ...newImageMap }));
    return newImageMap;
  } catch (err) {
    ctx.setError(err?.message || 'Failed to generate curated article images');
    console.error('[generateCuratedImages] Error:', err);
    return {};
  } finally {
    ctx.setLoading(false);
  }
}

/**
 * Hook to generate and manage images for curated articles.
 *
 * Two audiences, and the split between them is the point (T-210). This
 * hook runs on the PUBLIC `/{provider}/news` route, but every call it made was
 * authenticated: the cache lookup went to an editor-gated `cms/*` endpoint via
 * `getJSON`, whose `acquireApiToken` throws outright without an MSAL account.
 * So for an anonymous visitor every lookup failed and the grid rendered no
 * curated imagery at all, where cached images used to appear.
 *
 * Now:
 *   - **Reading** a cached image is anonymous, through `public/curated-image`.
 *     Every visitor gets the imagery.
 *   - **Generating** a missing one stays behind the admin gate, and is simply
 *     not attempted without the `editor` role. It was never going to succeed
 *     without it; skipping it also stops the hook dragging MSAL onto the
 *     critical path of a public page.
 *
 * The prompt lookup is gated with generation for the same reason: it reads
 * editor-only configuration and is an input to generation, so an anonymous
 * visitor has no use for it. It used to be attempted, fail, and fall back to a
 * default prompt that was then never used for anything.
 */
export function useGenerateCuratedImages(pagePath, provider) {
  const [imageMap, setImageMap] = useState({}); // { articleId: imageUrl }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // The gate is the ROLE, not merely "somebody is signed in". Generation and
  // the prompt read are both `editor`-gated server-side, so a signed-in viewer
  // gated on presence alone would fire a prompt read plus up to twelve
  // generation requests and collect a 403 for each — the same
  // requests-that-cannot-succeed defect as T-210 itself, just with a narrower
  // audience.
  //
  // `hasRole` also subsumes the wait for auth to settle: it reads the admin
  // status fetched after sign-in, so it is false while that is still in flight
  // and false for an anonymous visitor. An earlier version of this gate paired
  // `authReady` with a presence check to get that behaviour; with the role
  // check it would be a conjunct that can never change the answer.
  const { hasRole } = useAdminAuth();
  const canGenerate = hasRole('editor');

  const { resolvePromptForPage } = useImagePrompts();
  const functionsBase = getFunctionsBase();

  const ctx = useMemo(
    () => ({
      functionsBase,
      provider,
      pagePath,
      canGenerate,
      resolvePromptForPage,
      setImageMap,
      setLoading,
      setError,
    }),
    [functionsBase, provider, pagePath, canGenerate, resolvePromptForPage]
  );

  const generateArticleImage = useCallback(
    (article, basePrompt, options) => generateArticleImageWith(ctx, article, basePrompt, options),
    [ctx]
  );

  const generateImagesForArticles = useCallback(
    (articles) => generateImagesForArticlesWith(ctx, articles),
    [ctx]
  );

  /**
   * Get the cached image URL for an article.
   * @param {string} articleId - The article ID
   * @returns {string|null} Image URL if available, null otherwise
   */
  const getImageUrl = useCallback((articleId) => imageMap[articleId] || null, [imageMap]);

  return {
    imageMap,
    loading,
    error,
    generateArticleImage,
    generateImagesForArticles,
    getImageUrl,
  };
}
