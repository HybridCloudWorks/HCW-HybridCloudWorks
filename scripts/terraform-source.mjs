/**
 * The Terraform root module as one string, for the checks in this package that
 * assert things about the configuration by reading it as text.
 *
 * Terraform reads every `.tf` file in a directory as ONE module: one namespace,
 * one state, one plan. A check that reads a single file is asserting something
 * about **a file** when it means something about **the module**, and the gap
 * between those is silent — `assert-expected-plan.test.mjs` carried it until
 * 2026-08-29, matching `^resource "azapi_..."` against `main.tf` alone while an
 * azapi resource in `oidc.tf` or `observability.tf` went unseen.
 *
 * Deliberately duplicated from `functions/test/terraform-source.js` rather than
 * imported: `scripts/` and `functions/` are independent npm packages with no
 * workspace between them, and reaching across that boundary to share ten lines
 * would couple two packages that are otherwise unrelated. Change both. Within
 * `scripts/` there is exactly one copy — this one — and a second consumer is
 * why it moved out of the test file that used to hold it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INFRA = join(fileURLToPath(new URL('..', import.meta.url)), 'infra');

/**
 * Fewer `.tf` files than this means the path is wrong, not that the module
 * shrank. Without the floor a wrong path yields `''`, every `matchAll` over
 * `''` yields nothing, and every "these two lists agree" assertion passes by
 * comparing two empty lists.
 */
export const MIN_TF_FILES = 4;

export function terraformSource(infraDir = INFRA) {
  const names = readdirSync(infraDir)
    .filter((name) => name.endsWith('.tf'))
    .sort();
  if (names.length < MIN_TF_FILES) {
    throw new Error(
      `Expected at least ${MIN_TF_FILES} .tf files in ${infraDir}, found ${names.length}. ` +
        'The path is wrong — reading on would compare empty lists and pass.'
    );
  }
  return names.map((name) => readFileSync(join(infraDir, name), 'utf8')).join('\n');
}
