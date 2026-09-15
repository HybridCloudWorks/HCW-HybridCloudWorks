/**
 * The Code and Security read. It must not happen until the tab asks, the
 * newest read must win, a failure must leave no stale grades, and "not
 * configured" is an answer rather than an error.
 */
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import useCodeQuality, { CODE_QUALITY_ROUTE } from './useCodeQuality';

const getJSON = vi.fn();
vi.mock('@/lib/api', () => ({ getJSON: (...args) => getJSON(...args) }));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const FIRST = { ok: true, total: 1, fetchedAt: '2026-09-14T10:00:00.000Z' };
const NEWER = { ok: true, total: 2, fetchedAt: '2026-09-14T10:05:00.000Z' };
const NOT_CONFIGURED = {
  ok: false,
  code: 'INTEGRATION_NOT_CONFIGURED',
  error: 'Qlty is not configured: QLTY_API_TOKEN is not set',
  projectUrl: 'https://qlty.sh/gh/HybridCloudWorks/projects/HCW-HybridCloudWorks',
};

beforeEach(() => {
  getJSON.mockReset();
});

describe('useCodeQuality', () => {
  it('reads nothing until enabled, and is not loading meanwhile', () => {
    const { result } = renderHook(() => useCodeQuality(false));
    expect(getJSON).not.toHaveBeenCalled();
    expect(result.current.requested).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it('still loads under StrictMode, whose dev remount supersedes the first read', async () => {
    getJSON.mockResolvedValue(FIRST);
    const { result } = renderHook(() => useCodeQuality(true), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.data).toEqual(FIRST));
    expect(result.current.loading).toBe(false);
  });

  it('reads once when enabled, and keeps the answer when disabled again', async () => {
    getJSON.mockResolvedValue(FIRST);
    const { result, rerender } = renderHook(({ on }) => useCodeQuality(on), {
      initialProps: { on: false },
    });
    rerender({ on: true });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual(FIRST));
    expect(getJSON).toHaveBeenCalledWith(CODE_QUALITY_ROUTE);

    rerender({ on: false });
    rerender({ on: true });
    expect(getJSON).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(FIRST);
  });

  it('does not let a slow first read overwrite a refresh that resolved before it', async () => {
    const slow = deferred();
    getJSON.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(NEWER);
    const { result } = renderHook(() => useCodeQuality(true));

    let landed;
    await act(async () => {
      landed = await result.current.refresh();
    });
    expect(landed).toBe(true);
    expect(result.current.data).toEqual(NEWER);

    await act(async () => {
      slow.resolve(FIRST);
      await slow.promise;
    });
    expect(result.current.data).toEqual(NEWER);
    expect(result.current.loading).toBe(false);
  });

  it('clears the summary and sets the error when a refresh fails', async () => {
    const refused = Object.assign(new Error('Qlty answered 502'), { status: 502 });
    getJSON.mockResolvedValueOnce(FIRST).mockRejectedValueOnce(refused);
    const { result } = renderHook(() => useCodeQuality(true));
    await waitFor(() => expect(result.current.data).toEqual(FIRST));

    let landed;
    await act(async () => {
      landed = await result.current.refresh();
    });
    expect(landed).toBe(false);
    expect(result.current.error).toBe('Qlty answered 502');
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('passes "not configured" through as a state, not an error', async () => {
    getJSON.mockResolvedValue(NOT_CONFIGURED);
    const { result } = renderHook(() => useCodeQuality(true));
    await waitFor(() => expect(result.current.notConfigured).toEqual(NOT_CONFIGURED));
    expect(result.current.error).toBe('');
    expect(result.current.data).toBeNull();
  });

  it('treats any other ok:false body as an error', async () => {
    getJSON.mockResolvedValue({ ok: false, error: 'Something else' });
    const { result } = renderHook(() => useCodeQuality(true));
    await waitFor(() => expect(result.current.error).toBe('Something else'));
    expect(result.current.notConfigured).toBeNull();
  });

  it('drops, without error, a read that answers after unmount', async () => {
    const slow = deferred();
    getJSON.mockReturnValueOnce(slow.promise);
    const { result, unmount } = renderHook(() => useCodeQuality(true));
    const last = result.current;
    unmount();
    await act(async () => {
      slow.resolve(FIRST);
      await slow.promise;
    });
    expect(last.data).toBeNull();
    expect(result.current.data).toBeNull();
  });
});
