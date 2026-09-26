/**
 * The NVIDIA API Catalog provider (#701), end to end through the router.
 *
 * Kept apart from router.test.js because every assertion here is about the
 * ways this provider is deliberately DIFFERENT from the other three: placed
 * per feature, paced under the account's 40 RPM, failing over on its own
 * 400s, text only, and free. No test reaches the network — there is no key.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createAiRouter,
  createRequestPacer,
  getCostEstimate,
  DEFAULT_MODEL_TABLE,
  NVIDIA_BASE_URL,
  NVIDIA_DEFAULT_RPM,
} from './router.js';
import { recordAiUsage } from './usage.js';

const noSleep = vi.fn(async () => {});
const quiet = { warn: vi.fn() };

const KEYS = {
  GEMINI_API_KEY: 'g',
  OPENAI_API_KEY: 'o',
  ANTHROPIC_API_KEY: 'a',
  NVIDIA_API_KEY: 'nvapi-test',
};

const HOSTS = {
  'generativelanguage.googleapis.com': 'gemini',
  'api.openai.com': 'openai',
  'api.anthropic.com': 'anthropic',
  'integrate.api.nvidia.com': 'nvidia',
};

const ANSWER = JSON.stringify({
  content: [{ type: 'text', text: '{}' }],
  choices: [{ message: { content: '{}' } }],
  candidates: [{ content: { parts: [{ text: '{}' }] } }],
  usage: { prompt_tokens: 120, completion_tokens: 30 },
});

/**
 * A fetch that fails the named providers with `status` (or a function of the
 * call count) and answers for everyone else. `providers()` lists who was hit.
 */
function fetchFailing(failing = [], status = 500, message = 'boom') {
  const calls = [];
  const impl = vi.fn(async (url) => {
    const provider = HOSTS[new URL(url).host];
    calls.push(provider);
    if (failing.includes(provider)) {
      return { ok: false, status, text: async () => JSON.stringify({ error: { message } }) };
    }
    return { ok: true, status: 200, text: async () => ANSWER };
  });
  impl.providers = () => calls;
  return impl;
}

const storeOf = (providers = [], features = null) => ({
  queryDocs: vi.fn(async () => providers),
  readDoc: vi.fn(async () => features),
});

const router = (fetchImpl, { env = {}, ...rest } = {}) =>
  createAiRouter({
    env: { ...KEYS, ...env },
    fetch: fetchImpl,
    sleep: noSleep,
    log: quiet,
    ...rest,
  });

describe('availability — a key makes it possible', () => {
  it('is available when NVIDIA_API_KEY is present, and only then', () => {
    expect(createAiRouter({ env: { NVIDIA_API_KEY: 'nvapi-x' }, log: quiet }).availableProviders()).toEqual(
      ['nvidia']
    );
    expect(createAiRouter({ env: {}, log: quiet }).availableProviders()).toEqual([]);
  });

  it('treats an unseeded Key Vault reference as no key, like the others', () => {
    const r = createAiRouter({
      env: { NVIDIA_API_KEY: '@Microsoft.KeyVault(SecretUri=https://kv/secrets/NVIDIA-API-KEY)' },
      log: quiet,
    });
    expect(r.availableProviders()).toEqual([]);
  });

  it('sits last in the global order; placement, not order, puts it first', () => {
    expect(router(fetchFailing()).availableProviders()).toEqual([
      'gemini',
      'openai',
      'anthropic',
      'nvidia',
    ]);
  });
});

