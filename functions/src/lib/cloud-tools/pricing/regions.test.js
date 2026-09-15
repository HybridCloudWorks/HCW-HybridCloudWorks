import { describe, expect, it } from 'vitest';

import {
  COMPARISON_CELLS,
  DEFAULT_REGION,
  REGION_OPTIONS,
  SERVICE_LABELS,
  pricingDocId,
  publicRegionOptions,
  regionOption,
} from './regions.js';
import { PROVIDER_REGION_MATRIX, resolveProviderRegion } from './shared.js';
import { BASELINE_COSTS, PROVIDERS } from './baseline.js';

describe('REGION_OPTIONS', () => {
  it('offers the three regions the page is built against, in order', () => {
    expect(REGION_OPTIONS.map((r) => r.id)).toEqual(['us-east-1', 'us-west-2', 'westeurope']);
    expect(REGION_OPTIONS.map((r) => r.label)).toEqual(['US East', 'US West', 'Western Europe']);
  });

  it('agrees with PROVIDER_REGION_MATRIX for every provider', () => {
    // The row composer stamps providerRegion from resolveProviderRegion; the
    // header the page renders comes from here. They must say the same thing.
    for (const option of REGION_OPTIONS) {
      for (const provider of PROVIDERS) {
        expect(option[provider], `${option.id}.${provider}`).toBe(
          resolveProviderRegion(option.id, provider)
        );
      }
      // And the id itself is a matrix key, not a pass-through that happens
      // to resolve to itself for one provider.
      expect(PROVIDER_REGION_MATRIX, option.id).toHaveProperty(option.id);
    }
  });

  it('defaults to a region that exists', () => {
    expect(regionOption(DEFAULT_REGION)).not.toBeNull();
    expect(DEFAULT_REGION).toBe('us-east-1');
  });

  it('is frozen, entries included', () => {
    expect(Object.isFrozen(REGION_OPTIONS)).toBe(true);
    for (const option of REGION_OPTIONS) expect(Object.isFrozen(option)).toBe(true);
  });
});

describe('regionOption', () => {
  it('is an exact match — the id is a document key', () => {
    expect(regionOption('us-east-1')?.label).toBe('US East');
    expect(regionOption('US-EAST-1')).toBeNull();
    expect(regionOption(' us-east-1')).toBeNull();
    expect(regionOption('eastus')).toBeNull(); // an Azure name, not an option id
    expect(regionOption('')).toBeNull();
    expect(regionOption(undefined)).toBeNull();
  });
});

describe('publicRegionOptions', () => {
  it('projects id and label only — provider names stay server-side', () => {
    expect(publicRegionOptions()).toEqual([
      { id: 'us-east-1', label: 'US East' },
      { id: 'us-west-2', label: 'US West' },
      { id: 'westeurope', label: 'Western Europe' },
    ]);
  });
});

describe('SERVICE_LABELS', () => {
  it('names every catalog service and nothing else', () => {
    expect(Object.keys(SERVICE_LABELS)).toEqual(Object.keys(BASELINE_COSTS));
    for (const label of Object.values(SERVICE_LABELS)) expect(label).toMatch(/\S/);
  });
});

describe('document ids and cell count', () => {
  it('keys one document per region', () => {
    expect(pricingDocId('westeurope')).toBe('pricing:westeurope');
  });

  it('counts eight services by three providers', () => {
    expect(COMPARISON_CELLS).toBe(24);
  });
});
