/**
 * The contract behind the Tasks tab (ADR 0034 §4, slice 4, #859): what
 * `GET cms/ai-routing/effective` answers for a task is what `selectChain`
 * returns on the same documents — the same loader, the same catalogue read,
 * the same availability — so the page can never disagree with production.
 * The route's handler hands the router's answer through unchanged
 * (admin-integrations/ai-tasks.test.js), so the router's function is what
 * is held here.
 */
import { describe, it, expect, vi } from 'vitest';
import { createAiRouter } from './router.js';
import { selectChain } from './select.js';
import { resolveProviderOrder, selectionFrom } from './ai-config.js';
import { readModelCatalog } from './model-catalog-doc.js';
import { recommendedModelFor } from './provider-recommendations.js';
import { DEFAULT_MODEL_TABLE } from './model-tables.js';
import { AI_TASKS, TASK_NAMES } from './tasks.js';
import { DEFAULT_PROVIDER_ORDER } from './provider-order.js';
import {
  FEATURES,
  PROVIDERS,
  ROUTING_V1_WITH_ROUTE,
  WITH_SEED_PINS,
} from './fixtures/selection-2026-10-04.js';

const KEYS = {
  GEMINI_API_KEY: 'g',
  OPENAI_API_KEY: 'o',
  ANTHROPIC_API_KEY: 'a',
  NVIDIA_API_KEY: 'n',
  FOUNDRY_ENDPOINT: 'https://example.invalid',
};

/** A store serving the three documents and a catalogue by id. */
function storeOf({ providers = [], features = null, routing = null, catalog = null }) {
  const docs = { 'ai-features': features, 'ai-routing': routing, 'ai-model-catalog': catalog };
  return {
    queryDocs: vi.fn(async () => providers),
    readDoc: vi.fn(async (_c, id) => docs[id] ?? null),
  };
}

const V2 = {
  id: 'ai-routing',
  version: 2,
  global: { priority: [{ provider: 'foundry', model: null }, { provider: 'gemini', model: 'gemini-3.6-flash' }] },
  tasks: {
    forgeDrafting: { mode: 'recommended' },
    pricingExplain: { mode: 'global', exclude: ['openai'] },
    telegram: { mode: 'custom', chain: [{ provider: 'anthropic', model: null }], thenGlobal: false },
  },
  updatedAt: '2026-10-05T10:00:00Z',
  updatedBy: 'owner',
};

const CATALOG = {
  id: 'ai-model-catalog',
  providers: {
    gemini: {
      refresh: { lastOk: '2026-10-05T00:00:00Z', lastAttempt: null, lastError: null },
      models: { 'gemini-3.6-flash': { id: 'gemini-3.6-flash', status: 'retired' } },
    },
  },
};

const DOCS = {
  'the 2026-10-04 documents, v1 with a route and the seed pins': {
    providers: WITH_SEED_PINS,
    features: FEATURES,
    routing: ROUTING_V1_WITH_ROUTE,
  },
  'a v2 document with every mode, over a catalogue that retired a listed model': {
    providers: PROVIDERS,
    features: FEATURES,
    routing: V2,
    catalog: CATALOG,
  },
  'no documents at all': {},
};

const KEY_SETS = {
  'every provider keyed': KEYS,
  'Foundry and Gemini only': { FOUNDRY_ENDPOINT: KEYS.FOUNDRY_ENDPOINT, GEMINI_API_KEY: 'g' },
};

