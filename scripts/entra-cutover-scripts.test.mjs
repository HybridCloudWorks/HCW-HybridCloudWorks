/**
 * The production Entra scripts list no localhost, and nothing plain-http.
 *
 * PowerShell is otherwise untested in this repository, and these are the files
 * that rewrite the tenant. `functions/src/lib/auth/cors.js` already argues the
 * case at length:
 *
 *   LOCALHOST DOES NOT SURVIVE TO PRODUCTION. [...] `http://localhost:5173` in
 *   a production allowlist means any page running on a victim's machine — a
 *   malicious local dev server, a compromised `npm postinstall`, a rogue
 *   Electron app — can make cross-origin calls to production carrying the
 *   victim's token.
 *
 * It applies with more force to a redirect URI: a process listening on
 * 127.0.0.1 can complete an authorization-code redirect for the production
 * client id and receive the code. And unlike CORS, an app registration has no
 * `NODE_ENV` to gate it on — the only control is not listing it (#521).
 *
 * This is the "single plausible-looking line that no other test in this
 * repository would notice" that `msal-not-on-public-routes.test.js` exists to
 * catch, applied to the one place where getting it wrong changes the tenant.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, 'cutover', name), 'utf8');

/** Scripts that write the registration real users sign in with. */
const PRODUCTION_SCRIPTS = ['01-entra-api.ps1', '02-entra-spa-client.ps1'];

/** The one script allowed to mention localhost, and the reason it exists. */
const DEV_SCRIPT = '03-entra-dev-client.ps1';

describe.each(PRODUCTION_SCRIPTS)('%s', (name) => {
  const source = read(name);

  it('lists no localhost redirect URI', () => {
    // Matched as a URL, not a bare word: the files talk *about* localhost in
    // their comments on purpose, and forbidding the word would push the reason
    // out of the file that needs it most.
    expect(source).not.toMatch(/https?:\/\/(localhost|127\.0\.0\.1)/i);
  });

  it('lists no plain-http URI, in quotes of either kind', () => {
    // Comments are stripped first rather than the quotes being matched: these
    // files discuss `http://localhost` at length on purpose, and an assertion
    // that only understood single quotes would wave through a double-quoted
    // one. Strip what is explanation, then nothing plain-http may remain.
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')
      .replace(/<#[\s\S]*?#>/g, '');

    expect(code).not.toMatch(/http:\/\//i);
  });
});

describe(DEV_SCRIPT, () => {
  const source = read(DEV_SCRIPT);

  // The point of the dev registration is that localhost lives HERE and nowhere
  // else. A version of this file without it would silently push the problem
  // back to production.
  it('is where localhost lives', () => {
    expect(source).toMatch(/http:\/\/localhost:5173\/auth\/callback/);
    expect(source).toMatch(/http:\/\/localhost:4173\/auth\/callback/);
  });

  it('says it is local-only, so nobody promotes the id it prints', () => {
    expect(source).toMatch(/frontend\/\.env/);
    expect(source).toMatch(/never reach a repository variable/i);
  });
});

describe('the split into a client and a resource (#522)', () => {
  it('keeps the single-registration rationale, struck through rather than deleted', () => {
    const spa = read('02-entra-spa-client.ps1');
    // The argument was sound and somebody will re-derive it otherwise. Keeping
    // it visible with the reason it was reversed is what stops that.
    expect(spa).toContain('~~');
    expect(spa).toMatch(/highest-risk mismatch/);
  });

  it('does not change the API audience, which is the thing most likely to be got wrong', () => {
    const spa = read('02-entra-spa-client.ps1');
    expect(spa).toMatch(/ENTRA_API_AUDIENCE and/);
    expect(spa).toMatch(/ONLY value that changes/i);
  });

  it('assigns the app role on the API, not on the client', () => {
    const api = read('01-entra-api.ps1');
    expect(api).toMatch(/assigned on the API app's SERVICE PRINCIPAL/);
    // And the client half must not try to define roles of its own.
    expect(read('02-entra-spa-client.ps1')).not.toMatch(/appRoles/);
  });
});
