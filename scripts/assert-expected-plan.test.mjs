/**
 * The expected-plan checker, and the addresses it checks (T-724).
 *
 * Two different things are asserted here and both matter.
 *
 * The first is that the checker classifies a plan correctly — an expected
 * permanent diff passes, real drift hiding beside it does not. That is what
 * turns "a comment says a plan of this shape means no drift" into something a
 * machine decides.
 *
 * The second is that `EXPECTED` still names resources that exist in
 * `infra/main.tf`. A checker whose expectations have drifted from the
 * configuration is worse than none: it would wave through the very plan it was
 * written to catch, and do it with a reassuring green line.
 *
 * Since #719 a third: that an update is compared on every attribute, not only
 * `app_settings`, against a plan-JSON fixture. A change is named by its path
 * with both values, a sensitive value never appears in the output, and an
 * intended change passes only when it is declared.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  attributeChanges,
  checkPlan,
  classify,
  declarationLines,
  DECLARED,
  EXPECTED,
  formatPath,
} from './assert-expected-plan.mjs';
// The module-reading helper moved to its own file when a second check needed
// it (terraform-role-definitions.test.mjs). Same eight lines, one copy.
import { terraformSource } from './terraform-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTION_APP = 'azurerm_function_app_flex_consumption.hcw';

/**
 * A fresh copy of `fixtures/plan-permanent-diff.json`, and its Function App
 * change, for one test to mutate.
 *
 * The fixture is the known permanent diff in `terraform show -json` form: the
 * three azapi replacements, the Function App update that changes only
 * RUNTIME_CONFIG_WRITER, and a no-op. It is NOT a copy of a live hcw-azure
 * plan. That JSON carries the estate's sensitive values in plaintext and needs
 * a workspace-admin token to read. Two things keep it honest instead. Its
 * attribute names are held to `infra/` by "the fixture" tests below. Its
 * marker trees (`after_unknown`, `before_sensitive`, `after_sensitive`) follow
 * the shape a real Terraform 1.15.8 plan produced on 2026-09-27: `{}` and
 * `[false]` where nothing is marked, `true` where something is, and unknown
 * values omitted from `after`.
 */
function fixture() {
  const plan = JSON.parse(readFileSync(join(HERE, 'fixtures', 'plan-permanent-diff.json'), 'utf8'));
  const app = plan.resource_changes.find((c) => c.address === FUNCTION_APP).change;
  return { plan, app };
}

/** The #718 change, declared the way a pull request would declare it. */
const RUNTIME_22_TO_24 = Object.freeze({
  address: FUNCTION_APP,
  path: 'runtime_version',
  before: '22',
  after: '24',
  reason: '#718: Node.js 24 on Flex Consumption',
});

/** A plan carrying exactly the known permanent diff. */
const expectedPlan = () => ({
  resource_changes: [
    ...EXPECTED.replaced.map((address) => ({
      address,
      change: { actions: ['delete', 'create'] },
    })),
    {
      address: EXPECTED.updated[0].address,
      change: {
        actions: ['update'],
        before: { app_settings: { RUNTIME_CONFIG_WRITER: 'azapi-strip', OTHER: 'same' } },
        after: { app_settings: { RUNTIME_CONFIG_WRITER: 'azurerm', OTHER: 'same' } },
      },
    },
  ],
});

describe('classify', () => {
  it('reads Terraform action lists', () => {
    expect(classify(['delete', 'create'])).toBe('replace');
    expect(classify(['create', 'delete'])).toBe('replace');
    expect(classify(['create'])).toBe('create');
    expect(classify(['delete'])).toBe('delete');
    expect(classify(['update'])).toBe('update');
    expect(classify(['no-op'])).toBe('no-op');
    expect(classify([])).toBe('no-op');
    expect(classify()).toBe('no-op');
  });
});

