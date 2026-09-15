/**
 * Request-layer dedupe for the anonymous public API (T-716).
 *
 * Three hooks each downloaded the whole published corpus under their own
 * `usePublicData` key, and that hook holds state per instance — so identical
 * requests were never shared and one navigation could fetch the corpus three
 * times. These assert the two halves that matter: concurrent callers share one
 * in-flight request, and a repeat caller inside the TTL does not re-request.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchPublicContentList,
  fetchPublicSnapshot,
  clearPublicGetCache,
  PUBLIC_CORPUS_LIMIT,
} from './publicApi.js';

vi.mock('@/lib/functionsBase', () => ({
  requireFunctionsBase: () => 'https://api.test',
}));

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

describe('publicGet request dedupe', () => {
  beforeEach(() => {
    clearPublicGetCache();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    clearPublicGetCache();
    // stubGlobal('fetch') is not undone by restoreAllMocks; without this the
    // stub outlives the suite and later tests see a mock where fetch should be.
    vi.unstubAllGlobals();
  });

  it('shares one in-flight request between concurrent callers', async () => {
    let resolveFetch;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = () => resolve(okJson({ items: [{ id: 'a' }] }));
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    // Two components mounting in the same tick — the concurrent half of the bug.
    const a = fetchPublicContentList({ limit: PUBLIC_CORPUS_LIMIT });
    const b = fetchPublicContentList({ limit: PUBLIC_CORPUS_LIMIT });
    resolveFetch();
    const [ra, rb] = await Promise.all([a, b]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ra).toEqual([{ id: 'a' }]);
    expect(rb).toEqual([{ id: 'a' }]);
  });

  it('serves a repeat caller from cache within the TTL', async () => {
    const fetchMock = vi.fn(async () => okJson({ items: [{ id: 'x' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchPublicContentList({ limit: PUBLIC_CORPUS_LIMIT });
    await fetchPublicContentList({ limit: PUBLIC_CORPUS_LIMIT });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keys on the full query, so a different request is not served stale data', async () => {
    const fetchMock = vi.fn(async (url) =>
      okJson({ items: [{ id: String(url).includes('blogs') ? 'legacy' : 'content' }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const a = await fetchPublicContentList({ limit: PUBLIC_CORPUS_LIMIT });
    const b = await fetchPublicContentList({ limit: PUBLIC_CORPUS_LIMIT, source: 'blogs' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(a).toEqual([{ id: 'content' }]);
    expect(b).toEqual([{ id: 'legacy' }]);
  });

  it('keeps fresh snapshot reads out of the cache, in both directions', async () => {
    const snapshot = (n) => ({ snapshot: { generatedAt: `t${n}`, items: [] } });
    let n = 0;
    const fetchMock = vi.fn(async () => okJson(snapshot(++n)));
    vi.stubGlobal('fetch', fetchMock);

    // A cached plain read does not answer a fresh one.
    expect((await fetchPublicSnapshot('certifications')).generatedAt).toBe('t1');
    expect((await fetchPublicSnapshot('certifications', { fresh: true })).generatedAt).toBe('t2');
    expect((await fetchPublicSnapshot('certifications', { fresh: true })).generatedAt).toBe('t3');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\?fresh=\d+$/);

    // Fresh reads wrote nothing: once the plain entry is cleared, a plain read
    // goes to the network rather than finding a fresh read's copy.
    clearPublicGetCache();
    const cacheProbe = vi.fn(async () => okJson(snapshot(99)));
    vi.stubGlobal('fetch', cacheProbe);
    await fetchPublicSnapshot('certifications', { fresh: true });
    await fetchPublicSnapshot('certifications');
    expect(cacheProbe).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure — the next caller can retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(okJson({ items: [{ id: 'recovered' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPublicContentList({ limit: PUBLIC_CORPUS_LIMIT })).rejects.toThrow(
      /network down/
    );
    // A cached rejection would make one blip permanent for the TTL.
    await expect(fetchPublicContentList({ limit: PUBLIC_CORPUS_LIMIT })).resolves.toEqual([
      { id: 'recovered' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
