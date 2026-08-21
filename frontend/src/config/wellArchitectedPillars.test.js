// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  WELL_ARCHITECTED,
  ASSESSABLE_PROVIDERS,
  getFramework,
  getPillarIds,
  isPillarOfProvider,
} from './wellArchitectedPillars';

/**
 * These are published vendor frameworks, read off the vendors' own docs on
 * 2026-07-30. The counts are asserted because they are the thing most likely to
 * be "corrected" from memory into something wrong — AWS and Google both have
 * six while Azure has five, and Google's set is not a renamed Azure set.
 *
 * A wrong pillar here is not a cosmetic bug. It publishes a score against a
 * pillar a vendor does not define, on a page whose whole claim is that it
 * measures against the official framework.
 */
describe('Well-Architected pillar sets', () => {
  it.each([
    ['aws', 6],
    ['azure', 5],
    ['gcp', 6],
  ])('%s has %i pillars, per the vendor documentation', (provider, count) => {
    expect(getPillarIds(provider)).toHaveLength(count);
  });

  it('does not give Azure a Sustainability pillar', () => {
    // The single most likely wrong "fix": AWS and GCP have it, Azure does not.
    expect(isPillarOfProvider('azure', 'sustainability')).toBe(false);
    expect(isPillarOfProvider('aws', 'sustainability')).toBe(true);
    expect(isPillarOfProvider('gcp', 'sustainability')).toBe(true);
  });

  it("keeps Google's own pillar names rather than normalising them to AWS's", () => {
    // Normalising these would make the radar comparable and the label wrong.
    expect(getPillarIds('gcp')).toContain('securityPrivacyCompliance');
    expect(getPillarIds('gcp')).toContain('performanceOptimization');
    expect(getPillarIds('gcp')).not.toContain('performanceEfficiency');
    expect(getPillarIds('aws')).toContain('performanceEfficiency');
  });

  it('excludes VMware, whose framework is lifecycle phases not quality attributes', () => {
    // Plan / Build / Secure / Modernize / Operate cannot share a radar with
    // Reliability / Security / Cost. Absence here is the decision, so it is
    // pinned — adding VMware silently would be the regression.
    expect(getFramework('vmware')).toBeNull();
    expect(ASSESSABLE_PROVIDERS).not.toContain('vmware');
  });

  it('carries a framework URL on every provider, so a score is attributable', () => {
    for (const provider of ASSESSABLE_PROVIDERS) {
      const framework = getFramework(provider);
      expect(framework.frameworkUrl, provider).toMatch(/^https:\/\//);
      expect(framework.frameworkName, provider).toBeTruthy();
    }
  });

  it('gives every pillar a stable id, a label and a doc link', () => {
    for (const provider of ASSESSABLE_PROVIDERS) {
      for (const pillar of WELL_ARCHITECTED[provider].pillars) {
        expect(pillar.id, `${provider} pillar id`).toMatch(/^[a-z][A-Za-z]+$/);
        expect(pillar.label, `${provider}/${pillar.id} label`).toBeTruthy();
        expect(pillar.docUrl, `${provider}/${pillar.id} docUrl`).toMatch(/^https:\/\//);
      }
    }
  });

  it('has no duplicate pillar ids within a provider', () => {
    for (const provider of ASSESSABLE_PROVIDERS) {
      const ids = getPillarIds(provider);
      expect(new Set(ids).size, provider).toBe(ids.length);
    }
  });

  it('resolves case-insensitively and returns null for an unknown provider', () => {
    expect(getFramework('AWS')?.provider).toBe('aws');
    expect(getFramework('terraform')).toBeNull();
    expect(getPillarIds('terraform')).toEqual([]);
    expect(isPillarOfProvider('terraform', 'security')).toBe(false);
  });
});