describe('checkPlan', () => {
  it('accepts exactly the permanent diff', () => {
    expect(checkPlan(expectedPlan())).toMatchObject({ ok: true, unexpected: [], missing: [] });
  });

  it('ignores no-op entries', () => {
    const plan = expectedPlan();
    plan.resource_changes.push({
      address: 'azurerm_key_vault.hcw',
      change: { actions: ['no-op'] },
    });
    expect(checkPlan(plan).ok).toBe(true);
  });

  it('catches a destroy hiding beside the expected three', () => {
    // THE failure this exists for. Three destroys look like three destroys on
    // a summary line, and T-708 is what makes the consequence data loss.
    const plan = expectedPlan();
    plan.resource_changes.push({
      address: 'azurerm_cosmosdb_sql_container.hcw["content"]',
      change: { actions: ['delete', 'create'] },
    });
    const result = checkPlan(plan);
    expect(result.ok).toBe(false);
    expect(result.unexpected).toEqual([
      'azurerm_cosmosdb_sql_container.hcw["content"]: replace',
    ]);
  });

  it('catches a second attribute changing on the function app', () => {
    // The subtler one: the address IS expected to update, so an address-only
    // check would pass this. A settings change riding along with the marker is
    // drift.
    const plan = expectedPlan();
    plan.resource_changes[3].change.after.app_settings.OTHER = 'changed';
    const result = checkPlan(plan, { declared: [] });
    expect(result.ok).toBe(false);
    // Named by path with both values since #719. The marker beside it is still
    // tolerated, so it is the only line.
    expect(result.unexpected).toEqual([
      'azurerm_function_app_flex_consumption.hcw: update app_settings.OTHER: "same" -> "changed"',
    ]);
  });

  it('catches a plain create or delete', () => {
    for (const actions of [['create'], ['delete']]) {
      const plan = expectedPlan();
      plan.resource_changes.push({ address: 'azurerm_storage_account.new', change: { actions } });
      expect(checkPlan(plan).ok).toBe(false);
    }
  });

  it('reports an expected change that has stopped appearing', () => {
    // If the strip stops running, AzureWebJobsStorage comes back — the one
    // thing the pair exists to prevent (T-511). Silence is not success.
    const plan = expectedPlan();
    plan.resource_changes = plan.resource_changes.filter(
      (c) => c.address !== 'azapi_update_resource.function_app_settings_without_webjobs_storage'
    );
    const result = checkPlan(plan);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      'azapi_update_resource.function_app_settings_without_webjobs_storage',
    ]);
  });

  it('accepts a genuinely empty plan, with or without the key', () => {
    // What a plan should look like the day #29149 closes and the pair is
    // deleted along with EXPECTED.
    for (const plan of [{}, { resource_changes: [] }]) {
      const result = checkPlan(plan);
      expect(result.unexpected).toEqual([]);
      // `missing` is populated, correctly: with the pair still in main.tf, an
      // empty plan means the workaround is not running.
      expect(result.missing).toEqual(EXPECTED.replaced);
    }
  });

  it('throws on something that is not a plan', () => {
    // Distinguished from "unexpected changes" by the caller, which exits 2
    // rather than 1: "I could not read the plan" and "the plan is wrong" call
    // for different responses.
    expect(() => checkPlan(null)).toThrow();
    expect(() => checkPlan({ resource_changes: 'nope' })).toThrow();
  });
});

describe('EXPECTED matches the configuration', () => {
  const infraSource = terraformSource();

  it('names every azapi resource declared in infra/*.tf, and only those', () => {
    // Both directions. A resource added to the module but not here would have
    // its permanent replacement reported as drift, training operators to ignore
    // this tool; one removed from the module but left here would be reported
    // missing forever, with the same result.
    //
    // Reads the WHOLE module, not main.tf: until 2026-08-29 an azapi resource
    // in any other .tf file was invisible here, so "and only those" was only
    // ever true of one file.
    const declared = [...infraSource.matchAll(/^resource "(azapi_[a-z_]+)" "([a-z0-9_]+)"/gm)].map(
      (m) => `${m[1]}.${m[2]}`
    );
    expect(declared.length).toBeGreaterThan(0);
    expect([...EXPECTED.replaced].sort()).toEqual([...declared].sort());
  });

  it('names a resource and an app setting that exist', () => {
    const { address, attribute } = EXPECTED.updated[0];
    const [type, name] = address.split('.');
    expect(infraSource).toContain(`resource "${type}" "${name}"`);
    expect(infraSource).toContain(`"${attribute}"`);
  });
});

