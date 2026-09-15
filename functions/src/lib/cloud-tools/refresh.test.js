import { describe, expect, it, vi } from 'vitest';

import {
  CACHE_CONTAINER,
  REFRESH_JOB_TYPE,
  createPricingRefresh,
  parseRefreshPayload,
} from './refresh.js';
import { BASELINE_COSTS, KNOWN_UNIT_MISMATCHES, PROVIDERS } from './pricing/baseline.js';
import { REGION_OPTIONS, SERVICE_LABELS } from './pricing/regions.js';
import { DEFAULT_CACHE_TTL_MINUTES } from './freshness.js';

const NOW = new Date('2026-09-15T02:00:00.000Z');
const SERVICE_IDS = Object.keys(BASELINE_COSTS);

const memStore = () => {
  const docs = new Map();
  return {
    docs,
    upsertDoc: vi.fn(async (container, doc) => {
      docs.set(`${container}/${doc.id}`, doc);
      return doc;
    }),
  };
};

const row = (provider, serviceId, region, model = 'retail') => ({
  provider,
  serviceId,
  region,
  providerRegion: region,
  sku: `${provider}-sku`,
  model,
  pricePerUnit: 1,
  unit: 'hour',
  currency: 'USD',
  updatedAt: NOW.toISOString(),
  source: model === 'retail' ? `${provider}-api` : 'baseline-fallback',
});

/** A fetch that answers every provider live, and records its calls in order. */
const allLive = () =>
  vi.fn(async (serviceId, region) => PROVIDERS.map((p) => row(p, serviceId, region)));

const quiet = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('parseRefreshPayload', () => {
  it('defaults to every region option', () => {
    const all = REGION_OPTIONS.map((r) => r.id);
    expect(parseRefreshPayload(undefined).regions).toEqual(all);
    expect(parseRefreshPayload({}).regions).toEqual(all);
    expect(parseRefreshPayload({ regions: [] }).regions).toEqual(all);
    expect(parseRefreshPayload({ regions: null }).regions).toEqual(all);
  });

  it('accepts a subset and dedupes it', () => {
    expect(parseRefreshPayload({ regions: ['westeurope', 'westeurope'] }).regions).toEqual([
      'westeurope',
    ]);
  });

  it('refuses an unknown region rather than refreshing nothing', () => {
    expect(() => parseRefreshPayload({ regions: ['eastus'] })).toThrow(/unknown region.*eastus/);
    expect(() => parseRefreshPayload({ regions: 'us-east-1' })).toThrow(/must be an array/);
  });
});

