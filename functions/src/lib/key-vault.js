/**
 * Azure Key Vault helpers for Azure Functions.
 *
 * Used to fetch secrets like API keys at runtime if not supplied via App Settings.
 */
import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

let secretClient = null;

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

/**
 * Get a secret value from Key Vault.
 * @param {string} secretName
 * @returns {Promise<string|null>}
 */
export async function getSecret(secretName) {
  const client = getKeyVaultClient();
  if (!client) return null;

  try {
    const secret = await client.getSecret(secretName);
    return secret.value;
  } catch (err) {
    console.error(`Failed to fetch secret ${secretName} from Key Vault:`, err.message);
    return null;
  }
}
