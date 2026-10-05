/**
 * The three AI documents as they stood on 2026-10-04 — REPRESENTATIVE, not an
 * export. Reading production Cosmos was refused in the session that built
 * slice 3 (#858), so this is assembled from what the repository and the
 * owner's decisions that day say the documents held; replace it with the
 * production export when the owner provides one, keeping the shape.
 *
 *   - `providers`: the five cards the seed writes
 *     (frontend/src/lib/aiEngine/seed.js DEFAULT_PROVIDERS, the fields the
 *     router reads), in the order the owner set on 2026-10-04 — NVIDIA 1,
 *     Foundry 2, Gemini 3, OpenAI 4, Claude 5 — every card enabled and no
 *     model pinned. `WITH_SEED_PINS` is the same list with the pins the seed
 *     carries for Gemini, OpenAI and Claude, in case the owner never cleared
 *     them.
 *   - `features`: `ai-features` with every switch on and the placements the
 *     defaults give (features-catalogue.js PROVIDER_PLACEMENT_DEFAULTS):
 *     NVIDIA the backup (`order`) for content, Foundry `first` for the
 *     content features and alt text (#849, owner decision 2026-10-04).
 *   - `routing`: the v1 `ai-routing` document with no routes (ADR 0033 §4
 *     shipped on 2026-10-03 and no route had been set).
 *
 * select.contract.test.js migrates these to version 2 and holds the resolver
 * to the chain the pre-slice router produced for every task.
 */

const card = (id, order, apiKeyEnvVar, defaultModel = null) => ({
  id,
  enabled: true,
  order,
  apiKeyEnvVar,
  defaultModel,
  schemaVersion: 2,
  status: 'connected',
});

export const PROVIDERS = Object.freeze([
  card('nvidia', 1, 'NVIDIA_API_KEY'),
  card('foundry', 2, 'FOUNDRY_ENDPOINT'),
  card('gemini', 3, 'GEMINI_API_KEY'),
  card('openai', 4, 'OPENAI_API_KEY'),
  card('anthropic', 5, 'ANTHROPIC_API_KEY'),
]);

/** The same cards with the seed's pins, which the seed writes on first load. */
export const WITH_SEED_PINS = Object.freeze([
  card('nvidia', 1, 'NVIDIA_API_KEY'),
  card('foundry', 2, 'FOUNDRY_ENDPOINT'),
  card('gemini', 3, 'GEMINI_API_KEY', 'gemini-3.5-flash-lite'),
  card('openai', 4, 'OPENAI_API_KEY', 'gpt-5-mini'),
  card('anthropic', 5, 'ANTHROPIC_API_KEY', 'claude-sonnet-4-6'),
]);

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

export const FEATURES = Object.freeze({
  id: 'ai-features',
  features: {},
  placement: {
    nvidia: Object.fromEntries(CONTENT.map((f) => [f, 'order'])),
    foundry: Object.fromEntries([...CONTENT, 'altText'].map((f) => [f, 'first'])),
  },
  updatedAt: '2026-10-04T20:00:00Z',
});

export const ROUTING_V1 = Object.freeze({
  id: 'ai-routing',
  routes: {},
  updatedAt: '2026-10-03T22:00:00Z',
});

/** A variant with one route set, so the route-then-placement order is covered too. */
export const ROUTING_V1_WITH_ROUTE = Object.freeze({
  id: 'ai-routing',
  routes: {
    forgeDrafting: {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      fallbacks: [{ provider: 'gemini', model: null }],
    },
    telegram: { provider: 'foundry', model: 'gpt-5-nano', fallbacks: [] },
  },
  updatedAt: '2026-10-04T21:05:00Z',
});
