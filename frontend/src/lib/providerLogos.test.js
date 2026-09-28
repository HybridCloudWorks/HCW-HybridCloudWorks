/**
 * The provider logo table (2026-09-28): every provider the router serves has a
 * logo for each theme, and every file it names is in public/.
 *
 * Existence is the check that was missing. The home page's design cards
 * asked for /icons/providers/terraform.png, which was never there, and an
 * onError handler hid the broken image, so nothing ever said so.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANONICAL_PROVIDERS } from '@/lib/providers';
import { PROVIDER_LOGOS } from '@/lib/providerLogos';

const PUBLIC = join(process.cwd(), 'public');

describe('PROVIDER_LOGOS', () => {
  it('has one entry for every provider the router serves, and no other', () => {
    expect(Object.keys(PROVIDER_LOGOS).sort()).toEqual([...CANONICAL_PROVIDERS].sort());
  });

  it.each(Object.entries(PROVIDER_LOGOS))('%s has a file on disk for both themes', (_, logo) => {
    for (const theme of ['light', 'dark']) {
      expect(logo[theme], theme).toMatch(/^\/icons\/providers\/[\w.-]+\.(?:png|svg)$/);
      expect(existsSync(join(PUBLIC, logo[theme])), `${logo[theme]} is not in public/`).toBe(true);
    }
  });

  it('gives AWS, Ansible and GitHub a separate file for each theme', () => {
    for (const provider of ['aws', 'ansible', 'github']) {
      expect(PROVIDER_LOGOS[provider].light, provider).not.toBe(PROVIDER_LOGOS[provider].dark);
    }
  });

  it.each([
    ['aws', 'light', ['aws.amazon.com', 'trademark']],
    ['ansible', 'dark', ['Simple Icons 16.33.0', 'CC0-1.0', 'trademark']],
  ])('the %s %s variant names where it came from', (provider, theme, phrases) => {
    const svg = readFileSync(join(PUBLIC, PROVIDER_LOGOS[provider][theme]), 'utf8');
    expect(svg.startsWith('<!--'), 'the source note comes first').toBe(true);
    const note = svg.slice(0, svg.indexOf('-->'));
    for (const phrase of phrases) expect(note).toContain(phrase);
  });
});
