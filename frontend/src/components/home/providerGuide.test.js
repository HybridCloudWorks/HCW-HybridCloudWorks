/**
 * The home page provider strip's data (owner request 2026-09-28): which
 * providers, in which rows, of which type, with which website, and copy short
 * enough that the frame stays four lines tall.
 *
 * THE LENGTH CEILING IS A PROXY FOR A MEASUREMENT. jsdom has no layout, so
 * this cannot count lines. On 2026-09-28 the strip was measured in Chromium
 * at 768, 1024 and 1440px (the frame is max-w-[42rem], a 574px text column at
 * text-sm): every description took exactly four lines in the default font, and
 * the longest (307 characters) filled 3.26 lines of running width — 3.75 in
 * Verdana, used as a deliberately wide stand-in for other platforms' system
 * fonts. At 320 characters the default font fills about 3.4, which still
 * leaves room for the words that wrap early. Raise the ceiling only after
 * measuring again in a browser.
 */
import { describe, expect, it } from 'vitest';
import { CANONICAL_PROVIDERS } from '@/lib/providers';
import { PROVIDER_LOGOS } from '@/lib/providerLogos';
import {
  DESCRIPTION_MAX_CHARS,
  PROVIDER_GUIDE,
  PROVIDER_GUIDE_DEFAULT,
  PROVIDER_GUIDE_ROWS,
  PROVIDER_TYPES,
  websiteLinkLabel,
} from './providerGuide';

describe('the providers on the strip', () => {
  it('is all nine providers the site serves, once each', () => {
    const providers = PROVIDER_GUIDE.map((entry) => entry.provider);
    expect(providers).toHaveLength(9);
    expect(new Set(providers).size).toBe(9);
    expect([...providers].sort()).toEqual([...CANONICAL_PROVIDERS].sort());
  });

  it('lays them out in the two rows the owner asked for, in order', () => {
    expect(PROVIDER_GUIDE_ROWS.map((row) => row.map((entry) => entry.label))).toEqual([
      ['Azure', 'AWS', 'GCP', 'VMware'],
      ['GitHub', 'FinOps', 'Terraform', 'Docker', 'Ansible'],
    ]);
  });

  it('types each provider as the owner did', () => {
    expect(Object.fromEntries(PROVIDER_GUIDE.map((entry) => [entry.provider, entry.type]))).toEqual(
      {
        azure: 'cloud',
        aws: 'cloud',
        gcp: 'cloud',
        vmware: 'cloud',
        github: 'framework',
        finops: 'framework',
        terraform: 'service',
        docker: 'service',
        ansible: 'service',
      }
    );
    expect(PROVIDER_TYPES).toEqual({
      cloud: 'Cloud Provider',
      framework: 'Framework Provider',
      service: 'Service Provider',
    });
  });

  it('groups row 2 as framework providers, then service providers, which is where the pipe goes', () => {
    const types = PROVIDER_GUIDE_ROWS[1].map((entry) => entry.type);
    expect(types).toEqual(['framework', 'framework', 'service', 'service', 'service']);
  });

  it('links each provider to its main website, checked 2026-09-28', () => {
    expect(
      Object.fromEntries(PROVIDER_GUIDE.map((entry) => [entry.provider, entry.website]))
    ).toEqual({
      azure: 'https://azure.microsoft.com',
      aws: 'https://aws.amazon.com',
      gcp: 'https://cloud.google.com',
      vmware: 'https://www.vmware.com',
      github: 'https://github.com',
      finops: 'https://www.finops.org',
      // www.terraform.io redirects here and names it as canonical.
      terraform: 'https://developer.hashicorp.com/terraform',
      docker: 'https://www.docker.com',
      ansible: 'https://www.ansible.com',
    });
  });

  it('names each website link for a screen reader, including that it opens a new tab', () => {
    const byProvider = Object.fromEntries(PROVIDER_GUIDE.map((entry) => [entry.provider, entry]));
    expect(websiteLinkLabel(byProvider.azure)).toBe(
      "Microsoft Azure's website (opens in a new tab)"
    );
    expect(websiteLinkLabel(byProvider.aws)).toBe(
      "Amazon Web Services' website (opens in a new tab)"
    );
    for (const entry of PROVIDER_GUIDE) {
      expect(websiteLinkLabel(entry)).toMatch(/website \(opens in a new tab\)$/);
    }
  });

  it('has a logo for every provider on both themes', () => {
    // The files themselves are checked in lib/providerLogos.test.js.
    for (const entry of PROVIDER_GUIDE) {
      expect(PROVIDER_LOGOS[entry.provider], entry.provider).toEqual({
        light: expect.stringMatching(/^\/icons\/providers\//),
        dark: expect.stringMatching(/^\/icons\/providers\//),
      });
    }
  });
});

describe('the descriptions', () => {
  it.each(PROVIDER_GUIDE.map((entry) => [entry.provider, entry]))(
    '%s fits four lines at desktop width',
    (provider, entry) => {
      expect(
        entry.description.length,
        `${provider} is ${entry.description.length} characters; the ceiling is ${DESCRIPTION_MAX_CHARS}`
      ).toBeLessThanOrEqual(DESCRIPTION_MAX_CHARS);
    }
  );

  it.each(PROVIDER_GUIDE.map((entry) => [entry.provider, entry]))(
    '%s weaves its type into the sentence rather than leaving it as a label',
    (provider, entry) => {
      const phrase = PROVIDER_TYPES[entry.type].toLowerCase();
      expect(entry.description.toLowerCase(), provider).toContain(phrase);
      // Woven in, not tacked on as "Cloud Provider." or "Type: ...".
      expect(entry.description, provider).not.toMatch(/^(cloud|framework|service) provider\b/i);
      expect(entry.description, provider).not.toMatch(/\btype:/i);
    }
  );

  it('opens every description differently', () => {
    const openings = PROVIDER_GUIDE.map((entry) =>
      entry.description.split(' ').slice(0, 2).join(' ')
    );
    expect(new Set(openings).size).toBe(PROVIDER_GUIDE.length);
  });

  it('keeps the default line short, and inside the same ceiling', () => {
    expect(PROVIDER_GUIDE_DEFAULT.length).toBeLessThanOrEqual(DESCRIPTION_MAX_CHARS);
    expect(PROVIDER_GUIDE_DEFAULT).toMatch(/provider/i);
  });
});
