/**
 * No app setting may carry a literal secret value (T-723).
 *
 * The `azapi_resource_action` that reads the Function App's settings back
 * exports `["properties"]` — the ENTIRE live settings map — into Terraform
 * state, unredacted and unmarked, and from there into HCP Terraform's plan
 * JSON. The IaC standard says secret values never transit state.
 *
 * That export is safe today, and only because of one property: every
 * secret-shaped setting is a `@Microsoft.KeyVault(SecretUri=…)` reference, so
 * what lands in state is a pointer, not a credential. The first setting written
 * out-of-band with a literal value silently changes that — no plan diff worth
 * noticing, no error, just a credential now living in state and in every plan
 * JSON that follows.
 *
 * The strip resource downstream is where it would surface: it reads the live
 * map back and rewrites it, so a literal secret makes a full round trip through
 * state on every apply.
 *
 * This asserts the invariant rather than the workaround. Marking the export
 * sensitive would hide the value in output; it would not stop a credential
 * being there. Text-read like `cors-platform-origins.test.js` and
 * `timer-catalogue-sync.test.js`, so it fails in CI on a checkout with no Azure
 * credentials and no Terraform binary.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INFRA = join(fileURLToPath(new URL('../../..', import.meta.url)), 'infra');

/**
 * Setting names that read as credential-bearing.
 *
 * Deliberately broad. A false positive costs one allowlist entry with a stated
 * reason; a false negative is a credential in state.
 */
const SECRET_SHAPED = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|CONNECTION_STRING|CONNSTR)/;

/**
 * Secret-shaped names that legitimately hold a non-secret, each with the
 * reason. Adding to this list is a deliberate act, which is the point.
 *
 * One entry, and it has been in and out of this list in a single day, which is
 * the list working rather than the list failing. `KEY_VAULT_URI` left when GCP
 * pricing stopped needing a runtime vault client to READ a secret; it came back
 * for the API-keys page, which WRITES one through a role that cannot read. The
 * "keeps the allowlist honest" case below is what forces the round trip to be
 * deliberate in both directions.
 *
 * Keep this as short as it is. An exception here is a name a reader has to
 * check by hand forever.
 */
const ALLOWED_LITERALS = new Map([
  ['KEY_VAULT_URI', 'the vault address, not a secret — the thing references RESOLVE against'],
]);

/** `"NAME" = <value>` pairs inside the `app_settings = merge({ … })` block. */
function appSettings() {
  const source = readFileSync(join(INFRA, 'main.tf'), 'utf8');
  const start = source.indexOf('app_settings = merge({');
  expect(start, 'app_settings block not found in infra/main.tf').toBeGreaterThan(-1);

  // The block ends at the first line that closes it at the resource's
  // indentation. Bounded by the azapi read-back, which must come after it.
  const end = source.indexOf('resource "azapi_resource_action" "function_app_settings"', start);
  expect(end, 'the azapi read-back should follow the settings block').toBeGreaterThan(start);

  const block = source.slice(start, end);
  return [...block.matchAll(/^\s*"([A-Z][A-Z0-9_]*)"\s*=\s*(.+?)\s*$/gm)].map((m) => ({
    name: m[1],
    value: m[2],
  }));
}

const isVaultReference = (value) => value.includes('@Microsoft.KeyVault(SecretUri=');

describe('function app settings', () => {
  const settings = appSettings();

  it('parses a plausible number of settings — a silent parse failure would pass everything', () => {
    expect(settings.length).toBeGreaterThan(20);
  });

  it('resolves every secret-shaped setting from Key Vault', () => {
    const literals = settings
      .filter(({ name }) => SECRET_SHAPED.test(name))
      .filter(({ name, value }) => !isVaultReference(value) && !ALLOWED_LITERALS.has(name))
      // Report the NAME only. Printing the value would put a credential in a
      // CI log, which is the failure this test exists to prevent.
      .map(({ name }) => name);

    expect(
      literals,
      'secret-shaped app settings that are not Key Vault references. The azapi read-back ' +
        'exports the whole live settings map into Terraform state and plan JSON, so a literal ' +
        'value here becomes a credential in state. Use ' +
        '"@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/NAME)", or add ' +
        'the name to ALLOWED_LITERALS with the reason it is not a secret.'
    ).toEqual([]);
  });

  it('keeps the allowlist honest', () => {
    // An allowlist entry for a setting that no longer exists is a rule nobody
    // is following any more, and it would silently permit the name if it came
    // back meaning something else.
    const names = new Set(settings.map(({ name }) => name));
    for (const [name] of ALLOWED_LITERALS) {
      expect(names.has(name), `${name} is allowlisted but no longer declared`).toBe(true);
    }
  });

  it('still declares the Key Vault references the allowlist is measured against', () => {
    // Guards the guard: if the regex above stopped matching values, every
    // assertion here would pass while checking nothing.
    expect(settings.filter(({ value }) => isVaultReference(value)).length).toBeGreaterThan(10);
  });
});
