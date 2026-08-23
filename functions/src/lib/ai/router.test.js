import { describe, it, expect, vi } from 'vitest';
import {
  createAiRouter,
  readKey,
  parseJsonWithFallbacks,
  isRetryableError,
  getCostEstimate,
  COST_TABLE,
  DEFAULT_MODEL_TABLE,
  PROVIDERS,
} from './router.js';

const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const fail = (status, body = {}) => ({ ok: false, status, text: async () => JSON.stringify(body) });
const noSleep = vi.fn(async () => {});
const quiet = { warn: vi.fn() };

const anthropicReply = (text, usage = { input_tokens: 10, output_tokens: 5 }) =>
  ok({ content: [{ type: 'text', text }], usage });
const openaiReply = (text, usage = { prompt_tokens: 10, completion_tokens: 5 }) =>
  ok({ choices: [{ message: { content: text } }], usage });
const geminiReply = (
  text,
  usage = { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2 }
) => ok({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: usage });

describe('provider resolution — by key presence', () => {
  it('no key → no provider, and the generate calls fail with AI_NOT_CONFIGURED', async () => {
    const r = createAiRouter({ env: {}, fetch: vi.fn(), sleep: noSleep, log: quiet });
    expect(r.availableProviders()).toEqual([]);
    expect(r.getActiveAiProvider()).toBeNull();
    await expect(r.generateJsonResponse({ prompt: 'x' })).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
    await expect(r.generateTextResponse({ prompt: 'x' })).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
  });

  it('orders Gemini, OpenAI, Anthropic; a pin wins only if its key exists', () => {
    // Owner decision 2026-08-23, reversing the ported Anthropic-first order.
    // Cost, not quality: see DEFAULT_PROVIDER_ORDER in ai-config.js.
    const env = { OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' };
    expect(createAiRouter({ env, log: quiet }).getActiveAiProvider()).toBe('openai');
    expect(
      createAiRouter({ env: { ...env, GEMINI_API_KEY: 'g' }, log: quiet }).getActiveAiProvider()
    ).toBe('gemini');
    expect(
      createAiRouter({
        env: { ...env, CONTENTFORGE_AI_PROVIDER: 'anthropic' },
        log: quiet,
      }).getActiveAiProvider()
    ).toBe('anthropic');
    const log = { warn: vi.fn() };
    expect(
      createAiRouter({
        env: { ...env, CONTENTFORGE_AI_PROVIDER: 'gemini' },
        log,
      }).getActiveAiProvider()
    ).toBe('openai');
    expect(log.warn).toHaveBeenCalled();
  });

  it('treats an unresolved Key Vault reference, a BOM-only or blank value as no key', () => {
    expect(readKey({ K: '@Microsoft.KeyVault(SecretUri=https://kv/secrets/X)' }, 'K')).toBe('');
    expect(readKey({ K: '\uFEFF   ' }, 'K')).toBe('');
    expect(readKey({ K: '\uFEFFsk-real' }, 'K')).toBe('sk-real');
    expect(readKey({}, 'K')).toBe('');
    const r = createAiRouter({
      env: { ANTHROPIC_API_KEY: '@Microsoft.KeyVault(SecretUri=x)' },
      log: quiet,
    });
    expect(r.availableProviders()).toEqual([]);
  });
});

describe('request shaping', () => {
  it('anthropic: JSON mode adds the uncached JSON-only block after the cached system prompt', async () => {
    const fetch = vi.fn(async () => anthropicReply('{"a":1}'));
    const r = createAiRouter({
      env: { ANTHROPIC_API_KEY: 'a' },
      fetch,
      sleep: noSleep,
      log: quiet,
    });
    const usageOut = [];
    const out = await r.generateJsonResponse({
      prompt: 'p',
      systemPrompt: 'S',
      purpose: 'analysis',
      usageOut,
    });
    expect(out).toEqual({ a: 1 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('a');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.system[0]).toMatchObject({ text: 'S', cache_control: { type: 'ephemeral' } });
    expect(body.system[1].text).toMatch(/only valid JSON/);
    expect(usageOut[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      promptTokens: 10,
      completionTokens: 5,
    });
    expect(usageOut[0].costUsd).toBeCloseTo((10 * 3 + 5 * 15) / 1_000_000, 12);
  });

  it('openai: json_object response format, system message first, model from env override', async () => {
    const fetch = vi.fn(async () => openaiReply('{"b":2}'));
    const r = createAiRouter({
      env: { OPENAI_API_KEY: 'o', CONTENTFORGE_OPENAI_MODEL: 'gpt-custom' },
      fetch,
      sleep: noSleep,
      log: quiet,
    });
    expect(await r.generateJsonResponse({ prompt: 'p', systemPrompt: 'S' })).toEqual({ b: 2 });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: 'gpt-custom', response_format: { type: 'json_object' } });
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer o');
  });

  it('gemini: public API with the key header, JSON mime type, reasoning tokens counted as output', async () => {
    const fetch = vi.fn(async () => geminiReply('{"c":3}'));
    const r = createAiRouter({ env: { GEMINI_API_KEY: 'g' }, fetch, sleep: noSleep, log: quiet });
    const usageOut = [];
    expect(await r.generateJsonResponse({ prompt: 'p', systemPrompt: 'S', usageOut })).toEqual({
      c: 3,
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent'
    );
    expect(init.headers['x-goog-api-key']).toBe('g');
    const body = JSON.parse(init.body);
    expect(body.generationConfig).toEqual({
      temperature: 0.2,
      responseMimeType: 'application/json',
    });
    expect(body.systemInstruction.parts[0].text).toBe('S');
    expect(usageOut[0]).toMatchObject({
      provider: 'gemini',
      promptTokens: 10,
      completionTokens: 5,
    });
  });

  it("multimodal parts map to each provider's image shape", async () => {
    const parts = [
      { text: 'look' },
      { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
      { junk: true },
    ];
    const a = vi.fn(async () => anthropicReply('ok'));
    await createAiRouter({
      env: { ANTHROPIC_API_KEY: 'a' },
      fetch: a,
      sleep: noSleep,
      log: quiet,
    }).generateTextResponse({ parts });
    expect(JSON.parse(a.mock.calls[0][1].body).messages[0].content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ]);
    const o = vi.fn(async () => openaiReply('ok'));
    await createAiRouter({
      env: { OPENAI_API_KEY: 'o' },
      fetch: o,
      sleep: noSleep,
      log: quiet,
    }).generateTextResponse({ parts });
    expect(JSON.parse(o.mock.calls[0][1].body).messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAAA' },
    });
  });
});

