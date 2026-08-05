import { describe, expect, it } from 'vitest';

import {
  MESSAGING_BENCHMARK_SKU,
  MESSAGING_BENCHMARK_UNIT,
  NOSQL_BENCHMARK_SKU,
  NOSQL_BENCHMARK_UNIT,
  PROVIDER_REGION_MATRIX,
  SERVERLESS_BENCHMARK_SKU,
  SERVERLESS_BENCHMARK_UNIT,
  moneyToNumber,
  normalizeUnit,
  resolveProviderRegion,
} from './shared.js';

/**
 * The three assertion groups marked "ported" come from Site-Main
 * `functions/cloud-tools-pricing.test.js` unchanged. The rest close gaps the
 * original left — notably the pass-through behaviour for unmapped regions,
 * which the AWS rewrite now depends on far more heavily, since `regionCode`
 * filtering removed the old three-region cap.
 */

describe('resolveProviderRegion', () => {
  it('maps comparison regions to provider-specific regions (ported)', () => {
    expect(resolveProviderRegion('eastus', 'aws')).toBe('us-east-1');
    expect(resolveProviderRegion('europe-west1', 'azure')).toBe('westeurope');
    expect(resolveProviderRegion('us-west-2', 'gcp')).toBe('us-west1');
  });

  it('passes an unmapped region straight through', () => {
    // This is what lets the Query API price a region the matrix has never
    // heard of — the old `location`-label lookup returned null instead.
    expect(resolveProviderRegion('ap-south-1', 'aws')).toBe('ap-south-1');
    expect(resolveProviderRegion('sa-east-1', 'aws')).toBe('sa-east-1');
  });

  it('trims surrounding whitespace before looking up', () => {
    expect(resolveProviderRegion('  eastus  ', 'aws')).toBe('us-east-1');
  });

  it('is total for empty input', () => {
    expect(resolveProviderRegion('', 'aws')).toBe('');
    expect(resolveProviderRegion(undefined, 'aws')).toBeUndefined();
  });

  it('keeps every matrix row complete across all three providers', () => {
    for (const [region, row] of Object.entries(PROVIDER_REGION_MATRIX)) {
      for (const provider of ['aws', 'azure', 'gcp']) {
        expect(row[provider], `${region}.${provider}`).toBeTruthy();
      }
    }
  });
});

describe('moneyToNumber', () => {
  it('converts google money objects into decimal numbers (ported)', () => {
    expect(moneyToNumber({ units: '1', nanos: 250000000 })).toBe(1.25);
  });

  it('passes a plain number through', () => {
    expect(moneyToNumber(0.192)).toBe(0.192);
  });

  it('handles nanos-only and units-only', () => {
    expect(moneyToNumber({ nanos: 500000000 })).toBe(0.5);
    expect(moneyToNumber({ units: '3' })).toBe(3);
  });

  it('returns 0 for anything unusable rather than NaN', () => {
    // NaN would propagate into a rendered price.
    for (const bad of [null, undefined, 'free', '']) {
      expect(moneyToNumber(bad)).toBe(0);
    }
  });
});

describe('normalizeUnit', () => {
  it('normalizes representative unit strings used by live pricing APIs (ported)', () => {
    expect(normalizeUnit('GiBy.h')).toBe('GB-hour');
    expect(normalizeUnit('TiBy')).toBe('TB');
    expect(normalizeUnit('h')).toBe('hour');
  });

  it('normalizes the AWS unit spellings the Query API returns', () => {
    expect(normalizeUnit('Hrs')).toBe('hour');
    expect(normalizeUnit('GB-Mo')).toBe('GB-month');
    expect(normalizeUnit('Requests')).toBe('operations');
    expect(normalizeUnit('ReadRequestUnits')).toBe('operations');
    expect(normalizeUnit('WriteRequestUnits')).toBe('operations');
  });

  it('strips a leading "1 " quantity', () => {
    expect(normalizeUnit('1 GB')).toBe('GB');
  });

  it('leaves "1 Hour" capitalised — the source has a dead rule here', () => {
    // Behaviour pinned as-is, deliberately NOT corrected.
    //
    // normalizeUnit strips /^1\s+/ first, so by the time the
    // .replace('1 Hour', 'hour') rule runs the string is already 'Hour' and it
    // can never match. '1/Hour' has no whitespace, so its rule DOES fire —
    // which is presumably why nobody noticed.
    //
    // Changing this would alter a rendered unit string and the value the three
    // provider columns are compared on, so it is a product decision, not a
    // cleanup. Flagged rather than fixed.
    expect(normalizeUnit('1 Hour')).toBe('Hour');
    expect(normalizeUnit('1/Hour')).toBe('hour');
  });

  it('is total for empty input', () => {
    expect(normalizeUnit(undefined)).toBe('');
    expect(normalizeUnit(null)).toBe('');
  });
});

describe('benchmark constants', () => {
  it('are the shared strings that make the three provider columns comparable', () => {
    // Each provider meters these services differently, so all three converge on
    // a synthetic workload. If one provider's label drifts from another's, the
    // comparison silently stops being like-for-like.
    expect(SERVERLESS_BENCHMARK_SKU).toBe('1M requests + 400k GB-s benchmark');
    expect(SERVERLESS_BENCHMARK_UNIT).toBe('normalized request workload');
    expect(NOSQL_BENCHMARK_SKU).toBe('1M transactional operations benchmark');
    expect(NOSQL_BENCHMARK_UNIT).toBe('million operations');
    expect(MESSAGING_BENCHMARK_SKU).toBe('1M standard message operations benchmark');
    expect(MESSAGING_BENCHMARK_UNIT).toBe('million operations');
  });
});
