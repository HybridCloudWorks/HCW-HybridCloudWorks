/**
 * The queue page's two reads (PR #841): the snapshot for the current
 * filters, and the best-effort forged-today meter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const postJSON = vi.fn();
vi.mock('@/lib/api', () => ({ postJSON: (...args) => postJSON(...args) }));

const { forgeMeterFromConfig, useForgeMeter, useQueueSnapshot } = await import('./useQueueData.js');

const FILTERS = {
  statusFilter: 'needs_review',
  contentTypeFilter: 'all',
  kindFilter: 'all',
  ideaOriginFilter: 'all',
  pageSize: 100,
};

beforeEach(() => {
  postJSON.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useQueueSnapshot', () => {
  it('waits for auth, then asks for the snapshot with every filter', async () => {
    postJSON.mockResolvedValue({ items: [{ id: 'a' }], totalCount: 7 });
    const { result, rerender } = renderHook(
      ({ authReady }) => useQueueSnapshot({ authReady, ...FILTERS }),
      { initialProps: { authReady: false } }
    );
    expect(postJSON).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    rerender({ authReady: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const { pageSize, ...filters } = FILTERS;
    expect(postJSON).toHaveBeenCalledWith('getQueueSnapshot', { ...filters, itemLimit: pageSize });
    expect(result.current.items).toEqual([{ id: 'a' }]);
    expect(result.current.totalCount).toBe(7);
    expect(result.current.loadError).toBeNull();
  });

  it('refetches when a filter changes and reports a failed read', async () => {
    postJSON.mockResolvedValueOnce({ items: [], totalCount: 0 });
    postJSON.mockRejectedValueOnce(new Error('offline'));
    const { result, rerender } = renderHook(
      ({ statusFilter }) => useQueueSnapshot({ authReady: true, ...FILTERS, statusFilter }),
      { initialProps: { statusFilter: 'needs_review' } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ statusFilter: 'rejected' });
    await waitFor(() => expect(result.current.loadError).toBe('offline'));
    expect(postJSON).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(false);
  });

  it('lets the page replace the items optimistically', async () => {
    postJSON.mockResolvedValue({ items: [{ id: 'a' }, { id: 'b' }], totalCount: 2 });
    const { result } = renderHook(() => useQueueSnapshot({ authReady: true, ...FILTERS }));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.setItems((prev) => prev.filter((it) => it.id !== 'a')));
    expect(result.current.items).toEqual([{ id: 'b' }]);
  });
});

describe('useForgeMeter', () => {
  it('reads the meter from getForgeConfig once auth is ready', async () => {
    postJSON.mockResolvedValue({
      ok: true,
      stats: {},
      prompts: { autoForge: { dailyLimit: '5', enabled: true } },
    });
    const { result } = renderHook(() => useForgeMeter(true));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(postJSON).toHaveBeenCalledWith('getForgeConfig', {});
    expect(result.current).toMatchObject({ limit: 5, enabled: true });
  });

  it('stays null without auth, on a refused config, and on a failed read', async () => {
    const { result: unauth } = renderHook(() => useForgeMeter(false));
    expect(postJSON).not.toHaveBeenCalled();
    expect(unauth.current).toBeNull();

    postJSON.mockResolvedValueOnce({ ok: false });
    const { result: refused } = renderHook(() => useForgeMeter(true));
    await waitFor(() => expect(postJSON).toHaveBeenCalledTimes(1));
    expect(refused.current).toBeNull();

    postJSON.mockRejectedValueOnce(new Error('down'));
    const { result: failed } = renderHook(() => useForgeMeter(true));
    await waitFor(() => expect(postJSON).toHaveBeenCalledTimes(2));
    expect(failed.current).toBeNull();
  });
});

describe('forgeMeterFromConfig', () => {
  it('defaults a missing limit to 0 and a missing flag to off', () => {
    expect(forgeMeterFromConfig({ stats: {}, prompts: {} })).toMatchObject({
      limit: 0,
      enabled: false,
    });
  });
});