describe('resilience', () => {
  it('retries retryable statuses with backoff and gives up on the rest', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(fail(429))
      .mockResolvedValueOnce(fail(503))
      .mockResolvedValueOnce(anthropicReply('done'));
    const sleep = vi.fn(async () => {});
    const r = createAiRouter({ env: { ANTHROPIC_API_KEY: 'a' }, fetch, sleep, log: quiet });
    expect(await r.generateTextResponse({ prompt: 'p' })).toBe('done');
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 4000]);

    const bad = vi.fn(async () => fail(400, { error: { message: 'bad request' } }));
    await expect(
      createAiRouter({
        env: { ANTHROPIC_API_KEY: 'a' },
        fetch: bad,
        sleep,
        log: quiet,
      }).generateTextResponse({ prompt: 'p' })
    ).rejects.toThrow(/400 bad request/);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(isRetryableError({ status: 408 })).toBe(true);
    expect(isRetryableError({ message: 'rate limited' })).toBe(true);
    expect(isRetryableError({ status: 401 })).toBe(false);
  });

  it('repairs malformed JSON with one text round trip, then surfaces the original error', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(anthropicReply('```json\n{"x": 1,\n```'))
      .mockResolvedValueOnce(anthropicReply('{"x": 1}'));
    const r = createAiRouter({
      env: { ANTHROPIC_API_KEY: 'a' },
      fetch,
      sleep: noSleep,
      log: quiet,
    });
    expect(await r.generateJsonResponse({ prompt: 'p' })).toEqual({ x: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body).messages[0].content[0].text).toMatch(
      /should be JSON but is malformed/
    );

    const hopeless = vi.fn(async () => anthropicReply('nope'));
    await expect(
      createAiRouter({
        env: { ANTHROPIC_API_KEY: 'a' },
        fetch: hopeless,
        sleep: noSleep,
        log: quiet,
      }).generateJsonResponse({ prompt: 'p' })
    ).rejects.toThrow(/parseable JSON/);
  });

  it('parseJsonWithFallbacks strips fences and extracts an embedded object', () => {
    expect(parseJsonWithFallbacks('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonWithFallbacks('Sure! {"a":\n"bc"} thanks')).toEqual({ a: 'b c' });
    expect(parseJsonWithFallbacks('')).toEqual({});
    expect(() => parseJsonWithFallbacks('no json here')).toThrow();
  });
});

