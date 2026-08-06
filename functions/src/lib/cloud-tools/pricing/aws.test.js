import { describe, expect, it, vi } from 'vitest';

import {
  AWS_SERVICE_LOOKUPS,
  fetchAwsPrice,
  firstOnDemandDimension,
  getAwsPrice,
} from './aws.js';

/**
 * Behaviour pins for the AWS pricing path.
 *
 * The four composite assertions are carried over from Site-Main
 * `functions/cloud-tools-pricing.test.js:209-357` with the EXPECTED VALUES
 * UNCHANGED — including the float artefacts 6.866680000000001 and
 * 0.39999999999999997, which pin the order of the arithmetic. Only the
 * fixtures are reshaped, from bulk offer documents to GetProducts PriceList
 * entries, because that is precisely the thing being swapped.
 *
 * The remaining four services had no coverage upstream at all.
 */

/**
 * Build a PriceList entry.
 *
 * Note the terms nesting: a query entry is `terms.OnDemand["SKU.TERMCODE"]`,
 * one level shallower than a bulk document's
 * `terms.OnDemand[SKU][SKU.TERMCODE]`. Getting this wrong is the single
 * likeliest porting error, so the fixtures spell it out.
 */
function priceListEntry(sku, attributes, dimensions) {
  return JSON.stringify({
    product: { sku, attributes },
    serviceCode: 'Test',
    terms: {
      OnDemand: {
        [`${sku}.JRTCKXETXF`]: {
          sku,
          offerTermCode: 'JRTCKXETXF',
          priceDimensions: dimensions,
        },
      },
    },
  });
}

const dim = (id, unit, usd) => ({ [id]: { unit, pricePerUnit: { USD: usd } } });

/** A PricingClient stand-in that replays queued responses and records inputs. */
function stubClient(responses) {
  const calls = [];
  const queue = [...responses];
  return {
    calls,
    send: vi.fn(async (command) => {
      calls.push(command.input);
      return queue.shift() ?? { PriceList: [] };
    }),
  };
}

// ---------------------------------------------------------------------------

describe('firstOnDemandDimension', () => {
  it('reads the query-shape terms nesting, not the bulk one', () => {
    const entry = priceListEntry('VM1', { instanceType: 'm6i.xlarge' }, dim('d', 'Hrs', '0.1920000000'));
    expect(firstOnDemandDimension(entry)).toMatchObject({ usd: 0.192, unit: 'hour', sku: 'VM1' });
  });

  it('accepts an already-parsed object as well as a JSON string', () => {
    // The SDK has returned PriceList as both across versions.
    const entry = priceListEntry('VM1', {}, dim('d', 'Hrs', '1.5'));
    expect(firstOnDemandDimension(JSON.parse(entry)).usd).toBe(1.5);
  });

  it('normalises the unit', () => {
    const entry = priceListEntry('S1', {}, dim('d', 'GB-Mo', '0.023'));
    expect(firstOnDemandDimension(entry).unit).toBe('GB-month');
  });

  it('takes the first dimension by default', () => {
    const entry = priceListEntry('Q1', {}, {
      ...dim('free', 'Requests', '0.0000000000'),
      ...dim('paid', 'Requests', '0.0000004000'),
    });
    expect(firstOnDemandDimension(entry).usd).toBe(0);
  });

  it('skips $0 dimensions under firstNonZero — the SQS free tier', () => {
    const entry = priceListEntry('Q1', {}, {
      ...dim('free', 'Requests', '0.0000000000'),
      ...dim('paid', 'Requests', '0.0000004000'),
    });
    expect(firstOnDemandDimension(entry, { firstNonZero: true }).usd).toBe(0.0000004);
  });

  it('falls back to the first dimension when every dimension is $0', () => {
    const entry = priceListEntry('Q1', {}, dim('free', 'Requests', '0'));
    expect(firstOnDemandDimension(entry, { firstNonZero: true }).usd).toBe(0);
  });

  it('exposes attributes so a caller can refine locally', () => {
    const entry = priceListEntry('E1', { usagetype: 'X-AmazonEKS-Hours:perCluster' }, dim('d', 'Hrs', '0.1'));
    expect(firstOnDemandDimension(entry).attributes.usagetype).toBe('X-AmazonEKS-Hours:perCluster');
  });

  it('returns null rather than throwing on unusable input', () => {
    expect(firstOnDemandDimension(null)).toBeNull();
    expect(firstOnDemandDimension(JSON.stringify({ product: {} }))).toBeNull();
    expect(firstOnDemandDimension(JSON.stringify({ terms: { OnDemand: {} } }))).toBeNull();
    const noDims = JSON.stringify({ terms: { OnDemand: { 'A.B': { priceDimensions: {} } } } });
    expect(firstOnDemandDimension(noDims)).toBeNull();
  });
});

