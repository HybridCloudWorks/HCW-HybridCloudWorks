/**
 * The lab host's Vault unseals itself with a key that infra/lab-hybrid.tf
 * creates, signing in as the Arc machine that the arc role onboards (#726).
 * Three names cross the boundary between infra/ and lab-host/, and nothing at
 * run time checks them against each other before the owner's migration: the
 * vault role's pre-check would only report a 404 on the host. So they are held
 * together here, with the parts of the grant ADR 0032 makes non-negotiable:
 * never kv-site-prod-cus-01, one key, and a key-scoped role that can wrap,
 * unwrap and read the key and nothing more.
 *
 * In the CI matrix this runs in the `scripts (operations)` row, whose filter
 * covers infra/ and lab-host/.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

const labHybrid = read('infra/lab-hybrid.tf');
const variables = read('infra/variables.tf');
const roleDefaults = read('lab-host/ansible/roles/vault/defaults/main.yml');
const groupVars = read('lab-host/ansible/group_vars/all.yml');
const sealTemplate = read('lab-host/ansible/roles/vault/templates/vault.hcl.j2');

/** A top-level `key: value` from a YAML file, unquoted, ignoring a trailing comment. */
function yamlScalar(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*"?([^"\\n#]*?)"?\\s*(?:#.*)?$`, 'm'));
  expect(match, `${key} is not set as a plain scalar`).not.toBeNull();
  return match[1];
}

/** A variable's string default in infra/variables.tf. */
function variableDefault(name) {
  const match = variables.match(new RegExp(`variable "${name}" \\{[\\s\\S]*?default\\s*=\\s*"([^"]+)"`));
  expect(match, `no string default for var.${name}`).not.toBeNull();
  return match[1];
}

/** One top-level block of lab-hybrid.tf, up to its closing brace. */
function block(header) {
  const start = labHybrid.indexOf(header);
  expect(start, `${header} is not in infra/lab-hybrid.tf`).toBeGreaterThanOrEqual(0);
  const end = labHybrid.indexOf('\n}\n', start);
  return labHybrid.slice(start, end + 2);
}

/** A Terraform string template with the two naming variables at their defaults. */
function resolve(template) {
  return template
    .replaceAll('${var.environment}', variableDefault('environment'))
    .replaceAll('${var.region_abbreviation}', variableDefault('region_abbreviation'));
}

const vault = block('resource "azurerm_key_vault" "lab_hybrid"');
const key = block('resource "azapi_resource" "lab_hybrid_vault_seal_key"');
const arc = block('data "azapi_resource" "lab_hybrid_arc_machine"');
const grant = block('resource "azurerm_role_assignment" "lab_hybrid_vault_seal"');

describe('the seal key the vault role uses is the one infra/ creates', () => {
  it('names the same vault, which fits Key Vault and is not the production vault', () => {
    const name = resolve(vault.match(/^\s*name\s*=\s*"([^"]+)"/m)[1]);
    expect(yamlScalar(roleDefaults, 'vault_seal_azurekeyvault_vault_name')).toBe(name);
    expect(name.length).toBeLessThanOrEqual(24);
    expect(name).toMatch(/^[a-zA-Z](?!.*--)[a-zA-Z0-9-]{1,22}[a-zA-Z0-9]$/);
    expect(name).not.toBe(variableDefault('key_vault_name'));
  });

  it('names the same key', () => {
    const name = key.match(/^\s*name\s*=\s*"([^"]+)"/m)[1];
    expect(yamlScalar(roleDefaults, 'vault_seal_azurekeyvault_key_name')).toBe(name);
  });

  it('reads the Arc machine the arc role onboards, in the lab group', () => {
    const id = resolve(arc.match(/resource_id\s*=\s*"([^"]+)"/)[1]);
    expect(id).toContain(`/resourceGroups/${yamlScalar(groupVars, 'arc_resource_group')}/`);
    expect(id.endsWith(`/Microsoft.HybridCompute/machines/${yamlScalar(groupVars, 'arc_resource_name')}`)).toBe(true);
  });
});

describe('the grant is the narrow one ADR 0032 allows', () => {
  it('is scoped to the key, never the vault', () => {
    expect(grant).toMatch(/^\s*scope\s*=\s*azapi_resource\.lab_hybrid_vault_seal_key\.id$/m);
  });

  it('is Key Vault Crypto Service Encryption User, for a service principal', () => {
    expect(grant).toMatch(/role_definition_name\s*=\s*"Key Vault Crypto Service Encryption User"/);
    expect(grant).toMatch(/principal_type\s*=\s*"ServicePrincipal"/);
  });

  it('is the only role assignment on anything in the lab vault', () => {
    const scopes = [...labHybrid.matchAll(/^\s*scope\s*=\s*(\S+)$/gm)].map((m) => m[1]);
    expect(scopes.filter((s) => s.includes('lab_hybrid_vault_seal_key') || s.includes('azurerm_key_vault.lab_hybrid'))).toEqual([
      'azapi_resource.lab_hybrid_vault_seal_key.id',
    ]);
  });

  it('gives the key the two operations the seal calls and no others', () => {
    expect(key).toMatch(/keyOps\s*=\s*\["wrapKey", "unwrapKey"\]/);
  });

  it('protects the key and the vault from a Terraform destroy, and the vault from a purge', () => {
    expect(key).toMatch(/prevent_destroy\s*=\s*true/);
    expect(vault).toMatch(/prevent_destroy\s*=\s*true/);
    expect(vault).toMatch(/purge_protection_enabled\s*=\s*true/);
    expect(vault).toMatch(/rbac_authorization_enabled\s*=\s*true/);
  });
});

describe('the seal stanza stores no credential', () => {
  it('writes neither a client secret nor a client id', () => {
    // No secret: the whole point. No client id either: with one, Azure's
    // credential chain asks for a user-assigned identity, which an Arc
    // machine refuses ("Azure Arc doesn't support user-assigned managed
    // identities", MSAL for Go 1.6.0).
    const stanza = sealTemplate.slice(sealTemplate.indexOf('seal "azurekeyvault"'));
    expect(stanza).not.toMatch(/^\s*client_secret\s*=/m);
    expect(stanza).not.toMatch(/^\s*client_id\s*=/m);
  });
});
