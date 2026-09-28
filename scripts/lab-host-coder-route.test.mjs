/**
 * Coder's pages send their own Content-Security-Policy, and its default
 * `frame-ancestors 'self'` would keep them out of the site's panes, because a
 * browser enforces every policy it receives. The coder role's Caddy route
 * (lab-host/ansible/roles/coder/templates/10-coder.caddy.j2) removes that one
 * directive with `header >Content-Security-Policy "<find>" ""`, and the pinned
 * Caddy reads <find> as a Go regular expression (`caddy adapt` shows
 * "search_regexp").
 *
 * Coder v2.37.3 writes its directives in an order that changes from one
 * response to the next, and the last one has no trailing space. With the
 * space required, 7 of 40 pane loads of /login kept Coder's frame-ancestors
 * (measured 2026-09-28 against the pinned image behind the pinned Caddy). So
 * this holds the route's find to both positions, and to leaving the consent
 * page's `frame-ancestors 'none'` alone.
 *
 * In the CI matrix this runs in the `scripts (operations)` row, whose filter
 * covers lab-host/.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const route = readFileSync(
  path.join(repoRoot, 'lab-host/ansible/roles/coder/templates/10-coder.caddy.j2'),
  'utf8'
);

const found = route.match(/^\s*header >Content-Security-Policy "([^"]+)" ""$/m);
/** What Caddy does with the route's find: Go's ReplaceAllString, which a JS global regex matches for this pattern. */
const applyRoute = (csp) => csp.replace(new RegExp(found[1], 'g'), '');

// Coder's policy as v2.37.3 sent it, directives abridged, in two of the orders seen.
const MIDDLE =
  "child-src 'self'; frame-ancestors 'self'; default-src 'self'; frame-src 'self' *.coder.lab.hybridcloudworks.com; ";
const LAST =
  "child-src 'self'; default-src 'self'; frame-src 'self' *.coder.lab.hybridcloudworks.com; frame-ancestors 'self';";
const CONSENT = "default-src 'self'; frame-ancestors 'none'; ";

describe("the coder route's CSP rewrite", () => {
  it('is one header replacement in the route', () => {
    expect(found, 'no `header >Content-Security-Policy "<find>" ""` line in the route').not.toBeNull();
  });

  it.each([
    ['in the middle', MIDDLE],
    ['last, with no trailing space', LAST],
  ])("removes Coder's frame-ancestors 'self' %s", (_where, csp) => {
    const rewritten = applyRoute(csp);
    expect(rewritten).not.toMatch(/frame-ancestors/);
    expect(rewritten).toContain("frame-src 'self' *.coder.lab.hybridcloudworks.com;");
    expect(rewritten).toContain("default-src 'self';");
  });

  it("leaves the consent page's frame-ancestors 'none' as it is", () => {
    expect(applyRoute(CONSENT)).toBe(CONSENT);
  });
});
