/**
 * The ElevenLabs account read (#432, free plan from 2026-09-26).
 *
 * What is pinned: the subscription is read from the documented endpoint with
 * the key header and nothing else; its figures are normalised the same way
 * every time, including the free plan and usage-based billing; a read that
 * fails says why, in a sentence that names the fix, and is retried only when
 * a retry could help; and the cache shares one read between callers without
 * ever holding the key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  API_KEYS_PAGE,
  CREDITS_PER_CHARACTER,
  SUBSCRIPTION_CACHE_TTL_MS,
  SUBSCRIPTION_URL,
  assertCreditsCover,
  clearSubscriptionCache,
  creditShortfall,
  creditsNeeded,
  describeShortfall,
  errorCode,
  invalidateSubscription,
  isFreePlan,
  normalizeSubscription,
  readSubscription,
} from './elevenlabs-account.js';

const FREE = {
  tier: 'free',
  status: 'free',
  character_count: 1234,
  character_limit: 10000,
  next_character_count_reset_unix: 1792972800, // 2026-10-26T00:00:00Z
  can_extend_character_limit: false,
  max_credit_limit_extension: 0,
};

const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const fail = (status, body = '') => ({
  ok: false,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const noSleep = async () => {};

beforeEach(() => {
  clearSubscriptionCache();
});

describe('normalizeSubscription', () => {
  it('reads the free plan: tier, credits used, limit, left and the reset date', () => {
    expect(normalizeSubscription(FREE)).toEqual({
      tier: 'free',
      status: 'free',
      freePlan: true,
      creditsUsed: 1234,
      creditLimit: 10000,
      creditsLeft: 8766,
      overageCredits: 0,
      resetAt: '2026-10-26T00:00:00.000Z',
    });
  });

  it('reads a paid plan as not free, and never reports negative credits left', () => {
    const paid = normalizeSubscription({
      ...FREE,
      tier: 'creator',
      status: 'active',
      character_count: 125_000,
      character_limit: 121_000,
    });
    expect(paid.freePlan).toBe(false);
    expect(paid.creditsLeft).toBe(0);
  });

  it('counts usage-based billing only when the account is entitled to it', () => {
    const entitled = { ...FREE, tier: 'pro', status: 'active', can_extend_character_limit: true };
    expect(normalizeSubscription({ ...entitled, max_credit_limit_extension: 5000 }).overageCredits).toBe(5000);
    expect(normalizeSubscription({ ...entitled, max_credit_limit_extension: 'unlimited' }).overageCredits).toBe(
      'unlimited'
    );
    expect(normalizeSubscription({ ...entitled, max_credit_limit_extension: 0 }).overageCredits).toBe(0);
    // The deprecated spelling is read only when the current one is absent.
    expect(
      normalizeSubscription({
        ...entitled,
        max_credit_limit_extension: undefined,
        max_character_limit_extension: 700,
      }).overageCredits
    ).toBe(700);
    expect(normalizeSubscription({ ...FREE, max_credit_limit_extension: 5000 }).overageCredits).toBe(0);
  });

  it('reports no reset date rather than 1970 when ElevenLabs gives none', () => {
    expect(normalizeSubscription({ ...FREE, next_character_count_reset_unix: null }).resetAt).toBeNull();
    expect(normalizeSubscription({ ...FREE, next_character_count_reset_unix: undefined }).resetAt).toBeNull();
  });

  it('refuses an answer without the credit figures, as an unavailable subscription', () => {
    for (const body of [{}, { ...FREE, character_count: null }, { ...FREE, character_limit: 'lots' }]) {
      expect(() => normalizeSubscription(body)).toThrow(
        expect.objectContaining({ code: 'subscription_unavailable', provider: 'elevenlabs' })
      );
    }
  });
});

describe('isFreePlan and errorCode', () => {
  it('knows the free plan by its tier or its status', () => {
    expect(isFreePlan({ tier: 'free' })).toBe(true);
    expect(isFreePlan({ tier: 'Free' })).toBe(true);
    expect(isFreePlan({ tier: null, status: 'free_disabled' })).toBe(true);
    expect(isFreePlan({ tier: 'starter', status: 'active' })).toBe(false);
    expect(isFreePlan({})).toBe(false);
  });

  it('prefers the current `code` and falls back to the legacy `status`', () => {
    expect(errorCode(JSON.stringify({ detail: { code: 'insufficient_permissions', status: 'x' } }))).toBe(
      'insufficient_permissions'
    );
    expect(errorCode(JSON.stringify({ detail: { status: 'MISSING_PERMISSIONS' } }))).toBe(
      'missing_permissions'
    );
    expect(errorCode('<html>bad gateway</html>')).toBe('');
    expect(errorCode('')).toBe('');
  });
});

describe('readSubscription', () => {
  it('GETs the documented endpoint with the key header', async () => {
    const fetchImpl = vi.fn(async () => ok(FREE));
    const account = await readSubscription({ key: 'xi-key', fetchImpl, sleep: noSleep });
    expect(account.creditsLeft).toBe(8766);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(SUBSCRIPTION_URL);
    expect(SUBSCRIPTION_URL).toBe('https://api.elevenlabs.io/v1/user/subscription');
    expect(init).toEqual({
      method: 'GET',
      headers: { 'xi-api-key': 'xi-key', Accept: 'application/json' },
    });
  });

  it('shares one read for the cache window, per key, and reads again after it', async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const fetchImpl = vi.fn(async () => ok(FREE));

    await readSubscription({ key: 'k1', fetchImpl, sleep: noSleep, now });
    await readSubscription({ key: 'k1', fetchImpl, sleep: noSleep, now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await readSubscription({ key: 'k2', fetchImpl, sleep: noSleep, now });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // another key is another account

    clock += SUBSCRIPTION_CACHE_TTL_MS + 1;
    await readSubscription({ key: 'k1', fetchImpl, sleep: noSleep, now });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(SUBSCRIPTION_CACHE_TTL_MS).toBeLessThanOrEqual(60_000); // seconds, not minutes
  });

  it('reads fresh after an invalidation, or when asked not to use the cache', async () => {
    const fetchImpl = vi.fn(async () => ok(FREE));
    await readSubscription({ key: 'k', fetchImpl, sleep: noSleep });
    invalidateSubscription('k');
    await readSubscription({ key: 'k', fetchImpl, sleep: noSleep });
    await readSubscription({ key: 'k', fetchImpl, sleep: noSleep, useCache: false });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not cache a failure', async () => {
    const responses = [fail(503), fail(503), fail(503), ok(FREE)];
    const fetchImpl = vi.fn(async () => responses.shift());
    await expect(readSubscription({ key: 'k', fetchImpl, sleep: noSleep })).rejects.toMatchObject({
      code: 'subscription_unavailable',
    });
    await expect(readSubscription({ key: 'k', fetchImpl, sleep: noSleep })).resolves.toMatchObject({
      tier: 'free',
    });
  });

  it('names the permission and where to set it when the key cannot read the account', async () => {
    for (const [status, body] of [
      [401, { detail: { status: 'missing_permissions' } }],
      [403, { detail: { type: 'authorization_error', code: 'insufficient_permissions' } }],
      [403, ''],
    ]) {
      clearSubscriptionCache();
      const fetchImpl = vi.fn(async () => fail(status, body));
      const attempt = readSubscription({ key: 'k', fetchImpl, sleep: noSleep });
      await expect(attempt).rejects.toMatchObject({ status, code: 'subscription_unavailable' });
      await expect(attempt).rejects.toThrow(
        `the key needs the User → Read permission (user_read), set at ${API_KEYS_PAGE}`
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1); // a retry cannot grant a permission
    }
    expect(API_KEYS_PAGE).toBe('https://elevenlabs.io/app/developers/api-keys');
  });

  it('says a rejected key is a rejected key, not a missing permission', async () => {
    const fetchImpl = vi.fn(async () => fail(401, { detail: { code: 'invalid_api_key' } }));
    await expect(readSubscription({ key: 'k', fetchImpl, sleep: noSleep })).rejects.toThrow(
      /HTTP 401 invalid_api_key: ElevenLabs rejected the key\); nothing was sent/
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries 429, 5xx and network failures three times, then says what failed', async () => {
    const sleep = vi.fn(async () => {});
    const fiveHundreds = vi.fn(async () => fail(502, 'upstream'));
    await expect(readSubscription({ key: 'k', fetchImpl: fiveHundreds, sleep })).rejects.toThrow(
      /Could not read the ElevenLabs subscription \(HTTP 502: upstream\)/
    );
    expect(fiveHundreds).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    const offline = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    await expect(readSubscription({ key: 'k', fetchImpl: offline, sleep: noSleep })).rejects.toThrow(
      /could not reach ElevenLabs: ENOTFOUND/
    );
    expect(offline).toHaveBeenCalledTimes(3);
  });

  it('refuses a 2xx that is not JSON, and a call with no key, without guessing', async () => {
    const notJson = vi.fn(async () => ({ ok: true, status: 200, text: async () => '<html/>' }));
    await expect(readSubscription({ key: 'k', fetchImpl: notJson, sleep: noSleep })).rejects.toThrow(
      /the answer was not JSON/
    );
    const fetchImpl = vi.fn();
    await expect(readSubscription({ key: '', fetchImpl })).rejects.toThrow(
      /ELEVENLABS_API_KEY is not configured/
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never puts the key in an error message', async () => {
    const key = 'test-key-that-must-not-be-printed';
    const fetchImpl = vi.fn(async () => fail(401, { detail: { code: 'invalid_api_key' } }));
    const err = await readSubscription({ key, fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(err.message).not.toContain(key);
  });
});

describe('the arithmetic', () => {
  const account = normalizeSubscription(FREE); // 8,766 left

  it('bills one credit per character, rounded up', () => {
    expect(CREDITS_PER_CHARACTER).toBe(1);
    expect(creditsNeeded(300)).toBe(300);
    expect(creditsNeeded(0)).toBe(0);
    expect(creditsNeeded(-5)).toBe(0);
  });

  it('clears a job the credits left cover, including one that spends them exactly', () => {
    expect(creditShortfall(account, 8766)).toBeNull();
    expect(creditShortfall(account, 300)).toBeNull();
  });

  it('reports what the account is short by', () => {
    expect(creditShortfall(account, 9000)).toEqual({
      needed: 9000,
      left: 8766,
      limit: 10000,
      overage: 0,
      resetAt: '2026-10-26T00:00:00.000Z',
      tier: 'free',
    });
  });

  it('counts an unlimited extension as unlimited', () => {
    const unlimited = { ...account, overageCredits: 'unlimited' };
    expect(creditShortfall(unlimited, 10_000_000)).toBeNull();
  });

  it('writes the refusal as one sentence with every figure and the reset date', () => {
    expect(describeShortfall(creditShortfall(account, 9000))).toBe(
      'ElevenLabs has 8,766 credits left of 10,000, this episode needs 9,000; ' +
        'the allowance resets on 2026-10-26 (UTC). Nothing was sent, so no credits were spent.'
    );
    expect(
      describeShortfall({ needed: 10, left: 0, limit: 10000, overage: 0, resetAt: null })
    ).toMatch(/ElevenLabs did not say when the allowance resets/);
    expect(
      describeShortfall({ needed: 9000, left: 100, limit: 121000, overage: 500, resetAt: null })
    ).toMatch(/100 credits left of 121,000 \(plus 500 of usage-based billing\)/);
  });

  it('assertCreditsCover returns the account it cleared, or throws the pre-flight refusal', async () => {
    const fetchImpl = vi.fn(async () => ok(FREE));
    await expect(
      assertCreditsCover({ key: 'k', characters: 300, fetchImpl, sleep: noSleep })
    ).resolves.toMatchObject({ freePlan: true, creditsLeft: 8766 });

    const refused = await assertCreditsCover({
      key: 'k',
      characters: 9000,
      fetchImpl,
      sleep: noSleep,
    }).catch((e) => e);
    expect(refused).toMatchObject({
      name: 'SpeechError',
      code: 'quota_exceeded',
      status: null,
      details: { preflight: true, needed: 9000, left: 8766 },
    });
  });
});
