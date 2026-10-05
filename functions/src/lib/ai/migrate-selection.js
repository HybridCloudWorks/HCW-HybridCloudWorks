/**
 * migrate-selection.js — today's three documents become one selection
 * document, version 2 (ADR 0034 §6 "Migration", slice 3, #858).
 *
 * A PURE function from the `ai_providers` cards, `admin_settings/ai-features`
 * (its per-feature placements) and the v1 `admin_settings/ai-routing` (ADR
 * 0033 routes) to the v2 shape selection.js describes. Nothing an
 * administrator chose is lost, and nothing is written here: the loader
 * (ai-config.js) runs it in memory on every read of a v1 document, and the
 * first PUT after this merge stores the result. Versioned like the frontend
 * seed's PROVIDER_SCHEMA_VERSION: a document carrying SELECTION_VERSION is
 * returned as it is, so the function is idempotent.
 *
 * The rules, each the ADR's sentence:
 *
 *   - provider `order` → `global.priority` in that order, each card's pin
 *     (`defaultModel`) as its `model`. Every provider the router implements
 *     is listed, a card-less one after every ordered one in the default
 *     order (resolveProviderOrder's rank), a disabled one included — the
 *     card's switch still decides, and the resolver reads it.
 *   - a v1 route → a `custom` chain, primary then fallbacks, each with its
 *     model, `thenGlobal: true`. A step with no model takes the card's pin,
 *     which is what `configuredModelFor` gave it at call time.
 *   - a placement of `first` → that provider prepended to the task's chain,
 *     creating a custom chain over the global list when the task had none.
 *     A provider the route already names is not prepended: the route ran
 *     after placement, so its order was the effective one.
 *   - `order` → nothing; `off` → the provider in the task's `exclude`.
 *   - everything else `global`. A task that none of these touch has no
 *     entry.
 *
 * The placement read is `placementFor`, the EFFECTIVE value — the stored
 * one where configuration may set it, the code default otherwise, the lock
 * always — because that is what the router applied. So the defaults travel
 * too: with no documents at all the result is Foundry first for every
 * content task, and the trial tier and Foundry off the public explain
 * routes and the grounded call, exactly as features-catalogue.js has them.
 * `defaultSelection()` is that document; the router uses it when the loader
 * has none.
 */
import { DEFAULT_PROVIDER_ORDER } from './provider-order.js';
import { PER_FEATURE_PROVIDERS, placementFor } from './features-catalogue.js';
import { normalizeRouting } from './routing-table.js';
import { TASK_NAMES } from './tasks.js';
import { SELECTION_VERSION, isSelectionV2, normalizeSelection } from './selection.js';

/** The version this module migrates from. */
export const MIGRATED_FROM_VERSION = 1;

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The cards by id, lower-cased; documents for providers the router does not implement are ignored. */
function cardsOf(providers) {
  const byId = new Map();
  for (const doc of Array.isArray(providers) ? providers : []) {
    const id = String(doc?.id || '')
      .toLowerCase()
      .trim();
    if (DEFAULT_PROVIDER_ORDER.includes(id)) byId.set(id, doc);
  }
  return byId;
}

/** resolveProviderOrder's rank: the card's `order`, else after every ordered one in the default order. */
function rankOf(card, id) {
  const order = Number(card?.order);
  if (Number.isFinite(order)) return order;
  return 1000 + DEFAULT_PROVIDER_ORDER.indexOf(id);
}

/** Every implemented provider in the cards' order, the default order breaking ties. */
function orderedProviders(cards) {
  return [...DEFAULT_PROVIDER_ORDER].sort((a, b) => {
    const delta = rankOf(cards.get(a), a) - rankOf(cards.get(b), b);
    return delta !== 0 ? delta : DEFAULT_PROVIDER_ORDER.indexOf(a) - DEFAULT_PROVIDER_ORDER.indexOf(b);
  });
}

/** The card's pin, or null (configuredModelFor's rule). */
function pinOf(cards, provider) {
  const model = cards.get(provider)?.defaultModel;
  const trimmed = typeof model === 'string' ? model.trim() : '';
  return trimmed || null;
}

/**
 * One task's v2 entry from its v1 route and its placements, or null when it
 * is plain `global` (header). The route's steps lead and a `first` provider
 * the route does not name follows them: the route ran after placement, so
 * `[primary, ...fallbacks, ...rest of the placed order]` was the chain.
 *
 * Exported for the v1 PUT (admin-integrations/ai-routing.js), which applies
 * a route the Routing tab saves with exactly this rule, so a route set or
 * cleared there means what it meant before the migration.
 *
 * @param {object} params
 * @param {string} params.task
 * @param {ReturnType<typeof import('./routing-table.js').normalizeRoute>|null} params.route
 * @param {object|null} params.features  The `ai-features` document.
 * @param {Array<object>|null} params.providers  The `ai_providers` cards.
 */
export function taskEntryFor({ task, route, features, providers }) {
  const cards = cardsOf(providers);
  const chain = route ? [{ provider: route.provider, model: route.model }, ...route.fallbacks] : [];
  const first = [];
  const exclude = [];
  for (const provider of orderedProviders(cards)) {
    if (!PER_FEATURE_PROVIDERS.includes(provider)) continue;
    const placement = placementFor(features, provider, task);
    if (placement === 'off') exclude.push(provider);
    else if (placement === 'first' && !chain.some((step) => step.provider === provider)) {
      first.push({ provider, model: null });
    }
  }
  const steps = [...chain, ...first].map((step) => ({
    provider: step.provider,
    model: step.model || pinOf(cards, step.provider),
  }));
  if (!steps.length && !exclude.length) return null;
  const entry = steps.length ? { mode: 'custom', chain: steps, thenGlobal: true } : { mode: 'global' };
  if (exclude.length) entry.exclude = exclude;
  return entry;
}

/**
 * The v2 document for today's three documents (header). A `routing` that
 * already carries SELECTION_VERSION is returned unchanged.
 *
 * @param {object} docs
 * @param {Array<object>|null} docs.providers  The `ai_providers` cards.
 * @param {object|null} docs.features          The `ai-features` document.
 * @param {object|null} docs.routing           The `ai-routing` document, v1 or v2.
 */
export function migrateSelection({ providers = null, features = null, routing = null } = {}) {
  if (isSelectionV2(routing)) return routing;
  const cards = cardsOf(providers);
  const order = orderedProviders(cards);
  const { routes } = normalizeRouting(routing);
  const tasks = {};
  for (const task of TASK_NAMES) {
    const entry = taskEntryFor({ task, route: routes[task] || null, features, providers });
    if (entry) tasks[task] = entry;
  }
  return normalizeSelection({
    version: SELECTION_VERSION,
    global: { priority: order.map((provider) => ({ provider, model: pinOf(cards, provider) })) },
    tasks,
    updatedAt: isPlainObject(routing) && typeof routing.updatedAt === 'string' ? routing.updatedAt : null,
    updatedBy: 'migration',
  });
}

let defaults = null;

/** The document no documents migrate to: the code defaults (header). Built once. */
export function defaultSelection() {
  if (!defaults) defaults = Object.freeze(migrateSelection({}));
  return defaults;
}
