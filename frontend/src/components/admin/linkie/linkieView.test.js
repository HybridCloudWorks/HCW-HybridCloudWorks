/**
 * The Links tab's list state, which decides which single thing the list area
 * says. Four mutually exclusive answers written as four JSX guards is how the
 * `canWrite && !loading && !error && posts.length === 0` conjunction came to
 * exist; these assertions are what stops it coming back.
 */
import { describe, expect, it } from 'vitest';
import { listState, pushBlocker } from './linkieView';

const base = { canWrite: true, loading: false, error: '', posts: [] };

describe('listState', () => {
  it('answers "no profile" before anything else, because nothing was asked', () => {
    // A read cannot be in flight against a profile that was never chosen, so
    // this outranks `loading` even if a stale flag says otherwise.
    expect(listState({ ...base, canWrite: false, loading: true, error: 'x' })).toBe('no-profile');
  });

  it('answers "loading" ahead of the error a previous read left behind', () => {
    expect(listState({ ...base, loading: true, error: 'stale failure' })).toBe('loading');
  });

  it('answers "error" rather than "empty" when the read failed', () => {
    // The defect this prevents: a failed read rendering as "No posts yet",
    // which reads as an answer about the profile rather than about the call.
    expect(listState({ ...base, error: 'Linkie refused' })).toBe('error');
  });

  it('tells an empty list apart from a list with posts', () => {
    expect(listState(base)).toBe('empty');
    expect(listState({ ...base, posts: [{ _id: '1' }] })).toBe('posts');
  });
});

describe('pushBlocker', () => {
  const ready = {
    url: 'https://hybridcloudworks.com/a',
    canWrite: true,
    loading: false,
    alreadyLinked: false,
    pushing: false,
    profileNotice: '',
  };

  it('lets a push through when there is nothing in the way', () => {
    expect(pushBlocker(ready)).toBe('');
  });

  it('refuses a page with no public URL before anything else', () => {
    expect(pushBlocker({ ...ready, url: '' })).toBe('This page has no public URL');
  });

  it('prefers the profile notice to its own wording when one was supplied', () => {
    expect(pushBlocker({ ...ready, canWrite: false, profileNotice: 'Key rejected' })).toBe(
      'Key rejected'
    );
    expect(pushBlocker({ ...ready, canWrite: false })).toBe('No Linkie profile selected');
  });

  it('blocks while the existing posts are still being read', () => {
    // The #429 defect: `posts` is [] until the read settles, so an article
    // already on the profile looks unlinked and a fast operator duplicates it.
    expect(pushBlocker({ ...ready, loading: true })).toBe('Checking what is already linked…');
  });

  it('names the duplicate and the in-flight push, rather than only disabling', () => {
    expect(pushBlocker({ ...ready, alreadyLinked: true })).toBe('Already on this Linkie profile');
    expect(pushBlocker({ ...ready, pushing: true })).toBe('Pushing…');
  });
});
