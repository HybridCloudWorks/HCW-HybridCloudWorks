import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GCP_SERVICE_NAMES,
  fetchGcpPrice,
  findGoogleSkuMatch,
  getGoogleTieredRatePrice,
  inRegion,
  resetGoogleCaches,
} from './gcp.js';

/**
 * The three `findGoogleSkuMatch` cases are ported from Site-Main
 * `functions/cloud-tools-pricing.test.js:47-175` with expected values
 * unchanged. Credential handling and page accumulation are new.
 */

afterEach(() => resetGoogleCaches());

const tiered = (...rates) => ({
  pricingInfo: [{ pricingExpression: { tieredRates: rates.map((unitPrice) => ({ unitPrice })) } }],
});

const skuOf = (description, unitPrice, extra = {}) => ({
  description,
  serviceRegions: ['us-central1'],
  category: { usageType: 'OnDemand' },
  ...tiered(unitPrice),
  ...extra,
});

// ---------------------------------------------------------------------------

describe('findGoogleSkuMatch — ported', () => {
  it('builds derived GCP compute pricing from CPU and RAM SKUs', () => {
    const match = findGoogleSkuMatch(
      'compute-vm',
      [
        skuOf('E2 Instance Core running in Iowa', { units: '0', nanos: 21000000 }),
        skuOf('E2 Instance Ram running in Iowa', { units: '0', nanos: 2800000 }),
      ],
      'us-central1'
    );

    expect(match).toEqual({
      sku: 'E2-derived 4 vCPU / 16 GiB',
      unit: 'hour',
      pricePerUnit: 0.1288,
    });
  });

  it('matches GCP Cloud SQL regional vCPU and RAM SKUs', () => {
    const match = findGoogleSkuMatch(
      'database-relational',
      [
        skuOf('Cloud SQL for PostgreSQL: Regional - vCPU in Americas', { nanos: 45000000 }),
        skuOf('Cloud SQL for PostgreSQL: Regional - RAM in Americas', { nanos: 6000000 }),
      ],
      'us-central1'
    );

    expect(match).toEqual({
      sku: 'Cloud SQL regional 2 vCPU / 8 GiB derived',
      unit: 'hour',
      pricePerUnit: 0.138,
    });
  });

  it('skips the $0 Firestore free tier', () => {
    const withFreeTier = (description) => ({
      description,
      serviceRegions: ['us-central1'],
      category: { usageType: 'OnDemand' },
      pricingInfo: [
        {
          pricingExpression: {
            usageUnit: 'count',
            tieredRates: [{ unitPrice: { nanos: 0 } }, { unitPrice: { nanos: 60 } }],
          },
        },
      ],
    });

    const match = findGoogleSkuMatch(
      'database-nosql',
      [withFreeTier('Cloud Firestore Read Ops'), withFreeTier('Cloud Firestore Entity Writes')],
      'us-central1'
    );

    expect(match.sku).toBe('1M transactional operations benchmark');
    expect(match.pricePerUnit).toBeGreaterThan(0);
  });
});

describe('findGoogleSkuMatch — region and completeness', () => {
  it('ignores SKUs from another region', () => {
    const match = findGoogleSkuMatch(
      'compute-vm',
      [
        { ...skuOf('E2 Instance Core running in Belgium', { nanos: 21000000 }), serviceRegions: ['europe-west1'] },
        skuOf('E2 Instance Ram running in Iowa', { nanos: 2800000 }),
      ],
      'us-central1'
    );
    expect(match).toBeNull();
  });

  it('accepts a global SKU', () => {
    expect(inRegion({ serviceRegions: ['global'] }, 'us-central1')).toBe(true);
    expect(inRegion({ serviceRegions: ['us-central1'] }, 'us-central1')).toBe(true);
    expect(inRegion({ serviceRegions: ['europe-west1'] }, 'us-central1')).toBe(false);
    expect(inRegion({}, 'us-central1')).toBe(false);
  });

  it('returns null when only half a derived pair is present', () => {
    const match = findGoogleSkuMatch(
      'compute-vm',
      [skuOf('E2 Instance Core running in Iowa', { nanos: 21000000 })],
      'us-central1'
    );
    expect(match).toBeNull();
  });

  it('returns null for an unknown service', () => {
    expect(findGoogleSkuMatch('not-a-service', [], 'us-central1')).toBeNull();
  });
});

describe('getGoogleTieredRatePrice', () => {
  it('takes the first rate by default and the first non-zero when asked', () => {
    const expression = { tieredRates: [{ unitPrice: { nanos: 0 } }, { unitPrice: { nanos: 60 } }] };
    expect(getGoogleTieredRatePrice(expression)).toBe(0);
    expect(getGoogleTieredRatePrice(expression, { firstNonZero: true })).toBe(0.00000006);
  });

  it('is total for missing or empty rates', () => {
    expect(getGoogleTieredRatePrice(undefined)).toBe(0);
    expect(getGoogleTieredRatePrice({ tieredRates: [] })).toBe(0);
  });
});

// ---------------------------------------------------------------------------

/** Stub the billing API: a services list, then SKU pages. */
function stubBilling(skuPages) {
  const fetch = vi.fn(async (url) => {
    const href = String(url);
    if (href.includes('/services?')) {
      return {
        ok: true,
        json: async () => ({ services: [{ name: 'services/6F81-5844-456A', displayName: 'Compute Engine' }] }),
      };
    }
    const token = new URL(href).searchParams.get('pageToken');
    const index = token ? Number(token) : 0;
    return {
      ok: true,
      json: async () => ({
        skus: skuPages[index] ?? [],
        nextPageToken: index < skuPages.length - 1 ? String(index + 1) : '',
      }),
    };
  });
  return { fetch, accessToken: 'stub-token' };
}

