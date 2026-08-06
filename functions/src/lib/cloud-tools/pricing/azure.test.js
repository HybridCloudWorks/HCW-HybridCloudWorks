import { describe, expect, it, vi } from 'vitest';

import { AZURE_SERVICE_FILTERS, fetchAzurePrice, findAcrossPages } from './azure.js';

/**
 * The "2-vCore not 32-vCore" case is ported from Site-Main
 * `functions/cloud-tools-pricing.test.js:111-136` unchanged.
 *
 * Everything about pagination is new. The source never followed NextPageLink,
 * so the page-2 test below fails against it — which is the point of writing it.
 */

/** A stubbed Retail Prices endpoint that serves the given pages in order. */
function stubPages(pages, { nextLinkFor } = {}) {
  const urls = [];
  const fetch = vi.fn(async (url) => {
    urls.push(String(url));
    const index = urls.length - 1;
    const page = pages[index];
    if (!page) return { ok: true, json: async () => ({ Items: [] }) };
    return {
      ok: true,
      json: async () => ({
        Items: page,
        NextPageLink:
          nextLinkFor?.(index) ?? (index < pages.length - 1 ? `https://next/${index + 1}` : null),
      }),
    };
  });
  return { fetch, urls };
}

const blobHot = {
  productName: 'Blob Storage',
  skuName: 'Hot LRS',
  meterName: 'Hot Data Stored',
  unitPrice: 0.0184,
  unitOfMeasure: '1 GB/Month',
  currencyCode: 'USD',
};

describe('pagination', () => {
  it('finds a match on page 1 without fetching page 2', async () => {
    const { fetch, urls } = stubPages([[blobHot], [{ productName: 'never reached' }]]);
    const result = await fetchAzurePrice('storage-object', 'eastus', { fetch });

    expect(result.pricePerUnit).toBe(0.0184);
    expect(urls).toHaveLength(1);
  });

  it('follows NextPageLink and finds a match on page 2', async () => {
    // THE BUG. The source read json.Items from page 1 only, so this returned
    // null and the column silently fell back to baseline. The storage-object
    // filter really does return Count: 1000 with a NextPageLink in production.
    const { fetch, urls } = stubPages([
      [{ productName: 'Files', skuName: 'x', meterName: 'y' }],
      [blobHot],
    ]);

    const result = await fetchAzurePrice('storage-object', 'eastus', { fetch });

    expect(result).toMatchObject({ pricePerUnit: 0.0184, unit: 'GB-month' });
    expect(urls).toHaveLength(2);
    expect(urls[1]).toBe('https://next/1');
  });

  it('sends api-version and the OData filter on the first request', async () => {
    const { fetch, urls } = stubPages([[blobHot]]);
    await fetchAzurePrice('storage-object', 'eastus', { fetch });

    const url = new URL(urls[0]);
    expect(url.searchParams.get('api-version')).toBe('2023-01-01-preview');
    expect(url.searchParams.get('$filter')).toBe(
      "serviceName eq 'Storage' and armRegionName eq 'eastus' and priceType eq 'Consumption'"
    );
  });

  it('stops at the page cap and throws rather than looping forever', async () => {
    // An unbounded follow would reintroduce the unbounded-remote-read failure
    // this whole change exists to remove.
    const pages = Array.from({ length: 30 }, () => [{ productName: 'no match' }]);
    const { fetch } = stubPages(pages, { nextLinkFor: (i) => `https://next/${i + 1}` });

    await expect(fetchAzurePrice('storage-object', 'eastus', { fetch })).rejects.toThrow(
      /within 10 pages — filter too broad/
    );
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it('returns null — not a throw — when the pages are genuinely exhausted', async () => {
    // No match and no more pages is "no match", which is not an error.
    const { fetch } = stubPages([[{ productName: 'no match' }]]);
    expect(await fetchAzurePrice('storage-object', 'eastus', { fetch })).toBeNull();
  });

  it('throws on a non-2xx, preserving the source error message', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 503 }));
    await expect(fetchAzurePrice('storage-object', 'eastus', { fetch })).rejects.toThrow(
      'Azure retail prices returned 503'
    );
  });

  it('tolerates a page with no Items array', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    expect(await findAcrossPages('f', () => null, { fetch })).toMatchObject({ item: null });
  });
});

describe('region mapping', () => {
  it('maps the requested region into Azure naming before filtering', async () => {
    const { fetch, urls } = stubPages([[blobHot]]);
    await fetchAzurePrice('storage-object', 'us-east-1', { fetch });
    // The filter is percent-encoded in the query string, so decode before
    // asserting: us-east-1 must have become Azure's eastus.
    expect(new URL(urls[0]).searchParams.get('$filter')).toContain("armRegionName eq 'eastus'");
  });
});

