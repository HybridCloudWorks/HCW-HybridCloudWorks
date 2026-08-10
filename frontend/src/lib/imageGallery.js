import { getJSON } from '@/lib/api';
import { toMillis } from '@/lib/dateUtils';

const PAGE_SIZE = 200;

export function normalizeGalleryItem(item, sourceCollection) {
  const data = item || {};
  const articleId = String(data.articleId || data.contentId || data.id);
  const normalizedSourceCollection = String(data.sourceCollection || '').trim() || sourceCollection;
  return {
    id: data.id,
    articleId,
    imageUrl: data.imageUrl || '',
    provider: data.provider || '',
    title: data.title || articleId,
    slot: data.slot || '',
    galleryCollection: sourceCollection,
    sourceCollection: normalizedSourceCollection,
    createdAt: data.createdAt || null,
    customTags: data.customTags || [],
    folder: data.folder || 'default',
  };
}

export function getSourceLabel(sourceCollection) {
  if (
    sourceCollection === 'generated_content_images' ||
    sourceCollection === 'content' ||
    sourceCollection === 'blogs'
  ) {
    return 'ContentForge';
  }
  if (sourceCollection === 'curated_article_images') return 'Curated';
  if (sourceCollection === 'preview') return 'Preview';
  if (sourceCollection === 'manual_upload') return 'Uploaded';
  return 'Generated';
}

const createdAtMillis = toMillis;

export async function loadGalleryItems({ max = PAGE_SIZE } = {}) {
  // GET cms/images returns both galleries, newest first each, capped at max.
  const res = await getJSON(`cms/images?limit=${max}`);

  return [
    ...(res.curated || []).map((item) => normalizeGalleryItem(item, 'curated_article_images')),
    ...(res.generated || []).map((item) => normalizeGalleryItem(item, 'generated_content_images')),
  ]
    .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))
    .reduce(
      (acc, item) => {
        // Dedupe by imageUrl — multiple rows for the same generated asset
        // (regens, multi-page reuse) collapse into a single tile keyed on the
        // newest row. Items without a URL fall back to id-uniqueness.
        const key = item.imageUrl || `__id:${item.id}`;
        if (acc.seen.has(key)) return acc;
        acc.seen.add(key);
        acc.items.push(item);
        return acc;
      },
      { seen: new Set(), items: [] }
    ).items;
}
