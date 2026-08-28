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
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPlan, classify, EXPECTED } from './assert-expected-plan.mjs';

const INFRA = join(fileURLToPath(new URL('..', import.meta.url)), 'infra');

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
    const result = checkPlan(plan);
    expect(result.ok).toBe(false);
    expect(result.unexpected[0]).toMatch(/OTHER/);
    expect(result.unexpected[0]).toMatch(/expected only \["RUNTIME_CONFIG_WRITER"\]/);
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
  const mainTf = readFileSync(join(INFRA, 'main.tf'), 'utf8');

  it('names every azapi resource declared in infra/main.tf, and only those', () => {
    // Both directions. A resource added to main.tf but not here would have its
    // permanent replacement reported as drift, training operators to ignore
    // this tool; one removed from main.tf but left here would be reported
    // missing forever, with the same result.
    const declared = [...mainTf.matchAll(/^resource "(azapi_[a-z_]+)" "([a-z0-9_]+)"/gm)].map(
      (m) => `${m[1]}.${m[2]}`
    );
    expect(declared.length).toBeGreaterThan(0);
    expect([...EXPECTED.replaced].sort()).toEqual([...declared].sort());
  });

  it('names a resource and an app setting that exist', () => {
    const { address, attribute } = EXPECTED.updated[0];
    const [type, name] = address.split('.');
    expect(mainTf).toContain(`resource "${type}" "${name}"`);
    expect(mainTf).toContain(`"${attribute}"`);
  });
});