describe('request shape — the OpenAI-compatible path at the NVIDIA base URL', () => {
  it('posts to integrate.api.nvidia.com with Bearer auth and the purpose model', async () => {
    const fetchImpl = fetchFailing();
    const r = router(fetchImpl, { env: { GEMINI_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' } });
    await r.generateJsonResponse({
      prompt: 'write it',
      systemPrompt: 'You are an editor.',
      purpose: 'draft',
      feature: 'forgeDrafting',
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(NVIDIA_BASE_URL).toBe('https://integrate.api.nvidia.com/v1');
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer nvapi-test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe(DEFAULT_MODEL_TABLE.nvidia.draft[1]);
    expect(body.model).toBe('z-ai/glm-5.3');
    expect(body.max_tokens).toBe(8192);
    expect(body.temperature).toBe(0.2);
    // Plain-string content, and JSON asked for in words, not response_format.
    expect(body.messages).toEqual([
      { role: 'system', content: expect.stringMatching(/^You are an editor\.\n\nReturn only valid JSON/) },
      { role: 'user', content: 'write it' },
    ]);
    expect(body).not.toHaveProperty('response_format');
  });

  it('text parts are joined into one string', async () => {
    const fetchImpl = fetchFailing();
    const r = router(fetchImpl);
    await r.generateTextResponse({
      parts: [{ text: 'one' }, { text: 'two' }],
      feature: 'forgeDrafting',
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'one\n\ntwo' });
  });

  it('honours the env override for a purpose model', async () => {
    const fetchImpl = fetchFailing();
    const r = router(fetchImpl, { env: { CONTENTFORGE_NVIDIA_ANALYSIS_MODEL: 'moonshotai/kimi-k3' } });
    await r.generateJsonResponse({ prompt: 'x', purpose: 'analysis', feature: 'forgeGrading' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('moonshotai/kimi-k3');
  });

  it('strips inline <think> blocks from the answer', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: '<think>plan the piece</think>\n{"title":"T"}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
    }));
    const out = await router(fetchImpl).generateJsonResponse({ prompt: 'x', feature: 'inspector' });
    expect(out).toEqual({ title: 'T' });
  });

  it('the admin Test path reaches it by name', async () => {
    const fetchImpl = fetchFailing();
    const out = await router(fetchImpl).callProvider({ provider: 'nvidia', prompt: 'ping' });
    expect(out).toMatchObject({ text: '{}', promptTokens: 120, completionTokens: 30 });
    expect(out.model).toBe('z-ai/glm-5.3-flash');
    expect(fetchImpl.providers()).toEqual(['nvidia']);
  });
});

describe('per-feature placement', () => {
  it('goes FIRST for owner-triggered content features', async () => {
    for (const feature of [
      'inspector',
      'critique',
      'forgeDrafting',
      'forgeGrading',
      'voiceCalibration',
      'socialCaption',
      'listenAndLearn',
      'podcastScript',
    ]) {
      const fetchImpl = fetchFailing();
      await router(fetchImpl).generateJsonResponse({ prompt: 'x', feature });
      expect(fetchImpl.providers(), feature).toEqual(['nvidia']);
    }
  });

  it('keeps the global order (last) for the Telegram assistant', async () => {
    const fetchImpl = fetchFailing();
    const r = router(fetchImpl);
    expect((await r.resolveProviderChain('telegram')).map((c) => c.provider)).toEqual([
      'gemini',
      'openai',
      'anthropic',
      'nvidia',
    ]);
  });

  it('is never used by a call that names no feature', async () => {
    const r = router(fetchFailing());
    expect((await r.resolveProviderChain(null)).map((c) => c.provider)).not.toContain('nvidia');
  });

  it('a stored placement can demote it to the global order or switch it off', async () => {
    const demoted = router(fetchFailing(), {
      store: storeOf([], { placement: { nvidia: { forgeDrafting: 'order', critique: 'off' } } }),
    });
    expect((await demoted.resolveProviderChain('forgeDrafting')).map((c) => c.provider)).toEqual([
      'gemini',
      'openai',
      'anthropic',
      'nvidia',
    ]);
    expect((await demoted.resolveProviderChain('critique')).map((c) => c.provider)).not.toContain(
      'nvidia'
    );
    // Untouched features keep their default.
    expect((await demoted.resolveProviderChain('inspector'))[0].provider).toBe('nvidia');
  });

  it('switched off globally in the portal, it is off for every feature', async () => {
    const r = router(fetchFailing(), { store: storeOf([{ id: 'nvidia', enabled: false }]) });
    expect((await r.resolveProviderChain('forgeDrafting')).map((c) => c.provider)).toEqual([
      'gemini',
      'openai',
      'anthropic',
    ]);
  });

  it('uses the model an administrator pinned for it', async () => {
    const fetchImpl = fetchFailing();
    const r = router(fetchImpl, {
      store: storeOf([{ id: 'nvidia', enabled: true, defaultModel: 'z-ai/glm-5.3-flash' }]),
    });
    await r.generateTextResponse({ prompt: 'x', purpose: 'draft', feature: 'forgeDrafting' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('z-ai/glm-5.3-flash');
  });
});

describe('the anonymous public features never route to it', () => {
  const PUBLIC = ['pricingExplain', 'landingZoneExplain'];

  it('not by default, with every key present', async () => {
    for (const feature of PUBLIC) {
      const fetchImpl = fetchFailing();
      await router(fetchImpl).generateJsonResponse({ prompt: 'x', feature });
      expect(fetchImpl.providers(), feature).toEqual(['gemini']);
    }
  });

  it('not even when a stored placement asks for it — configuration cannot enable', async () => {
    const r = router(fetchFailing(), {
      store: storeOf([{ id: 'nvidia', enabled: true, order: 0 }], {
        placement: { nvidia: { pricingExplain: 'first', landingZoneExplain: 'order' } },
      }),
    });
    for (const feature of PUBLIC) {
      expect((await r.resolveProviderChain(feature)).map((c) => c.provider), feature).not.toContain(
        'nvidia'
      );
    }
  });

  it('not when every provider above it fails — the chain simply ends', async () => {
    const fetchImpl = fetchFailing(['gemini', 'openai', 'anthropic'], 503);
    await expect(
      router(fetchImpl).generateJsonResponse({ prompt: 'x', feature: 'pricingExplain' })
    ).rejects.toThrow(/503/);
    expect(fetchImpl.providers()).not.toContain('nvidia');
  });

  it('not through a CONTENTFORGE_AI_PROVIDER pin', async () => {
    const log = { warn: vi.fn() };
    const fetchImpl = fetchFailing();
    await router(fetchImpl, { env: { CONTENTFORGE_AI_PROVIDER: 'nvidia' }, log }).generateJsonResponse({
      prompt: 'x',
      feature: 'landingZoneExplain',
    });
    expect(fetchImpl.providers()).toEqual(['gemini']);
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/not used for 'landingZoneExplain'/));
  });

  it('with only an NVIDIA key, the call fails before anything is sent, saying why', async () => {
    const fetchImpl = fetchFailing();
    const r = createAiRouter({ env: { NVIDIA_API_KEY: 'nvapi-x' }, fetch: fetchImpl, log: quiet });
    await expect(r.generateJsonResponse({ prompt: 'x', feature: 'pricingExplain' })).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
      message: expect.stringMatching(/\(nvidia\) is not used for 'pricingExplain'/),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('failover from nvidia to the next provider', () => {
  it.each([
    [429, 'rate limit exceeded'],
    [500, 'internal error'],
    [503, 'service unavailable'],
    [404, 'Function not found for account'],
    [400, 'max_tokens exceeds the model limit'],
    [422, 'unprocessable'],
  ])('fails over on %i', async (status, message) => {
    const fetchImpl = fetchFailing(['nvidia'], status, message);
    await expect(
      router(fetchImpl).generateJsonResponse({ prompt: 'x', feature: 'forgeDrafting' })
    ).resolves.toEqual({});
    expect(fetchImpl.providers().at(-1)).toBe('gemini');
    expect(fetchImpl.providers().filter((p) => p !== 'nvidia')).toEqual(['gemini']);
  });

  it('retries a real 429 with backoff before failing over', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = fetchFailing(['nvidia'], 429, 'Too Many Requests');
    await createAiRouter({ env: KEYS, fetch: fetchImpl, sleep, log: quiet }).generateTextResponse({
      prompt: 'x',
      feature: 'forgeDrafting',
    });
    expect(fetchImpl.providers()).toEqual(['nvidia', 'nvidia', 'nvidia', 'gemini']);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 4000]);
  });

  it('an unknown model fails over too — a retired catalogue id is a 404', async () => {
    const fetchImpl = fetchFailing(['nvidia'], 404, "Model 'z-ai/glm-5.3' not found");
    const usage = [];
    await router(fetchImpl).generateTextResponse({ prompt: 'x', feature: 'socialCaption', usageOut: usage });
    expect(fetchImpl.providers()).toEqual(['nvidia', 'gemini']);
    expect(usage.at(-1).provider).toBe('gemini');
  });

  it('a timeout is not retried on nvidia; it fails over at once', async () => {
    const sleep = vi.fn(async () => {});
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      const provider = HOSTS[new URL(url).host];
      calls.push(provider);
      if (provider === 'nvidia') {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      return { ok: true, status: 200, text: async () => ANSWER };
    });
    await createAiRouter({ env: KEYS, fetch: fetchImpl, sleep, log: quiet }).generateTextResponse({
      prompt: 'x',
      feature: 'forgeDrafting',
    });
    expect(calls).toEqual(['nvidia', 'gemini']);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('a 400 from the OTHER providers still does not fail over', async () => {
    // The nvidia exception is scoped: the frontier APIs keep the old rule.
    const fetchImpl = fetchFailing(['gemini', 'openai', 'anthropic'], 400, 'invalid request');
    await expect(
      router(fetchImpl).generateTextResponse({ prompt: 'x', feature: 'telegram' })
    ).rejects.toThrow(/400/);
    expect(fetchImpl.providers()).toEqual(['gemini']);
  });

  it('reports a rejected key under NVIDIA_API_KEY, then fails over', async () => {
    const onKeyVerdict = vi.fn(async () => {});
    const fetchImpl = fetchFailing(['nvidia'], 401, 'Unauthorized');
    await router(fetchImpl, { onKeyVerdict }).generateTextResponse({
      prompt: 'x',
      feature: 'forgeDrafting',
    });
    expect(onKeyVerdict).toHaveBeenCalledWith(
      'NVIDIA_API_KEY',
      expect.objectContaining({ ok: false, status: 401 })
    );
    expect(fetchImpl.providers()).toEqual(['nvidia', 'gemini']);
  });
});

describe('text only', () => {
  it('is left out of a call that carries an image, which goes to the next provider', async () => {
    const fetchImpl = fetchFailing();
    await router(fetchImpl).generateJsonResponse({
      parts: [{ text: 'describe' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }],
      feature: 'inspector',
    });
    expect(fetchImpl.providers()).toEqual(['gemini']);
  });

  it('says so when it is the only provider for an image call', async () => {
    const fetchImpl = fetchFailing();
    const r = createAiRouter({ env: { NVIDIA_API_KEY: 'n' }, fetch: fetchImpl, log: quiet });
    await expect(
      r.generateJsonResponse({
        parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }],
        feature: 'inspector',
      })
    ).rejects.toThrow(/takes text only/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('pacing guard — under the ~40 RPM account limit', () => {
  it('defaults below 40 requests a minute', () => {
    expect(NVIDIA_DEFAULT_RPM).toBeLessThan(40);
    expect(NVIDIA_DEFAULT_RPM).toBeGreaterThan(0);
  });

  it('the pacer grants at most `limit` in any rolling window', () => {
    let t = 0;
    const pacer = createRequestPacer({ limit: 3, windowMs: 60_000, now: () => t });
    expect([pacer.take(), pacer.take(), pacer.take(), pacer.take()]).toEqual([true, true, true, false]);
    t = 59_999;
    expect(pacer.take()).toBe(false);
    t = 60_000; // the three grants at t=0 leave the window together
    expect(pacer.take()).toBe(true);
    expect(pacer.used()).toBe(1);
  });

  it('never lets the default limit through in one minute', () => {
    let t = 0;
    const pacer = createRequestPacer({ limit: NVIDIA_DEFAULT_RPM, now: () => t });
    let granted = 0;
    for (let i = 0; i < 100; i += 1) {
      t = i * 500; // 100 requests over 50 s
      if (pacer.take()) granted += 1;
    }
    expect(granted).toBe(NVIDIA_DEFAULT_RPM);
  });

  it('a burst past the limit fails over without sending, retrying or sleeping', async () => {
    let t = 1_000;
    const sleep = vi.fn(async () => {});
    const fetchImpl = fetchFailing();
    const r = createAiRouter({
      env: { ...KEYS, NVIDIA_REQUESTS_PER_MINUTE: '2' },
      fetch: fetchImpl,
      sleep,
      log: quiet,
      now: () => t,
    });
    for (let i = 0; i < 4; i += 1) {
      await r.generateTextResponse({ prompt: 'draft', feature: 'forgeDrafting' });
    }
    expect(fetchImpl.providers()).toEqual(['nvidia', 'nvidia', 'gemini', 'gemini']);
    expect(sleep).not.toHaveBeenCalled();

    t += 60_000; // the window empties and nvidia serves again
    await r.generateTextResponse({ prompt: 'draft', feature: 'forgeDrafting' });
    expect(fetchImpl.providers().at(-1)).toBe('nvidia');
  });

  it('a pinned nvidia that is paced fails with the pacing reason, not silently elsewhere', async () => {
    const t = 0;
    const fetchImpl = fetchFailing();
    const r = createAiRouter({
      env: { ...KEYS, NVIDIA_REQUESTS_PER_MINUTE: '1', CONTENTFORGE_AI_PROVIDER: 'nvidia' },
      fetch: fetchImpl,
      sleep: noSleep,
      log: quiet,
      now: () => t,
    });
    await r.generateTextResponse({ prompt: 'x', feature: 'forgeDrafting' });
    await expect(r.generateTextResponse({ prompt: 'x', feature: 'forgeDrafting' })).rejects.toMatchObject({
      code: 'AI_PACED',
      status: 429,
    });
    expect(fetchImpl.providers()).toEqual(['nvidia']);
  });

  it('ignores a nonsense override and keeps the default', async () => {
    let t = 0;
    const fetchImpl = fetchFailing();
    const r = createAiRouter({
      env: { NVIDIA_API_KEY: 'n', NVIDIA_REQUESTS_PER_MINUTE: 'lots' },
      fetch: fetchImpl,
      sleep: noSleep,
      log: quiet,
      now: () => t,
    });
    for (let i = 0; i < NVIDIA_DEFAULT_RPM; i += 1) {
      t += 10;
      await r.callProvider({ provider: 'nvidia', prompt: 'x' });
    }
    await expect(r.callProvider({ provider: 'nvidia', prompt: 'x' })).rejects.toMatchObject({
      code: 'AI_PACED',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(NVIDIA_DEFAULT_RPM);
  });
});

describe('usage — recorded, at zero cost', () => {
  it('the router records the call as nvidia with costUsd 0', async () => {
    const usageOut = [];
    await router(fetchFailing()).generateTextResponse({
      prompt: 'x',
      feature: 'podcastScript',
      usageOut,
    });
    expect(usageOut).toEqual([
      {
        provider: 'nvidia',
        model: DEFAULT_MODEL_TABLE.nvidia.general[1],
        promptTokens: 120,
        completionTokens: 30,
        costUsd: 0,
      },
    ]);
  });

  it('every default model, and any other model, prices at zero', () => {
    for (const [, model] of Object.values(DEFAULT_MODEL_TABLE.nvidia)) {
      expect(getCostEstimate('nvidia', model, 1_000_000, 1_000_000), model).toBe(0);
    }
    expect(getCostEstimate('nvidia', 'moonshotai/kimi-k3', 5_000_000, 5_000_000)).toBe(0);
  });

  it('the ai_usage writer stores it with estimatedCostUsd 0 and real token totals', async () => {
    const store = { upsertDoc: vi.fn(async () => {}) };
    const row = await recordAiUsage(
      { store, ai: { getCostEstimate }, uuid: () => 'id-1', now: () => new Date('2026-09-25T00:00:00Z') },
      { provider: 'nvidia', model: 'z-ai/glm-5.3', promptTokens: 900, completionTokens: 2100 }
    );
    expect(row).toMatchObject({
      provider: 'nvidia',
      totalTokens: 3000,
      estimatedCostUsd: 0,
    });
    expect(store.upsertDoc).toHaveBeenCalledWith('ai_usage', row);
  });
});
