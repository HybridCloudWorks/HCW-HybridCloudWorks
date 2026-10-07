/**
 * The Terraform run identity's grants, held to what infra/ actually declares
 * (estate review 2026-10-06, finding SEC-1).
 *
 * `scripts/bootstrap-terraform-oidc.ps1` grants `id-plat-terraform-prod-cus-01`
 * Contributor on each resource group infra/ declares, and a custom
 * subscription-scope role for the few things infra/ does above a group.
 * Both lists live in `scripts/terraform-identity-grants.json`. They are
 * copies of facts that live in `infra/*.tf`, and a copy drifts in the
 * direction nobody sees until an apply: a group added to infra/ and not to
 * the JSON is a group Terraform can create and then cannot fill, and the
 * failure is `AuthorizationFailed` on the owner's confirmation, naming a
 * resource rather than the missing grant. So the copies are compared here,
 * from the HCL, on every run.
 *
 * And `scripts/Set-TerraformRbacCondition.ps1` says "nothing in infra/
 * assigns a denied role". That sentence is a contract: an infra/ change that
 * assigns a denied role plans cleanly and is refused at apply. It is
 * enforced here too.
 *
 * Text, not a parser, like the other infra checks in this package
 * (terraform-source.mjs): every value read below is a literal on its own
 * line, and each reader asserts it found something, so a regex that rots
 * fails loudly instead of comparing two empty lists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { terraformSource, INFRA } from './terraform-source.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const grants = JSON.parse(readFileSync(join(SCRIPTS, 'terraform-identity-grants.json'), 'utf8'));
const source = terraformSource();
const variables = readFileSync(join(INFRA, 'variables.tf'), 'utf8');
const conditionScript = readFileSync(join(SCRIPTS, 'Set-TerraformRbacCondition.ps1'), 'utf8');
const bootstrapScript = readFileSync(join(SCRIPTS, 'bootstrap-terraform-oidc.ps1'), 'utf8');

/**
 * The HCP Terraform project in the federated-credential subject has one
 * documented value, and the script's default must be that value: on
 * 2026-10-07 the default, the runbook and backend.tf all said one project while
 * the live workspace sat in another, and a re-run would have replaced the
 * credentials silently. This pins the default to the two documents an operator
 * reads first, so the three cannot drift apart again; which project is RIGHT
 * is read off the workspace's Settings page, not from any of them.
 */
describe('the OIDC project default', () => {
  const scriptDefault = bootstrapScript.match(/^\s*\[string\] \$TfcProject = '([^']+)',/m)[1];
  const backend = readFileSync(join(SCRIPTS, '..', 'infra', 'backend.tf'), 'utf8');
  const backendProject = backend.match(/^# Org: hcw \| Project: ([^|]+?) \| Workspace: hcw-azure$/m)[1];
  const runbook = readFileSync(join(SCRIPTS, '..', 'docs', 'runbooks', 'deployment-runbook.md'), 'utf8');
  const runbookProject = runbook.match(/org `hcw`, project `([^`]+)`, workspace `hcw-azure`/)[1];

  it('is the project backend.tf and the deployment runbook name', () => {
    expect(scriptDefault).toBe(backendProject);
    expect(scriptDefault).toBe(runbookProject);
  });

  it('is replaced on the identity only when asked', () => {
    expect(bootstrapScript).toMatch(/\[switch\] \$ReplaceFederatedCredentials/);
    expect(bootstrapScript).toMatch(/if \(-not \$ReplaceFederatedCredentials\) \{\s*Stop-WithGuidance/);
  });
});

/** Every `resource "<type>" "<label>" { ... }` block, braces balanced. */
function resourceBlocks(text, type) {
  const out = [];
  const head = new RegExp(`^resource\\s+"${type}"\\s+"(\\w+)"\\s*\\{`, 'gm');
  for (const m of text.matchAll(head)) {
    let depth = 0;
    let end = m.index;
    for (let i = m.index; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    out.push({ label: m[1], body: text.slice(m.index, end + 1) });
  }
  return out;
}

/** A variable's string default from infra/variables.tf. */
function stringDefault(name) {
  const m = variables.match(
    new RegExp(`variable\\s+"${name}"\\s*\\{[^}]*?\\bdefault\\s*=\\s*"([^"]*)"`, 's')
  );
  if (!m) throw new Error(`variable "${name}" has no string default in infra/variables.tf`);
  return m[1];
}

/** The keys of `local.app_resource_groups` in main.tf. */
function appResourceGroupKeys() {
  const m = source.match(/app_resource_groups\s*=\s*\{([\s\S]*?)\n {2}\}/);
  if (!m) throw new Error('local.app_resource_groups not found in infra/');
  return [...m[1].matchAll(/^\s{4}(\w+)\s*=/gm)].map((k) => k[1]);
}

const SLOT_BY_PROVIDER = { '': 'app', mgmt: 'mgmt', conn: 'conn' };

/** Which subscription slot a resource block lands in, from its provider alias. */
function blockSlot(label, body) {
  const alias = body.match(/^\s*provider\s*=\s*azurerm\.(\w+)/m)?.[1] ?? '';
  const slot = SLOT_BY_PROVIDER[alias];
  if (!slot) throw new Error(`azurerm_resource_group.${label} uses provider alias "${alias}", which has no slot`);
  return slot;
}

/** A name template with `${each.key}` and the naming variables substituted. */
function resolveName(label, template, key, values) {
  return template.replace(/\$\{([^}]+)\}/g, (whole, expr) => {
    if (expr === 'each.key' && key) return key;
    if (expr in values) return values[expr];
    throw new Error(`azurerm_resource_group.${label}: cannot resolve ${whole} in "${template}"`);
  });
}

