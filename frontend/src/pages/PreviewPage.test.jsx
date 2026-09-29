/**
 * The staging preview (T-606) renders a draft as the provider it is filed
 * under. Until #775 it kept its own copy of the provider list, without
 * Docker, so a Docker draft previewed as AWS: AWS's theme, AWS's links.
 */
import { describe, expect, it } from 'vitest';
import { VALID_PROVIDERS } from '@/context/ProviderContext';
import { providerKeyOf } from './PreviewPage';

describe('providerKeyOf', () => {
  it('previews a Docker draft as Docker, whichever field and casing carry it', () => {
    expect(providerKeyOf({ cloudProvider: 'Docker' })).toBe('docker');
    expect(providerKeyOf({ 'Cloud Provider': 'docker' })).toBe('docker');
  });

  it('knows every provider the router serves', () => {
    for (const provider of VALID_PROVIDERS) {
      expect(providerKeyOf({ cloudProvider: provider.toUpperCase() }), provider).toBe(provider);
    }
  });

  it('keeps its two fallbacks: Google Cloud is gcp, and anything else is aws', () => {
    expect(providerKeyOf({ cloudProvider: 'Google Cloud' })).toBe('gcp');
    expect(providerKeyOf({ cloudProvider: 'Multi' })).toBe('aws');
    expect(providerKeyOf(null)).toBe('aws');
  });
});
