/**
 * How many Key Vault references failed to resolve (T-720).
 *
 * ## The problem this makes visible
 *
 * More than twenty app settings are `@Microsoft.KeyVault(SecretUri=…)`
 * references. When one does not resolve, the application receives the LITERAL
 * reference string, and `readKey()` treats a value starting with
 * `@Microsoft.KeyVault(` as "no key configured".
 *
 * That behaviour is deliberate and good: it is what keeps optional integrations
 * inert instead of crashing while secrets are still being seeded. Its cost is
 * that four unrelated failures collapse into one indistinguishable symptom —
 *
 *   - the secret was never seeded,
 *   - the app's RBAC grant on the vault was revoked,
 *   - the vault firewall is denying the app's subnet,
 *   - the secret was rotated and the reference now points at nothing
 *
 * — and every one of them presents as a feature quietly turning itself off, in
 * production, indefinitely. Application Insights sees no exception, because the
 * code path taken is a clean fallback. The Terraform comments document this
 * trap three times; before this module, no signal anywhere observed it.
 *
 * ## Why a count and not a list, on the anonymous endpoint
 *
 * `/api/health` is anonymous, and T-402 stripped the runtime version, the site
 * name and a feature flag from it precisely because an unauthenticated
 * inventory is the first thing anyone enumerating a host looks for. The NAMES
 * of unresolved settings are exactly such an inventory — they enumerate which
 * integrations exist and which are currently unconfigured.
 *
 * A count is not. It discloses no name, no value and no version, and it is the
 * whole of what an alert needs: the number is 0 in a healthy estate, so any
 * other number is actionable without knowing which one. Operators who need the
 * names get them from the authenticated ops-health surface.
 *
 * ## What it cannot see
 *
 * A setting whose reference resolves to the WRONG secret. That value looks
 * entirely normal from here — it is a real string, not a reference — and only
 * the upstream service can say it is wrong. This detects unresolved, not
 * incorrect.
 */

/** The prefix an unresolved Key Vault reference arrives as, verbatim. */
export const KEY_VAULT_REFERENCE_PREFIX = '@Microsoft.KeyVault(';

/**
 * Is this value an unresolved Key Vault reference?
 *
 * Trimmed and BOM-stripped to match `readKey`'s own normalisation exactly. If
 * the two ever disagree, this reports healthy while the application behaves as
 * though the key is absent — the precise blindness being fixed.
 */
export function isUnresolvedReference(value) {
  if (typeof value !== 'string') return false;
  return value.replace(/^﻿/, '').trim().startsWith(KEY_VAULT_REFERENCE_PREFIX);
}

/**
 * Names of every setting holding an unresolved reference, sorted.
 *
 * For the AUTHENTICATED surface only — see the module header on why the
 * anonymous endpoint gets a count.
 *
 * @param {Record<string, unknown>} env
 * @returns {string[]}
 */
export function unresolvedSecretNames(env = {}) {
  return Object.keys(env ?? {})
    .filter((name) => isUnresolvedReference(env[name]))
    .sort();
}

/**
 * How many settings hold an unresolved reference.
 *
 * @param {Record<string, unknown>} env
 * @returns {number}
 */
export function unresolvedSecretCount(env = {}) {
  return unresolvedSecretNames(env).length;
}
