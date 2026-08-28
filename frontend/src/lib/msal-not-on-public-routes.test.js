/**
 * No public route may statically reach MSAL (T-736).
 *
 * `@azure/msal-browser` is 236 kB, and an anonymous visitor to
 * `/:provider/news` was downloading and executing all of it — plus running
 * `onAuthStateChanged` — to look at a news grid. The chain was
 * `useGenerateCuratedImages` → `useAdminAuth` → `entraAuth` → MSAL, with a
 * second path through `lib/api.js`.
 *
 * What makes this worth a test rather than a one-line fix is that the code
 * already believed it was fixed. `useGenerateCuratedImages`'s own header says
 * its role gate "stops the hook dragging MSAL onto the critical path of a
 * public page". The runtime gate does work — it stops the hook *calling*
 * anything. It cannot stop a bundler resolving a static import, because that
 * happens before any gate runs. A runtime guard and a module-graph guarantee
 * look identical in the source and are not the same thing.
 *
 * So this walks the real static import graph from each public entry point. It
 * is deliberately blind to dynamic `import()`, which is the whole mechanism of
 * the fix: a lazily-imported MSAL is exactly what is wanted, and only a
 * top-level `import ... from` is a failure. Re-adding one is a single
 * plausible-looking line that no other test in this repository would notice.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

// `process.cwd()`, not `import.meta.url`: this suite runs under the jsdom
// environment where Vite rewrites `import.meta.url` to an http URL, and
// `fileURLToPath` rejects it. Vitest runs from the package root.
const SRC = resolve(process.cwd(), 'src');

/** Public entry points: what an anonymous visitor's route actually mounts. */
const PUBLIC_ENTRIES = [
  'pages/shared/NewsPage.jsx',
  'pages/azure/BlogPage.jsx',
  'pages/aws/BlogPage.jsx',
  'components/templates/BlogDetailTemplate.jsx',
  'components/templates/ContentListingTemplate.jsx',
  'components/templates/LandingPageTemplate.jsx',
  'hooks/useGenerateCuratedImages.js',
  'hooks/useBlogData.js',
  'lib/publicApi.js',
  // Not a public page, but the module that put MSAL in everyone's graph. Any
  // authed caller may be bundled with a public one; keeping it clean is what
  // makes the entries above stay clean.
  'lib/api.js',
];

/** Modules whose presence in a public graph is the failure. */
const FORBIDDEN = [/(^|\/)entraAuth(\.js)?$/, /@azure\/msal-browser/, /(^|\/)msalConfig(\.js)?$/];

const EXTENSIONS = ['', '.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.jsx'];

/** Resolve a specifier to a file under src/, or null if it is external. */
function resolveSpecifier(specifier, fromFile) {
  let base;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null; // bare package — matched by name, not walked

  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try {
        readFileSync(candidate);
        return candidate;
      } catch {
        /* a directory — try the next extension */
      }
    }
  }
  return null;
}

/**
 * Top-level `import ... from '...'` and `export ... from '...'` specifiers.
 * Dynamic `import('...')` is deliberately NOT matched: it is the fix.
 */
function staticImportsOf(file) {
  const source = readFileSync(file, 'utf8');
  const specifiers = [];
  const pattern = /^\s*(?:import|export)\s[^;]*?\sfrom\s*['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  // Bare side-effect imports: `import '@/lib/x'`
  for (const match of source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

/** Walk the static graph, returning the first path that reaches a forbidden module. */
function findForbiddenPath(entry) {
  const start = join(SRC, entry);
  const seen = new Set([start]);
  const queue = [[start]];

  while (queue.length > 0) {
    const path = queue.shift();
    const file = path[path.length - 1];

    for (const specifier of staticImportsOf(file)) {
      if (FORBIDDEN.some((pattern) => pattern.test(specifier))) {
        return [...path, specifier].map((p) => String(p).replace(SRC, 'src'));
      }
      const next = resolveSpecifier(specifier, file);
      if (!next || seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}

describe('public route bundles', () => {
  it('every listed entry point exists — a typo here would silently test nothing', () => {
    for (const entry of PUBLIC_ENTRIES) {
      expect(existsSync(join(SRC, entry)), `${entry} not found`).toBe(true);
    }
  });

  for (const entry of PUBLIC_ENTRIES) {
    it(`${entry} does not statically reach MSAL`, () => {
      const path = findForbiddenPath(entry);
      expect(
        path,
        path
          ? `MSAL is back in a public graph via:\n  ${path.join('\n  → ')}\n` +
              'Use a dynamic import() inside the function that needs it (see lib/api.js).'
          : ''
      ).toBeNull();
    });
  }

  it('the walker actually detects a forbidden import', () => {
    // Guards the guard. Every assertion above passes vacuously if the walker
    // resolves nothing — a broken alias, a changed extension list — so one
    // module known to import entraAuth statically must come back positive.
    expect(findForbiddenPath('lib/auditLog.js')).not.toBeNull();
  });
});