describe('every attribute of an update is compared, not only app_settings (#719)', () => {
  const unexpected = (plan, declared = []) => checkPlan(plan, { declared }).unexpected;

  it('an app_settings-only per-apply change still passes', () => {
    // The permanent diff itself. Its one difference is the marker, which is
    // tolerated whatever its values, exactly as before #719.
    const { plan, app } = fixture();
    expect(attributeChanges(app).map((d) => d.path)).toEqual(['app_settings.RUNTIME_CONFIG_WRITER']);
    expect(checkPlan(plan, { declared: [] })).toEqual({
      ok: true,
      unexpected: [],
      missing: [],
      declared: [],
      unused: [],
    });
  });

  it('fails a runtime_version change nobody declared, naming it and both values', () => {
    // #718's plan. The app_settings-only check passed this without reading it.
    const { plan, app } = fixture();
    app.before.runtime_version = '22';
    const result = checkPlan(plan, { declared: [] });
    expect(result.ok).toBe(false);
    expect(result.unexpected).toEqual([`${FUNCTION_APP}: update runtime_version: "22" -> "24"`]);
  });

  it('passes a runtime_version change the pull request declared', () => {
    const { plan, app } = fixture();
    app.before.runtime_version = '22';
    const result = checkPlan(plan, { declared: [RUNTIME_22_TO_24] });
    expect(result).toEqual({
      ok: true,
      unexpected: [],
      missing: [],
      declared: [RUNTIME_22_TO_24],
      unused: [],
    });
    expect(declarationLines(result)).toEqual([
      `DECLARED    ${FUNCTION_APP} runtime_version: "22" -> "24" (#718: Node.js 24 on Flex Consumption)`,
    ]);
  });

  it('holds a declaration to its values and its address, so a stale one passes nothing else', () => {
    // A rollback of the declared bump is a different change and fails.
    const rollback = fixture();
    rollback.app.after.runtime_version = '22';
    const result = checkPlan(rollback.plan, { declared: [RUNTIME_22_TO_24] });
    expect(result.unexpected).toEqual([`${FUNCTION_APP}: update runtime_version: "24" -> "22"`]);
    expect(result.unused).toEqual([RUNTIME_22_TO_24]);

    // The same path and values on another address do not match it either.
    const elsewhere = fixture();
    elsewhere.app.before.runtime_version = '22';
    const other = { ...RUNTIME_22_TO_24, address: 'azurerm_linux_function_app.other' };
    expect(unexpected(elsewhere.plan, [other])).toEqual([
      `${FUNCTION_APP}: update runtime_version: "22" -> "24"`,
    ]);
  });

  it('reports a declaration the plan does not contain, without failing', () => {
    // After the apply the declared change is gone from every plan. That is
    // the prompt to delete the entry, not drift.
    const { plan } = fixture();
    const result = checkPlan(plan, { declared: [RUNTIME_22_TO_24] });
    expect(result.ok).toBe(true);
    expect(result.unused).toEqual([RUNTIME_22_TO_24]);
    expect(declarationLines(result)).toEqual([
      `NOTE        declared, not in this plan: ${FUNCTION_APP} runtime_version: "22" -> "24" ` +
        '(#718: Node.js 24 on Flex Consumption). Once it has applied, delete it from DECLARED in ' +
        'scripts/assert-expected-plan.mjs.',
    ]);
  });

  it('uses the shipped DECLARED when none is passed', () => {
    const { plan } = fixture();
    expect(checkPlan(plan).unused).toEqual(DECLARED);
  });

  it('fails a sensitive attribute change without printing either value', () => {
    const { plan, app } = fixture();
    const before = app.before.site_config[0].application_insights_connection_string;
    const after = before.replace(/0{8}-0{4}-0{4}-0{4}-0{12}/, '11111111-1111-1111-1111-111111111111');
    app.after.site_config[0].application_insights_connection_string = after;

    const result = checkPlan(plan, { declared: [] });
    expect(result.unexpected).toEqual([
      `${FUNCTION_APP}: update site_config[0].application_insights_connection_string: (sensitive) -> (sensitive)`,
    ]);
    const printed = JSON.stringify(result);
    expect(printed).not.toContain(before);
    expect(printed).not.toContain('11111111');
  });

  it('will not match a declaration for a sensitive change, even with the right values', () => {
    // Declaring it would mean writing the value into this repository.
    const { plan, app } = fixture();
    const before = app.before.site_config[0].application_insights_key;
    app.after.site_config[0].application_insights_key = '11111111-1111-1111-1111-111111111111';
    const declaration = {
      address: FUNCTION_APP,
      path: 'site_config[0].application_insights_key',
      before,
      after: '11111111-1111-1111-1111-111111111111',
      reason: 'test',
    };
    const result = checkPlan(plan, { declared: [declaration] });
    expect(result.ok).toBe(false);
    expect(result.unused).toEqual([declaration]);
  });

  it('masks a whole sensitive block, keys and all', () => {
    // site_credential is sensitive as a block, so its field names are not
    // printed either. Terraform's renderer does the same.
    const { plan, app } = fixture();
    app.after.site_credential = [{ name: '$func-site-prod-cus-01', password: 'bbbb' }];
    const lines = unexpected(plan);
    expect(lines).toEqual([`${FUNCTION_APP}: update site_credential: (sensitive) -> (sensitive)`]);
    expect(lines.join('\n')).not.toContain('password');
    expect(lines.join('\n')).not.toContain('bbbb');
  });

  it('prints a value known only after apply as such', () => {
    // Terraform omits an unknown value from `after` and marks it in
    // after_unknown, so there is nothing to print but the fact.
    const { plan, app } = fixture();
    const subnet = app.before.virtual_network_subnet_id;
    delete app.after.virtual_network_subnet_id;
    app.after_unknown.virtual_network_subnet_id = true;
    expect(unexpected(plan)).toEqual([
      `${FUNCTION_APP}: update virtual_network_subnet_id: ${JSON.stringify(subnet)} -> (known after apply)`,
    ]);
  });

  it('prints neither value of an unknown block with a sensitive value beneath it', () => {
    const { plan, app } = fixture();
    delete app.after.site_config;
    app.after_unknown.site_config = true;
    const lines = unexpected(plan);
    expect(lines).toEqual([`${FUNCTION_APP}: update site_config: (sensitive) -> (known after apply)`]);
    expect(lines.join('\n')).not.toContain('InstrumentationKey');
  });

  it('prints a list or object about to be recomputed by its size, not its contents', () => {
    // The shape Terraform 1.15.8 produced for terraform_data on 2026-09-27: a
    // sensitive input copied into the computed `output`, and left unmarked in
    // before_sensitive. Terraform's own renderer printed the secret.
    const { plan } = fixture();
    plan.resource_changes.push({
      address: 'terraform_data.example',
      change: {
        actions: ['update'],
        before: { id: 'x', output: { SECRET: 'aaaa', runtime_version: '22' }, list: ['aaaa'] },
        after: { id: 'x' },
        after_unknown: { output: true, list: true },
        before_sensitive: { output: {}, list: [false] },
        after_sensitive: {},
      },
    });
    const lines = unexpected(plan);
    expect(lines).toEqual([
      'terraform_data.example: update list: (a list of 1 item) -> (known after apply)',
      'terraform_data.example: update output: (an object with 2 keys) -> (known after apply)',
    ]);
    expect(lines.join('\n')).not.toContain('aaaa');
  });

  it('names attributes inside nested blocks by their path', () => {
    const { plan, app } = fixture();
    const site = app.after.site_config[0];
    site.http2_enabled = false;
    site.cors[0].allowed_origins.push('https://example.com');
    site.ip_restriction.push({ action: 'Allow', ip_address: '203.0.113.0/24', priority: 100 });
    expect(unexpected(plan)).toEqual([
      `${FUNCTION_APP}: update site_config[0].cors[0].allowed_origins[3]: (absent) -> "https://example.com"`,
      `${FUNCTION_APP}: update site_config[0].http2_enabled: true -> false`,
      `${FUNCTION_APP}: update site_config[0].ip_restriction[0]: (absent) -> ` +
        '{"action":"Allow","ip_address":"203.0.113.0/24","priority":100}',
    ]);
  });

  it('matches a declaration by the path it prints, nested blocks included', () => {
    const { plan, app } = fixture();
    app.after.site_config[0].http2_enabled = false;
    const declaration = {
      address: FUNCTION_APP,
      path: 'site_config[0].http2_enabled',
      before: true,
      after: false,
      reason: 'test',
    };
    expect(checkPlan(plan, { declared: [declaration] })).toMatchObject({
      ok: true,
      declared: [declaration],
    });
  });

  it('quotes an app setting whose name holds a dot', () => {
    // AzureWebJobs.<function>.Disabled is the platform's own naming. Printed
    // bare, it would read as three levels.
    const { plan, app } = fixture();
    app.after.app_settings['AzureWebJobs.syncContent.Disabled'] = 'true';
    expect(unexpected(plan)).toEqual([
      `${FUNCTION_APP}: update app_settings["AzureWebJobs.syncContent.Disabled"]: (absent) -> "true"`,
    ]);
  });

  it('names each attribute issue #719 listed, and passes none of them', () => {
    const { plan, app } = fixture();
    Object.assign(app.after, {
      instance_memory_in_mb: 4096,
      maximum_instance_count: 100,
      https_only: false,
      virtual_network_subnet_id: null,
      storage_authentication_type: 'StorageAccountConnectionString',
    });
    expect(unexpected(plan).map((line) => line.split(': ')[1])).toEqual([
      'update https_only',
      'update instance_memory_in_mb',
      'update maximum_instance_count',
      'update storage_authentication_type',
      'update virtual_network_subnet_id',
    ]);
  });

  it('does not pass an update in which nothing visibly differs', () => {
    // Terraform planned a change this checker cannot see. That is not
    // evidence of a harmless one.
    const { plan, app } = fixture();
    app.after.app_settings.RUNTIME_CONFIG_WRITER = app.before.app_settings.RUNTIME_CONFIG_WRITER;
    expect(unexpected(plan)).toEqual([
      `${FUNCTION_APP}: update, but no attribute differs between before and after. Read this change in the plan.`,
    ]);
  });

  it('compares an update to any other resource the same way', () => {
    const { plan } = fixture();
    plan.resource_changes.push({
      address: 'azurerm_storage_account.content',
      change: {
        actions: ['update'],
        before: { min_tls_version: 'TLS1_2' },
        after: { min_tls_version: 'TLS1_0' },
        after_unknown: {},
        before_sensitive: {},
        after_sensitive: {},
      },
    });
    expect(unexpected(plan)).toEqual([
      'azurerm_storage_account.content: update min_tls_version: "TLS1_2" -> "TLS1_0"',
    ]);
  });
});

