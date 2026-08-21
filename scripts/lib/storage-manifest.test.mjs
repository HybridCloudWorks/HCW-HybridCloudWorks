import { describe, it, expect } from 'vitest';

import { AZURE_CONTAINERS, PREFIXES, ruleFor, mapObject, topPrefixOf, copiedPrefixes } from './storage-manifest.mjs';

describe('storage manifest', () => {
  it('every copied prefix targets a container Terraform creates', () => {
    for (const rule of copiedPrefixes()) {
      expect(AZURE_CONTAINERS, `${rule.prefix} → ${rule.container}`).toContain(rule.container);
    }
  });

  it('skipped prefixes name no container', () => {
    for (const rule of PREFIXES.filter((r) => r.disposition === 'skip')) {
      expect(rule.container).toBeNull();
    }
  });

  it('every prefix ends in a slash and is unique', () => {
    const seen = new Set();
    for (const rule of PREFIXES) {
      expect(rule.prefix.endsWith('/'), rule.prefix).toBe(true);
      expect(seen.has(rule.prefix), `duplicate ${rule.prefix}`).toBe(false);
      seen.add(rule.prefix);
    }
  });

  it('longest prefix wins: database/certifications/ is not swallowed by certifications/', () => {
    const m = mapObject('database/certifications/aws-saa.svg');
    expect(m).toEqual(expect.objectContaining({ container: 'certifications', blobName: 'database/aws-saa.svg' }));
  });

  it('the whole database/<family>/ pattern lands under the family container with database/ kept', () => {
    for (const family of ['blogs', 'certifications', 'speakerevents']) {
      const m = mapObject(`database/${family}/x.svg`);
      expect(m.container).toBe(family);
      expect(m.blobName).toBe('database/x.svg');
    }
  });

  it('the five same-name prefixes strip their prefix', () => {
    expect(mapObject('covers/c1/hero.png')).toEqual(expect.objectContaining({ container: 'covers', blobName: 'c1/hero.png' }));
    expect(mapObject('blogs/b1/img.jpg')).toEqual(expect.objectContaining({ container: 'blogs', blobName: 'b1/img.jpg' }));
    expect(mapObject('certifications/x.png')).toEqual(expect.objectContaining({ container: 'certifications', blobName: 'x.png' }));
    expect(mapObject('speakerevents/e1/p.webp')).toEqual(expect.objectContaining({ container: 'speakerevents', blobName: 'e1/p.webp' }));
  });

  it('other families land under content with their prefix preserved', () => {
    expect(mapObject('image-gallery/manual/a.png')).toEqual(
      expect.objectContaining({ container: 'content', blobName: 'image-gallery/manual/a.png' })
    );
    expect(mapObject('character/hero-1.png')).toEqual(expect.objectContaining({ container: 'content', blobName: 'character/hero-1.png' }));
    expect(mapObject('published-images/p1/x.png')).toEqual(
      expect.objectContaining({ container: 'content', blobName: 'published-images/p1/x.png' })
    );
  });

  it('skipped and unmanifested objects map to null', () => {
    expect(mapObject('articles/2026/x.jpg')).toBeNull();
    expect(mapObject('uploads/uid123/tmp.png')).toBeNull();
    expect(mapObject('something-new/x.bin')).toBeNull();
    expect(ruleFor('something-new/x.bin')).toBeNull();
  });

  it('a bare prefix marker object is not copied', () => {
    expect(mapObject('covers/')).toBeNull();
  });

  it('topPrefixOf groups by first segment', () => {
    expect(topPrefixOf('covers/a/b.png')).toBe('covers/');
    expect(topPrefixOf('loose-file.png')).toBe('loose-file.png');
  });

  it('published-images is flagged as a disclosure decision, not silently made public', () => {
    const rule = ruleFor('published-images/x.png');
    expect(rule.container).toBe('content');
    expect(rule.note).toMatch(/PUBLIC_MEDIA_CONTAINERS/);
  });
});
