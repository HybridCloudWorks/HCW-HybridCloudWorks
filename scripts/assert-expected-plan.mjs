#!/usr/bin/env node
/**
 * Assert that a Terraform plan contains ONLY the known permanent diff (T-724).
 *
 * ## Why this exists
 *
 * `infra/main.tf` carries a read-then-strip pair that works around
 * hashicorp/terraform-provider-azurerm#29149, and its cost is that a clean plan
 * no longer exists. Every plan reports:
 *
 *     ~ "RUNTIME_CONFIG_WRITER" = "azapi-strip" -> "azurerm"
 *     Plan: 3 to add, 1 to change, 3 to destroy
 *
 * and a comment in `main.tf` says that a plan reporting exactly that "and
 * nothing else means NO DRIFT".
 *
 * ADR 0018's convergence proof was an EMPTY plan. Operators are now trained to
 * approve a specific non-empty shape by pattern-matching it, and the thing
 * pattern-matching misses is real drift sitting inside or beside the expected
 * trio — three destroys look like three destroys. T-708 is what makes the
 * consequence data loss rather than inconvenience: `prevent_destroy` now covers
 * the Cosmos containers, but a regenerated spec still produces a
 * destroy-and-create plan, and its only gate is a human reading carefully.
 *
 * So the assertion moves out of a comment and into a program.
 *
 * ## Usage
 *
 *     terraform show -json tfplan > plan.json
 *     node scripts/assert-expected-plan.mjs plan.json
 *
 * Exit 0 when the change set is exactly the expected diff (or empty). Exit 1
 * with the unexpected changes named, and exit 2 on a malformed plan — those are
 * distinguished because "the plan is not what I think it is" and "I could not
 * read the plan" call for different responses, and collapsing them is how a
 * broken checker gets read as a clean estate.
 *
 * ## Not wired into CI, and why
 *
 * The plan runs in HCP Terraform through its VCS integration; `iac-validate.yml`
 * runs `terraform init -backend=false` and has no workspace token, so there is
 * no plan JSON in CI to check. Wiring this up needs a TFC API token as a
 * repository secret — an owner action, tracked in TODO.md. Until then this is
 * run by hand against a saved plan, which is still strictly better than reading
 * the same shape off a screen.
 *
 * ## When #29149 closes
 *
 * Delete this file with the azapi pair. `EXPECTED` going empty is the signal
 * that the workaround is gone: at that point the correct assertion is simply
 * "the plan is empty", which this already handles.
 */

import { readFileSync } from 'node:fs';

/**
 * The permanent diff, by resource address.
 *
 * `replaced` are the three azapi resources their own `replace_triggered_by`
 * recreates on every apply. `updated` is the one attribute the strip rewrites.
 *
 * Addresses, not counts. A near-miss count reads as close enough while meaning
 * something entirely different happened — the same reasoning TODO.md gives
 * for approving the teardown against addresses rather than "92 destroyed".
 */
export const EXPECTED = {
  replaced: [
    'azapi_resource_action.function_app_settings',
    'azapi_update_resource.function_app_settings_without_webjobs_storage',
    'azapi_update_resource.function_app_ftp_basic_auth',
  ],
  updated: [
    {
      address: 'azurerm_function_app_flex_consumption.hcw',
      attribute: 'RUNTIME_CONFIG_WRITER',
    },
  ],
};

/** Terraform's action lists, normalised to a single word. */
export function classify(actions = []) {
  const set = new Set(actions);
  if (set.has('create') && set.has('delete')) return 'replace';
  if (set.has('create')) return 'create';
  if (set.has('delete')) return 'delete';
  if (set.has('update')) return 'update';
  return 'no-op';
}

/**
 * Compare a parsed plan against EXPECTED.
 *
 * @param {object} plan `terraform show -json` output
 * @returns {{ok: boolean, unexpected: string[], missing: string[]}}
 */
export function checkPlan(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('plan is not an object');
  }
  // `resource_changes` is absent from a genuinely empty plan, which is valid.
  const changes = plan.resource_changes ?? [];
  if (!Array.isArray(changes)) {
    throw new Error('plan.resource_changes is not an array');
  }

  const expectedReplaced = new Set(EXPECTED.replaced);
  const expectedUpdated = new Map(EXPECTED.updated.map((e) => [e.address, e.attribute]));

  const unexpected = [];
  const seen = new Set();

  for (const change of changes) {
    const action = classify(change?.change?.actions);
    if (action === 'no-op') continue;

    const address = change.address;
    seen.add(address);

    if (action === 'replace' && expectedReplaced.has(address)) continue;

    if (action === 'update' && expectedUpdated.has(address)) {
      // An update to an expected address is only expected for the ONE known
      // attribute. Anything else changing on the function app is exactly the
      // drift that hides beside the trio, so it is reported rather than waved
      // through on the address alone.
      const attribute = expectedUpdated.get(address);
      const before = change.change?.before?.app_settings ?? {};
      const after = change.change?.after?.app_settings ?? {};
      const differing = [
        ...new Set([...Object.keys(before), ...Object.keys(after)]),
      ].filter((key) => before[key] !== after[key]);

      if (differing.length === 1 && differing[0] === attribute) continue;
      unexpected.push(
        `${address}: update touches ${JSON.stringify(differing)}, expected only ["${attribute}"]`
      );
      continue;
    }

    unexpected.push(`${address}: ${action}`);
  }

  // An expected change that has STOPPED appearing matters too: it means the
  // workaround is no longer running, and the AzureWebJobsStorage strip is what
  // stands between the app and a connection string it must not have (T-511).
  const missing = [...expectedReplaced].filter((address) => !seen.has(address));

  return { ok: unexpected.length === 0 && missing.length === 0, unexpected, missing };
}

function main(argv) {
  const path = argv[2];
  if (!path) {
    console.error('usage: node scripts/assert-expected-plan.mjs <plan.json>');
    console.error('  produce it with: terraform show -json tfplan > plan.json');
    return 2;
  }

  let plan;
  try {
    plan = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`could not read a plan from ${path}: ${err.message}`);
    return 2;
  }

  let result;
  try {
    result = checkPlan(plan);
  } catch (err) {
    console.error(`malformed plan: ${err.message}`);
    return 2;
  }

  if (result.ok) {
    console.log('plan matches the expected permanent diff and nothing else.');
    return 0;
  }

  for (const line of result.unexpected) {
    console.error(`UNEXPECTED  ${line}`);
  }
  for (const address of result.missing) {
    console.error(
      `MISSING     ${address}: expected to be replaced every apply. If #29149 has closed, ` +
        'remove the azapi pair and this script together.'
    );
  }
  console.error('');
  console.error('Do not approve this plan on the shape of the summary line. Read each change.');
  return 1;
}

// Only run when invoked directly, so the exports above stay importable.
if (process.argv[1] && process.argv[1].endsWith('assert-expected-plan.mjs')) {
  process.exit(main(process.argv));
}