/** The names one azurerm_resource_group block creates. */
function blockNames(label, body, values) {
  const template = body.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
  if (!template) throw new Error(`azurerm_resource_group.${label} has no literal name template`);
  const keys = /for_each\s*=\s*local\.app_resource_groups/.test(body) ? appResourceGroupKeys() : [null];
  return keys.map((key) => resolveName(label, template, key, values));
}

/** slot -> sorted resource group names, as infra/ would create them with its defaults. */
function declaredResourceGroups() {
  const values = {
    'var.workload_name': stringDefault('workload_name'),
    'var.environment': stringDefault('environment'),
    'var.region_abbreviation': stringDefault('region_abbreviation'),
  };
  const blocks = resourceBlocks(source, 'azurerm_resource_group');
  if (blocks.length === 0) throw new Error('no azurerm_resource_group blocks found — the regex has rotted');
  const bySlot = { app: [], mgmt: [], conn: [] };
  for (const { label, body } of blocks) {
    bySlot[blockSlot(label, body)].push(...blockNames(label, body, values));
  }
  return Object.fromEntries(Object.entries(bySlot).map(([slot, names]) => [slot, names.sort()]));
}

/** The names in a PowerShell `$Name = @( 'a', 'b' )` array. */
function psArray(text, name) {
  const m = text.match(new RegExp(`\\$${name}\\s*=\\s*@\\(([\\s\\S]*?)\\)`));
  if (!m) throw new Error(`$${name} not found`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((s) => s[1]);
}

describe('Contributor on the resource groups infra/ declares', () => {
  const declared = declaredResourceGroups();

  it('reads a plausible set of groups from infra/ at all', () => {
    // Guards the guard: nine groups across three subscriptions on 2026-10-07.
    const total = Object.values(declared).flat().length;
    expect(total).toBeGreaterThanOrEqual(9);
    expect(declared.mgmt.length).toBeGreaterThan(0);
    expect(declared.conn.length).toBeGreaterThan(0);
  });

  it('lists exactly the groups infra/ creates, in the subscription that holds each', () => {
    const listed = Object.fromEntries(
      Object.entries(grants.resourceGroups).map(([slot, names]) => [slot, [...names].sort()])
    );
    expect(
      listed,
      'scripts/terraform-identity-grants.json "resourceGroups" differs from the azurerm_resource_group ' +
        'blocks in infra/. A group missing from the JSON is one Terraform can create and then cannot ' +
        'put anything in. Add it there in the same change, and see the bootstrap script, section 5, ' +
        'for the extra pass a new group needs.'
    ).toEqual(declared);
  });
});

describe('the subscription-scope custom role', () => {
  const role = grants.subscriptionRole;

  it('registers exactly the providers var.azure_resource_providers lists', () => {
    const block = variables.match(/variable\s+"azure_resource_providers"\s*\{[\s\S]*?default\s*=\s*\[([\s\S]*?)\]/);
    expect(block, 'variable "azure_resource_providers" not found').not.toBeNull();
    const providers = [...block[1].matchAll(/"([^"]+)"/g)].map((p) => p[1]).sort();
    expect(providers.length).toBeGreaterThan(5);
    const registers = role.Actions.filter((a) => a.endsWith('/register/action'))
      .map((a) => a.replace(/\/register\/action$/, ''))
      .sort();
    expect(registers).toEqual(providers);
  });

  it('cannot delete a resource group, write authorization, or reach a data plane', () => {
    const lower = role.Actions.map((a) => a.toLowerCase());
    expect(lower).not.toContain('microsoft.resources/subscriptions/resourcegroups/delete');
    expect(lower.filter((a) => a.includes('*'))).toEqual([]);
    expect(lower.filter((a) => a.startsWith('microsoft.authorization/'))).toEqual([]);
    expect(role.DataActions).toEqual([]);
  });

  it('can create the groups and keep the budgets infra/ declares at subscription scope', () => {
    expect(role.Actions).toContain('Microsoft.Resources/subscriptions/resourceGroups/write');
    expect(role.Actions).toContain('Microsoft.Consumption/budgets/write');
    expect(source).toMatch(/^resource\s+"azurerm_consumption_budget_subscription"/m);
  });

  it('is the role the bootstrap reads and the condition script recognises by name', () => {
    expect(bootstrapScript).toContain("'terraform-identity-grants.json'");
    expect(psArray(conditionScript, 'MarkerRoles')).toContain(role.Name);
  });
});

describe('the RBAC Administrator condition against what infra/ assigns', () => {
  const denied = psArray(conditionScript, 'DeniedOnWrite');
  const userOnly = (conditionScript.match(/\$UserOnlyOnWrite\s*=\s*'([^']+)'/) ?? [])[1];

  it('refuses Contributor, so a run cannot hand the subscription-wide grant back to itself', () => {
    expect(denied).toContain('Contributor');
    expect(denied).toContain('Owner');
    expect(userOnly).toBe('Key Vault Secrets Officer');
  });

  it('is never asked by infra/ to assign a denied role, except the user-only seeding window', () => {
    const assignments = resourceBlocks(source, 'azurerm_role_assignment').map(({ label, body }) => ({
      label,
      role: (body.match(/^\s*role_definition_name\s*=\s*"([^"]+)"/m) ?? [])[1],
      principalIsAdminList: /principal_id\s*=\s*each\.value/.test(body) && /var\.admin_object_ids/.test(body),
    }));
    expect(assignments.length).toBeGreaterThan(10);
    const refused = assignments
      .filter((a) => a.role && denied.includes(a.role))
      .filter((a) => !(a.role === userOnly && a.principalIsAdminList))
      .map((a) => `azurerm_role_assignment.${a.label} assigns "${a.role}", which the condition refuses`);
    expect(refused).toEqual([]);
  });
});
