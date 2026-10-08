/**
 * The Health Hub's memory, as the page holds it (#1010, #1011): read on
 * load, re-read every minute while visible and not while hidden, never wiped
 * by a failed read, painted first from this tab's cache, and recorded back
 * with the server's own copy kept.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const getJSON = vi.fn();
const sendJSON = vi.fn();
vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
}));

import useStoredResults, { POLL_MS } from './useStoredResults';
import { PROBE_RESULTS_ROUTE, RESULTS_CACHE_KEY, newestResult } from './probeStore';

const answer = (status, checkedAt = '2026-10-08T11:58:00.000Z') => ({
  success: true,
  results: {
    publer: { probeId: 'publer', status, summary: status, checkedAt, checkedBy: 'pulse' },
  },
  pulse: { lastBeatAt: '2026-10-08T11:58:00.000Z', intervalMs: 300000 },
});

let visibility = 'visible';
const setVisibility = (state) => {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
};
const reads = () => getJSON.mock.calls.filter(([route]) => route === PROBE_RESULTS_ROUTE).length;
/**
 * Let a read land. With the interval faked, waitFor cannot poll (it uses the
 * same timer), so the tests that fake it settle the promise chain directly.
 */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

beforeEach(() => {
  window.sessionStorage.clear();
  getJSON.mockReset();
  sendJSON.mockReset();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useStoredResults', () => {
  it('reads on load, in the shared words, and caches the answer for the next first paint', async () => {
    getJSON.mockResolvedValue(answer('unavailable'));
    const { result } = renderHook(() => useStoredResults(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.results.publer).toMatchObject({
      status: 'offline',
      checkedBy: 'pulse',
      stored: true,
    });
    expect(result.current.pulse).toMatchObject({ lastBeatAt: '2026-10-08T11:58:00.000Z' });
    expect(JSON.parse(window.sessionStorage.getItem(RESULTS_CACHE_KEY)).results.publer.status).toBe(
      'offline'
    );
  });

  it('paints from this tab’s cache before the server answers', () => {
    window.sessionStorage.setItem(RESULTS_CACHE_KEY, JSON.stringify(answer('healthy')));
    getJSON.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStoredResults(true));
    expect(result.current.results.publer.status).toBe('healthy');
    expect(result.current.loaded).toBe(false);
  });

  it('re-reads every minute while visible, stops while hidden, and reads at once when shown', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    getJSON.mockResolvedValue(answer('healthy'));
    renderHook(() => useStoredResults(true));
    await waitFor(() => expect(reads()).toBe(1));

    await act(async () => vi.advanceTimersByTime(POLL_MS));
    expect(reads()).toBe(2);

    act(() => setVisibility('hidden'));
    await act(async () => vi.advanceTimersByTime(POLL_MS * 5));
    expect(reads()).toBe(2);

    await act(async () => setVisibility('visible'));
    expect(reads()).toBe(3);
    await act(async () => vi.advanceTimersByTime(POLL_MS));
    expect(reads()).toBe(4);
  });

  it('picks up what the pulse recorded since the last read, without a reload', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    getJSON.mockResolvedValueOnce(answer('healthy'));
    const { result } = renderHook(() => useStoredResults(true));
    await settle();
    expect(result.current.results.publer?.status).toBe('healthy');
    getJSON.mockResolvedValueOnce(answer('critical', '2026-10-08T12:03:00.000Z'));
    await act(async () => vi.advanceTimersByTime(POLL_MS));
    await settle();
    expect(result.current.results.publer.status).toBe('critical');
  });

  it('keeps the results it has when a re-read fails, and says the read failed', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    getJSON.mockResolvedValueOnce(answer('healthy'));
    const { result } = renderHook(() => useStoredResults(true));
    await settle();
    expect(result.current.loaded).toBe(true);
    getJSON.mockRejectedValueOnce(new Error('HTTP 503'));
    await act(async () => vi.advanceTimersByTime(POLL_MS));
    await settle();
    expect(result.current.error).toBe('HTTP 503');
    expect(result.current.results.publer.status).toBe('healthy');
  });

  it('reads nothing until auth is ready, and stops polling when unmounted', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    getJSON.mockResolvedValue(answer('healthy'));
    const { rerender, unmount } = renderHook(({ ready }) => useStoredResults(ready), {
      initialProps: { ready: false },
    });
    expect(reads()).toBe(0);
    rerender({ ready: true });
    await waitFor(() => expect(reads()).toBe(1));
    unmount();
    await act(async () => vi.advanceTimersByTime(POLL_MS * 3));
    expect(reads()).toBe(1);
  });

  it('records a result and keeps the server’s stamped copy; a refused write changes nothing', async () => {
    getJSON.mockResolvedValue({ success: true, results: {}, pulse: null });
    const { result } = renderHook(() => useStoredResults(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    sendJSON.mockResolvedValueOnce({
      success: true,
      result: {
        probeId: 'publer',
        status: 'healthy',
        summary: 'Connected.',
        checkedAt: '2026-10-08T12:01:00.000Z',
        checkedBy: 'admin',
      },
    });
    await act(() =>
      result.current.record('publer', { status: 'healthy', summary: 'Connected.' }, 420.4)
    );
    expect(sendJSON).toHaveBeenCalledWith(PROBE_RESULTS_ROUTE, 'PUT', {
      probeId: 'publer',
      status: 'healthy',
      summary: 'Connected.',
      durationMs: 420,
    });
    expect(result.current.results.publer).toMatchObject({
      checkedAt: '2026-10-08T12:01:00.000Z',
      checkedBy: 'admin',
    });

    // A viewer recording an editor's probe: 403, swallowed, nothing changes.
    sendJSON.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    await act(() => result.current.record('resend', { status: 'critical', summary: 'x' }));
    expect(result.current.results.resend).toBeUndefined();
  });
});

describe('newestResult', () => {
  it('takes the later time, and never lets a result with no time beat one with a time', () => {
    const older = { checkedAt: '2026-10-08T10:00:00.000Z' };
    const newer = { checkedAt: '2026-10-08T11:00:00.000Z' };
    const never = { checkedAt: null };
    expect(newestResult(older, newer)).toBe(newer);
    expect(newestResult(newer, older)).toBe(newer);
    expect(newestResult(never, older)).toBe(older);
    expect(newestResult(older, never)).toBe(older);
    expect(newestResult(null, older)).toBe(older);
    expect(newestResult(never, undefined)).toBe(never);
  });
});
