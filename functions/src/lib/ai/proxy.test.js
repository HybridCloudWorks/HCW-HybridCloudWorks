/**
 * aiProxy and testAiProvider (#180).
 *
 * These two are what an administrator uses to find out whether the AI
 * configuration works. Both were 404s while the portal called them, so the
 * Playground and every Test button failed — and the failure looked like a
 * broken page rather than a missing endpoint.
 *
 * The assertions that matter are the ones about what these deliberately do NOT
 * do: they do not fall through the preference order, they are not gated by the
 * feature switches, and they do not return 5xx for a provider that simply is not
 * configured. Each of those would make the tool answer a different question from
 * the one it was asked.
 */
import { describe, it, expect, vi } from 'vitest';
import { createAiProxyHandlers } from './proxy.js';

const context = { log: vi.fn(), error: vi.fn() };

const allowGuard = { requireRole: vi.fn(async () => ({ role: 'editor', error: null })) };
const denyGuard = {
  requireRole: vi.fn(async () => ({ error: { status: 403, body: '{}' } })),
};

const makeRequest = (body) => ({ json: async () => body });

function makeStore(over = {}) {
  return {
    readDoc: vi.fn(async () => null),
    upsertDoc: vi.fn(async (_c, d) => d),
    patchDoc: vi.fn(async (_c, id, u) => ({ id, ...u })),
    ...over,
  };
}

const okAi = () => ({
  callProvider: vi.fn(async ({ provider, model }) => ({
    text: 'ok',
    promptTokens: 10,
    completionTokens: 4,
    model: model || `${provider}-default`,
  })),
  getCostEstimate: vi.fn(() => 0.000042),
});

/** Fixed clock so latency is asserted rather than tolerated. */
const fixed = {
  now: () => new Date('2026-08-23T20:00:00.000Z'),
  uuid: () => 'usage-1',
  clock: (() => {
    let t = 1000;
    return () => (t += 250);
  })(),
};

const build = (over = {}) =>
  createAiProxyHandlers({
    guard: allowGuard,
    store: makeStore(),
    ai: okAi(),
    ...fixed,
    ...over,
  });

