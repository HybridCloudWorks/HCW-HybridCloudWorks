import { toDate } from '@/lib/dateUtils';

/**
 * Normalize inconsistent Firestore field names into a canonical shape.
 * Many documents use both Title/title, Summary/summary, etc.
 * Use this when reading content items to avoid cascading fallback chains.
 */
export const normalizeContentFields = (doc) => {
  if (!doc) return null;
  return {
    ...doc,
    title: doc.Title || doc.title || '',
    summary: doc.Summary || doc.summary || '',
    cloudProvider: doc['Cloud Provider'] || doc.cloudProvider || '',
    publishTarget: doc.publishTarget || doc.targetLandingZone || '',
    content: doc.content || doc.Content || doc.postContent || '',
    slug: doc.slug || doc.Slug || '',
  };
};

/**
 * Kept as a named export because several components import it; the
 * implementation now lives in lib/dateUtils.js so there is one of it
 * (TODO.md T-304).
 */
export const normalizeFirestoreDate = (value) => toDate(value);

/**
 * Remove HTML tags from a string, applying the removal repeatedly until the
 * result is stable. A single pass of `<[^>]*>` is incomplete — overlapping
 * constructs such as `<scr<script>ipt>` leave a live tag behind — so we loop
 * to a fixed point. Used for plain-text previews and word counts.
 */
export const stripHtmlTags = (value) => {
  if (!value) return '';
  let prev;
  let out = String(value);
  do {
    prev = out;
    out = out.replace(/<[^>]*>/g, '');
  } while (out !== prev);
  return out;
};

export const getCoverImageUrl = (article) => {
  if (!article) return null;

  // Priority 0: AI-generated cover (altCoverImage field)
  if (article.altCoverImage && typeof article.altCoverImage === 'string') {
    return normalizePublicImageUrl(article.altCoverImage);
  }

  // Priority 1: Cover Image field (array or object)
  const coverImage = article.coverImage || article['Cover Image'];
  if (!coverImage) return null;
  if (Array.isArray(coverImage)) return normalizePublicImageUrl(coverImage[0]?.downloadURL || null);
  if (typeof coverImage === 'object')
    return normalizePublicImageUrl(coverImage.downloadURL || null);
  return normalizePublicImageUrl(coverImage);
};

export const normalizePublicImageUrl = (value) => {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'storage.googleapis.com') {
      const pathSegments = parsed.pathname.split('/').filter(Boolean);
      if (pathSegments.length >= 2) {
        const [bucket, ...rest] = pathSegments;
        return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(rest.join('/'))}?alt=media`;
      }
    }
  } catch {
    return url;
  }

  return url;
};

export const formatPostDate = (date) => {
  const normalized = normalizeFirestoreDate(date);
  return normalized && !isNaN(normalized) ? normalized.toLocaleDateString() : '';
};
