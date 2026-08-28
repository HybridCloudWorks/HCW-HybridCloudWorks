/**
 * Every public route App.jsx declares must be pre-rendered (T-737).
 *
 * Eleven indexable routes were declared and reached neither disk nor the
 * sitemap — `/tools/*`, `/finops/tools`, `/finops/focus`, `/terraform/modules`,
 * `/terraform/tools`, `/github/workflows`, `/github/tools`, `/templates/*`.
 * They fell through to `app-shell.html`, which has a generic title and no
 * canonical, so a crawler that found one got the same untitled shell as for
 * everything else.
 *
 * `prerender-entry.jsx` derives `/:provider/<section>` from `VALID_PROVIDERS`
 * precisely so that list cannot go stale — its own comment says "a
 * hand-maintained list is how a route quietly stops being pre-rendered". The
 * standalone routes could not be derived that way, so they ARE a hand-
 * maintained list, and this test is what the derivation was doing for the rest:
 * adding a route to App.jsx and forgetting to pre-render it fails here rather
 * than shipping an untitled page.
 *
 * Deliberately excluded, and asserted as such below, because "not pre-rendered"
 * is the correct answer for them:
 *   - `/admin/*`   — behind Entra sign-in, no search value, and pre-rendering
 *                    would publish the shell of a private UI.
 *   - `/preview/:id` — the signed staging view (T-606). A pre-rendered preview
 *                    would publish an unpublished draft to disk.
 *   - parameterised routes — `:slug` detail pages come from the content
 *                    manifest, not from this enumeration (#175).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { routes } from '../../scripts/prerender-entry.jsx';
import { VALID_PROVIDERS } from '@/context/ProviderContext';

const APP = () => readFileSync(join(process.cwd(), 'src', 'App.jsx'), 'utf8');

/** Absolute `path="..."` values declared on a <Route> in App.jsx. */
function declaredAbsolutePaths() {
  return [...APP().matchAll(/<Route\s+path="(\/[^"]*)"/g)].map((m) => m[1]);
}

/** Routes that must never be pre-rendered, with the reason each is excluded. */
const NEVER_PRERENDER = [
  { prefix: '/admin', why: 'private UI behind Entra sign-in' },
  { prefix: '/preview', why: 'signed staging view of an UNPUBLISHED draft (T-606)' },
];

const isParameterised = (path) => path.includes(':') || path.includes('*');

describe('pre-render coverage', () => {
  const prerendered = new Set(routes());

  it('reads a plausible set of routes from both sides', () => {
    // Both halves of every assertion below are derived, so a regex that stops
    // matching would make this file pass while checking nothing.
    expect(declaredAbsolutePaths().length).toBeGreaterThan(15);
    expect(prerendered.size).toBeGreaterThan(50);
  });

  it('pre-renders every non-parameterised public route App.jsx declares', () => {
    const missing = declaredAbsolutePaths()
      .filter((path) => !isParameterised(path))
      .filter((path) => !NEVER_PRERENDER.some(({ prefix }) => path.startsWith(prefix)))
      .filter((path) => !prerendered.has(path));

    expect(
      [...new Set(missing)],
      'declared in App.jsx but not pre-rendered — these fall back to app-shell.html, ' +
        'which has a generic title and no canonical. Add them to STANDALONE_ROUTES in ' +
        'scripts/prerender-entry.jsx, or exclude them deliberately in NEVER_PRERENDER here.'
    ).toEqual([]);
  });

  it('pre-renders nothing private', () => {
    for (const { prefix, why } of NEVER_PRERENDER) {
      const leaked = [...prerendered].filter((path) => path.startsWith(prefix));
      expect(leaked, `${prefix} must not be pre-rendered: ${why}`).toEqual([]);
    }
  });

  it('pre-renders no route that does not exist', () => {
    // The other direction. A stale entry renders a page that no longer has a
    // route, which pre-renders as the NotFound view and publishes a 200-status
    // "not found" page — a soft 404, the exact defect Migration_Plan §3.4 was
    // about.
    const declared = new Set(declaredAbsolutePaths());
    // Relative children of the `/:provider` block: `blog`, `code`, `news`…
    const providerSections = new Set(
      [...APP().matchAll(/<Route\s+path="([^"/:*][^"]*)"/g)].map((m) => m[1])
    );

    const phantom = [...prerendered]
      .filter((path) => path !== '/')
      // Manifest-supplied detail routes are not declared literally.
      .filter((path) => path.split('/').filter(Boolean).length <= 2)
      .filter((path) => {
        if (declared.has(path)) return false;
        const [provider, section] = path.slice(1).split('/');
        // `/azure` is served by the parameterised `/:provider`, and
        // `/azure/blog` by its relative `blog` child — neither appears as a
        // literal absolute path, which is the whole reason for this branch.
        if (!VALID_PROVIDERS.includes(provider)) return true;
        return section ? !providerSections.has(section) : false;
      });

    expect([...new Set(phantom)], 'pre-rendered but not declared in App.jsx').toEqual([]);
  });
});