describe('createPricingRefresh', () => {
  it('writes one document per region, the whole catalog in each, in the contract shape', async () => {
    const store = memStore();
    const fetchLivePricing = allLive();
    const refresh = createPricingRefresh({ store, fetchLivePricing, now: () => NOW, log: quiet });

    const summary = await refresh.run();

    expect(store.upsertDoc).toHaveBeenCalledTimes(REGION_OPTIONS.length);
    for (const option of REGION_OPTIONS) {
      const doc = store.docs.get(`${CACHE_CONTAINER}/pricing:${option.id}`);
      expect(doc).toMatchObject({
        id: `pricing:${option.id}`,
        region: option.id,
        refreshedAt: NOW.toISOString(),
        ttlMinutes: DEFAULT_CACHE_TTL_MINUTES,
        counts: { live: 24, baseline: 0, unavailable: 0 },
      });
      expect(doc.services.map((s) => s.serviceId)).toEqual(SERVICE_IDS);
      for (const service of doc.services) {
        expect(service.label).toBe(SERVICE_LABELS[service.serviceId]);
        expect(service.rows.map((r) => r.provider)).toEqual([...PROVIDERS]);
        expect(service.unit).toBe('hour');
        expect(Object.keys(service).sort()).toEqual(['label', 'rows', 'serviceId', 'sku', 'unit']);
      }
    }
    expect(summary.regions.map((r) => r.region)).toEqual(REGION_OPTIONS.map((r) => r.id));
    expect(summary.failed).toEqual([]);
    expect(summary.durationMs).toBe(0);
  });

  it('fetches services one at a time, never in parallel', async () => {
    // AWS and Azure rate-limit; 72 concurrent calls is how a refresh gets
    // throttled into a partial document.
    let inFlight = 0;
    let peak = 0;
    const fetchLivePricing = vi.fn(async (serviceId, region) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return PROVIDERS.map((p) => row(p, serviceId, region));
    });
    await createPricingRefresh({ store: memStore(), fetchLivePricing, log: quiet }).run();
    expect(fetchLivePricing).toHaveBeenCalledTimes(REGION_OPTIONS.length * SERVICE_IDS.length);
    expect(peak).toBe(1);
  });

  it('passes no baseline for the two unit-mismatched services, and the catalog entry for the rest', async () => {
    const fetchLivePricing = allLive();
    await createPricingRefresh({ store: memStore(), fetchLivePricing, log: quiet }).run({
      regions: ['us-east-1'],
    });
    for (const [serviceId, , baseline] of fetchLivePricing.mock.calls) {
      if (KNOWN_UNIT_MISMATCHES.has(serviceId)) expect(baseline, serviceId).toBeNull();
      else expect(baseline, serviceId).toBe(BASELINE_COSTS[serviceId]);
    }
  });

  it('counts live, baseline and unavailable cells from the rows it gets back', async () => {
    const fetchLivePricing = vi.fn(async (serviceId, region) => {
      if (serviceId === 'compute-serverless') return [row('aws', serviceId, region)]; // two absent
      if (serviceId === 'compute-vm') {
        return [
          row('aws', serviceId, region),
          row('azure', serviceId, region, 'baseline-fallback'),
          row('gcp', serviceId, region, 'baseline-fallback'),
        ];
      }
      return PROVIDERS.map((p) => row(p, serviceId, region));
    });
    const store = memStore();
    const { regions } = await createPricingRefresh({ store, fetchLivePricing, log: quiet }).run({
      regions: ['us-west-2'],
    });
    expect(regions[0].counts).toEqual({ live: 20, baseline: 2, unavailable: 2 });
    const doc = store.docs.get(`${CACHE_CONTAINER}/pricing:us-west-2`);
    expect(doc.counts).toEqual(regions[0].counts);
    // The absent providers are absent, not padded with placeholder rows.
    const partial = doc.services.find((s) => s.serviceId === 'compute-serverless');
    expect(partial.rows.map((r) => r.provider)).toEqual(['aws']);
  });

  it('names the catalog unit and sku when a service has no rows at all', async () => {
    const fetchLivePricing = vi.fn(async (serviceId, region) =>
      serviceId === 'database-nosql' ? [] : PROVIDERS.map((p) => row(p, serviceId, region))
    );
    const store = memStore();
    await createPricingRefresh({ store, fetchLivePricing, log: quiet }).run({
      regions: ['westeurope'],
    });
    const doc = store.docs.get(`${CACHE_CONTAINER}/pricing:westeurope`);
    const nosql = doc.services.find((s) => s.serviceId === 'database-nosql');
    expect(nosql.rows).toEqual([]);
    expect(nosql.unit).toBe(BASELINE_COSTS['database-nosql'].unit);
    expect(nosql.sku).toBe(BASELINE_COSTS['database-nosql'].sku);
    expect(doc.counts.unavailable).toBe(3);
  });

  it('one region failing does not stop the others', async () => {
    const store = memStore();
    store.upsertDoc.mockImplementation(async (container, doc) => {
      if (doc.region === 'us-west-2') throw new Error('cosmos 503');
      store.docs.set(`${container}/${doc.id}`, doc);
      return doc;
    });
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const summary = await createPricingRefresh({
      store,
      fetchLivePricing: allLive(),
      log,
    }).run();

    expect(summary.regions.map((r) => r.region)).toEqual(['us-east-1', 'westeurope']);
    expect(summary.failed).toEqual([{ region: 'us-west-2', error: 'cosmos 503' }]);
    expect(store.docs.has(`${CACHE_CONTAINER}/pricing:westeurope`)).toBe(true);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('us-west-2 FAILED'));
  });

  it('clears the memoised provider state once per run, before fetching', async () => {
    const order = [];
    const clearCaches = vi.fn(() => order.push('clear'));
    const fetchLivePricing = vi.fn(async (serviceId, region) => {
      order.push('fetch');
      return PROVIDERS.map((p) => row(p, serviceId, region));
    });
    await createPricingRefresh({
      store: memStore(),
      fetchLivePricing,
      clearCaches,
      log: quiet,
    }).run({ regions: ['us-east-1'] });
    expect(clearCaches).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe('clear');
  });

  it('refuses an unknown region before touching anything', async () => {
    const store = memStore();
    const fetchLivePricing = allLive();
    await expect(
      createPricingRefresh({ store, fetchLivePricing, log: quiet }).run({ regions: ['eastus'] })
    ).rejects.toThrow(/unknown region/);
    expect(fetchLivePricing).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('names the job type the worker registers', () => {
    expect(REFRESH_JOB_TYPE).toBe('refresh-tool-pricing');
    expect(CACHE_CONTAINER).toBe('tool_service_cache');
  });
});