describe('callProvider (admin test path)', () => {
  it('requires an explicit, configured provider and returns text with token counts', async () => {
    const fetch = vi.fn(async () => openaiReply('hi', { prompt_tokens: 7, completion_tokens: 2 }));
    const r = createAiRouter({ env: { OPENAI_API_KEY: 'o' }, fetch, sleep: noSleep, log: quiet });
    expect(await r.callProvider({ provider: 'openai', prompt: 'p' })).toEqual({
      text: 'hi',
      promptTokens: 7,
      completionTokens: 2,
      model: 'gpt-5-nano',
    });
    await expect(r.callProvider({ provider: 'anthropic', prompt: 'p' })).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
    await expect(r.callProvider({ provider: 'vertex', prompt: 'p' })).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
  });
});

describe('cost table (ported from upstream ai-model-router.cost.test.js)', () => {
  it('prices gemini-3.6-flash at the published rate, not the 2.5-flash fallback', () => {
    expect(COST_TABLE.gemini['gemini-3.6-flash']).toEqual([1.5, 7.5]);
    expect(COST_TABLE.gemini['gemini-3.6-flash']).not.toEqual(
      COST_TABLE.gemini['gemini-2.5-flash']
    );
    expect(COST_TABLE.vertex).toEqual(COST_TABLE.gemini); // history recorded as vertex prices identically
  });

  it('keeps the 2.5 rows, which price usage already recorded against them', () => {
    expect(COST_TABLE.gemini['gemini-2.5-pro']).toEqual([3.5, 10.5]);
    expect(COST_TABLE.gemini['gemini-2.5-flash-lite']).toEqual([0.1, 0.4]);
  });

  it('computes a real figure for a 3.6-flash call', () => {
    expect(getCostEstimate('gemini', 'gemini-3.6-flash', 1_000_000, 1_000_000)).toBeCloseTo(9.0, 6);
    expect(getCostEstimate('gemini', 'gemini-2.5-flash', 1_000_000, 1_000_000)).toBeCloseTo(2.8, 6);
    expect(getCostEstimate('nope', 'x', 1_000_000, 1_000_000)).toBe(0);
  });

  it('has an explicit row for every Anthropic and Gemini default (OpenAI gpt-5 rates are deliberately unpriced)', () => {
    const r = createAiRouter({ env: {}, log: quiet });
    for (const provider of ['anthropic', 'gemini']) {
      for (const purpose of Object.keys(DEFAULT_MODEL_TABLE[provider])) {
        const model = r.defaultModelFor(provider, purpose);
        expect(
          COST_TABLE[provider][model],
          `${provider}/${purpose} → ${model} has no COST_TABLE row`
        ).toBeDefined();
      }
    }
    expect(PROVIDERS).toEqual(['gemini', 'openai', 'anthropic']);
  });
});