describe('getAwsPrice request construction', () => {
  it('sends ServiceCode plus TERM_MATCH filters, MaxResults 1 by default', async () => {
    const client = stubClient([{ PriceList: [priceListEntry('A', {}, dim('d', 'Hrs', '1'))] }]);
    await getAwsPrice(client, 'AmazonEC2', { regionCode: 'us-east-1', instanceType: 'm6i.xlarge' });

    expect(client.calls[0]).toEqual({
      ServiceCode: 'AmazonEC2',
      FormatVersion: 'aws_v1',
      MaxResults: 1,
      Filters: [
        { Type: 'TERM_MATCH', Field: 'regionCode', Value: 'us-east-1' },
        { Type: 'TERM_MATCH', Field: 'instanceType', Value: 'm6i.xlarge' },
      ],
    });
  });

  it('omits undefined filter values rather than sending "undefined"', async () => {
    // edge-cdn passes no region; a stringified undefined would match nothing.
    const client = stubClient([{ PriceList: [priceListEntry('A', {}, dim('d', 'Hrs', '1'))] }]);
    await getAwsPrice(client, 'AmazonCloudFront', { regionCode: undefined, transferType: 'X' });
    expect(client.calls[0].Filters).toEqual([{ Type: 'TERM_MATCH', Field: 'transferType', Value: 'X' }]);
  });

  it('returns null on an empty PriceList — no match is not an error', async () => {
    const client = stubClient([{ PriceList: [] }]);
    expect(await getAwsPrice(client, 'AmazonEC2', {})).toBeNull();
  });

  it('applies refine across a widened page and skips non-matches', async () => {
    const client = stubClient([
      {
        PriceList: [
          priceListEntry('E1', { usagetype: 'USEAST1-AmazonEKS-Hours:perNode' }, dim('d', 'Hrs', '9.99')),
          priceListEntry('E2', { usagetype: 'USEAST1-AmazonEKS-Hours:perCluster' }, dim('d', 'Hrs', '0.10')),
        ],
      },
    ]);
    const result = await getAwsPrice(client, 'AmazonEKS', {}, {
      maxResults: 100,
      refine: (d) => String(d.attributes?.usagetype || '').endsWith('perCluster'),
    });
    expect(result.usd).toBe(0.1);
  });
});

// ---------------------------------------------------------------------------
// The four ported composites. Expected values are unchanged from the source.
// ---------------------------------------------------------------------------

describe('service composites — ported assertions', () => {
  it('compute-vm: m6i.xlarge Linux shared', async () => {
    const client = stubClient([
      {
        PriceList: [
          priceListEntry(
            'VM1',
            {
              regionCode: 'us-east-1',
              instanceType: 'm6i.xlarge',
              operatingSystem: 'Linux',
              tenancy: 'Shared',
              preInstalledSw: 'NA',
              capacitystatus: 'Used',
            },
            dim('vmDim', 'Hrs', '0.1920000000')
          ),
        ],
      },
    ]);

    expect(await fetchAwsPrice('compute-vm', 'us-east-1', { client })).toEqual({
      sku: 'm6i.xlarge Linux shared',
      unit: 'hour',
      pricePerUnit: 0.192,
    });
  });

  it('compute-serverless: requests*1e6 + duration*400k', async () => {
    const client = stubClient([
      { PriceList: [priceListEntry('REQ1', {}, dim('reqDim', 'Requests', '0.0000002000'))] },
      { PriceList: [priceListEntry('DUR1', {}, dim('durDim', 'seconds', '0.0000166667'))] },
    ]);

    expect(await fetchAwsPrice('compute-serverless', 'us-east-1', { client })).toEqual({
      sku: '1M requests + 400k GB-s benchmark',
      unit: 'normalized request workload',
      // Float artefact preserved: pins request-then-duration ordering.
      pricePerUnit: 6.866680000000001,
    });
  });

  it('integration-messaging: skips the $0 free tier, then *1e6', async () => {
    const client = stubClient([
      {
        PriceList: [
          priceListEntry(
            'SQS1',
            { regionCode: 'us-east-1', group: 'SQS-APIRequest-Tier1', queueType: 'Standard' },
            {
              ...dim('freeDim', 'Requests', '0.0000000000'),
              ...dim('paidDim', 'Requests', '0.0000004000'),
            }
          ),
        ],
      },
    ]);

    expect(await fetchAwsPrice('integration-messaging', 'us-east-1', { client })).toEqual({
      sku: '1M standard message operations benchmark',
      unit: 'million operations',
      pricePerUnit: 0.39999999999999997,
    });
  });

  it('edge-cdn: global, and sends no regionCode filter', async () => {
    const client = stubClient([
      {
        PriceList: [
          priceListEntry(
            'CF1',
            {
              transferType: 'CloudFront Outbound',
              fromLocation: 'United States',
              toLocation: 'External',
            },
            dim('cfDim', 'GB', '0.0850000000')
          ),
        ],
      },
    ]);

    expect(await fetchAwsPrice('edge-cdn', 'us-east-1', { client })).toEqual({
      sku: 'United States edge outbound first-tier transfer',
      unit: 'GB egress',
      pricePerUnit: 0.085,
    });

    const fields = client.calls[0].Filters.map((f) => f.Field);
    expect(fields).not.toContain('regionCode');
  });
});

// ---------------------------------------------------------------------------
// The four services the original suite never covered.
// ---------------------------------------------------------------------------