describe('formatPath', () => {
  it('writes a path the way Terraform does', () => {
    expect(formatPath(['runtime_version'])).toBe('runtime_version');
    expect(formatPath(['site_config', 0, 'cors', 0, 'allowed_origins', 2])).toBe(
      'site_config[0].cors[0].allowed_origins[2]'
    );
    expect(formatPath(['app_settings', 'RUNTIME_CONFIG_WRITER'])).toBe(
      'app_settings.RUNTIME_CONFIG_WRITER'
    );
    expect(formatPath(['app_settings', 'AzureWebJobs.x.Disabled'])).toBe(
      'app_settings["AzureWebJobs.x.Disabled"]'
    );
    expect(formatPath([])).toBe('(the whole resource)');
  });
});

describe('the command line never prints a sensitive value', () => {
  // End to end, because main() is what reaches the job summary, and the tests
  // above see only checkPlan's return value.
  function run(plan) {
    const dir = mkdtempSync(join(tmpdir(), 'assert-expected-plan-'));
    try {
      const file = join(dir, 'plan.json');
      writeFileSync(file, JSON.stringify(plan));
      try {
        const stdout = execFileSync(process.execPath, [join(HERE, 'assert-expected-plan.mjs'), file], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 30_000,
        });
        return { code: 0, output: stdout };
      } catch (err) {
        return { code: err.status, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('exits 0 on the permanent diff', () => {
    const got = run(fixture().plan);
    expect(got.code).toBe(0);
    expect(got.output).toContain('plan matches the expected permanent diff');
  });

  it('exits 1 naming each path, with no sensitive value in its output', () => {
    const { plan, app } = fixture();
    app.before.runtime_version = '22';
    const key = app.before.site_config[0].application_insights_key;
    app.after.site_config[0].application_insights_key = '11111111-1111-1111-1111-111111111111';

    const got = run(plan);
    expect(got.code).toBe(1);
    expect(got.output).toContain(`UNEXPECTED  ${FUNCTION_APP}: update runtime_version: "22" -> "24"`);
    expect(got.output).toContain(
      `UNEXPECTED  ${FUNCTION_APP}: update site_config[0].application_insights_key: (sensitive) -> (sensitive)`
    );
    expect(got.output).not.toContain(key);
    expect(got.output).not.toContain('11111111');
  });
});

describe('the fixture', () => {
  const infraSource = terraformSource();

  it('names Function App attributes that infra/functionapp.tf actually sets', () => {
    // A fixture calibrated against invented attribute names would pass while
    // matching nothing the repository writes.
    const { app } = fixture();
    for (const name of [
      'runtime_name',
      'runtime_version',
      'instance_memory_in_mb',
      'maximum_instance_count',
      'https_only',
      'virtual_network_subnet_id',
      'storage_container_type',
      'storage_container_endpoint',
      'storage_authentication_type',
      'webdeploy_publish_basic_authentication_enabled',
    ]) {
      expect(app.after, name).toHaveProperty(name);
      expect(infraSource, name).toMatch(new RegExp(`^\\s+${name}\\s+=`, 'm'));
    }
    for (const name of [
      'application_insights_connection_string',
      'application_insights_key',
      'http2_enabled',
      'ip_restriction_default_action',
      'scm_ip_restriction_default_action',
    ]) {
      expect(app.after.site_config[0], name).toHaveProperty(name);
      expect(infraSource, name).toMatch(new RegExp(`^\\s+${name}\\s+=`, 'm'));
    }
  });

  it('carries the markers a real plan carries on every change', () => {
    for (const { address, change } of fixture().plan.resource_changes) {
      expect(Array.isArray(change.actions), address).toBe(true);
      for (const key of ['before', 'after', 'after_unknown', 'before_sensitive', 'after_sensitive']) {
        expect(change, `${address} ${key}`).toHaveProperty(key);
      }
    }
  });
});

describe('DECLARED', () => {
  const infraSource = terraformSource();

  it('holds only complete entries, each for a resource declared in infra/*.tf', () => {
    // Empty is the normal state, and then this passes trivially. An entry
    // needs both values spelled out, because an omitted one matches only an
    // absent attribute, and a reason, because the next reader has to decide
    // whether it has applied.
    for (const declaration of DECLARED) {
      const label = JSON.stringify(declaration);
      expect(typeof declaration.address, label).toBe('string');
      expect(typeof declaration.path, label).toBe('string');
      expect(typeof declaration.reason === 'string' && declaration.reason.length > 0, label).toBe(true);
      expect(Object.hasOwn(declaration, 'before') && Object.hasOwn(declaration, 'after'), label).toBe(true);
      const [type, name] = declaration.address.replace(/\[.*$/, '').split('.');
      expect(infraSource, label).toContain(`resource "${type}" "${name}"`);
    }
  });
});
