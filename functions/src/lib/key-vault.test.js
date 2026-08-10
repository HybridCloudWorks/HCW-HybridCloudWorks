/**
 * Key Vault reads.
 *
 * The load-bearing assertion is the one distinguishing "absent" from
 * "unreachable". Every failure used to return `null`, so a throttled or
 * RBAC-denied read was indistinguishable from a secret that does not exist —
 * and the one caller in this repository turns `null` into an error message
 * naming the wrong cause (TODO.md T-405).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const client = vi.hoisted(() => ({ getSecret: vi.fn() }));

vi.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class {
    getSecret(...args) {
      return client.getSecret(...args);
    }
  },
}));
vi.mock('@azure/identity', () => ({ DefaultAzureCredential: class {} }));

const { getSecret, isSecretNotFound, resetKeyVaultForTests, SECRET_CACHE_TTL_MS } =
  await import('./key-vault.js');

const original = { ...process.env };

describe('getSecret', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyVaultForTests();
    process.env.KEY_VAULT_URI = 'https://example.vault.azure.net';
  });

  afterEach(() => {
    process.env = { ...original };
    resetKeyVaultForTests();
  });

  it('returns the value', async () => {
    client.getSecret.mockResolvedValue({ value: 's3cret' });
    expect(await getSecret('GITHUB-APP-PRIVATE-KEY')).toBe('s3cret');
  });

  it('returns null with no vault configured, without constructing a client', async () => {
    delete process.env.KEY_VAULT_URI;
    resetKeyVaultForTests();
    expect(await getSecret('anything')).toBeNull();
    expect(client.getSecret).not.toHaveBeenCalled();
  });

  it('returns null only when the secret genuinely does not exist', async () => {
    client.getSecret.mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    expect(await getSecret('missing')).toBeNull();

    resetKeyVaultForTests();
    client.getSecret.mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'SecretNotFound' })
    );
    expect(await getSecret('missing')).toBeNull();
  });

  it('throws on throttling, denial, and network failure', async () => {
    // The whole point. A caller that sees `null` concludes the secret is not
    // configured; these say nothing about whether it is.
    for (const error of [
      Object.assign(new Error('throttled'), { statusCode: 429 }),
      Object.assign(new Error('forbidden'), { statusCode: 403 }),
      new Error('getaddrinfo ENOTFOUND'),
    ]) {
      resetKeyVaultForTests();
      client.getSecret.mockRejectedValue(error);
      await expect(getSecret('name')).rejects.toThrow(error.message);
    }
  });

  it('caches a hit, so a hot path does not spend the vault request budget', async () => {
    client.getSecret.mockResolvedValue({ value: 's3cret' });
    for (let i = 0; i < 10; i += 1) expect(await getSecret('name')).toBe('s3cret');
    expect(client.getSecret).toHaveBeenCalledTimes(1);
  });

  it('caches a genuine absence too', async () => {
    // Otherwise a secret that is legitimately not configured turns every call
    // into a round trip — the behaviour this change exists to remove, just on
    // the unhappy path.
    client.getSecret.mockRejectedValue(Object.assign(new Error('nope'), { statusCode: 404 }));
    for (let i = 0; i < 5; i += 1) expect(await getSecret('missing')).toBeNull();
    expect(client.getSecret).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure it could not classify', async () => {
    // A throttle is a condition to retry, not a fact about the secret.
    client.getSecret.mockRejectedValue(Object.assign(new Error('throttled'), { statusCode: 429 }));
    await expect(getSecret('name')).rejects.toThrow();
    await expect(getSecret('name')).rejects.toThrow();
    expect(client.getSecret).toHaveBeenCalledTimes(2);
  });

  it('re-reads after the TTL expires', async () => {
    let clock = 1_000_000;
    client.getSecret.mockResolvedValue({ value: 'v1' });
    expect(await getSecret('name', { now: () => clock, ttlMs: 1000 })).toBe('v1');

    client.getSecret.mockResolvedValue({ value: 'v2' });
    expect(await getSecret('name', { now: () => clock, ttlMs: 1000 })).toBe('v1');

    clock += 1001;
    expect(await getSecret('name', { now: () => clock, ttlMs: 1000 })).toBe('v2');
  });

  it('caches per secret name', async () => {
    client.getSecret.mockImplementation(async (name) => ({ value: `value-of-${name}` }));
    expect(await getSecret('a')).toBe('value-of-a');
    expect(await getSecret('b')).toBe('value-of-b');
    expect(client.getSecret).toHaveBeenCalledTimes(2);
  });

  it('defaults to a five-minute TTL', () => {
    expect(SECRET_CACHE_TTL_MS).toBe(5 * 60 * 1000);
  });
});

describe('isSecretNotFound', () => {
  it('recognises both the status code and the service condition name', () => {
    expect(isSecretNotFound({ statusCode: 404 })).toBe(true);
    expect(isSecretNotFound({ code: 'SecretNotFound' })).toBe(true);
  });

  it('is false for anything that is not absence', () => {
    for (const error of [{ statusCode: 429 }, { statusCode: 403 }, new Error('boom'), null]) {
      expect(isSecretNotFound(error)).toBe(false);
    }
  });
});
