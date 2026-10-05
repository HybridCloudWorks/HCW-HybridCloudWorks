/**
 * The issuer registry: what the Certifications editor's combobox offers and
 * how a typed issuer maps to a curated entry. Anthropic joined on 2026-10-05
 * (owner request): the Claude certifications had no issuer to pick.
 */
import { describe, it, expect } from 'vitest';
import {
  detectIssuer,
  getIssuerColor,
  getIssuerOptions,
  getLearnUrl,
  getVendorForIssuer,
  ISSUERS,
} from './certIssuers';

describe('the registry', () => {
  it('has one entry per id, each with the fields the editor reads', () => {
    const ids = ISSUERS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const issuer of ISSUERS) {
      expect(issuer.name).toBeTruthy();
      expect(issuer.aliases.length).toBeGreaterThan(0);
      expect(['aws', 'azure', 'gcp', 'microsoft', 'google', 'other']).toContain(issuer.vendor);
      expect(issuer.learnBase).toMatch(/^https:\/\//);
      expect(issuer.learnSearch('')).toMatch(/^https:\/\//);
      expect(issuer.color).toContain('bg-');
    }
  });

  it('offers every name, sorted, so Anthropic is a choice in the combobox', () => {
    const options = getIssuerOptions();
    expect(options).toEqual([...options].sort());
    expect(options).toContain('Anthropic');
  });
});

describe('detectIssuer', () => {
  it('matches the exact name or an alias, case-insensitively, and nothing looser', () => {
    expect(detectIssuer('Anthropic')?.id).toBe('anthropic');
    expect(detectIssuer('claude')?.id).toBe('anthropic');
    expect(detectIssuer('  ANTHROPIC ')?.id).toBe('anthropic');
    expect(detectIssuer('Microsoft')?.id).toBe('microsoft');
    // A longer label is the editor's own and is not collapsed.
    expect(detectIssuer('Microsoft Azure')).toBeNull();
    expect(detectIssuer('')).toBeNull();
  });
});

describe('what a cert gets from its issuer', () => {
  it('Anthropic routes to no vendor page, carries a learn link, and has its own colour', () => {
    expect(getVendorForIssuer('Anthropic')).toBe('other');
    expect(getLearnUrl('Anthropic', '')).toBe('https://www.anthropic.com/learn');
    expect(getLearnUrl('Anthropic', 'Claude Certified Architect')).toContain(
      encodeURIComponent('Claude Certified Architect')
    );
    expect(getIssuerColor('Anthropic')).not.toBe(getIssuerColor('Some Unknown Issuer'));
  });

  it('a typed label that contains a known name still routes to its vendor page', () => {
    expect(getVendorForIssuer('Microsoft Azure')).toBe('azure');
    expect(getVendorForIssuer('Anthropic Academy')).toBe('other');
  });
});
