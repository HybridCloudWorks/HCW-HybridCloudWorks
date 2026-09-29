/**
 * The registered `probeAiProviders` timer runs the AI Engine's Test (#701).
 *
 * lib/timers/ai-provider-probe.test.js covers the probe itself. This covers
 * the wiring in schedulers.js, through the same `@azure/functions` mock the
 * other timer tests use: the flag gate, the process-wide router, and the
 * Cosmos module as the store. A timer that registered but called something
 * else would pass the unit tests and write nothing onto the cards.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const timerRegistrations = new Map();

vi.mock('@azure/functions', () => ({
  app: {
    http: () => {},
    timer: (name, options) => timerRegistrations.set(name, options),
    cosmosDB: () => {},
    storageQueue: () => {},
  },
  output: {
    storageQueue: (options) => ({ type: 'queue', ...options }),
  },
}));

const patchDoc = vi.fn(async (_c, id, u) => ({ id, ...u }));
const upsertDoc = vi.fn(async (_c, d) => d);
vi.mock('../lib/cosmos-client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  patchDoc: (...args) => patchDoc(...args),
  upsertDoc: (...args) => upsertDoc(...args),
}));

const callProvider = vi.fn(async ({ provider }) => ({
  text: 'ok',
  promptTokens: 9,
  completionTokens: 2,
  model: `${provider}-short`,
}));
vi.mock('../lib/ai/router.js', async (importOriginal) => ({
  ...(await importOriginal()),
  availableProviders: () => ['gemini', 'nvidia'],
  callProvider: (...args) => callProvider(...args),
}));

await import('./schedulers.js');
const { TEST_MAX_TOKENS, TEST_TIMEOUT_MS } = await import('../lib/ai/proxy.js');

const saved = {};
const FLAGS = ['FEATURE_FLAG_SCHEDULERS', 'FEATURE_FLAG_PROBE_AI_PROVIDERS'];

beforeAll(() => {
  for (const name of FLAGS) saved[name] = process.env[name];
  process.env.FEATURE_FLAG_SCHEDULERS = 'true';
  process.env.FEATURE_FLAG_PROBE_AI_PROVIDERS = 'true';
});

afterAll(() => {
  for (const name of FLAGS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const fakeContext = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('the probeAiProviders timer', () => {
  it('is registered weekly on Monday at 06:15 UTC', () => {
    expect(timerRegistrations.get('probeAiProviders')?.schedule).toBe('0 15 6 * * 1');
  });

  it('runs the Test against each provider with a key and writes the verdict onto its card', async () => {
    const context = fakeContext();
    await timerRegistrations.get('probeAiProviders').handler({}, context);

    expect(callProvider.mock.calls.map(([args]) => args)).toEqual(
      ['gemini', 'nvidia'].map((provider) => ({
        provider,
        model: null,
        prompt: expect.any(String),
        maxTokens: TEST_MAX_TOKENS,
        timeoutMs: TEST_TIMEOUT_MS,
      }))
    );
    for (const provider of ['gemini', 'nvidia']) {
      expect(patchDoc).toHaveBeenCalledWith(
        'ai_providers',
        provider,
        expect.objectContaining({ status: 'connected', lastTestError: null, lastTestedBy: 'probe' })
      );
    }
    expect(upsertDoc.mock.calls.map(([container, row]) => [container, row.source])).toEqual([
      ['ai_usage', 'ai-engine:probe'],
      ['ai_usage', 'ai-engine:probe'],
    ]);
    // The summary the wrapper logs: what an operator reads back.
    expect(context.log).toHaveBeenCalledWith(
      expect.stringMatching(/^\[probeAiProviders\] \{"probed":2,"connected":2,/)
    );
  });

  it('with its flag off, calls nothing', async () => {
    callProvider.mockClear();
    process.env.FEATURE_FLAG_PROBE_AI_PROVIDERS = 'false';
    try {
      await timerRegistrations.get('probeAiProviders').handler({}, fakeContext());
    } finally {
      process.env.FEATURE_FLAG_PROBE_AI_PROVIDERS = 'true';
    }
    expect(callProvider).not.toHaveBeenCalled();
  });
});
