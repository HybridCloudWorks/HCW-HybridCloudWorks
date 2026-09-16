/**
 * The Linkie Hub's pure view helpers (#577).
 *
 * `isLiveRecord` and `getLiveUrl` are re-exported from lib/livePages.js rather
 * than defined here. Both hubs push the same published pages outward, so they
 * must agree about which ones exist — and until #577 each carried its own copy
 * with a comment claiming they matched.
 */
import { resolveMediaUrl } from '@/lib/functionsBase';
import { getOrderedContentImageUrls } from '@/lib/contentImages';
import { toPublicImageUrl } from '@/lib/linkie';
export { getLiveUrl, isLiveRecord } from '@/lib/livePages';

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
