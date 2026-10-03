/**
 * The admin provider list is the site's provider registry, not a copy of it.
 * It was a hand-kept copy until 2026-10-03 and stopped at FinOps, so Docker,
 * VMware and Ansible articles could not be filed on the review board although
 * each provider has a blog route. A provider registered in CANONICAL_PROVIDERS
 * and missing here fails this file.
 */
import { describe, expect, it } from 'vitest';
import { VALID_PROVIDERS } from '@/context/ProviderContext';
import { CANONICAL_PROVIDERS } from '@/lib/providers';
import {
  BLOG_LANDING_ZONE_OPTIONS,
  PROVIDER_LABELS,
  PROVIDER_OPTIONS,
  PROVIDER_OPTIONS_WITH_AUTO,
  storedProviderValue,
} from './admin';

describe('PROVIDER_OPTIONS', () => {
  it('offers every provider the site routes, in registry order', () => {
    expect(PROVIDER_OPTIONS.map((option) => option.value.toLowerCase())).toEqual([
      ...CANONICAL_PROVIDERS,
    ]);
    expect([...CANONICAL_PROVIDERS].sort()).toEqual([...VALID_PROVIDERS].sort());
  });

  it('names every registered provider, so no button falls back to its stored value', () => {
    expect(Object.keys(PROVIDER_LABELS).sort()).toEqual([...CANONICAL_PROVIDERS].sort());
  });

  it('stores the values the server writes: Docker, Vmware, Ansible beside Aws and Finops', () => {
    expect(PROVIDER_OPTIONS).toContainEqual({ value: 'Docker', label: 'Docker' });
    expect(PROVIDER_OPTIONS).toContainEqual({ value: 'Vmware', label: 'VMware' });
    expect(PROVIDER_OPTIONS).toContainEqual({ value: 'Ansible', label: 'Ansible' });
    expect(PROVIDER_OPTIONS).toContainEqual({ value: 'Aws', label: 'AWS' });
    expect(storedProviderValue('finops')).toBe('Finops');
  });

  it('feeds the Builder dropdowns the same providers', () => {
    expect(PROVIDER_OPTIONS_WITH_AUTO.slice(1)).toEqual(PROVIDER_OPTIONS);
    expect(BLOG_LANDING_ZONE_OPTIONS.slice(1).map((option) => option.value)).toEqual(
      PROVIDER_OPTIONS.map((option) => option.value)
    );
  });
});
