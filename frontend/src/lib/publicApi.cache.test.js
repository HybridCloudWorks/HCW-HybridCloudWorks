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
import { fetchPublicContentList, clearPublicGetCache, PUBLIC_CORPUS_LIMIT } from './publicApi.js';

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
