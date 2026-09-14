/**
 * The Health Hub's snapshot read. What must hold is ordering, not fetching:
 * the newest read wins however the network orders the answers, an unmounted
 * page takes nothing, and a failed read leaves no stale numbers beside its
 * error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import useOpsSnapshot, { EMPTY_SNAPSHOT } from './useOpsSnapshot';

const postJSON = vi.fn();
vi.mock('@/lib/api', () => ({ postJSON: (...args) => postJSON(...args) }));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const FIRST = { readiness: { publishedItems: 1 }, digest: null, alerts: [] };
const NEWER = { readiness: { publishedItems: 2 }, digest: null, alerts: [] };

beforeEach(() => {
  postJSON.mockReset();
});

describe('useOpsSnapshot', () => {
  it('waits for auth before its first read, and is loading meanwhile', () => {
    const { result } = renderHook(() => useOpsSnapshot(false));
    expect(postJSON).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
    expect(result.current.snapshot).toBe(EMPTY_SNAPSHOT);
  });

  it('loads once auth is ready', async () => {
    postJSON.mockResolvedValue(FIRST);
    const { result } = renderHook(() => useOpsSnapshot(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(postJSON).toHaveBeenCalledWith('getOpsHealthSnapshot', {});
    expect(result.current.snapshot).toEqual(FIRST);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('');
  });

  it('does not let a slow first load overwrite a refresh that resolved before it', async () => {
    const slow = deferred();
    postJSON.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(NEWER);
    const { result } = renderHook(() => useOpsSnapshot(true));

    let landed;
    await act(async () => {
      landed = await result.current.refresh();
    });
    expect(landed).toBe(true);
    expect(result.current.snapshot).toEqual(NEWER);

    // The first read answers last. Last to resolve must not win.
    await act(async () => {
      slow.resolve(FIRST);
      await slow.promise;
    });
    expect(result.current.snapshot).toEqual(NEWER);
    expect(result.current.loading).toBe(false);
  });

  it('drops a superseded failure too, rather than blanking a newer read', async () => {
    const slow = deferred();
    postJSON.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(NEWER);
    const { result } = renderHook(() => useOpsSnapshot(true));
    await act(async () => {
      await result.current.refresh();
    });

    await act(async () => {
      slow.reject(new Error('first read timed out'));
      await slow.promise.catch(() => {});
    });
    expect(result.current.snapshot).toEqual(NEWER);
    expect(result.current.error).toBe('');
  });

  it('empties the snapshot and sets the error when a refresh fails', async () => {
    postJSON.mockResolvedValueOnce(FIRST).mockRejectedValueOnce(new Error('snapshot refused'));
    const { result } = renderHook(() => useOpsSnapshot(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let landed;
    await act(async () => {
      landed = await result.current.refresh();
    });
    // Resolves rather than throws: the caller's action already happened.
    expect(landed).toBe(false);
    expect(result.current.error).toBe('snapshot refused');
    expect(result.current.snapshot).toBe(EMPTY_SNAPSHOT);
    expect(result.current.loaded).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('takes nothing from a read whose effect was torn down before it answered', async () => {
    // The same cleanup runs on unmount; an auth flip is the observable case,
    // because the hook is still mounted to be asserted on.
    const slow = deferred();
    postJSON.mockReturnValueOnce(slow.promise);
    const { result, rerender } = renderHook(({ ready }) => useOpsSnapshot(ready), {
      initialProps: { ready: true },
    });
    rerender({ ready: false });
    await act(async () => {
      slow.resolve(FIRST);
      await slow.promise;
    });
    expect(result.current.snapshot).toBe(EMPTY_SNAPSHOT);
    expect(result.current.loaded).toBe(false);
  });
});
