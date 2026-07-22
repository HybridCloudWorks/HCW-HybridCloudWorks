import { collection, getDocs, limit, orderBy, query as buildQuery } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';

const PAGE_SIZE = 200;

export function normalizeGalleryItem(docSnap, sourceCollection) {
  const data = docSnap.data() || {};
  const articleId = String(data.articleId || data.contentId || docSnap.id);
  const normalizedSourceCollection = String(data.sourceCollection || '').trim() || sourceCollection;
  return {
    id: docSnap.id,
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

export async function loadGalleryItems({ max = PAGE_SIZE } = {}) {
  const curatedQuery = buildQuery(
    collection(db, 'curated_article_images'),
    orderBy('createdAt', 'desc'),
    limit(max)
  );
  const contentQuery = buildQuery(
    collection(db, 'generated_content_images'),
    orderBy('createdAt', 'desc'),
    limit(max)
  );

  const [curatedSnapshot, contentSnapshot] = await Promise.all([
    getDocs(curatedQuery),
    getDocs(contentQuery),
  ]);

  return [
    ...curatedSnapshot.docs.map((docSnap) =>
      normalizeGalleryItem(docSnap, 'curated_article_images')
    ),
    ...contentSnapshot.docs.map((docSnap) =>
      normalizeGalleryItem(docSnap, 'generated_content_images')
    ),
  ]
    .sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() || 0;
      const bTime = b.createdAt?.toMillis?.() || 0;
      return bTime - aTime;
    })
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
