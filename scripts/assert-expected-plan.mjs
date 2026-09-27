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
 * ## Every attribute, not only app_settings (#719)
 *
 * Until #719 an update to the Function App was compared on `app_settings`
 * alone. #718 moved `runtime_version` from "22" to "24" and this reported the
 * plan as expected without reading that attribute, and a stray change to
 * `instance_memory_in_mb`, `https_only`, `virtual_network_subnet_id` or the
 * storage settings would have passed the same way.
 *
 * Every update in the plan is now compared `before` against `after`, leaf by
 * leaf, and each difference is named by its path:
 *
 *     runtime_version
 *     site_config[0].cors[0].allowed_origins[2]
 *     app_settings.RUNTIME_CONFIG_WRITER
 *     app_settings["AzureWebJobs.syncContent.Disabled"]
 *
 * On an update, two kinds of difference are tolerated and nothing else. The
 * first is the `EXPECTED.updated` app setting, whatever its values, which is
 * the T-724 allow-list unchanged. The second is a change declared in
 * `DECLARED` below, with exactly the declared values. Every other difference
 * is UNEXPECTED, printed as `address: update path: before -> after`.
 *
 * VALUES ARE PRINTED ACCORDING TO THE PLAN'S MARKERS. `terraform show -json`
 * carries sensitive values in plaintext in `before` and `after`. That was
 * checked against Terraform 1.15.8 on 2026-09-27: a sensitive variable's
 * value sat in both, flagged only in `before_sensitive` and `after_sensitive`.
 * So a difference under either sensitive marker prints as `(sensitive)` on
 * both sides, as Terraform's own renderer does. A value under `after_unknown`
 * prints as `(known after apply)`. A block or map that differs as a whole
 * prints as `(sensitive)` if anything beneath it is marked sensitive.
 *
 * The markers are Terraform's, and they are only as good as Terraform makes
 * them. A value Terraform does not mark is printed, as Terraform's own
 * renderer prints it. The same experiment found one that was missed: a
 * provider copied a sensitive input into a computed attribute it does not
 * declare sensitive (terraform_data's `output`), and the old value arrived
 * unmarked. So a list or object whose new value is unknown prints by its size,
 * not its contents. That was the case seen, and the finding does not need its
 * contents: the whole value will be recomputed.
 *
 * ## Declaring an intended change
 *
 * The pull request that makes a change declares it by adding an entry to
 * `DECLARED`, in this file, in the same diff:
 *
 *     {
 *       address: 'azurerm_function_app_flex_consumption.hcw',
 *       path: 'runtime_version',
 *       before: '22',
 *       after: '24',
 *       reason: '#718: Node.js 24 on Flex Consumption',
 *     }
 *
 * `path` is written as this script prints it. The entry matches that address,
 * that path and exactly those two values, so a reviewer reads the expectation
 * beside the change it permits. Once the change has applied, the entry matches
 * nothing, and a later drift of the same attribute is caught again rather than
 * waved through by a stale line. A declaration the plan does not contain is
 * printed as a NOTE, not a failure. Usually its change has applied, and the
 * note is the prompt to delete the entry.
 *
 * A sensitive or unknown difference cannot be declared. Matching one would
 * mean writing its value here, so such an entry never matches, and the plan
 * waits for a person to read it.
 *
 * `tfc-plan-check.yml` reads the declarations on the ref it was dispatched
 * from (normally `main`), not those at the commit the run was planned for.
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
 * ## Where it runs
 *
 * `.github/workflows/tfc-plan-check.yml` runs this, through
 * `check-tfc-plan.mjs`, against a plan HCP Terraform is holding for
 * confirmation. It is dispatched rather than triggered, and that workflow's
 * header says why. Run by hand against a saved plan, it is the same check.
 * (This section said "not wired into CI" until #719; `tfc-plan-check.yml`
 * had wired it since #284.)
 *
 * ## When #29149 closes
 *
 * Delete this file with the azapi pair. `EXPECTED` going empty is the signal
 * that the workaround is gone: at that point the correct assertion is simply
 * "the plan is empty", which this already handles.
 */

import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { attributeChanges, describeDifference, formatPath, render } from './lib/plan-diff.mjs';

// The diff mechanics live in lib/plan-diff.mjs; this file keeps the policy.
// Re-exported so callers and tests have one module to import.
export { attributeChanges, describeDifference, formatPath } from './lib/plan-diff.mjs';

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

/**
 * Intended one-off changes, each declared by the pull request that makes it
 * (#719).
 *
 * Empty is the normal state. An entry is `{ address, path, before, after,
 * reason }` and matches only those exact values. Delete it once its change
 * has applied. "Declaring an intended change" in the header has the rest.
 */
export const DECLARED = [];

/** Terraform's action lists, normalised to a single word. */
export function classify(actions = []) {
  const set = new Set(actions);
  if (set.has('create') && set.has('delete')) return 'replace';
  if (set.has('create')) return 'create';
  if (set.has('delete')) return 'delete';
  if (set.has('update')) return 'update';
  return 'no-op';
}

/** One `DECLARED` entry, for the report. */
export function describeDeclaration({ address, path, before, after, reason }) {
  return `${address} ${path}: ${render(before)} -> ${render(after)}${reason ? ` (${reason})` : ''}`;
}

/**
 * The report lines about declarations, shared by both entry points. DECLARED
 * names what the plan matched; NOTE names what it did not. Neither fails the
 * check: a declaration the plan lacks has usually applied already.
 */
export function declarationLines({ declared = [], unused = [] }) {
  return [
    ...declared.map((d) => `DECLARED    ${describeDeclaration(d)}`),
    ...unused.map(
      (d) =>
        `NOTE        declared, not in this plan: ${describeDeclaration(d)}. Once it has ` +
        'applied, delete it from DECLARED in scripts/assert-expected-plan.mjs.'
    ),
  ];
}

/**
 * Whether one declaration covers one difference. A sensitive or unknown
 * difference never matches: declaring it would mean writing its value here.
 */
function matchesDeclaration(declaration, address, difference) {
  if (difference.sensitive || difference.unknown) return false;
  if (declaration?.address !== address || declaration.path !== difference.path) return false;
  const sameBefore = isDeepStrictEqual(declaration.before, difference.before);
  return sameBefore && isDeepStrictEqual(declaration.after, difference.after);
}

/**
 * Compare a parsed plan against EXPECTED and DECLARED.
 *
 * `declared` defaults to `DECLARED` and is a parameter so the tests can supply
 * their own.
 *
 * @param {object} plan `terraform show -json` output
 * @returns {{ok: boolean, unexpected: string[], missing: string[],
 *            declared: object[], unused: object[]}}
 *   `declared` lists the declarations this plan matched. `unused` lists those
 *   it did not, which the caller reports without failing.
 */
export function checkPlan(plan, { declared = DECLARED } = {}) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('plan is not an object');
  }
  // `resource_changes` is absent from a genuinely empty plan, which is valid.
  const changes = plan.resource_changes ?? [];
  if (!Array.isArray(changes)) {
    throw new Error('plan.resource_changes is not an array');
  }

  const expectedReplaced = new Set(EXPECTED.replaced);
  // address -> the paths an update there may change, whatever the values.
  const tolerated = new Map();
  for (const { address, attribute } of EXPECTED.updated) {
    if (!tolerated.has(address)) tolerated.set(address, new Set());
    tolerated.get(address).add(formatPath(['app_settings', attribute]));
  }

  const unexpected = [];
  const seen = new Set();
  const matched = new Set();

  for (const change of changes) {
    const action = classify(change?.change?.actions);
    if (action === 'no-op') continue;

    const address = change.address;
    seen.add(address);

    if (action === 'replace' && expectedReplaced.has(address)) continue;

    if (action === 'update') {
      // Every attribute, not only app_settings (#719). An update is expected
      // only for the one known app setting and for what a pull request has
      // declared. Anything else changing, on the function app or anywhere, is
      // exactly the drift that hides beside the trio, so it is named rather
      // than waved through on the address alone.
      const differences = attributeChanges(change.change);
      if (differences.length === 0) {
        // Terraform plans an update, and nothing this checker can see differs.
        // That is not evidence of a harmless change, so it is not passed.
        unexpected.push(
          `${address}: update, but no attribute differs between before and after. Read this change in the plan.`
        );
        continue;
      }
      for (const difference of differences) {
        if (tolerated.get(address)?.has(difference.path)) continue;
        const declaration = declared.find((d) => matchesDeclaration(d, address, difference));
        if (declaration) {
          matched.add(declaration);
          continue;
        }
        unexpected.push(`${address}: update ${difference.path}: ${describeDifference(difference)}`);
      }
      continue;
    }

    unexpected.push(`${address}: ${action}`);
  }

  // An expected change that has STOPPED appearing matters too: it means the
  // workaround is no longer running, and the AzureWebJobsStorage strip is what
  // stands between the app and a connection string it must not have (T-511).
  const missing = [...expectedReplaced].filter((address) => !seen.has(address));

  return {
    ok: unexpected.length === 0 && missing.length === 0,
    unexpected,
    missing,
    declared: declared.filter((d) => matched.has(d)),
    unused: declared.filter((d) => !matched.has(d)),
  };
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
    console.log(
      result.declared.length === 0
        ? 'plan matches the expected permanent diff and nothing else.'
        : 'plan matches the expected permanent diff and its declared changes, and nothing else.'
    );
    for (const line of declarationLines(result)) console.log(line);
    return 0;
  }

  for (const line of declarationLines(result)) console.error(line);
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
