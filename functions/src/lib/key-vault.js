/**
 * Azure Key Vault helpers for Azure Functions.
 *
 * Used to fetch secrets at runtime that are not supplied via App Settings.
 *
 * Two things this module used to get wrong, both fixed here (TODO.md T-405):
 *
 *   1. **Every call was a network round trip.** Key Vault is a throttled
 *      service with a per-vault request budget, and a secret fetched on a hot
 *      path spends that budget on a value that changes approximately never.
 *   2. **Every failure looked like absence.** Throttled, RBAC-denied, network
 *      error and genuinely-missing all returned `null`. A caller cannot tell
 *      "this secret does not exist" from "we are being rate-limited", and the
 *      one caller in this repository turns `null` into a hard error message
 *      naming the wrong cause — `getGoogleAuth` reports the secret as "missing
 *      or unreadable", which is exactly the ambiguity that made the message
 *      useless.
 *
 * Now: absence is `null`, and everything else throws. A throw on a transient
 * failure is the useful behaviour, because the caller can retry it and the
 * error carries the real reason.
 */
import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

let secretClient = null;

/**
 * Secret values change on the order of months; five minutes bounds the staleness
 * an operator sees after rotating one, and removes essentially all of the
 * request volume.
 */
export const SECRET_CACHE_TTL_MS = 5 * 60 * 1000;

/** @type {Map<string, {value: string|null, expiresAt: number}>} */
const cache = new Map();

export function getKeyVaultClient() {
  if (secretClient) return secretClient;

  const vaultUrl = process.env.KEY_VAULT_URI;
  if (!vaultUrl) {
    console.warn('KEY_VAULT_URI is not set. Key vault secrets cannot be fetched.');
    return null;
  }

  const credential = new DefaultAzureCredential();
  secretClient = new SecretClient(vaultUrl, credential);
  return secretClient;
}

/** Test seam: drop the memoised client and every cached secret. */
export function resetKeyVaultForTests() {
  secretClient = null;
  cache.clear();
}

/**
 * True when the error means the secret is not there, as opposed to not
 * reachable. Both `statusCode` and `code` are checked because the SDK's
 * `RestError` carries the HTTP status while the service names the condition.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isSecretNotFound(error) {
  return error?.statusCode === 404 || error?.code === 'SecretNotFound';
}

/**
 * Get a secret value from Key Vault.
 *
 * @param {string} secretName
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @param {number} [options.ttlMs]
 * @returns {Promise<string|null>} the value, or `null` when the secret does not
 *   exist in the vault.
 * @throws when the vault could not be reached, the identity is not authorized,
 *   or the request was throttled — anything that is not "absent".
 */
export async function getSecret(secretName, { now = Date.now, ttlMs = SECRET_CACHE_TTL_MS } = {}) {
  const cached = cache.get(secretName);
  if (cached && cached.expiresAt > now()) return cached.value;

  const client = getKeyVaultClient();
  if (!client) return null;

  try {
    const secret = await client.getSecret(secretName);
    const value = secret?.value ?? null;
    cache.set(secretName, { value, expiresAt: now() + ttlMs });
    return value;
  } catch (error) {
    if (isSecretNotFound(error)) {
      // Absence is cached too. Without it, a secret that is legitimately not
      // configured turns every call into a round trip — the exact behaviour
      // this change exists to remove, just on the unhappy path.
      cache.set(secretName, { value: null, expiresAt: now() + ttlMs });
      return null;
    }
    // Not cached: a throttle or an RBAC failure is a condition to retry, not a
    // fact about the secret.
    throw error;
  }
}