describe('stored configuration, applied end to end', () => {
  const keys = { GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' };

  /** A store whose ai_providers rows and ai-features doc are given inline. */
  const storeOf = (providers, features = null) => ({
    queryDocs: vi.fn(async () => providers),
    readDoc: vi.fn(async () => features),
  });

  /** Captures which provider actually got called by looking at the URL. */
  function spyFetch() {
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          content: [{ type: 'text', text: '{}' }],
          choices: [{ message: { content: '{}' } }],
          candidates: [{ content: { parts: [{ text: '{}' }] } }],
        }),
    }));
    fetchImpl.host = () => new URL(fetchImpl.mock.calls.at(-1)[0]).host;
    return fetchImpl;
  }

  it('routes to Gemini by default when every key is present', async () => {
    const fetchImpl = spyFetch();
    const r = createAiRouter({ env: keys, fetch: fetchImpl, sleep: noSleep, log: quiet });
    await r.generateJsonResponse({ prompt: 'x' });
    expect(fetchImpl.host()).toBe('generativelanguage.googleapis.com');
  });

  it('a disabled provider is skipped even though its key is present', async () => {
    const fetchImpl = spyFetch();
    const r = createAiRouter({
      env: keys,
      fetch: fetchImpl,
      sleep: noSleep,
      log: quiet,
      store: storeOf([{ id: 'gemini', enabled: false }]),
    });
    await r.generateJsonResponse({ prompt: 'x' });
    expect(fetchImpl.host()).toBe('api.openai.com');
  });

  it('honours the configured order over the default one', async () => {
    const fetchImpl = spyFetch();
    const r = createAiRouter({
      env: keys,
      fetch: fetchImpl,
      sleep: noSleep,
      log: quiet,
      store: storeOf([
        { id: 'anthropic', enabled: true, order: 1 },
        { id: 'gemini', enabled: true, order: 2 },
      ]),
    });
    await r.generateJsonResponse({ prompt: 'x' });
    expect(fetchImpl.host()).toBe('api.anthropic.com');
  });

  it('uses the model an administrator pinned for that provider', async () => {
    const fetchImpl = spyFetch();
    const r = createAiRouter({
      env: keys,
      fetch: fetchImpl,
      sleep: noSleep,
      log: quiet,
      store: storeOf([{ id: 'gemini', enabled: true, defaultModel: 'gemini-2.5-pro' }]),
    });
    await r.generateJsonResponse({ prompt: 'x' });
    expect(fetchImpl.mock.calls.at(-1)[0]).toContain('gemini-2.5-pro');
  });

  it('an explicit model from the call site still wins over the pin', async () => {
    const fetchImpl = spyFetch();
    const r = createAiRouter({
      env: keys,
      fetch: fetchImpl,
      sleep: noSleep,
      log: quiet,
      store: storeOf([{ id: 'gemini', enabled: true, defaultModel: 'gemini-2.5-pro' }]),
    });
    await r.generateJsonResponse({ prompt: 'x', model: 'gemini-3.6-flash' });
    expect(fetchImpl.mock.calls.at(-1)[0]).toContain('gemini-3.6-flash');
  });

  it('a disabled feature throws AI_FEATURE_DISABLED without calling anything', async () => {
    const fetchImpl = spyFetch();
    const r = createAiRouter({
      env: keys,
      fetch: fetchImpl,
      sleep: noSleep,
      log: quiet,
      store: storeOf([], { features: { critique: false } }),
    });
    await expect(r.generateJsonResponse({ prompt: 'x', feature: 'critique' })).rejects.toMatchObject(
      { code: 'AI_FEATURE_DISABLED', feature: 'critique' }
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('leaves every other feature running when one is switched off', async () => {
    const fetchImpl = spyFetch();
    const r = createAiRouter({
      env: keys,
      fetch: fetchImpl,
      sleep: noSleep,
      log: quiet,
      store: storeOf([], { features: { critique: false } }),
    });
    await expect(r.generateJsonResponse({ prompt: 'x', feature: 'inspector' })).resolves.toEqual({});
  });

  it('says "disabled in the portal", not "not configured", when all providers are off', async () => {
    // The two need different fixes and the message is the only thing pointing
    // at which one.
    const r = createAiRouter({
      env: keys,
      fetch: spyFetch(),
      sleep: noSleep,
      log: quiet,
      store: storeOf([
        { id: 'gemini', enabled: false },
        { id: 'openai', enabled: false },
        { id: 'anthropic', enabled: false },
      ]),
    });
    await expect(r.generateJsonResponse({ prompt: 'x' })).rejects.toThrow(/disabled in the admin/i);
  });

  it('a configuration read failure changes nothing — AI keeps working', async () => {
    // The failure mode this guards is the worst one available: a Cosmos blip
    // that reads as "everything disabled" would take the site's AI down with
    // no error anyone would connect to it.
    const fetchImpl = spyFetch();
    const r = createAiRouter({
      env: keys,
      fetch: fetchImpl,
      sleep: noSleep,
      log: quiet,
      store: {
        queryDocs: vi.fn(async () => {
          throw new Error('cosmos down');
        }),
        readDoc: vi.fn(async () => {
          throw new Error('cosmos down');
        }),
      },
    });
    await r.generateJsonResponse({ prompt: 'x', feature: 'inspector' });
    expect(fetchImpl.host()).toBe('generativelanguage.googleapis.com');
  });
});
