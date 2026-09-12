/**
 * The two things about this config that must never silently change (#516).
 *
 * `msalConfig.js` is the whole of the SPA's identity configuration and none of
 * it was pinned. The authority in particular defaulted to `common` when the
 * tenant variable was empty, which is a value that *works* — it authenticates
 * anyone in any Microsoft directory — and then fails on every API call. A test
 * is the only thing that distinguishes "configured" from "configured wrongly
 * but plausibly" here.
 *
 * Env is stubbed rather than read, and modules are reset between cases, because
 * `msalConfig` reads `import.meta.env` once at module scope.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const TENANT = '1a2fce27-b5f6-43c7-a86e-cf0bb74d4672';
const CLIENT = 'ac696e96-e203-47be-ade8-c35ece8a6c4a';

async function loadConfig(env) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('./msalConfig.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the authority', () => {
  it('is the configured tenant when one is set', async () => {
    const { msalConfig } = await loadConfig({
      VITE_ENTRA_TENANT_ID: TENANT,
      VITE_ENTRA_CLIENT_ID: CLIENT,
    });
    expect(msalConfig.auth.authority).toBe(`https://login.microsoftonline.com/${TENANT}`);
  });

  // The regression this file exists for. `common` accepts a sign-in from every
  // Entra tenant and every personal Microsoft account; `organizations` and
  // `consumers` are the same mistake wearing different hats.
  it.each(['common', 'organizations', 'consumers'])(
    'never falls back to %s when the tenant is missing',
    async (multiTenant) => {
      const { msalConfig } = await loadConfig({
        VITE_ENTRA_TENANT_ID: '',
        VITE_ENTRA_CLIENT_ID: CLIENT,
      });
      expect(msalConfig.auth.authority).not.toContain(multiTenant);
    }
  );

  it('resolves to an authority that cannot authenticate anyone when unset', async () => {
    const { msalConfig } = await loadConfig({
      VITE_ENTRA_TENANT_ID: '',
      VITE_ENTRA_CLIENT_ID: CLIENT,
    });
    // A GUID that is not a tenant: MSAL fails at authority resolution, which
    // surfaces as the sign-in card rather than as a signed-in-but-broken app.
    expect(msalConfig.auth.authority).toBe(
      'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000'
    );
  });
});

describe('the API token request', () => {
  it('asks for the configured scope, and nothing else', async () => {
    const scope = `api://${CLIENT}/access_as_admin`;
    const { apiTokenRequest } = await loadConfig({
      VITE_ENTRA_TENANT_ID: TENANT,
      VITE_ENTRA_CLIENT_ID: CLIENT,
      VITE_ENTRA_API_SCOPE: scope,
    });
    // The scope is what puts `access_as_admin` in the token's `scp` claim, and
    // since #515 the API rejects a token without it.
    expect(apiTokenRequest.scopes).toEqual([scope]);
  });
});
