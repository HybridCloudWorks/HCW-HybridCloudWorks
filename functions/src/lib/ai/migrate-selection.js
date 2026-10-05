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
 *
 * THE MEDIA MODEL FIELDS (ADR 0034 slice 5, #860). The Listen & Learn
 * speech model stored on Platform settings (`admin_config/
 * listen_and_learn_speech`, `geminiModel`) and the podcast voice model
 * setting (`LISTEN_AND_LEARN_ELEVENLABS_MODEL`) were the two model choices
 * the settings pages carried; the Tasks tab owns them now. `media` carries
 * what they held, and the rule is one sentence: a stored model that differs
 * from the task's recommendation becomes that task's `custom` chain —
 * `[{ provider: the recommended provider, model: the stored one }]` with
 * `thenGlobal: false`, since the Priority list is a chat list and cannot
 * follow a speech task — so nothing changes for the owner on merge. One
 * that equals the recommendation, or none, leaves the task on its default
 * mode (`recommended`). Applied by `applyMediaMigration` to a v1 migration
 * AND to a stored v2 document that has no entry for the task yet: a v2
 * document saved by slice 4, before these tasks existed, must not lose a
 * choice its author never saw on the page. A v2 entry for the task, of any
 * mode, is left alone. The placements never touch a media task: a chat
 * provider's `first` or `off` means nothing to a voice.
 */
import { DEFAULT_PROVIDER_ORDER } from './provider-order.js';
import { PER_FEATURE_PROVIDERS, placementFor } from './features-catalogue.js';
import { normalizeRouting } from './routing-table.js';
import { AI_TASKS, TASK_NAMES, isMediaTask } from './tasks.js';
import { SELECTION_VERSION, isSelectionV2, normalizeSelection } from './selection.js';

/** The version this module migrates from. */
export const MIGRATED_FROM_VERSION = 1;

/**
 * The media tasks whose model a settings page or setting used to carry, and
 * the key `media` names each under (header).
 */
export const MEDIA_MIGRATION_TASKS = Object.freeze(['listenAndLearnSpeech', 'podcastVoice']);

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
export function migrateSelection({
  providers = null,
  features = null,
  routing = null,
  media = null,
} = {}) {
  if (isSelectionV2(routing)) return applyMediaMigration(routing, media);
  const cards = cardsOf(providers);
  const order = orderedProviders(cards);
  const { routes } = normalizeRouting(routing);
  const tasks = {};
  for (const task of TASK_NAMES) {
    // The placements and the v1 routes were written for chat providers; a
    // media task never had either (header).
    if (isMediaTask(AI_TASKS[task])) continue;
    const entry = taskEntryFor({ task, route: routes[task] || null, features, providers });
    if (entry) tasks[task] = entry;
  }
  return applyMediaMigration(
    normalizeSelection({
      version: SELECTION_VERSION,
      global: { priority: order.map((provider) => ({ provider, model: pinOf(cards, provider) })) },
      tasks,
      updatedAt:
        isPlainObject(routing) && typeof routing.updatedAt === 'string' ? routing.updatedAt : null,
      updatedBy: 'migration',
    }),
    media
  );
}

/** A stored media model id, trimmed, or null. */
const storedModelOf = (media, task) => {
  const value = media?.[task];
  const model = typeof value === 'string' ? value.trim() : '';
  return model || null;
};

/**
 * The media rule (header) over a normalised v2 document: for each task in
 * MEDIA_MIGRATION_TASKS with no entry, a stored model that differs from the
 * recommendation becomes a custom chain on the recommended provider,
 * `thenGlobal: false`. Returns the document itself when nothing applies,
 * so an idempotent read stays cheap.
 *
 * @param {object} selection  A v2 document (normalised or stored).
 * @param {Record<string, string|null>|null} media  `{ listenAndLearnSpeech, podcastVoice }`.
 */
export function applyMediaMigration(selection, media) {
  if (!media) return selection;
  const added = {};
  for (const task of MEDIA_MIGRATION_TASKS) {
    if (isPlainObject(selection?.tasks?.[task])) continue;
    const model = storedModelOf(media, task);
    const recommended = AI_TASKS[task]?.recommended;
    if (!model || !recommended || model === recommended.model) continue;
    added[task] = {
      mode: 'custom',
      chain: [{ provider: recommended.provider, model }],
      thenGlobal: false,
    };
  }
  if (!Object.keys(added).length) return selection;
  return normalizeSelection({ ...selection, tasks: { ...(selection.tasks || {}), ...added } });
}

let defaults = null;

/** The document no documents migrate to: the code defaults (header). Built once. */
export function defaultSelection() {
  if (!defaults) defaults = Object.freeze(migrateSelection({}));
  return defaults;
}
