/**
 * The build refuses to ship a misconfigured sign-in (#516).
 *
 * `assertDeployConfig` is exported from `vite.config.js` specifically so it can
 * be tested as a pure function. Do NOT switch this to invoking the default
 * export: the config factory calls `loadEnv(mode, process.cwd(), '')`, so a
 * developer's local `frontend/.env` would leak into the assertions and the
 * result would depend on whose machine ran them.
 */
import { describe, it, expect } from 'vitest';

import { assertDeployConfig } from '../../vite.config.js';

const TENANT = '1a2fce27-b5f6-43c7-a86e-cf0bb74d4672';
const CLIENT = 'ac696e96-e203-47be-ade8-c35ece8a6c4a';

const good = () => ({
  VITE_AZURE_FUNCTIONS_URL: '/api',
  VITE_ENTRA_CLIENT_ID: CLIENT,
  VITE_ENTRA_TENANT_ID: TENANT,
  VITE_ENTRA_API_SCOPE: `api://${CLIENT}/access_as_admin`,
});

describe('a complete deploy configuration', () => {
  it('passes', () => {
    expect(() => assertDeployConfig(good())).not.toThrow();
  });
});

describe('each variable is required', () => {
  it.each([
    'VITE_AZURE_FUNCTIONS_URL',
    'VITE_ENTRA_CLIENT_ID',
    'VITE_ENTRA_TENANT_ID',
    'VITE_ENTRA_API_SCOPE',
  ])('refuses the build when %s is missing', (key) => {
    expect(() => assertDeployConfig({ ...good(), [key]: undefined })).toThrow(key);
  });

  it('refuses an empty string as readily as an absent key', () => {
    expect(() => assertDeployConfig({ ...good(), VITE_ENTRA_TENANT_ID: '   ' })).toThrow(
      /VITE_ENTRA_TENANT_ID/
    );
  });

  // Every check here trims, and the API base was the one that did not — an
  // all-whitespace value is how a variable set from a broken shell expansion
  // arrives, and untrimmed it is truthy enough to be baked into the bundle.
  it('refuses an all-whitespace API base, which is truthy but useless', () => {
    expect(() => assertDeployConfig({ ...good(), VITE_AZURE_FUNCTIONS_URL: '   ' })).toThrow(
      /VITE_AZURE_FUNCTIONS_URL/
    );
  });
});

// The regression. These are the values a reader of the old .env.example was
// most likely to paste in, and every one of them is non-empty, so a presence
// check would have waved all three through.
describe('a multi-tenant authority is not a tenant', () => {
  it.each(['common', 'organizations', 'consumers'])('refuses %s as the tenant', (value) => {
    expect(() => assertDeployConfig({ ...good(), VITE_ENTRA_TENANT_ID: value })).toThrow(
      /must be a GUID/
    );
  });

  it('refuses a client id that is not a GUID', () => {
    expect(() => assertDeployConfig({ ...good(), VITE_ENTRA_CLIENT_ID: 'HCWSite SPA' })).toThrow(
      /VITE_ENTRA_CLIENT_ID/
    );
  });

  // The nil UUID satisfies the GUID shape, so it slipped through the first
  // version of this validator — while being the exact value msalConfig.js
  // falls back to *because* it can never authenticate anyone. The build must
  // not ship the sentinel the runtime uses to mean "misconfigured".
  it.each(['VITE_ENTRA_TENANT_ID', 'VITE_ENTRA_CLIENT_ID'])(
    'refuses the nil UUID as %s, though it is GUID-shaped',
    (key) => {
      expect(() =>
        assertDeployConfig({ ...good(), [key]: '00000000-0000-0000-0000-000000000000' })
      ).toThrow(key);
    }
  );
});

describe('the API scope', () => {
  it('refuses a Graph scope, which produces a token this API rejects', () => {
    expect(() => assertDeployConfig({ ...good(), VITE_ENTRA_API_SCOPE: 'User.Read' })).toThrow(
      /api:\/\//
    );
  });

  // `/.default` is a real delegated request shape, just not this
  // registration's. The lever for that is the documentation, not the build —
  // failing here would block a legitimate configuration.
  it('allows /.default rather than second-guessing the operator', () => {
    expect(() =>
      assertDeployConfig({ ...good(), VITE_ENTRA_API_SCOPE: `api://${CLIENT}/.default` })
    ).not.toThrow();
  });

  // The prefix on its own names no resource and no permission. Well-formed and
  // useless is still useless.
  it('refuses a bare api:// with nothing after it', () => {
    expect(() => assertDeployConfig({ ...good(), VITE_ENTRA_API_SCOPE: 'api://' })).toThrow(
      /VITE_ENTRA_API_SCOPE/
    );
  });
});

describe('the error names every problem at once', () => {
  it('so three missing variables do not cost three deploy attempts', () => {
    let message = '';
    try {
      assertDeployConfig({ VITE_AZURE_FUNCTIONS_URL: '/api' });
    } catch ({ message: thrownMessage }) {
      message = thrownMessage;
    }
    expect(message).toContain('VITE_ENTRA_CLIENT_ID');
    expect(message).toContain('VITE_ENTRA_TENANT_ID');
    expect(message).toContain('VITE_ENTRA_API_SCOPE');
    expect(message).toContain('3 configuration problem(s)');
  });
});
