/**
 * The generated brand art (#371, #351) is committed, so this checks the
 * committed files rather than re-rendering them: every file the generator owns
 * exists, is the size and format the pages expect (8-bit RGBA like
 * azure-hero/), and stays under the byte ceiling. The SVG side is checked for
 * determinism and self-containment, which is what makes `art:generate` a
 * reproducible step rather than a one-off.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  COVER_PROVIDERS,
  COVER_SIZE,
  HERO_PROVIDERS,
  HERO_SIZE,
  HERO_VARIANTS,
  MAX_BYTES,
  PALETTES,
  buildCoverSvg,
  buildHeroSvg,
  encodePng,
  outputs,
} from './generate-brand-art.mjs';

/** Width, height, bit depth and colour type from the IHDR chunk. */
function pngHeader(file) {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    depth: bytes[24],
    colorType: bytes[25],
  };
}

describe('generated brand art', () => {
  it('owns five hero images for each provider whose set was missing, and eight covers', () => {
    const files = outputs().map((o) => o.publicPath);
    expect(files).toHaveLength(HERO_PROVIDERS.length * HERO_VARIANTS + COVER_PROVIDERS.length);
    for (const provider of ['gcp', 'github', 'terraform', 'finops']) {
      for (let i = 1; i <= 5; i += 1) expect(files).toContain(`/images/${provider}-hero/${i}.png`);
    }
    for (const provider of [
      'azure',
      'aws',
      'gcp',
      'github',
      'terraform',
      'ansible',
      'vmware',
      'multi',
    ]) {
      expect(files).toContain(`/images/default-heroes/${provider}.png`);
    }
  });

  it('has a palette for every provider it draws', () => {
    for (const provider of [...HERO_PROVIDERS, ...COVER_PROVIDERS]) {
      expect(PALETTES[provider], provider).toBeDefined();
      expect(PALETTES[provider].tones.length).toBeGreaterThanOrEqual(3);
    }
  });

  for (const target of outputs()) {
    it(`${target.publicPath} is committed at ${target.size.width}×${target.size.height} RGBA under the ceiling`, () => {
      expect(existsSync(target.file), `missing: run npm run art:generate`).toBe(true);
      expect(statSync(target.file).size).toBeLessThanOrEqual(MAX_BYTES);
      expect(pngHeader(target.file)).toEqual({
        width: target.size.width,
        height: target.size.height,
        depth: 8,
        colorType: 6,
      });
    });
  }

  it('builds the same SVG for the same provider and variant every time', () => {
    expect(buildHeroSvg('gcp', 3)).toBe(buildHeroSvg('gcp', 3));
    expect(buildCoverSvg('multi')).toBe(buildCoverSvg('multi'));
    expect(buildHeroSvg('gcp', 3)).not.toBe(buildHeroSvg('gcp', 4));
    expect(buildHeroSvg('gcp', 3)).not.toBe(buildHeroSvg('finops', 3));
  });

  it('references nothing outside the document', () => {
    const svgs = [
      ...HERO_PROVIDERS.flatMap((p) =>
        Array.from({ length: HERO_VARIANTS }, (_, i) => buildHeroSvg(p, i + 1))
      ),
      ...COVER_PROVIDERS.map((p) => buildCoverSvg(p)),
    ];
    for (const svg of svgs) {
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg).not.toMatch(/href=|<image|@import|url\((?!#)/);
      expect(svg).toContain('font-family="Goldman"');
    }
    expect(buildHeroSvg('gcp', 1)).toContain(
      `width="${HERO_SIZE.width}" height="${HERO_SIZE.height}"`
    );
    expect(buildCoverSvg('aws')).toContain(
      `width="${COVER_SIZE.width}" height="${COVER_SIZE.height}"`
    );
  });

  it('rejects a provider without a palette and a variant out of range', () => {
    expect(() => buildHeroSvg('oracle', 1)).toThrow(/no palette/);
    expect(() => buildHeroSvg('gcp', 0)).toThrow(/variant/);
    expect(() => buildHeroSvg('gcp', HERO_VARIANTS + 1)).toThrow(/variant/);
    expect(() => buildCoverSvg('oracle')).toThrow(/no palette/);
  });

  it('encodes a valid 8-bit RGBA PNG and refuses a short pixel buffer', () => {
    const rgba = Buffer.alloc(2 * 2 * 4, 0xff);
    const png = encodePng(2, 2, rgba);
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(2);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
    expect(() => encodePng(2, 2, Buffer.alloc(3))).toThrow(/expected 16/);
  });
});
