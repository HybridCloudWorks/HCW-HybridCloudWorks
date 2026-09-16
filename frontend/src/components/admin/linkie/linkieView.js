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

/**
 * Which one thing the posts list is saying, as a single name.
 *
 * The four states are mutually exclusive, and written as four JSX guards the
 * last of them was `canWrite && !loading && !error && posts.length === 0` —
 * a four-term conjunction restating the three above it, which Qlty flagged as a
 * complex binary expression on #626. Naming the state says it once.
 *
 * @returns {'no-profile'|'loading'|'error'|'empty'|'posts'}
 */
export function listState({ canWrite, loading, error, posts }) {
  if (!canWrite) return 'no-profile';
  if (loading) return 'loading';
  if (error) return 'error';
  return posts.length === 0 ? 'empty' : 'posts';
}

/**
 * Why Push cannot run for one published page, in the order the reasons are
 * worth saying. A table rather than a disjunction: `!url || !canWrite ||
 * loading || alreadyLinked || pushing` said only *that* the button was off,
 * and Qlty flagged it on #626 as a complex binary expression.
 */
const PUSH_BLOCKERS = Object.freeze([
  [(state) => !state.url, () => 'This page has no public URL'],
  [(state) => !state.canWrite, (state) => state.profileNotice || 'No Linkie profile selected'],
  // `posts` is [] while the fetch is in flight, so "already linked" cannot be
  // told apart from "not answered yet" without the flag — and lighting up Push
  // on an article already in Linkie lets a fast operator create duplicates.
  // Caught in review on #429.
  [(state) => state.loading, () => 'Checking what is already linked…'],
  [(state) => state.alreadyLinked, () => 'Already on this Linkie profile'],
  [(state) => state.pushing, () => 'Pushing…'],
]);

/** The reason Push is disabled for this page, or '' when it can run. */
export function pushBlocker(state) {
  const blocker = PUSH_BLOCKERS.find(([holds]) => holds(state));
  return blocker ? blocker[1](state) : '';
}