describe('credentials', () => {
  it('throws when the Key Vault secret is missing — never a silent baseline row', async () => {
    // getSecret swallows errors and returns null. For a credential that is
    // wrong: it would look like "GCP has no price for this service".
    const deps = { getSecret: async () => null, fetch: vi.fn() };
    await expect(fetchGcpPrice('compute-vm', 'us-central1', deps)).rejects.toThrow(
      /credential unavailable/
    );
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('throws when the secret is not valid JSON', async () => {
    const deps = { getSecret: async () => 'not json', fetch: vi.fn() };
    await expect(fetchGcpPrice('compute-vm', 'us-central1', deps)).rejects.toThrow(/malformed/);
  });
});

describe('SKU paging', () => {
  it('finds a pair split across two pages', async () => {
    // Why accumulation is required rather than matching per page: compute-vm
    // needs both the Core and the Ram SKU, and they can straddle a boundary.
    const deps = stubBilling([
      [skuOf('E2 Instance Core running in Iowa', { nanos: 21000000 })],
      [skuOf('E2 Instance Ram running in Iowa', { nanos: 2800000 })],
    ]);

    const result = await fetchGcpPrice('compute-vm', 'us-central1', deps);
    expect(result).toEqual({ sku: 'E2-derived 4 vCPU / 16 GiB', unit: 'hour', pricePerUnit: 0.1288 });
  });

  it('stops as soon as the match is complete', async () => {
    const deps = stubBilling([
      [
        skuOf('E2 Instance Core running in Iowa', { nanos: 21000000 }),
        skuOf('E2 Instance Ram running in Iowa', { nanos: 2800000 }),
      ],
      [skuOf('never reached', { nanos: 1 })],
    ]);

    await fetchGcpPrice('compute-vm', 'us-central1', deps);
    // one services call + one SKU page
    expect(deps.fetch).toHaveBeenCalledTimes(2);
  });

  it('discards out-of-region SKUs instead of accumulating them', async () => {
    // The source pushed every SKU from every page — up to 150,000 objects.
    // Every matcher branch requires inRegion, so they can be dropped on arrival.
    const foreign = Array.from({ length: 500 }, (_, i) => ({
      ...skuOf(`Irrelevant ${i}`, { nanos: 1 }),
      serviceRegions: ['asia-east1'],
    }));

    const deps = stubBilling([
      foreign,
      [
        skuOf('E2 Instance Core running in Iowa', { nanos: 21000000 }),
        skuOf('E2 Instance Ram running in Iowa', { nanos: 2800000 }),
      ],
    ]);

    const result = await fetchGcpPrice('compute-vm', 'us-central1', deps);
    expect(result.pricePerUnit).toBe(0.1288);
  });

  it('returns null when the pages are exhausted with no match', async () => {
    const deps = stubBilling([[skuOf('Something else', { nanos: 1 })]]);
    expect(await fetchGcpPrice('compute-vm', 'us-central1', deps)).toBeNull();
  });

  it('throws on a non-2xx SKU response', async () => {
    const deps = {
      accessToken: 'stub-token',
      fetch: vi.fn(async (url) =>
        String(url).includes('/services?')
          ? { ok: true, json: async () => ({ services: [{ name: 's/1', displayName: 'Compute Engine' }] }) }
          : { ok: false, status: 429 }
      ),
    };
    await expect(fetchGcpPrice('compute-vm', 'us-central1', deps)).rejects.toThrow(
      'Google SKUs returned 429'
    );
  });

  it('returns null when the billing catalog has no such service', async () => {
    const deps = {
      accessToken: 'stub-token',
      fetch: vi.fn(async () => ({ ok: true, json: async () => ({ services: [] }) })),
    };
    expect(await fetchGcpPrice('compute-vm', 'us-central1', deps)).toBeNull();
  });
});

describe('output shape', () => {
  it('returns a price triple, not the full row', async () => {
    const deps = stubBilling([
      [
        skuOf('E2 Instance Core running in Iowa', { nanos: 21000000 }),
        skuOf('E2 Instance Ram running in Iowa', { nanos: 2800000 }),
      ],
    ]);
    const result = await fetchGcpPrice('compute-vm', 'us-central1', deps);
    expect(Object.keys(result).sort()).toEqual(['pricePerUnit', 'sku', 'unit']);
  });

  it('maps the requested region into GCP naming', async () => {
    const deps = stubBilling([
      [
        skuOf('E2 Instance Core running in Iowa', { nanos: 21000000 }),
        skuOf('E2 Instance Ram running in Iowa', { nanos: 2800000 }),
      ],
    ]);
    // us-east-1 maps to us-central1; the fixtures are tagged us-central1.
    expect(await fetchGcpPrice('compute-vm', 'us-east-1', deps)).not.toBeNull();
  });

  it('names a billing service for all eight catalog services', () => {
    expect(Object.keys(GCP_SERVICE_NAMES)).toHaveLength(8);
  });

  it('returns null for a service it does not define', async () => {
    expect(await fetchGcpPrice('not-a-service', 'us-central1', {})).toBeNull();
  });
});
