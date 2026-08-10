import { useState, useCallback } from 'react';
import { getFunctionsBase } from '@/lib/functionsBase';
import { useImagePrompts } from './useImagePrompts';
import { postJSON, getJSON } from '@/lib/api'; // Stage-2 fix: authed call required after requireAdmin gate added

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

function isFunctionsBaseUnavailable(functionsBase) {
  return !functionsBase || functionsBase.includes('localhost') || functionsBase.includes('5173');
}

function getArticleUrl(article = {}) {
  return article.sourceUrl || article['CD Url'] || article.url || article.link || '';
}

function buildImageRequestBody(article, basePrompt, provider) {
  return {
    articleTitle: article.title || 'AWS News Article',
    articleSummary: article.summary || article.description || '',
    basePrompt: basePrompt || 'Professional technical illustration',
    provider: provider || 'AWS',
    articleId: article.id,
    articleUrl: getArticleUrl(article),
  };
}

/**
 * Hook to generate and manage images for curated articles.
 * Generates unique images per article using the page's saved prompt.
 */
export function useGenerateCuratedImages(pagePath, provider) {
  const [imageMap, setImageMap] = useState({}); // { articleId: imageUrl }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Get cached image URL from the curated-image cache endpoint
  const getCachedImageUrl = useCallback(async (articleId) => {
    try {
      const res = await getJSON(`cms/images/curated/${encodeURIComponent(articleId)}`);
      if (res.item?.imageUrl) {
        console.warn(`[generateCuratedImages] Found cached image for ${articleId}`);
        return res.item.imageUrl;
      }
      return null;
    } catch (err) {
      console.error(`[generateCuratedImages] Error fetching cache for ${articleId}:`, err.message);
      return null;
    }
  }, []);

  const { resolvePromptForPage } = useImagePrompts();
  const functionsBase = getFunctionsBase();

  /**
   * Generate a unique image for a single curated article.
   * @param {Object} article - Curated article object with id, title, summary
   * @param {string} basePrompt - Base prompt from image_prompts
   * @returns {Promise<string|null>} Image URL or null if generation failed
   */
  const generateArticleImage = useCallback(
    async (article, basePrompt) => {
      try {
        if (!article?.id) {
          console.warn(`[generateCuratedImages] Article missing ID, skipping generation`);
          return null;
        }

        // Skip if functionsBase is not configured (empty, localhost, or vite dev server)
        if (isFunctionsBaseUnavailable(functionsBase)) {
          console.warn(
            `[generateCuratedImages] Cloud Functions not available (${functionsBase}), skipping for ${article.id}`
          );
          return null;
        }

        // Check the server-side image cache first (cms/images, not Firestore)
        const cachedUrl = await getCachedImageUrl(article.id);
        if (cachedUrl) {
          console.warn(`[generateCuratedImages] Using cached image for ${article.id}`);
          setImageMap((prev) => ({ ...prev, [article.id]: cachedUrl }));
          return cachedUrl;
        }

        // Not cached, generate a new image. postJSON injects the Entra access
        // token (lib/api.js); generateCuratedArticleImage is behind the admin
        // role guard.
        console.warn(`[generateCuratedImages] Generating new image for article: ${article.id}`);
        const requestBody = buildImageRequestBody(article, basePrompt, provider);
        const { imageUrl } = await postJSON('generateCuratedArticleImage', requestBody);

        if (imageUrl) {
          return imageUrl;
        }

        return null;
      } catch (err) {
        console.error(
          `[generateCuratedImages] Failed for article ${article?.id}:`,
          err.message || err
        );
        return null;
      }
    },
    [functionsBase, provider, getCachedImageUrl]
  );

  /**
   * Generate images for multiple curated articles.
   * Fetches the prompt for the page and generates unique images.
   * @param {Array} articles - Array of curated article objects
   * @returns {Promise<Object>} Map of articleId -> imageUrl
   */
  const generateImagesForArticles = useCallback(
    async (articles) => {
      if (!articles || articles.length === 0) {
        console.warn('[generateCuratedImages] No articles to process');
        return {};
      }

      setLoading(true);
      setError(null);

      try {
        console.warn(`[generateCuratedImages] Processing ${articles.length} articles`);

        // Fetch the assigned global prompt set/prompt for this page.
        const providerKey = String(provider || 'AWS').toUpperCase();
        let basePrompt =
          DEFAULT_PROMPT_BY_PROVIDER[providerKey] ||
          'Professional technical illustration for cloud infrastructure with clean, modern design';

        try {
          const promptData = await resolvePromptForPage(pagePath);
          if (promptData?.primaryPrompt) {
            const additionalParameters = promptData.additionalParameters?.trim();
            basePrompt = additionalParameters
              ? `${promptData.primaryPrompt}\n\nAdditional Style Constraints:\n${additionalParameters}`
              : promptData.primaryPrompt;
            console.warn(
              `[generateCuratedImages] Using prompt set: ${promptData.setName} / ${promptData.promptName || 'primary'}`
            );
          } else {
            console.warn('[generateCuratedImages] No prompt assignment configured for this page');
          }
        } catch (promptErr) {
          console.warn(
            '[generateCuratedImages] Could not fetch prompts, using default:',
            promptErr.message
          );
          // Continue with default prompt
        }

        // Generate images for all articles in parallel
        console.warn(
          `[generateCuratedImages] Generating images for ${articles.length} articles...`
        );
        const imagePromises = articles.map((article) =>
          generateArticleImage(article, basePrompt).then((url) => ({
            id: article.id,
            url,
          }))
        );

        const results = await Promise.all(imagePromises);
        console.warn(`[generateCuratedImages] All ${articles.length} image requests completed`);

        // Build map of articleId -> imageUrl
        const newImageMap = {};
        let successCount = 0;
        results.forEach(({ id, url }) => {
          if (url) {
            newImageMap[id] = url;
            successCount++;
          }
        });
        console.warn(
          `[generateCuratedImages] Success: ${successCount}/${articles.length} images ready`
        );

        setImageMap((prev) => ({ ...prev, ...newImageMap }));
        return newImageMap;
      } catch (err) {
        const errorMsg = err?.message || 'Failed to generate curated article images';
        setError(errorMsg);
        console.error('[generateCuratedImages] Error:', err);
        return {};
      } finally {
        setLoading(false);
      }
    },
    [provider, pagePath, resolvePromptForPage, generateArticleImage]
  );

  /**
   * Get the cached image URL for an article.
   * @param {string} articleId - The article ID
   * @returns {string|null} Image URL if available, null otherwise
   */
  const getImageUrl = useCallback(
    (articleId) => {
      return imageMap[articleId] || null;
    },
    [imageMap]
  );

  return {
    imageMap,
    loading,
    error,
    generateArticleImage,
    generateImagesForArticles,
    getImageUrl,
  };
}
