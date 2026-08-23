/**
 * The three rules from ai-config.js's header, as tests.
 *
 * Each of them is the answer to "what happens when stored configuration and
 * reality disagree", and each fails in a quiet, expensive way if it is ever
 * inverted: a provider enabled without a key 401s every call; a Cosmos blip
 * that read as "everything disabled" would silently switch the site's AI off;
 * a feature that defaulted to off would ship dark and look like a bug.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  AI_FEATURES,
  DEFAULT_PROVIDER_ORDER,
  FEATURE_NAMES,
  configuredModelFor,
  createAiConfigLoader,
  isFeatureEnabled,
  resolveProviderOrder,
} from './ai-config.js';
import { PROVIDERS } from './router.js';

const quiet = { warn: vi.fn() };
const doc = (id, extra = {}) => ({ id, enabled: true, ...extra });

describe('rule 1 — a key is authoritative, configuration is advisory', () => {
  it('never returns a provider whose key is absent, however enabled it looks', () => {
    const docs = [doc('anthropic', { order: 1 }), doc('gemini', { order: 2 })];
    const { order } = resolveProviderOrder(docs, ['gemini']);
    expect(order).toEqual(['gemini']);
  });

  it('lets configuration disable a provider that does have a key', () => {
    const docs = [doc('gemini', { enabled: false }), doc('openai')];
    const { order, disabled } = resolveProviderOrder(docs, ['gemini', 'openai']);
    expect(order).toEqual(['openai']);
    expect(disabled).toEqual(['gemini']);
  });

  it('reports every provider disabled, which the router turns into a distinct error', () => {
    // "All switched off" is a legitimate instruction and must not be confused
    // with "no keys seeded" — they need different fixes.
    const docs = [doc('gemini', { enabled: false }), doc('openai', { enabled: false })];
    const { order, disabled } = resolveProviderOrder(docs, ['gemini', 'openai']);
    expect(order).toEqual([]);
    expect(disabled).toEqual(['gemini', 'openai']);
  });
});

describe('rule 2 — unreadable configuration is not empty configuration', () => {
  it('null docs fall back to the default order over the available keys', () => {
    const { order, disabled } = resolveProviderOrder(null, ['anthropic', 'gemini']);
    expect(order).toEqual(['gemini', 'anthropic']);
    expect(disabled).toEqual([]);
  });

  it('an EMPTY container is different: no document means no opinion, so all stay on', () => {
    const { order } = resolveProviderOrder([], ['anthropic', 'gemini']);
    expect(order).toEqual(['gemini', 'anthropic']);
  });

  it('a read failure with no cache reports null rather than "all off"', async () => {
    const store = {
      queryDocs: vi.fn().mockRejectedValue(new Error('cosmos down')),
      readDoc: vi.fn().mockRejectedValue(new Error('cosmos down')),
    };
    const loader = createAiConfigLoader({ store, log: quiet });
    await expect(loader.load()).resolves.toEqual({ providers: null, features: null });
  });

  it('a read failure with a warm cache keeps serving the last known configuration', async () => {
    // The alternative — dropping to "no configuration" — would quietly re-enable
    // a provider an administrator had switched off, during an outage, with no
    // trace of why.
    let now = 1_000;
    const store = {
      queryDocs: vi.fn().mockResolvedValue([doc('openai', { enabled: false })]),
      readDoc: vi.fn().mockResolvedValue({ features: { critique: false } }),
    };
    const loader = createAiConfigLoader({ store, ttlMs: 100, now: () => now, log: quiet });

    const first = await loader.load();
    expect(first.providers).toHaveLength(1);

    now += 500; // past the TTL, so the next load refreshes
    store.queryDocs.mockRejectedValue(new Error('cosmos down'));
    store.readDoc.mockRejectedValue(new Error('cosmos down'));

    const second = await loader.load();
    expect(second).toEqual(first);
  });
});

describe('rule 3 — absent means on', () => {
  it('enables a feature with no settings document at all', () => {
    for (const name of FEATURE_NAMES) expect(isFeatureEnabled(null, name)).toBe(true);
  });

  it('enables a feature the settings document does not mention', () => {
    expect(isFeatureEnabled({ features: { inspector: false } }, 'telegram')).toBe(true);
  });

  it('only an explicit false disables — not 0, not "", not "false"', () => {
    expect(isFeatureEnabled({ features: { inspector: false } }, 'inspector')).toBe(false);
    for (const value of [0, '', 'false', null, undefined]) {
      expect(isFeatureEnabled({ features: { inspector: value } }, 'inspector')).toBe(true);
    }
  });
});

describe('ordering', () => {
  it('sorts by the configured order field', () => {
    const docs = [doc('gemini', { order: 3 }), doc('openai', { order: 1 }), doc('anthropic', { order: 2 })];
    const { order } = resolveProviderOrder(docs, ['gemini', 'openai', 'anthropic']);
    expect(order).toEqual(['openai', 'anthropic', 'gemini']);
  });

  it('sorts a provider with no order after every provider that has one', () => {
    const docs = [doc('gemini'), doc('anthropic', { order: 5 })];
    const { order } = resolveProviderOrder(docs, ['gemini', 'anthropic']);
    expect(order).toEqual(['anthropic', 'gemini']);
  });

  it('breaks an order tie by the default order, so the choice is not instance-dependent', () => {
    const docs = [doc('anthropic', { order: 1 }), doc('gemini', { order: 1 })];
    const { order } = resolveProviderOrder(docs, ['anthropic', 'gemini']);
    expect(order).toEqual(['gemini', 'anthropic']);
  });

  it('ignores documents for providers this platform does not implement', () => {
    // vertex, perplexity, bedrock and replicate are real rows in the shared
    // container, left over from Site-Main. They are read past, not deleted.
    const docs = [doc('vertex', { order: 0 }), doc('perplexity', { order: 0 }), doc('gemini')];
    const { order } = resolveProviderOrder(docs, ['gemini']);
    expect(order).toEqual(['gemini']);
  });
});

describe('configured model', () => {
  it('returns the administrator pin, and null when there is none', () => {
    const docs = [doc('gemini', { defaultModel: 'gemini-3.6-flash' }), doc('openai')];
    expect(configuredModelFor(docs, 'gemini')).toBe('gemini-3.6-flash');
    expect(configuredModelFor(docs, 'openai')).toBeNull();
    expect(configuredModelFor(null, 'gemini')).toBeNull();
  });

  it('treats a blank pin as no pin', () => {
    expect(configuredModelFor([doc('gemini', { defaultModel: '   ' })], 'gemini')).toBeNull();
  });
});

describe('the catalogue and the provider list stay in step', () => {
  it('PROVIDERS is exactly DEFAULT_PROVIDER_ORDER', () => {
    // One constant, deliberately: no implemented provider without a place in
    // the order, no place in the order for a provider that is not implemented.
    expect([...PROVIDERS]).toEqual([...DEFAULT_PROVIDER_ORDER]);
  });

  it('every feature carries the three things a toggle has to explain', () => {
    for (const [name, entry] of Object.entries(AI_FEATURES)) {
      expect(entry.label, name).toBeTruthy();
      expect(entry.description, name).toBeTruthy();
      // "What will I notice if I turn this off?" is the question someone is
      // actually holding, and it is the one a bare label never answers.
      expect(entry.route, name).toBeTruthy();
    }
  });
});

describe('caching', () => {
  it('reads once inside the TTL and again after it', async () => {
    let now = 0;
    const store = { queryDocs: vi.fn().mockResolvedValue([]), readDoc: vi.fn().mockResolvedValue(null) };
    const loader = createAiConfigLoader({ store, ttlMs: 1000, now: () => now, log: quiet });

    await loader.load();
    await loader.load();
    expect(store.queryDocs).toHaveBeenCalledTimes(1);

    now = 1001;
    await loader.load();
    expect(store.queryDocs).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight read between concurrent callers', async () => {
    const store = { queryDocs: vi.fn().mockResolvedValue([]), readDoc: vi.fn().mockResolvedValue(null) };
    const loader = createAiConfigLoader({ store, log: quiet });

    await Promise.all([loader.load(), loader.load(), loader.load()]);
    expect(store.queryDocs).toHaveBeenCalledTimes(1);
  });

  it('with no store, reports no configuration and never throws', async () => {
    // This is what keeps every existing unit test — and any caller that does
    // not hand over a Cosmos client — on the pre-configuration behaviour.
    const loader = createAiConfigLoader({});
    await expect(loader.load()).resolves.toEqual({ providers: null, features: null });
  });
});
