/**
 * The alias table is the guard against re-divergence (T-738).
 *
 * Four copies of this logic drifted apart and produced a live bug: a VMware or
 * Ansible document with no explicit provider field showed on the landing page
 * and vanished from `/vmware/blog`, because one copy knew those aliases and
 * another did not. A table alone does not prevent that recurring — a test that
 * walks the table does, because a provider added to the data is covered
 * without anyone remembering to write a case for it.
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalizeProvider,
  inferProviderFromText,
  isCanonicalProvider,
  squashProvider,
  PROVIDER_ALIASES,
  CANONICAL_PROVIDERS,
} from './providers.js';
import { VALID_PROVIDERS } from '@/context/ProviderContext';

describe('the alias table', () => {
  it('covers exactly the providers the router serves', () => {
    // If these drift, a document can canonicalise to something no route
    // renders — which is the same class of silent disappearance T-738 found.
    expect([...CANONICAL_PROVIDERS].sort()).toEqual([...VALID_PROVIDERS].sort());
    expect(PROVIDER_ALIASES.map((entry) => entry.provider).sort()).toEqual(
      [...CANONICAL_PROVIDERS].sort()
    );
  });

  // Table-driven on purpose: a provider added to PROVIDER_ALIASES is tested
  // the moment it is added, with no edit here.
  for (const { provider, squashed, text } of PROVIDER_ALIASES) {
    describe(provider, () => {
      it('canonicalises every one of its squashed aliases', () => {
        for (const alias of squashed) {
          expect(canonicalizeProvider(alias)).toBe(provider);
          expect(canonicalizeProvider(alias.toUpperCase())).toBe(provider);
        }
      });

      it('is inferred from every one of its text aliases', () => {
        for (const alias of text) {
          expect(inferProviderFromText(`a post about ${alias} and things`)).toBe(provider);
        }
      });

      it('canonicalises its own name', () => {
        expect(canonicalizeProvider(provider)).toBe(provider);
        expect(isCanonicalProvider(canonicalizeProvider(provider))).toBe(true);
      });
    });
  }
});

describe('canonicalizeProvider', () => {
  it('handles the multi-word values real documents actually carry', () => {
    // The exact-key alias map this replaces turned these into `microsoftazure`
    // and `awslambda`, and because it fed getContentPublicPath, the result was
    // a URL no route serves.
    expect(canonicalizeProvider('Microsoft Azure')).toBe('azure');
    expect(canonicalizeProvider('Amazon Web Services')).toBe('aws');
    expect(canonicalizeProvider('AWS Lambda')).toBe('aws');
    expect(canonicalizeProvider('Google Cloud')).toBe('gcp');
    expect(canonicalizeProvider('Google Cloud Platform')).toBe('gcp');
    expect(canonicalizeProvider('Red Hat Ansible')).toBe('ansible');
    expect(canonicalizeProvider('VMware by Broadcom')).toBe('vmware');
  });

  it('resolves the aliases that used to be known to only one copy', () => {
    // The exact divergence T-738 measured.
    for (const [input, expected] of [
      ['vmware', 'vmware'],
      ['VMware', 'vmware'],
      ['broadcom', 'vmware'],
      ['ansible', 'ansible'],
      ['Ansible', 'ansible'],
      ['redhat', 'ansible'],
    ]) {
      expect(canonicalizeProvider(input)).toBe(expected);
    }
  });

  it('is empty for empty input, and never throws on rubbish', () => {
    for (const value of ['', null, undefined, '   ', '!!!', 0, false, {}, []]) {
      expect(() => canonicalizeProvider(value)).not.toThrow();
    }
    expect(canonicalizeProvider('')).toBe('');
    expect(canonicalizeProvider(null)).toBe('');
    expect(canonicalizeProvider('   ')).toBe('');
  });

  it('passes an unknown provider through squashed rather than dropping it', () => {
    // Emptying it would turn "filed under something we do not know" into
    // "has no provider", which reads identically to a data defect.
    expect(canonicalizeProvider('Oracle Cloud')).toBe('oraclecloud');
  });
});

describe('inferProviderFromText', () => {
  it('returns empty when there is no evidence', () => {
    expect(inferProviderFromText('a post about cats')).toBe('');
    expect(inferProviderFromText('')).toBe('');
    expect(inferProviderFromText(null)).toBe('');
  });

  it('reads a provider out of a URL', () => {
    expect(inferProviderFromText('https://cloud.google.com/run/docs')).toBe('gcp');
    expect(inferProviderFromText('https://learn.microsoft.com/azure')).toBe('azure');
  });

  it('prefers the earlier table entry when a string mentions two', () => {
    // Order is load-bearing, so it is pinned rather than left to chance.
    expect(inferProviderFromText('migrating from aws to github actions')).toBe('github');
  });
});

describe('squashProvider', () => {
  it('strips everything that is not a letter or digit', () => {
    expect(squashProvider('Google Cloud!')).toBe('googlecloud');
    expect(squashProvider('  AWS  ')).toBe('aws');
  });
});
