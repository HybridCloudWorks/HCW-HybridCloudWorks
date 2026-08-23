/**
 * `usePublicData` with and without a pre-render seed.
 *
 * The seed exists so detail pages can be pre-rendered: effects do not run
 * during server rendering, so an unseeded page emits its skeleton and stops —
 * the empty shell pre-rendering exists to remove.
 *
 * The load-bearing property is the negative one. No provider is mounted in the
 * browser, so every assertion in the first block must keep passing forever;
 * if seeding ever changed the running application's behaviour, it would have
 * bought pre-rendered detail pages at the cost of the live site.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { usePublicData } from './usePublicData';
import { PrerenderDataContext } from './prerenderData';

const wrapWith = (seed) =>
  function Wrapper({ children }) {
    return <PrerenderDataContext.Provider value={seed}>{children}</PrerenderDataContext.Provider>;
  };

describe('no provider — the browser path, which must not change', () => {
  it('starts loading and resolves from the fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue({ title: 'Fetched' });
    const { result } = renderHook(() => usePublicData(fetcher, 'article:a'));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ title: 'Fetched' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('an empty key disables the fetch entirely', () => {
    const fetcher = vi.fn();
    const { result } = renderHook(() => usePublicData(fetcher, ''));

    expect(result.current.loading).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('surfaces a fetch failure instead of loading forever', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => usePublicData(fetcher, 'article:a'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe('with a seed — the pre-render path', () => {
  it('resolves synchronously on the first render, never loading', () => {
    // The whole point: a `loading` first render puts the skeleton into the
    // pre-rendered HTML, because there is no second render on a server.
    const fetcher = vi.fn();
    const { result } = renderHook(() => usePublicData(fetcher, 'article:a'), {
      wrapper: wrapWith({ 'article:a': { title: 'Seeded' } }),
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual({ title: 'Seeded' });
  });

  it('does not re-fetch what it was handed', async () => {
    const fetcher = vi.fn().mockResolvedValue({ title: 'Fetched' });
    renderHook(() => usePublicData(fetcher, 'article:a'), {
      wrapper: wrapWith({ 'article:a': { title: 'Seeded' } }),
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('falls back to fetching for a key the seed does not cover', async () => {
    // A manifest is a snapshot. A route it does not include must still work.
    const fetcher = vi.fn().mockResolvedValue({ title: 'Fetched' });
    const { result } = renderHook(() => usePublicData(fetcher, 'article:missing'), {
      wrapper: wrapWith({ 'article:a': { title: 'Seeded' } }),
    });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual({ title: 'Fetched' }));
  });

  it('treats a seeded null as "looked up, does not exist"', async () => {
    // Distinct from absent. A page should render its not-found state rather
    // than spin, and must not fetch to rediscover it.
    const fetcher = vi.fn().mockResolvedValue({ title: 'Fetched' });
    const { result } = renderHook(() => usePublicData(fetcher, 'article:gone'), {
      wrapper: wrapWith({ 'article:gone': null }),
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('an empty seed object behaves exactly like no provider', async () => {
    const fetcher = vi.fn().mockResolvedValue({ title: 'Fetched' });
    const { result } = renderHook(() => usePublicData(fetcher, 'article:a'), {
      wrapper: wrapWith({}),
    });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual({ title: 'Fetched' }));
  });
});
