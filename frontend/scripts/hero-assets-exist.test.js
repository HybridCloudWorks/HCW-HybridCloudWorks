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

function landingPages() {
  return readdirSync(PAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(PAGES, entry.name, 'LandingPage.jsx'))
    .filter((file) => existsSync(file));
}

describe('landing page image assets', () => {
  const pages = landingPages();

  it('finds the landing pages', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  for (const file of pages) {
    it(`${file.slice(PAGES.length + 1)} references only images that exist under public/`, () => {
      // Code only: comment lines are dropped first, and only '…' / "…" string
      // literals count, so prose that mentions a path is not a reference.
      // `join(PUBLIC, '/images/x')` is `<public>/images/x` — path.join keeps
      // every segment (it is path.resolve that would restart at a leading
      // slash); the azure and aws pages, whose sets exist, prove the lookup.
      const source = readFileSync(file, 'utf8')
        .split('
')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('
');
      const paths = [...source.matchAll(/['"](\/images\/[^'"\s?#]+)['"]/g)].map((m) => m[1]);
      const missing = paths.filter((p) => !existsSync(join(PUBLIC, p)));
      expect(missing, `referenced but not under public/: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
