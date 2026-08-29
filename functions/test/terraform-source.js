/**
 * Read the Terraform root module as one string, for the tests that assert
 * things about the configuration by reading it as text.
 *
 * ## Why not `readFileSync('infra/main.tf')`
 *
 * Four tests in this package and one in `scripts/` used to name `main.tf`
 * directly. Terraform does not work that way: every `.tf` file in a directory
 * is one module, with one namespace and one state. A guard that reads a single
 * file is asserting something about **a file** when it means something about
 * **the module**, and the gap between those two is silent.
 *
 * That gap was already open before anyone proposed splitting `main.tf`:
 * `scripts/assert-expected-plan.test.mjs` matches `^resource "azapi_..."` to
 * check that its permanent-diff allowlist names every azapi resource. An azapi
 * resource declared in `observability.tf`, `oidc.tf` or `hub.tf` was invisible
 * to it — the allowlist would look complete while missing an entry, and the
 * plan checker would report that resource's permanent replacement as drift.
 *
 * So this is not scaffolding for a future refactor. It closes a live hole, and
 * splitting `main.tf` afterwards becomes a file move that no guard can notice —
 * which is what "state-safe" should have meant all along.
 *
 * ## The floor
 *
 * A wrong path returns `''` from a `readFileSync` loop over zero files, and
 * every `matchAll` over `''` returns nothing, and every "these two lists agree"
 * assertion then passes by comparing two empty lists. `MIN_TF_FILES` is what
 * stops that: it is deliberately lower than the real count so the check does
 * not become a chore on every legitimate split, and high enough that an empty
 * or wrong directory cannot pass.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Fewer `.tf` files than this in the root module means the path is wrong, not
 * that the module shrank. Today there are seven.
 */
export const MIN_TF_FILES = 4;

/** Every `.tf` file in the root module, sorted, so the order is deterministic. */
export function terraformFileNames(infraDir) {
  return readdirSync(infraDir)
    .filter((name) => name.endsWith('.tf'))
    .sort();
}

/**
 * The whole root module as one string.
 *
 * Files are joined with a newline so a construct at the end of one file cannot
 * accidentally splice into the start of the next — `}` followed directly by
 * `resource "..."` would otherwise read as one line to a `^`-anchored pattern.
 *
 * @param {string} infraDir absolute path to `infra/`
 * @returns {string}
 */
export function terraformSource(infraDir) {
  const names = terraformFileNames(infraDir);
  if (names.length < MIN_TF_FILES) {
    throw new Error(
      `Expected at least ${MIN_TF_FILES} .tf files in ${infraDir}, found ${names.length}. ` +
        'The path is wrong — reading on would compare empty lists and pass.'
    );
  }
  return names.map((name) => readFileSync(join(infraDir, name), 'utf8')).join('\n');
}

/**
 * The text of one HCL block, from an opening anchor to the line that closes it
 * at `closeIndent`.
 *
 * Used instead of "read until the next resource I happen to know follows this
 * one". `app-settings-secrets.test.js` bounded the `app_settings` map with
 * `resource "azapi_resource_action" "function_app_settings"` — a DIFFERENT
 * resource, seventy lines further down. That works until either moves, and
 * moving them is exactly what splitting the file does. A block that closes at a
 * known indentation is a property of the block itself.
 *
 * @param {string} source
 * @param {string} openAnchor literal text that starts the block, e.g. 'app_settings = merge({'
 * @param {string} closeLine literal line that closes it, e.g. '  })'
 * @returns {string|null} the text between them, or null if either is missing
 */
export function hclBlockAfter(source, openAnchor, closeLine) {
  const start = source.indexOf(openAnchor);
  if (start === -1) return null;
  const from = start + openAnchor.length;
  const end = source.indexOf(`\n${closeLine}`, from);
  if (end === -1) return null;
  return source.slice(from, end);
}
