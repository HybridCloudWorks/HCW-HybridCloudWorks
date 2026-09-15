import { describe, expect, it, vi } from 'vitest';

import { createPublicPricingHandlers } from './public-pricing.js';
import { DEFAULT_CACHE_TTL_MINUTES } from './freshness.js';

const NOW = Date.parse('2026-09-15T12:00:00Z');
const MINUTE = 60_000;

const context = { log: vi.fn(), error: vi.fn() };
const request = (query = {}) => ({ method: 'GET', query: { get: (k) => query[k] ?? null } });
const body = (res) => JSON.parse(res.body);

const doc = (over = {}) => ({
  id: 'pricing:us-east-1',
  region: 'us-east-1',
  refreshedAt: new Date(NOW - 30 * MINUTE).toISOString(),
  ttlMinutes: 1440,
  services: [
    { serviceId: 'compute-vm', label: 'Virtual machines', unit: 'hour', sku: 'x', rows: [] },
  ],
  counts: { live: 21, baseline: 1, unavailable: 2 },
  _rid: 'r',
  _etag: '"e"',
  ...over,
});

const handlers = (stored, now = () => NOW) =>
  createPublicPricingHandlers({
    store: { readDoc: vi.fn(async (_c, id) => (stored && stored.id === id ? stored : null)) },
    now,
  });

describe('GET /api/public/cloud-tools/pricing', () => {
  it('defaults to us-east-1 and reads the region document by its id as partition key', async () => {
    const h = createPublicPricingHandlers({
      store: { readDoc: vi.fn(async () => doc()) },
      now: () => NOW,
    });
    const res = await h.getPricing(request(), context);
    expect(res.status).toBe(200);
    expect(body(res).pricing.region).toBe('us-east-1');
  });

  it('answers 400 for a region that is not an option', async () => {
    const h = handlers(doc());
    for (const bad of ['eastus', 'US-EAST-1', 'mars']) {
      const res = await h.getPricing(request({ region: bad }), context);
      expect(res.status, bad).toBe(400);
      expect(body(res)).toEqual({ error: 'Unknown region' });
    }
  });

  it('serves a fresh document with its freshness and a 15-minute cache', async () => {
    const stored = doc();
    const store = { readDoc: vi.fn(async () => stored) };
    const h = createPublicPricingHandlers({ store, now: () => NOW });
    const res = await h.getPricing(request({ region: 'us-east-1' }), context);

    expect(store.readDoc).toHaveBeenCalledWith(
      'tool_service_cache',
      'pricing:us-east-1',
      'pricing:us-east-1'
    );
    expect(res.headers['Cache-Control']).toBe('public, max-age=900');
    const { success, pricing } = body(res);
    expect(success).toBe(true);
    expect(pricing).toEqual({
      region: 'us-east-1',
      regions: [
        { id: 'us-east-1', label: 'US East' },
        { id: 'us-west-2', label: 'US West' },
        { id: 'westeurope', label: 'Western Europe' },
      ],
      refreshedAt: stored.refreshedAt,
      ttlMinutes: 1440,
      ageMinutes: 30,
      stale: false,
      counts: { live: 21, baseline: 1, unavailable: 2 },
      services: stored.services,
    });
    // Cosmos system fields never reach the wire.
    expect(res.body).not.toContain('_rid');
    expect(res.body).not.toContain('_etag');
  });

  it('reports a document past its TTL as stale, and still serves it', async () => {
    // Reported, not refreshed: see the header, and freshness.js.
    const stored = doc({ refreshedAt: new Date(NOW - 3000 * MINUTE).toISOString() });
    const res = await handlers(stored).getPricing(request({ region: 'us-east-1' }), context);
    expect(res.status).toBe(200);
    const { pricing } = body(res);
    expect(pricing.stale).toBe(true);
    expect(pricing.ageMinutes).toBe(3000);
    expect(pricing.services).toHaveLength(1);
  });

  it('answers "not refreshed yet" as a 200 with every cell unavailable when no document exists', async () => {
    const res = await handlers(null).getPricing(request({ region: 'westeurope' }), context);
    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toBe('public, max-age=60');
    expect(body(res)).toEqual({
      success: true,
      pricing: {
        region: 'westeurope',
        regions: [
          { id: 'us-east-1', label: 'US East' },
          { id: 'us-west-2', label: 'US West' },
          { id: 'westeurope', label: 'Western Europe' },
        ],
        refreshedAt: null,
        ttlMinutes: DEFAULT_CACHE_TTL_MINUTES,
        ageMinutes: null,
        stale: true,
        counts: { live: 0, baseline: 0, unavailable: 24 },
        services: [],
      },
    });
  });

  it('never calls a provider — the read is one point read and nothing else', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const store = { readDoc: vi.fn(async () => null) };
      await createPublicPricingHandlers({ store }).getPricing(request(), context);
      expect(store.readDoc).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('answers 500 without leaking the error when the read throws', async () => {
    const store = {
      readDoc: vi.fn(async () => {
        throw new Error('cosmos said no: /dbs/x/colls/tool_service_cache');
      }),
    };
    const res = await createPublicPricingHandlers({ store }).getPricing(request(), context);
    expect(res.status).toBe(500);
    expect(body(res)).toEqual({ error: 'Failed to get pricing' });
    expect(context.error).toHaveBeenCalled();
  });
});
