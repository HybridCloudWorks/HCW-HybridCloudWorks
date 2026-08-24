/**
 * The platform CORS allowlist and the in-code one must agree.
 *
 * Two allowlists drifting was the stated reason DECISION 7 removed the platform
 * block in the first place, and the objection was sound. What was wrong was the
 * conclusion: removing it does not hand preflight handling back to the
 * application, because the Functions host answers a genuine preflight — OPTIONS
 * carrying both `Origin` and `Access-Control-Request-Method` — itself. With no
 * origins configured it answers 204 with no Access-Control-* headers, and every
 * browser rejects that.
 *
 * That shipped. On 2026-08-23 the admin portal authenticated successfully and
 * then every API call failed with "Failed to fetch", with nothing server-side to
 * show for it, because the in-code preflight response was correct and never ran.
 *
 * So both lists exist, and this is what stops them drifting. The in-code list
 * remains authoritative for actual requests — it 403s a disallowed origin and it
 * owns the localhost rule. The platform list exists only so the host can answer
 * a preflight, and it has to cover everything the in-code list covers or a
 * browser is refused before the application is ever consulted.
 *
 * Read from main.tf as text rather than from Terraform state: this has to fail
 * in CI, on a checkout, with no Azure credentials.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN_TF = join(fileURLToPath(new URL('../../../..', import.meta.url)), 'infra', 'main.tf');

/** The literal origins inside site_config's `cors { allowed_origins = ... }`. */
function platformOrigins() {
  const source = readFileSync(MAIN_TF, 'utf8');
  const block = /cors\s*\{\s*allowed_origins\s*=\s*concat\(([\s\S]*?)\)\s*\n\s*support_credentials/.exec(
    source
  );
  expect(block, 'no cors { allowed_origins = concat(...) } block found in infra/main.tf').not.toBeNull();
  return [...block[1].matchAll(/"(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
}

/** The in-code lists, read the same way so the test needs no exports added. */
function inCodeOrigins() {
  const source = readFileSync(new URL('./cors.js', import.meta.url), 'utf8');
  // Sliced rather than matched with a built regex. A dynamic pattern here has
  // to survive a template literal, where a backslash escape collapses before
  // RegExp ever sees it — `\[` becomes `[`, the pattern loses its escaping,
  // and the failure is a SyntaxError about an unmatched paren rather than
  // anything to do with CORS.
  const grab = (name) => {
    const marker = `const ${name} = [`;
    const from = source.indexOf(marker);
    expect(from, `${name} not found in cors.js`).toBeGreaterThan(-1);
    const to = source.indexOf(']', from);
    return [...source.slice(from, to).matchAll(/'(https?:\/\/[^']+)'/g)].map((m) => m[1]);
  };
  return [...grab('PRODUCTION_ORIGINS'), ...grab('PREVIEW_ORIGINS')];
}

describe('platform CORS allowlist', () => {
  it('exists at all — without it the host answers every preflight with a bare 204', () => {
    expect(platformOrigins().length).toBeGreaterThan(0);
  });

  it('covers every origin the in-code allowlist covers', () => {
    // A browser refused at the preflight never reaches the application, so an
    // origin missing here is invisible to every server-side check and log.
    const platform = platformOrigins();
    const missing = inCodeOrigins().filter((origin) => !platform.includes(origin));
    expect(
      missing,
      'origins allowed in cors.js but not by the platform — browsers will be refused at the preflight'
    ).toEqual([]);
  });

  it('adds no origin the in-code allowlist would reject', () => {
    // The reverse drift is quieter and worse: the preflight succeeds, the browser
    // sends the real request, and the application 403s it. That reads as a broken
    // API rather than a rejected origin.
    const inCode = inCodeOrigins();
    const extra = platformOrigins().filter((origin) => !inCode.includes(origin));
    expect(extra, 'origins the platform allows that cors.js does not').toEqual([]);
  });

  it('does not enable support_credentials', () => {
    // A bearer-token API, not a cookie API — and true widens what the platform
    // intercepts well beyond preflights.
    const source = readFileSync(MAIN_TF, 'utf8');
    expect(source).toMatch(/support_credentials\s*=\s*false/);
    expect(source).not.toMatch(/support_credentials\s*=\s*true/);
  });
});