describe('service composites — previously untested', () => {
  it('storage-object', async () => {
    const client = stubClient([
      { PriceList: [priceListEntry('S3A', {}, dim('d', 'GB-Mo', '0.0230000000'))] },
    ]);
    expect(await fetchAwsPrice('storage-object', 'us-east-1', { client })).toEqual({
      sku: 'S3 Standard general purpose storage',
      unit: 'GB-month',
      pricePerUnit: 0.023,
    });
  });

  it('database-relational', async () => {
    const client = stubClient([
      { PriceList: [priceListEntry('RDS1', {}, dim('d', 'Hrs', '0.1360000000'))] },
    ]);
    expect(await fetchAwsPrice('database-relational', 'us-east-1', { client })).toEqual({
      sku: 'db.t3.large MySQL Single-AZ',
      unit: 'hour',
      pricePerUnit: 0.136,
    });

    expect(client.calls[0].Filters).toEqual([
      { Type: 'TERM_MATCH', Field: 'regionCode', Value: 'us-east-1' },
      { Type: 'TERM_MATCH', Field: 'instanceType', Value: 'db.t3.large' },
      { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: 'MySQL' },
      { Type: 'TERM_MATCH', Field: 'licenseModel', Value: 'No license required' },
      { Type: 'TERM_MATCH', Field: 'deploymentOption', Value: 'Single-AZ' },
    ]);
  });

  it('database-nosql: (read + write) * 500k each', async () => {
    const client = stubClient([
      { PriceList: [priceListEntry('RD1', {}, dim('d', 'ReadRequestUnits', '0.000000125'))] },
      { PriceList: [priceListEntry('WR1', {}, dim('d', 'WriteRequestUnits', '0.000000625'))] },
    ]);
    expect(await fetchAwsPrice('database-nosql', 'us-east-1', { client })).toEqual({
      sku: '1M transactional operations benchmark',
      unit: 'million operations',
      pricePerUnit: 0.000000125 * 500_000 + 0.000000625 * 500_000,
    });
  });

  it('containers-kubernetes: exact usagetype match on the first call', async () => {
    const client = stubClient([
      {
        PriceList: [
          priceListEntry(
            'EKS1',
            { usagetype: 'USEAST1-AmazonEKS-Hours:perCluster' },
            dim('d', 'Hrs', '0.1000000000')
          ),
        ],
      },
    ]);
    expect(await fetchAwsPrice('containers-kubernetes', 'us-east-1', { client })).toEqual({
      sku: 'Amazon EKS cluster usage',
      unit: 'hour',
      pricePerUnit: 0.1,
    });
    expect(client.send).toHaveBeenCalledTimes(1); // no fallback needed
  });

  it('containers-kubernetes: falls back to a suffix match when the prefix rule fails', async () => {
    // Several regions do not follow the UPPERCASE-NOHYPHEN prefix rule, which
    // is why the original carried a fallback at all.
    const client = stubClient([
      { PriceList: [] }, // exact usagetype misses
      {
        PriceList: [
          priceListEntry('EKS2', { usagetype: 'APS1-AmazonEKS-Hours:perNode' }, dim('d', 'Hrs', '9.99')),
          priceListEntry('EKS3', { usagetype: 'APS1-AmazonEKS-Hours:perCluster' }, dim('d', 'Hrs', '0.10')),
        ],
      },
    ]);

    expect(await fetchAwsPrice('containers-kubernetes', 'ap-south-1', { client })).toEqual({
      sku: 'Amazon EKS cluster usage',
      unit: 'hour',
      pricePerUnit: 0.1,
    });
    expect(client.send).toHaveBeenCalledTimes(2);
    expect(client.calls[1].MaxResults).toBe(100);
  });
});

describe('partial results', () => {
  it('returns null when one half of a composite is missing', async () => {
    // A partial composite would silently under-price the benchmark.
    const client = stubClient([
      { PriceList: [priceListEntry('REQ1', {}, dim('d', 'Requests', '0.0000002'))] },
      { PriceList: [] }, // duration missing
    ]);
    expect(await fetchAwsPrice('compute-serverless', 'us-east-1', { client })).toBeNull();
  });

  it('returns null for an unknown serviceId', async () => {
    expect(await fetchAwsPrice('not-a-service', 'us-east-1', { client: stubClient([]) })).toBeNull();
  });
});

describe('coverage of the service catalog', () => {
  it('defines a lookup for all eight catalog services', () => {
    expect(Object.keys(AWS_SERVICE_LOOKUPS).sort()).toEqual([
      'compute-serverless',
      'compute-vm',
      'containers-kubernetes',
      'database-nosql',
      'database-relational',
      'edge-cdn',
      'integration-messaging',
      'storage-object',
    ]);
  });

  it('gives every service a ServiceCode and at least one lookup', () => {
    for (const [id, config] of Object.entries(AWS_SERVICE_LOOKUPS)) {
      expect(config.serviceCode, id).toBeTruthy();
      expect(Object.keys(config.lookups).length, id).toBeGreaterThan(0);
      expect(typeof config.price, id).toBe('function');
    }
  });
});
