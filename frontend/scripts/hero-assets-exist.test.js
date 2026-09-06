/**
 * Every `/images/…` path a landing page hard-codes must exist under public/.
 *
 * Found by the published-pages audit (#361 → #371): four landing pages listed
 * five hero images each that were never added, and every visit loaded seven
 * 404s and six broken image boxes. Nothing failed — a missing static asset is
 * a runtime 404, invisible to the build. This reads the landing pages the way
 * a grep would and checks the filesystem, so a path is either real or the
 * suite is red.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = join(FRONTEND, 'src', 'pages');
const PUBLIC = join(FRONTEND, 'public');

/** Lines that are comments, so prose mentioning a path is not a reference. */
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

/** A single- or double-quoted string literal holding a public image path. */
const IMAGE_LITERAL = /['"](\/images\/[^'"\s?#]+)['"]/g;

function landingPages() {
  return readdirSync(PAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(PAGES, entry.name, 'LandingPage.jsx'))
    .filter((file) => existsSync(file));
}

/** Image paths referenced from code in the file — comment lines dropped first. */
export function referencedImagePaths(source) {
  const code = String(source)
    .split('\n')
    .filter((line) => !COMMENT_LINE.test(line))
    .join('\n');
  return [...code.matchAll(IMAGE_LITERAL)].map((m) => m[1]);
}

describe('landing page image assets', () => {
  const pages = landingPages();

  it('finds the landing pages', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it('reads code literals and ignores comments', () => {
    const source = [
      "// '/images/not-a-reference.png' in a comment",
      " * '/images/also-not.png' in a doc block",
      'const A = [\'/images/real/1.png\', "/images/real/2.png"];',
    ].join('\n');
    expect(referencedImagePaths(source)).toEqual(['/images/real/1.png', '/images/real/2.png']);
  });

  for (const file of pages) {
    it(`${file.slice(PAGES.length + 1)} references only images that exist under public/`, () => {
      // `join(PUBLIC, '/images/x')` is `<public>/images/x`: path.join keeps
      // every segment (path.resolve is the one that restarts at a leading
      // slash). The azure and aws pages, whose sets exist, prove the lookup.
      const paths = referencedImagePaths(readFileSync(file, 'utf8'));
      const missing = paths.filter((p) => !existsSync(join(PUBLIC, p)));
      expect(missing, `referenced but not under public/: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
