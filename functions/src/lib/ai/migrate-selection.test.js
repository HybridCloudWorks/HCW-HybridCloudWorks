/**
 * The migration (ADR 0034 §6, #858): today's three documents become the v2
 * selection document, and nothing an administrator chose is lost.
 */
import { describe, it, expect } from 'vitest';
import { defaultSelection, migrateSelection, taskEntryFor } from './migrate-selection.js';
import { resolveProviderOrder } from './ai-config.js';
import { PROVIDER_PLACEMENT_DEFAULTS } from './features-catalogue.js';
import { DEFAULT_PROVIDER_ORDER } from './provider-order.js';
import { AI_TASKS, TASK_NAMES, isMediaTask } from './tasks.js';

const CONTENT = [
  'inspector',
  'critique',
  'forgeDrafting',
  'forgeGrading',
  'voiceCalibration',
  'socialCaption',
  'listenAndLearn',
  'podcastScript',
  'telegram',
  'forgeAssist',
];

describe('provider order → the Priority list', () => {
  it('lists every implemented provider in card order, each card\'s pin as its model', () => {
    const { global } = migrateSelection({
      providers: [
        { id: 'anthropic', order: 2, defaultModel: ' claude-sonnet-4-6 ' },
        { id: 'Foundry', order: 1, defaultModel: null },
        { id: 'gemini', order: 3, defaultModel: '' },
        { id: 'vertex', order: 0, enabled: true },
      ],
    });
    expect(global.priority).toEqual([
      { provider: 'foundry', model: null },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { provider: 'gemini', model: null },
      // Card-less providers follow, in the default order.
      { provider: 'openai', model: null },
      { provider: 'nvidia', model: null },
    ]);
  });

  it('keeps a disabled provider in the list: the card\'s switch still decides, and the resolver reads it', () => {
    const { global } = migrateSelection({ providers: [{ id: 'gemini', order: 1, enabled: false }] });
    expect(global.priority[0]).toEqual({ provider: 'gemini', model: null });
  });

  it('orders exactly as resolveProviderOrder does for the providers that hold a key', () => {
    const providers = [
      { id: 'nvidia', order: 1 },
      { id: 'foundry', order: 2 },
      { id: 'gemini', order: 3 },
      { id: 'openai', order: 4 },
      { id: 'anthropic', order: 5 },
    ];
    const { global } = migrateSelection({ providers });
    for (const keyed of [DEFAULT_PROVIDER_ORDER, ['gemini', 'anthropic'], ['foundry', 'nvidia', 'openai']]) {
      const listed = global.priority.map((s) => s.provider).filter((p) => keyed.includes(p));
      expect(listed, keyed.join()).toEqual(resolveProviderOrder(providers, keyed).order);
    }
  });
});