describe('aiProxy', () => {
  it('returns the text, token counts, a cost and a latency', async () => {
    const response = await build().aiProxy(makeRequest({ provider: 'gemini', prompt: 'hi' }), context);
    const body = JSON.parse(response.body);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      text: 'ok',
      promptTokens: 10,
      completionTokens: 4,
      estimatedCostUsd: 0.000042,
    });
    expect(body.latencyMs).toBeGreaterThan(0);
  });

  it('records the call in ai_usage, which nothing had written since the port', async () => {
    // The portal's Usage tab reads this container and does its arithmetic
    // client-side on provider / totalTokens / estimatedCostUsd, so a record
    // under other field names totals to zero and looks like no usage at all.
    const store = makeStore();
    await build({ store }).aiProxy(
      makeRequest({ provider: 'gemini', prompt: 'hi', source: 'admin_playground' }),
      context
    );

    expect(store.upsertDoc).toHaveBeenCalledWith(
      'ai_usage',
      expect.objectContaining({
        provider: 'gemini',
        totalTokens: 14,
        estimatedCostUsd: 0.000042,
        source: 'admin_playground',
        timestamp: '2026-08-23T20:00:00.000Z',
      })
    );
  });

  it('calls the NAMED provider and does not fall through the preference order', async () => {
    // callProvider, not generateTextResponse. "Test Anthropic" that quietly
    // succeeds against Gemini answers the wrong question.
    const ai = okAi();
    await build({ ai }).aiProxy(
      makeRequest({ provider: 'anthropic', prompt: 'hi', model: 'claude-haiku-4-5' }),
      context
    );
    expect(ai.callProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', model: 'claude-haiku-4-5' })
    );
  });

  it('answers 200 with ok:false when the provider fails, not 5xx', async () => {
    // The caller is a Playground that renders the message. An unconfigured
    // provider is an answer, and AI_NOT_CONFIGURED already says what to do.
    const ai = okAi();
    ai.callProvider.mockRejectedValue(
      Object.assign(new Error('openai is not configured'), { code: 'AI_NOT_CONFIGURED' })
    );
    const response = await build({ ai }).aiProxy(
      makeRequest({ provider: 'openai', prompt: 'hi' }),
      context
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      ok: false,
      code: 'AI_NOT_CONFIGURED',
    });
  });

  it('does not record usage for a call that never happened', async () => {
    const ai = okAi();
    ai.callProvider.mockRejectedValue(new Error('boom'));
    const store = makeStore();
    await build({ ai, store }).aiProxy(makeRequest({ provider: 'gemini', prompt: 'hi' }), context);
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('still returns the answer when recording usage fails', async () => {
    // The model has already answered and already been paid for. Losing the
    // record is better than losing the response.
    const store = makeStore({ upsertDoc: vi.fn(async () => { throw new Error('cosmos down'); }) });
    const response = await build({ store }).aiProxy(
      makeRequest({ provider: 'gemini', prompt: 'hi' }),
      context
    );
    expect(JSON.parse(response.body).ok).toBe(true);
  });

  it('400s a missing provider or prompt', async () => {
    for (const body of [{ prompt: 'hi' }, { provider: 'gemini' }, { provider: 'gemini', prompt: '  ' }]) {
      const response = await build().aiProxy(makeRequest(body), context);
      expect(response.status).toBe(400);
    }
  });

  it('requires a role', async () => {
    const response = await build({ guard: denyGuard }).aiProxy(
      makeRequest({ provider: 'gemini', prompt: 'hi' }),
      context
    );
    expect(response.status).toBe(403);
  });
});

describe('testAiProvider', () => {
  it('writes the verdict onto the provider document so the badge survives a reload', async () => {
    const store = makeStore();
    const response = await build({ store }).testAiProvider(
      makeRequest({ providerId: 'gemini' }),
      context
    );

    expect(JSON.parse(response.body)).toMatchObject({ ok: true, status: 'connected' });
    expect(store.patchDoc).toHaveBeenCalledWith(
      'ai_providers',
      'gemini',
      expect.objectContaining({
        status: 'connected',
        lastTested: '2026-08-23T20:00:00.000Z',
        lastTestError: null,
      })
    );
  });

  it('records status "error" AND the message when the provider refuses', async () => {
    // A test button that fails silently is worse than no test button.
    const ai = okAi();
    ai.callProvider.mockRejectedValue(new Error('API key not valid'));
    const store = makeStore();
    const response = await build({ ai, store }).testAiProvider(
      makeRequest({ providerId: 'openai' }),
      context
    );

    expect(JSON.parse(response.body)).toMatchObject({ ok: false, status: 'error' });
    expect(JSON.parse(response.body).error).toMatch(/API key not valid/);
    expect(store.patchDoc).toHaveBeenCalledWith(
      'ai_providers',
      'openai',
      expect.objectContaining({ status: 'error', lastTestError: 'API key not valid' })
    );
  });

  it('still reports the result when the status write fails', async () => {
    const store = makeStore({ patchDoc: vi.fn(async () => { throw new Error('cosmos down'); }) });
    const response = await build({ store }).testAiProvider(
      makeRequest({ providerId: 'gemini' }),
      context
    );
    expect(JSON.parse(response.body).ok).toBe(true);
  });

  it('400s a missing providerId', async () => {
    const response = await build().testAiProvider(makeRequest({}), context);
    expect(response.status).toBe(400);
  });

  it('requires a role', async () => {
    const response = await build({ guard: denyGuard }).testAiProvider(
      makeRequest({ providerId: 'gemini' }),
      context
    );
    expect(response.status).toBe(403);
  });
});
