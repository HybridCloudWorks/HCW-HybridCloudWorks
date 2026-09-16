/**
 * The posts on one Linkie profile (#577).
 *
 * The read itself is useLinkieRead; what belongs here is what a *post* list is:
 * how a response becomes rows, and the one write that changes the list without
 * re-reading it.
 */
import { describeLinkieFailure, extractPosts, unwrapLinkie, visibleLinksState } from '@/lib/linkie';
import { ltListPosts } from './linkieApi';
import useLinkieRead from './useLinkieRead';

/**
 * The posts Linkie returned, or why the list cannot be read.
 *
 * The proxy answers HTTP 200 whatever Linkie said, so `ok` is the only signal.
 * Without this a 401 renders as "No posts yet".
 */
export function readPosts(response) {
  const unwrapped = unwrapLinkie(response);
  if (unwrapped.notConfigured || unwrapped.failed) {
    const reason = unwrapped.notConfigured ? unwrapped.reason : describeLinkieFailure(unwrapped);
    return { posts: [], error: reason };
  }
  return { posts: extractPosts(response), error: '' };
}

const POSTS_READ = Object.freeze({
  fetch: ltListPosts,
  parse: readPosts,
  empty: Object.freeze({ posts: [] }),
});

export default function useLinkiePosts(profileId) {
  const { result, setResult, loading, reload } = useLinkieRead(profileId, POSTS_READ);

  return {
    ...visibleLinksState({ profileId, loading, result }),
    loading,
    reload,
    // A delete is applied to the list in place: re-reading would show the post
    // again until Linkie's own index catches up.
    dropPost: (postId) =>
      setResult((prev) => ({ ...prev, posts: prev.posts.filter((post) => post._id !== postId) })),
  };
}
