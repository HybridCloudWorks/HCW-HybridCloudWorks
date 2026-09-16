/**
 * The Linkie Hub's pure view helpers (#577).
 *
 * The rules for what counts as a live page and where it lives are the Social
 * Hub's, and deliberately so — both hubs push the same published pages
 * outward, so they must agree about which ones exist.
 */
import { resolveMediaUrl } from '@/lib/functionsBase';
import { getOrderedContentImageUrls } from '@/lib/contentImages';
import { toPublicImageUrl } from '@/lib/linkie';

export function isLiveRecord(item) {
  const status = String(item?.contentStatus || '');
  if (item?.softDeletedAt || item?.softDeleteExpiresAt) return false;
  return item?.Live === true || item?.Status === 'Live' || status.startsWith('published_');
}

export function getLiveUrl(item) {
  return (
    item.slugPageUrl ||
    item.publishedUrl ||
    item.blogUrl ||
    item.publicUrl ||
    (item.curatedSubpagePath
      ? `https://hybridcloudworks.com${String(item.curatedSubpagePath).startsWith('/') ? item.curatedSubpagePath : `/${item.curatedSubpagePath}`}`
      : '')
  );
}

/**
 * An image URL Linkie's servers can fetch, or ''. Uploads and gallery rows
 * store `/api/public/media/…` paths; see `toPublicImageUrl` for the rules.
 */
export const publicImageUrl = (url) =>
  toPublicImageUrl(url, {
    resolve: resolveMediaUrl,
    origin: typeof window === 'undefined' ? '' : window.location.origin,
  });

/** A content item's cover — the first of its ordered hero/secondary images. */
export function contentCoverImage(item) {
  const [first] = getOrderedContentImageUrls(item);
  const cover = first || (typeof item?.coverImage === 'string' ? item.coverImage : '');
  return publicImageUrl(cover);
}
