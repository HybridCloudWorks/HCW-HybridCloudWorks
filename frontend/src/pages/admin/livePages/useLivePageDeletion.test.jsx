/**
 * The Delete Live Page flow (PR #841): confirm target in, one
 * softDeleteLivePage request out, and the URL remembered as deleted so the
 * row leaves the screen without a refetch; a failure is shown and clears
 * the in-flight marker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const postJSON = vi.fn();
vi.mock('@/lib/api', () => ({ postJSON: (...args) => postJSON(...args) }));

const { useLivePageDeletion } = await import('./useLivePageDeletion.js');

const TARGET = {
  id: 'c1',
  __source: 'content',
  Live: true,
  publishedUrl: 'https://HybridCloudWorks.com/azure/blog/one',
};

beforeEach(() => {
  postJSON.mockReset();
});

describe('useLivePageDeletion', () => {
  it('does nothing without a target', async () => {
    const { result } = renderHook(() => useLivePageDeletion());
    await act(() => result.current.handleDeleteLivePage());
    expect(postJSON).not.toHaveBeenCalled();
  });

  it('soft-deletes the target and remembers its URL as deleted', async () => {
    postJSON.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useLivePageDeletion());

    act(() => result.current.setDeleteTarget(TARGET));
    await act(() => result.current.handleDeleteLivePage());

    expect(postJSON).toHaveBeenCalledWith('softDeleteLivePage', { contentId: 'c1', blogId: '' });
    expect(result.current.locallyDeletedKeys).toEqual({
      'https://hybridcloudworks.com/azure/blog/one': true,
    });
    expect(result.current.deleteTarget).toBeNull();
    expect(result.current.deletingId).toBe('');
    expect(result.current.deleteError).toBe('');
  });

  it('keeps the target and reports the failure when the request fails', async () => {
    postJSON.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useLivePageDeletion());

    act(() => result.current.setDeleteTarget(TARGET));
    await act(() => result.current.handleDeleteLivePage());

    expect(result.current.deleteError).toBe('nope');
    expect(result.current.deleteTarget).toEqual(TARGET);
    expect(result.current.locallyDeletedKeys).toEqual({});
    expect(result.current.deletingId).toBe('');
  });
});
