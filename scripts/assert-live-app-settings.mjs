/**
 * Fail a deploy whose app-settings map is missing settings Terraform declares.
 *
 * ## Why this exists alongside the pre-flight guard
 *
 * `tfc-workspace-busy.mjs` refuses to START a deploy while a Terraform run is
 * going. That closes the common case and not the whole one: a run that begins
 * AFTER the deploy has read the settings map still races it, because the
 * deploy's closing write replays the map it read minutes earlier and ARM's
 * appsettings PUT replaces rather than merges (#454).
 *
 * So the pre-flight guard is the prevention and this is the detection. Without
 * it, a clobbered map is discovered days later by a feature that quietly read
 * nothing — which is exactly how #454 was found.
 *
 * ## What it checks, and what it deliberately does not
 *
 * Only the settings declared as Key Vault references. Those are parsed with
 * the SAME expression `functions/src/lib/secret-catalog.test.js` uses against
 * the same source, so there is one definition of "a reference Terraform
 * declares" and CI already asserts that catalogue and Terraform agree.
 *
 * It does NOT check plain settings, and `PUBLIC_API_ORIGIN` — one of the six
 * lost in #454 — is therefore uncovered. That is a deliberate limit rather
 * than an oversight: `app_settings` is a `merge()` of a literal block with
 * computed maps (`local.timer_flags`), and a regex confident enough to gate a
 * deploy on cannot be written against it. A false failure here blocks every
 * release, which is worse than the bug. Five of the six lost settings were
 * references, and so is every credential.
 *
 * ## Usage
 *
 *     az functionapp config appsettings list -n APP -g RG --query "[].name" -o tsv \
 *       | node scripts/assert-live-app-settings.mjs
 *
 * Reads the live names on stdin, one per line. Exits 1 naming what is missing.
 */
import { pathToFileURL } from 'node:url';
import { INFRA, terraformSource } from './terraform-source.mjs';

/**
 * Below this many references the parse is assumed broken rather than the
 * infrastructure shrunk.
 *
 * Guards the guard. A regex that stopped matching would yield an empty
 * declared set, every live map would satisfy it, and the check would pass
 * while verifying nothing — the failure mode this whole file exists to
 * prevent, reproduced inside the prevention. `secret-catalog.test.js` sets the
 * same floor for the same reason.
 */
export const MIN_DECLARED = 15;

/**
 * Every app-setting name Terraform points at a Key Vault secret.
 *
 * @param {string} source - concatenated infra/*.tf
 * @returns {string[]} setting names, in declaration order
 */
export function declaredKeyVaultSettings(source) {
  const pattern =
    /"([A-Z0-9_]+)"\s*=\s*"@Microsoft\.KeyVault\(SecretUri=\$\{azurerm_key_vault\.hcw\.vault_uri\}secrets\/([A-Z0-9-]+)\)"/g;
  return [...String(source).matchAll(pattern)].map((m) => m[1]);
}

/**
 * Declared names absent from the live map.
 *
 * @param {string[]} declared
 * @param {string[]} live
 * @returns {string[]}
 */
export function missingSettings(declared, live) {
  const present = new Set(live);
  return declared.filter((name) => !present.has(name));
}

/** Newline-separated names, tolerating blank lines and stray whitespace. */
export function parseLiveNames(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const declared = declaredKeyVaultSettings(terraformSource(INFRA));

  if (declared.length < MIN_DECLARED) {
    console.error(
      `::error::Parsed only ${declared.length} Key Vault references from infra/ ` +
        `(expected at least ${MIN_DECLARED}). The expression in ` +
        'declaredKeyVaultSettings no longer matches how Terraform writes them, so this ' +
        'check would pass while verifying nothing. Fix the parse before trusting a green deploy.'
    );
    return 2;
  }

  const live = parseLiveNames(await readStdin());
  if (live.length === 0) {
    console.error(
      '::error::No live app-setting names arrived on stdin. Expected the output of ' +
        '`az functionapp config appsettings list --query "[].name" -o tsv`.'
    );
    return 2;
  }

  const missing = missingSettings(declared, live);
  if (missing.length > 0) {
    console.error(
      `::error::${missing.length} setting(s) Terraform declares are absent from the live app: ` +
        `${missing.join(', ')}. This is the deploy-versus-apply race in #454 — ARM's ` +
        'appsettings PUT replaces the whole map, so whichever writer finished last ' +
        'discarded the other\'s settings. Re-apply infra/ (HCP Terraform, workspace ' +
        'hcw-azure), then rerun this deploy. Do not add the settings by hand: that hides ' +
        'the race and the next deploy loses them again.'
    );
    return 1;
  }

  console.log(`All ${declared.length} Key Vault-referenced settings present on the live app.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`::error::${error.message}`);
      process.exit(2);
    });
}
