/**
 * The Publishing tab's snapshot read: first read may use caches, a refresh
 * never does; the newest read wins; a failed read clears the old snapshot;
 * an unmounted tab takes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import usePublicSnapshot from './usePublicSnapshot';

const fetchPublicSnapshot = vi.fn();
vi.mock('@/lib/publicApi', () => ({
  fetchPublicSnapshot: (...args) => fetchPublicSnapshot(...args),
}));

const deferred = () => {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const OLD = { generatedAt: '2026-09-01T00:00:00Z', items: [{ id: 'a' }] };
const NEW = { generatedAt: '2026-09-14T00:00:00Z', items: [{ id: 'a' }, { id: 'b' }] };

beforeEach(() => fetchPublicSnapshot.mockReset());

describe('usePublicSnapshot', () => {
  it('loads on mount, and a refresh asks past the caches', async () => {
    fetchPublicSnapshot.mockResolvedValueOnce(OLD).mockResolvedValueOnce(NEW);
    const { result } = renderHook(() => usePublicSnapshot());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.snapshot).toEqual(OLD));
    expect(fetchPublicSnapshot).toHaveBeenLastCalledWith('certifications', { fresh: false });

    await act(async () => {
      expect(await result.current.refresh()).toBe(true);
    });
    expect(fetchPublicSnapshot).toHaveBeenLastCalledWith('certifications', { fresh: true });
    expect(result.current.snapshot).toEqual(NEW);
  });

  it('reports "never published" as null, not as loading', async () => {
    fetchPublicSnapshot.mockResolvedValueOnce(null);
    const { result } = renderHook(() => usePublicSnapshot());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.snapshot).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('does not let a slow first read overwrite a newer refresh', async () => {
    const slow = deferred();
    fetchPublicSnapshot.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(NEW);
    const { result } = renderHook(() => usePublicSnapshot());
    await act(async () => {
      await result.current.refresh();
    });
    await act(async () => {
      slow.resolve(OLD);
      await slow.promise;
    });
    expect(result.current.snapshot).toEqual(NEW);
  });

  it('clears the old snapshot when a refresh fails', async () => {
    fetchPublicSnapshot.mockResolvedValueOnce(OLD).mockRejectedValueOnce(new Error('HTTP 500'));
    const { result } = renderHook(() => usePublicSnapshot());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      expect(await result.current.refresh()).toBe(false);
    });
    expect(result.current.snapshot).toBeUndefined();
    expect(result.current.loaded).toBe(false);
    expect(result.current.error).toBe('HTTP 500');
  });

  it('takes nothing after unmount', async () => {
    const slow = deferred();
    fetchPublicSnapshot.mockReturnValueOnce(slow.promise);
    const { result, unmount } = renderHook(() => usePublicSnapshot());
    const before = result.current;
    unmount();
    await act(async () => {
      slow.resolve(OLD);
      await slow.promise;
    });
    expect(result.current).toBe(before);
    expect(result.current.snapshot).toBeUndefined();
  });
});
