/**
 * The two Phase 3 cloud-tools calls (#613): the price-changes read, which is a
 * cached GET like the pricing read, and the explanation POST, which is
 * neither cached nor deduplicated and has to tell a quota (429) from a
 * paused service (503) — so the thrown Error carries the status.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearPublicGetCache, fetchPriceChanges, requestPricingExplanation } from './publicApi.js';

vi.mock('@/lib/functionsBase', () => ({
  requireFunctionsBase: () => 'https://api.test',
}));

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  clearPublicGetCache();
  vi.restoreAllMocks();
});
afterEach(() => {
  clearPublicGetCache();
  vi.unstubAllGlobals();
});

describe('fetchPriceChanges', () => {
  const changes = (region) => ({
    success: true,
    changes: { region, asOf: null, windows: { '7d': { items: [] }, '30d': { items: [] } } },
  });

  it('asks for the region, defaulting to us-east-1, and unwraps the changes object', async () => {
    const fetchMock = vi.fn(async (url) =>
      jsonResponse(changes(new URL(String(url)).searchParams.get('region')))
    );
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchPriceChanges()).region).toBe('us-east-1');
    expect((await fetchPriceChanges('westeurope')).region).toBe('westeurope');
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://api.test/public/cloud-tools/price-changes?region=westeurope'
    );
    // A GET, through the shared cache: the same region again is not refetched.
    await fetchPriceChanges('westeurope');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws the server sentence on a 400 and refuses a body with no changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Unknown region: mars-1' }, 400))
    );
    await expect(fetchPriceChanges('mars-1')).rejects.toThrow('Unknown region: mars-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true }))
    );
    await expect(fetchPriceChanges('us-east-1')).rejects.toThrow(/no changes object/);
  });

  it('returns null when the route is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, 404))
    );
    expect(await fetchPriceChanges('us-east-1')).toBeNull();
  });
});

describe('requestPricingExplanation', () => {
  const body = { region: 'us-east-1', scenarioId: 'three-tier-web', results: [] };

  it('POSTs the body as JSON and returns the explanation', async () => {
    const explanation = {
      text: 'Two paragraphs.',
      model: 'claude-x',
      generatedAt: '2026-09-15T10:00:00.000Z',
      cached: false,
    };
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, explanation }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await requestPricingExplanation(body)).toEqual(explanation);
    const [[url, init]] = fetchMock.mock.calls;
    expect(String(url)).toBe('https://api.test/public/cloud-tools/explain');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(body);
    // Never deduplicated: a second press is a second request.
    await requestPricingExplanation(body);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws with the status and the server sentence on 429 and 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Rate limit: 5 an hour' }, 429))
    );
    await expect(requestPricingExplanation(body)).rejects.toMatchObject({
      status: 429,
      message: 'Rate limit: 5 an hour',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Explanations are paused.' }, 503))
    );
    await expect(requestPricingExplanation(body)).rejects.toMatchObject({
      status: 503,
      message: 'Explanations are paused.',
    });
  });

  it('falls back to an HTTP sentence when the body is not JSON, and refuses a body with no text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => JSON.parse('{') }))
    );
    await expect(requestPricingExplanation(body)).rejects.toMatchObject({
      status: 500,
      message: 'Explanation request failed with HTTP 500',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, explanation: {} }))
    );
    await expect(requestPricingExplanation(body)).rejects.toThrow(/no text/);
  });
});