describe('the effective read equals selectChain on the same documents, for every task', () => {
  for (const [docsLabel, docs] of Object.entries(DOCS)) {
    for (const [keysLabel, env] of Object.entries(KEY_SETS)) {
      it(`${docsLabel}; ${keysLabel}`, async () => {
        const store = storeOf(docs);
        const router = createAiRouter({ env, log: { warn: vi.fn() }, store });
        const effective = await router.resolveEffectiveSelection();

        // What the router read, derived the way the loader derives it.
        const keyed = DEFAULT_PROVIDER_ORDER.filter((p) =>
          p === 'foundry' ? Boolean(env.FOUNDRY_ENDPOINT) : Boolean(env[`${p.toUpperCase()}_API_KEY`])
        );
        const cards = docs.providers || [];
        const { order: enabled, disabled } = resolveProviderOrder(cards, keyed);
        const selection = selectionFrom({
          providers: cards,
          features: docs.features || null,
          routing: docs.routing || null,
        });
        const catalog = await readModelCatalog({ store, now: () => new Date() });

        expect(effective.availability).toEqual({ keyed, enabled, disabled });
        expect(Object.keys(effective.tasks)).toEqual([...TASK_NAMES]);
        for (const task of TASK_NAMES) {
          const expected = selectChain({ task, selection, catalog, availability: { keyed, enabled } });
          expect(effective.tasks[task], task).toMatchObject({
            mode: expected.mode,
            chain: expected.chain,
            rejected: expected.rejected,
            flags: expected.flags,
            label: AI_TASKS[task].label,
            modality: AI_TASKS[task].modality,
            needs: [...AI_TASKS[task].needs],
            public: AI_TASKS[task].public,
            recommended: AI_TASKS[task].recommended,
            entry: selection.tasks[task] || { mode: 'global' },
          });
        }
        expect(effective.priority.map((p) => [p.provider, p.model])).toEqual(
          selection.global.priority.map((p) => [p.provider, p.model])
        );
        expect(effective.updatedAt).toBe(selection.updatedAt ?? null);
      });
    }
  }

  it('each Priority row says what a null model resolves to: the purpose defaults and the modality recommendation', async () => {
    const router = createAiRouter({
      env: { ...KEYS, CONTENTFORGE_FOUNDRY_DRAFT_MODEL: 'gpt-5-mini-override' },
      log: { warn: vi.fn() },
      store: storeOf({ routing: V2 }),
    });
    const { priority } = await router.resolveEffectiveSelection();
    const foundry = priority.find((p) => p.provider === 'foundry');
    expect(foundry).toMatchObject({
      model: null,
      keyed: true,
      enabled: true,
      defaults: {
        draft: 'gpt-5-mini-override',
        analysis: DEFAULT_MODEL_TABLE.foundry.analysis[1],
        multimodal: DEFAULT_MODEL_TABLE.foundry.multimodal[1],
        general: DEFAULT_MODEL_TABLE.foundry.general[1],
      },
      modality: {
        text: recommendedModelFor('foundry', 'text').model,
        vision: recommendedModelFor('foundry', 'vision').model,
      },
    });
    expect(priority.find((p) => p.provider === 'gemini').model).toBe('gemini-3.6-flash');
  });

  it('reads past the cache: a document saved after the last load is what the answer reflects', async () => {
    const routing = { ...V2, tasks: {} };
    const store = storeOf({ routing });
    const router = createAiRouter({ env: KEYS, log: { warn: vi.fn() }, store });
    await router.resolveProviderChain('forgeDrafting');
    store.readDoc.mockImplementation(async (_c, id) =>
      id === 'ai-routing' ? { ...routing, tasks: { forgeDrafting: { mode: 'recommended' } } } : null
    );
    const effective = await router.resolveEffectiveSelection();
    // The new entry was read. With no catalogue document the recommendation
    // is seeded `unknown`, so the resolver falls to the list and says so —
    // which is the flag the Tasks tab shows as "recommendation not live".
    expect(effective.tasks.forgeDrafting.entry).toEqual({ mode: 'recommended' });
    expect(effective.tasks.forgeDrafting.mode).toBe('global');
    expect(effective.tasks.forgeDrafting.flags[0]).toMatch(/recommended model is not eligible/);
    expect(effective.tasks.forgeDrafting.rejected[0]).toMatchObject({
      provider: 'foundry',
      model: 'gpt-5-mini',
      selection: 'recommended',
      code: 'not-live',
    });
  });
});