describe('selectors', () => {
  it('picks SQL GP Gen5 2-vCore, not the 32-vCore row (ported)', () => {
    const selected = AZURE_SERVICE_FILTERS['database-relational'].selectItem([
      {
        productName: 'SQL Database Single General Purpose - Compute Gen5',
        armSkuName: 'SQLDB_GP_Compute_Gen5_32',
        meterName: 'vCore',
        unitPrice: 4.7232,
      },
      {
        productName: 'SQL Database Single General Purpose - Compute Gen5',
        armSkuName: 'SQLDB_GP_Compute_Gen5_2',
        meterName: 'vCore',
        unitPrice: 0.2952,
      },
    ]);

    expect(selected.armSkuName).toBe('SQLDB_GP_Compute_Gen5_2');
    expect(selected.unitPrice).toBe(0.2952);
  });

  it('composes the serverless benchmark from two meters', async () => {
    const { fetch } = stubPages([
      [
        { meterName: 'On Demand Total Executions', productName: 'Functions', unitPrice: 0.000002 },
        { meterName: 'On Demand Execution Time', productName: 'Functions', unitPrice: 0.000016 },
      ],
    ]);

    const result = await fetchAzurePrice('compute-serverless', 'eastus', { fetch });
    expect(result).toMatchObject({
      sku: '1M requests + 400k GB-s benchmark',
      unit: 'normalized request workload',
      // 0.000002 * 100_000 + 0.000016 * 400_000. Note 100_000, not 1_000_000 —
      // Azure meters executions per 10, and that asymmetry with the AWS path is
      // carried over from the source deliberately.
      pricePerUnit: Number((0.000002 * 100000 + 0.000016 * 400000).toFixed(6)),
    });
  });

  it('returns null when only one half of the serverless pair is present', async () => {
    const { fetch } = stubPages([
      [{ meterName: 'On Demand Total Executions', productName: 'Functions', unitPrice: 0.000002 }],
    ]);
    expect(await fetchAzurePrice('compute-serverless', 'eastus', { fetch })).toBeNull();
  });

  it('excludes Spot and Windows VM rows', () => {
    const selected = AZURE_SERVICE_FILTERS['compute-vm'].selectItem([
      { skuName: 'Standard_D4as_v5 Spot', productName: 'Virtual Machines' },
      { skuName: 'Standard_D4as_v5', productName: 'Virtual Machines Das v5 Series Windows' },
      { skuName: 'Standard_D4as_v5', productName: 'Virtual Machines Das v5 Series' },
    ]);
    expect(selected.productName).toBe('Virtual Machines Das v5 Series');
  });

  it('skips $0 Cosmos and Service Bus rows', () => {
    expect(
      AZURE_SERVICE_FILTERS['database-nosql'].selectItem([
        { skuName: 'serverless', meterName: '1M RUs', unitPrice: 0 },
        { skuName: 'standard', meterName: '1M RUs', unitPrice: 0.25 },
      ]).unitPrice
    ).toBe(0.25);

    expect(
      AZURE_SERVICE_FILTERS['integration-messaging'].selectItem([
        { meterName: 'Standard Messaging Operations', unitPrice: 0 },
        { meterName: 'Basic Messaging Operations', unitPrice: 0.05 },
      ]).unitPrice
    ).toBe(0.05);
  });
});

describe('output shape', () => {
  it('returns a price triple plus currency, not the full row', async () => {
    // index.js composes provider/serviceId/region/model/source/updatedAt once.
    const { fetch } = stubPages([[blobHot]]);
    const result = await fetchAzurePrice('storage-object', 'eastus', { fetch });
    expect(Object.keys(result).sort()).toEqual(['currency', 'pricePerUnit', 'sku', 'unit']);
  });

  it('carries a non-USD currency through', async () => {
    const { fetch } = stubPages([[{ ...blobHot, currencyCode: 'EUR' }]]);
    expect((await fetchAzurePrice('storage-object', 'eastus', { fetch })).currency).toBe('EUR');
  });

  it('rounds to six decimal places', async () => {
    const { fetch } = stubPages([[{ ...blobHot, unitPrice: 0.01841234567 }]]);
    expect((await fetchAzurePrice('storage-object', 'eastus', { fetch })).pricePerUnit).toBe(0.018412);
  });

  it('returns null for a service it does not define', async () => {
    expect(await fetchAzurePrice('not-a-service', 'eastus', {})).toBeNull();
  });

  it('defines a filter for all eight catalog services', () => {
    expect(Object.keys(AZURE_SERVICE_FILTERS)).toHaveLength(8);
    for (const [id, config] of Object.entries(AZURE_SERVICE_FILTERS)) {
      expect(typeof config.filter, id).toBe('function');
      expect(typeof config.selectItem, id).toBe('function');
      // Every service sets `unit` explicitly — which is what makes the
      // normalizeUnit fallback unreachable, and the '1 Hour' fix a no-op.
      expect(config.unit, id).toBeTruthy();
    }
  });
});
