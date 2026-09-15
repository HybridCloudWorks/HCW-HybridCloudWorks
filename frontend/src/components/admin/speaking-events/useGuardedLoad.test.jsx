/**
 * The Speaking Events Hub's read guard (#573). What must hold is ordering:
 * the newest read wins however the network orders the answers, a torn-down
 * read takes nothing, and a failed read leaves no stale rows beside its error.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import useGuardedLoad from './useGuardedLoad';

const EMPTY = Object.freeze([]);
const describeError = (err) => `Failed: ${err.message}`;

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const setup = (load, enabled = true) =>
  renderHook(({ ready }) => useGuardedLoad(load, { enabled: ready, empty: EMPTY, describeError }), {
    initialProps: { ready: enabled },
  });

describe('useGuardedLoad', () => {
  it('does not read until enabled, and is loading meanwhile', async () => {
    const load = vi.fn().mockResolvedValue(['a']);
    const { result } = setup(load, false);
    expect(load).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
    let landed;
    await act(async () => {
      landed = await result.current.refresh();
    });
    expect(landed).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('loads and stamps when it landed', async () => {
    const load = vi.fn().mockResolvedValue(['a']);
    const { result } = setup(load);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.data).toEqual(['a']);
    expect(result.current.loadedAt).toBeInstanceOf(Date);
    expect(result.current.loading).toBe(false);
  });

  it('does not let a slow first read overwrite a refresh that answered first', async () => {
    const slow = deferred();
    const load = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValueOnce(['newer']);
    const { result } = setup(load);
    await act(async () => {
      expect(await result.current.refresh()).toBe(true);
    });
    await act(async () => {
      slow.resolve(['older']);
      await slow.promise;
    });
    expect(result.current.data).toEqual(['newer']);
  });

  it('drops a superseded failure rather than blanking a newer read', async () => {
    const slow = deferred();
    const load = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValueOnce(['newer']);
    const { result } = setup(load);
    await act(async () => {
      await result.current.refresh();
    });
    await act(async () => {
      slow.reject(new Error('timed out'));
      await slow.promise.catch(() => {});
    });
    expect(result.current.data).toEqual(['newer']);
    expect(result.current.error).toBe('');
  });

  it('empties the data when a refresh fails, and never throws', async () => {
    const load = vi.fn().mockResolvedValueOnce(['a']).mockRejectedValueOnce(new Error('refused'));
    const { result } = setup(load);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    let landed;
    await act(async () => {
      landed = await result.current.refresh();
    });
    expect(landed).toBe(false);
    expect(result.current.error).toBe('Failed: refused');
    expect(result.current.data).toBe(EMPTY);
    expect(result.current.loaded).toBe(false);
  });

  it('takes nothing from a read whose effect was torn down before it answered', async () => {
    const slow = deferred();
    const load = vi.fn().mockReturnValueOnce(slow.promise);
    const { result, rerender } = setup(load);
    rerender({ ready: false });
    await act(async () => {
      slow.resolve(['late']);
      await slow.promise;
    });
    expect(result.current.data).toBe(EMPTY);
    expect(result.current.loaded).toBe(false);
  });
});