describe('placements and routes → tasks', () => {
  it('with no documents at all, the code defaults travel: Foundry first for content, the locks as exclude', () => {
    const { tasks } = migrateSelection({});
    for (const task of CONTENT) {
      expect(tasks[task], task).toEqual({
        mode: 'custom',
        chain: [{ provider: 'foundry', model: null }],
        thenGlobal: true,
      });
    }
    expect(tasks.altText).toEqual({
      mode: 'custom',
      chain: [{ provider: 'foundry', model: null }],
      thenGlobal: true,
      exclude: ['nvidia'],
    });
    for (const task of ['sourceGrounding', 'pricingExplain', 'landingZoneExplain']) {
      expect(tasks[task], task).toEqual({ mode: 'global', exclude: ['nvidia', 'foundry'] });
    }
    // The media tasks never had a placement or a route (slice 5): no entry.
    expect(Object.keys(tasks).sort()).toEqual(
      TASK_NAMES.filter((task) => !isMediaTask(AI_TASKS[task])).sort()
    );
    expect(defaultSelection()).toEqual(migrateSelection({}));
    expect(defaultSelection()).toBe(defaultSelection());
  });

  it("'first' prepends, 'order' does nothing, 'off' excludes — the stored value where it may be set", () => {
    const features = {
      placement: {
        nvidia: { forgeDrafting: 'first', inspector: 'order', critique: 'off', pricingExplain: 'first' },
        foundry: { forgeDrafting: 'order', critique: 'off' },
      },
    };
    const { tasks } = migrateSelection({ features });
    expect(tasks.forgeDrafting).toEqual({
      mode: 'custom',
      chain: [{ provider: 'nvidia', model: null }],
      thenGlobal: true,
    });
    expect(tasks.inspector).toEqual({
      mode: 'custom',
      chain: [{ provider: 'foundry', model: null }],
      thenGlobal: true,
    });
    expect(tasks.critique).toEqual({ mode: 'global', exclude: ['nvidia', 'foundry'] });
    // The lock holds: a stored 'first' on the public route is still 'off'.
    expect(tasks.pricingExplain).toEqual({ mode: 'global', exclude: ['nvidia', 'foundry'] });
  });

  it('two providers placed first are prepended in the card order', () => {
    const features = { placement: { nvidia: { forgeDrafting: 'first' } } };
    const byCards = migrateSelection({
      providers: [{ id: 'nvidia', order: 1 }, { id: 'foundry', order: 2 }],
      features,
    });
    expect(byCards.tasks.forgeDrafting.chain.map((s) => s.provider)).toEqual(['nvidia', 'foundry']);
    const byDefault = migrateSelection({ features });
    // No cards: the default order, where nvidia precedes foundry.
    expect(byDefault.tasks.forgeDrafting.chain.map((s) => s.provider)).toEqual(['nvidia', 'foundry']);
    const reversed = migrateSelection({
      providers: [{ id: 'foundry', order: 1 }, { id: 'nvidia', order: 2 }],
      features,
    });
    expect(reversed.tasks.forgeDrafting.chain.map((s) => s.provider)).toEqual(['foundry', 'nvidia']);
  });

  it('a v1 route becomes a custom chain, primary then fallbacks with their models, then the list', () => {
    const routing = {
      routes: {
        telegram: {
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          fallbacks: [{ provider: 'gemini' }, { provider: 'vertex' }],
        },
        junk: { provider: 'gemini' },
      },
      updatedAt: '2026-10-03T00:00:00Z',
    };
    const { tasks, updatedAt, updatedBy } = migrateSelection({
      routing,
      features: { placement: { foundry: { telegram: 'order' } } },
    });
    expect(tasks.telegram).toEqual({
      mode: 'custom',
      chain: [
        { provider: 'anthropic', model: 'claude-opus-4-6' },
        { provider: 'gemini', model: null },
      ],
      thenGlobal: true,
    });
    expect(tasks.junk).toBeUndefined();
    expect(updatedAt).toBe('2026-10-03T00:00:00Z');
    expect(updatedBy).toBe('migration');
  });

  it("a route leads and a 'first' provider the route does not name follows it: the route ran after placement", () => {
    const { tasks } = migrateSelection({
      routing: { routes: { forgeDrafting: { provider: 'anthropic', fallbacks: [{ provider: 'gemini' }] } } },
    });
    expect(tasks.forgeDrafting.chain.map((s) => s.provider)).toEqual(['anthropic', 'gemini', 'foundry']);
    const named = migrateSelection({
      routing: { routes: { forgeDrafting: { provider: 'foundry', model: 'gpt-5-nano', fallbacks: [{ provider: 'gemini' }] } } },
    });
    expect(named.tasks.forgeDrafting.chain).toEqual([
      { provider: 'foundry', model: 'gpt-5-nano' },
      { provider: 'gemini', model: null },
    ]);
  });

  it('a chain step with no model takes the card\'s pin, as configuredModelFor gave it at call time', () => {
    const { tasks } = migrateSelection({
      providers: [{ id: 'foundry', defaultModel: 'gpt-5-nano' }, { id: 'gemini', defaultModel: 'gemini-2.5-pro' }],
      routing: { routes: { telegram: { provider: 'gemini', fallbacks: [{ provider: 'openai', model: 'gpt-4o' }] } } },
    });
    expect(tasks.telegram.chain).toEqual([
      { provider: 'gemini', model: 'gemini-2.5-pro' },
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'foundry', model: 'gpt-5-nano' },
    ]);
  });

  it('taskEntryFor answers null for a task its placements and route leave on the list', () => {
    const features = { placement: { foundry: { telegram: 'order' } } };
    expect(taskEntryFor({ task: 'telegram', route: null, features, providers: [] })).toBeNull();
    expect(PROVIDER_PLACEMENT_DEFAULTS.nvidia.telegram).toBe('order');
  });
});

describe('versioning', () => {
  it('returns a version 2 document unchanged, so running it twice is running it once', () => {
    const v2 = {
      version: 2,
      global: { priority: [{ provider: 'gemini', model: null }] },
      tasks: { telegram: { mode: 'recommended' } },
      updatedAt: 'x',
      updatedBy: 'owner',
    };
    expect(migrateSelection({ routing: v2 })).toBe(v2);
    const once = migrateSelection({ routing: { routes: { telegram: { provider: 'openai' } } } });
    expect(migrateSelection({ routing: once })).toBe(once);
  });
});
