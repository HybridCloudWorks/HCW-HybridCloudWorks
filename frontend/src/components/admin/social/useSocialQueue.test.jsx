/**
 * The Queue tab's state, without its cards: both lists paint together, a
 * failed read empties both (#555), a second delete click while the first is
 * unanswered is ignored, and an edit paints over its row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  publerListPosts: vi.fn(),
  listSocialPosts: vi.fn(),
  publerDeletePost: vi.fn(),
  deleteSocialPostDoc: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock('./publerApi', () => ({
  publerListPosts: (...args) => api.publerListPosts(...args),
  listSocialPosts: (...args) => api.listSocialPosts(...args),
  publerDeletePost: (...args) => api.publerDeletePost(...args),
  deleteSocialPostDoc: (...args) => api.deleteSocialPostDoc(...args),
  publerCallFailed: (err) => ({ posts: [], notice: err.message }),
  readPublerPosts: (res) => ({ posts: res?.posts || [], notice: res?.notice || '' }),
}));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

const { default: useSocialQueue } = await import('./useSocialQueue.js');

/** A promise the test settles by hand. */
function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useSocialQueue', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    toast.mockReset();
  });

  it('loads Publer posts and local records together and clears loading', async () => {
    api.publerListPosts.mockResolvedValue({ posts: [{ id: 'p1' }] });
    api.listSocialPosts.mockResolvedValue([{ id: 'l1', caption: 'Hi' }]);
    const { result } = renderHook(() => useSocialQueue());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.publerPosts).toEqual([{ id: 'p1' }]);
    expect(result.current.localPosts).toEqual([{ id: 'l1', caption: 'Hi' }]);
    expect(result.current.error).toBe('');
    expect(api.publerListPosts).toHaveBeenCalledWith('scheduled');
  });

  it('carries a refused Publer call as a notice rather than an error', async () => {
    api.publerListPosts.mockRejectedValue(new Error('Publer is not configured'));
    api.listSocialPosts.mockResolvedValue([]);
    const { result } = renderHook(() => useSocialQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.publerNotice).toBe('Publer is not configured');
    expect(result.current.error).toBe('');
  });

  it('empties both lists when the local read fails', async () => {
    api.publerListPosts.mockResolvedValue({ posts: [{ id: 'p1' }] });
    api.listSocialPosts.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => useSocialQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('500');
    expect(result.current.publerPosts).toEqual([]);
    expect(result.current.localPosts).toEqual([]);
  });

  it('sends one delete for two confirmations while the first is unanswered', async () => {
    api.publerListPosts.mockResolvedValue({ posts: [{ id: 'p1' }, { id: 'p2' }] });
    api.listSocialPosts.mockResolvedValue([]);
    const pending = deferred();
    api.publerDeletePost.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useSocialQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setPendingDelete({ kind: 'publer', post: { id: 'p1' } }));
    act(() => result.current.confirmDelete());
    await waitFor(() => expect(result.current.deletingId).toBe('p1'));
    act(() => result.current.setPendingDelete({ kind: 'publer', post: { id: 'p2' } }));
    act(() => result.current.confirmDelete());
    expect(api.publerDeletePost).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
    });
    await waitFor(() => expect(result.current.deletingId).toBeNull());
    expect(result.current.publerPosts).toEqual([{ id: 'p2' }]);
    expect(toast).toHaveBeenCalledWith({ title: 'Post deleted from Publer' });
  });

  it('removes a local record on confirm and paints an edit over its row', async () => {
    api.publerListPosts.mockResolvedValue({ posts: [] });
    api.listSocialPosts.mockResolvedValue([
      { id: 'l1', caption: 'One' },
      { id: 'l2', caption: 'Two' },
    ]);
    api.deleteSocialPostDoc.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useSocialQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setPendingDelete({ kind: 'local', post: { id: 'l1' } }));
    await act(async () => {
      result.current.confirmDelete();
    });
    await waitFor(() => expect(result.current.localPosts).toEqual([{ id: 'l2', caption: 'Two' }]));
    expect(api.deleteSocialPostDoc).toHaveBeenCalledWith('l1');

    act(() => result.current.setEditing({ id: 'l2', caption: 'Two' }));
    act(() => result.current.applyEdit({ id: 'l2', caption: 'Two, edited' }));
    expect(result.current.localPosts).toEqual([{ id: 'l2', caption: 'Two, edited' }]);
    expect(result.current.editing).toBeNull();
  });
});
