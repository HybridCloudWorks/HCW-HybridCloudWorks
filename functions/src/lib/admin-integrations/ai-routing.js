/**
 * ai-routing.js — the selection document, `admin_settings/ai-routing`
 * (lib/ai/selection.js, ADR 0034 §2, #858): the Priority list and each
 * task's mode and chain. Until slice 3 this was the v1 routing table (ADR
 * 0033 §4, `{ routes }`), and the Routing tab still speaks v1 until slice 4
 * (#859) replaces it with the Tasks tab, so both shapes are served here:
 *
 *   GET answers the version 2 document — a stored v1 document migrated in
 *   memory, nothing written — beside the v1 `routes` view of it the Routing
 *   tab renders (a custom chain as primary + fallbacks).
 *
 *   PUT takes either shape. A v2 body `{ version: 2, global, tasks,
 *   updatedAt }` is validated, normalised and written; an `updatedAt` that
 *   is not the one the page read is a 409 and nothing is written (§6). A v1
 *   body `{ routes: { <feature>: route | null } }` is merged into the
 *   current document — a route becomes that task's custom chain, null puts
 *   it back on the Priority list — and the result is written as v2. So the
 *   stored document is v2 from the first save after this merge, whichever
 *   tab saved it. After that save, the "Where AI is used" placements and
 *   the card pins no longer reach the router: they were migrated into this
 *   document at that moment, and the document is what the router reads.
 *
 * Each handler body is a module-level function over `ctx` (guard, store, now,
 * aiConfigChanged, availableProviders); the factory at the bottom only
 * wires them.
 */
import {
  AI_FEATURES,
  DEFAULT_PROVIDER_ORDER,
  FEATURE_NAMES,
  FEATURES_DOC_ID,
  MAX_ROUTE_FALLBACKS,
  PROVIDERS_CONTAINER,
  ROUTING_DOC_ID,
  SETTINGS_CONTAINER,
  normalizeRoute,
  resolveProviderOrder,
  selectionFrom,
} from '../ai/ai-config.js';
import {
  SELECTION_VERSION,
  isSelectionV2,
  normalizeSelection,
  validateSelection,
} from '../ai/selection.js';
import { taskEntryFor } from '../ai/migrate-selection.js';
import { readModelCatalog } from '../ai/model-catalog-doc.js';
import { actorName } from '../auth/actor-name.js';
import { json, validBody } from '../http/admin-handler.js';

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
/** A model field: absent, null, or a string. */
const isOptionalString = (value) =>
  value === undefined || value === null || typeof value === 'string';
const providerName = (value) =>
  String(value || '')
    .toLowerCase()
    .trim();

/** One fallback of a route: a known provider not already used, with an optional model. */
function fallbackError(feature, entry, seen) {
  const fallback = providerName(entry?.provider);
  if (!DEFAULT_PROVIDER_ORDER.includes(fallback)) {
    return `routes.${feature}.fallbacks: unknown provider "${entry?.provider ?? ''}"`;
  }
  if (seen.has(fallback)) {
    return `routes.${feature}.fallbacks: ${fallback} is listed twice (or is the primary)`;
  }
  seen.add(fallback);
  if (!isOptionalString(entry.model)) {
    return `routes.${feature}.fallbacks: model must be a string or null`;
  }
  return null;
}

/** The fallbacks of a route: an array of at most MAX_ROUTE_FALLBACKS, each distinct from the primary and each other. */
function fallbacksError(feature, provider, fallbacks) {
  if (!Array.isArray(fallbacks)) return `routes.${feature}.fallbacks must be an array`;
  if (fallbacks.length > MAX_ROUTE_FALLBACKS) {
    return `routes.${feature}.fallbacks: at most ${MAX_ROUTE_FALLBACKS}`;
  }
  const seen = new Set([provider]);
  for (const entry of fallbacks) {
    const problem = fallbackError(feature, entry, seen);
    if (problem) return problem;
  }
  return null;
}

/**
 * Validate one route of a v1 PUT body. Returns the error sentence, or null.
 * Stricter than the migration's normaliser on purpose: the normaliser drops
 * what it cannot use so a stored oddity never breaks a call, while a save
 * names the mistake so it is never stored.
 */
function routeError(feature, raw) {
  if (!isPlainObject(raw)) {
    return `routes.${feature} must be { provider, model?, fallbacks? } or null`;
  }
  const provider = providerName(raw.provider);
  if (!DEFAULT_PROVIDER_ORDER.includes(provider)) {
    return `routes.${feature}.provider must be one of ${DEFAULT_PROVIDER_ORDER.join(', ')}`;
  }
  if (!isOptionalString(raw.model)) {
    return `routes.${feature}.model must be a string or null`;
  }
  return raw.fallbacks === undefined ? null : fallbacksError(feature, provider, raw.fallbacks);
}

/**
 * The whole `routes` map of a v1 PUT body: an object of known features,
 * each a valid route or null. Returns the error sentence, or null.
 */
function routingRequestError(incoming) {
  if (!isPlainObject(incoming)) {
    return 'Body must be { routes: { <feature>: { provider, model?, fallbacks?: [{ provider, model? }] } | null } } or a version 2 selection document { version: 2, global: { priority }, tasks, updatedAt }';
  }
  const unknown = Object.keys(incoming).filter((name) => !FEATURE_NAMES.includes(name));
  if (unknown.length > 0) {
    return `Unknown AI feature(s): ${unknown.join(', ')}. Known: ${FEATURE_NAMES.join(', ')}`;
  }
  for (const [feature, raw] of Object.entries(incoming)) {
    const problem = raw === null ? null : routeError(feature, raw);
    if (problem) return problem;
  }
  return null;
}

/**
 * The v1 view of a v2 document, for the Routing tab: each `custom` task as
 * `{ provider, model, fallbacks }` (the chain's head and the next
 * MAX_ROUTE_FALLBACKS); a `global` or `recommended` task has no route.
 */
export function routesView(selection) {
  const routes = {};
  for (const [task, entry] of Object.entries(selection?.tasks || {})) {
    if (entry.mode !== 'custom' || !entry.chain?.length) continue;
    const [primary, ...rest] = entry.chain;
    routes[task] = {
      provider: primary.provider,
      model: primary.model,
      fallbacks: rest.slice(0, MAX_ROUTE_FALLBACKS).map(({ provider, model }) => ({ provider, model })),
    };
  }
  return routes;
}

/**
 * A v1 `{ routes }` body applied to a v2 document, with the meaning a route
 * had before the migration: the task's entry is re-derived from the route
 * and the task's placements (migrate-selection.js taskEntryFor), so a route
 * leads and a `first` provider follows it, and null puts the task back to
 * what its placements alone say — Simple mode, as the Routing tab calls it.
 */
export function applyRoutesToSelection(selection, incoming, { features, providers }) {
  const tasks = { ...selection.tasks };
  for (const [task, raw] of Object.entries(incoming)) {
    const entry = taskEntryFor({
      task,
      route: raw === null ? null : normalizeRoute(raw),
      features,
      providers,
    });
    if (entry) tasks[task] = entry;
    else delete tasks[task];
  }
  return normalizeSelection({ ...selection, tasks });
}

/**
 * The model catalogue as the router reads it, so what a save judges eligible
 * is what a call will. A catalogue that cannot be read is null, as in the
 * config loader: the save then judges every model by the code table.
 */
async function readCatalogOrNull(ctx, context) {
  try {
    return await readModelCatalog({ store: ctx.store, now: ctx.now });
  } catch (error) {
    context?.error?.('putAiRouting: could not read the model catalogue:', error);
    return null;
  }
}

/** The three documents the current selection is derived from (a v1 store migrates in memory), and the catalogue. */
async function readCurrent(ctx, context) {
  const [stored, providers, features, catalog] = await Promise.all([
    ctx.store.readDoc(SETTINGS_CONTAINER, ROUTING_DOC_ID, ROUTING_DOC_ID),
    ctx.store.queryDocs(PROVIDERS_CONTAINER, 'SELECT * FROM c'),
    ctx.store.readDoc(SETTINGS_CONTAINER, FEATURES_DOC_ID, FEATURES_DOC_ID),
    readCatalogOrNull(ctx, context),
  ]);
  const cards = Array.isArray(providers) ? providers : [];
  return {
    stored,
    cards,
    catalog,
    features: features || null,
    selection: selectionFrom({ providers: cards, features: features || null, routing: stored || null }),
  };
}

/** The answer both verbs send: the v2 document and its v1 view. */
function answer(selection, extra = {}) {
  return {
    success: true,
    selection,
    routes: routesView(selection),
    updatedAt: selection.updatedAt,
    ...extra,
  };
}

/**
 * GET /api/cms/ai-routing — the selection document (version 2) and its v1
 * view. `migrated` says the stored document is still v1 (or absent) and
 * what is returned was derived in memory. The catalogue travels with the
 * answer for the same reason getAiFeatures sends it.
 */
async function getAiRouting(ctx, request, context) {
  const auth = await ctx.guard.requireRole(request, 'editor');
  if (auth.error) return auth.error;
  try {
    const { stored, selection } = await readCurrent(ctx, context);
    return json(
      200,
      answer(selection, {
        migrated: !isSelectionV2(stored),
        catalogue: AI_FEATURES,
        providers: DEFAULT_PROVIDER_ORDER,
        maxFallbacks: MAX_ROUTE_FALLBACKS,
      })
    );
  } catch (error) {
    context.error('getAiRouting failed:', error);
    return json(500, { error: 'Failed to read AI routing' });
  }
}

/** What holds a key and is switched on, for the "would have no model" rule (§6). */
function availabilityFor(ctx, cards) {
  const keyed = typeof ctx.availableProviders === 'function' ? ctx.availableProviders() : null;
  if (!Array.isArray(keyed)) return undefined;
  return { keyed, enabled: resolveProviderOrder(cards, keyed).order };
}

/**
 * The next document for a PUT body, or `{ status, body }` to answer with. A
 * v2 body is validated whole (§6) and its `updatedAt` must be the one the
 * page read; a v1 body is validated as before, merged, and the result held
 * to the same §6 rule. Both judge eligibility over the catalogue the router
 * reads, so a save never accepts a chain a call would turn away.
 */
function nextSelection(ctx, body, current) {
  const eligibility = { availability: availabilityFor(ctx, current.cards), catalog: current.catalog };
  if (body.version !== undefined || body.global !== undefined || body.tasks !== undefined) {
    const errors = validateSelection(body, eligibility);
    if (errors.length) return { status: 400, body: { error: errors[0], errors } };
    if ((body.updatedAt ?? null) !== (current.selection.updatedAt ?? null)) {
      return {
        status: 409,
        body: {
          error: 'The selection document changed since it was read; reload and apply the change again.',
          updatedAt: current.selection.updatedAt,
        },
      };
    }
    return { selection: normalizeSelection(body) };
  }
  const problem = routingRequestError(body.routes);
  if (problem) return { status: 400, body: { error: problem } };
  const selection = applyRoutesToSelection(current.selection, body.routes, {
    features: current.features,
    providers: current.cards,
  });
  const errors = validateSelection(selection, eligibility);
  if (errors.length) return { status: 400, body: { error: errors[0], errors } };
  return { selection };
}

/**
 * PUT /api/cms/ai-routing — a v2 document, or a v1 `{ routes }` body merged
 * into the current one (header). Writes version 2 either way. Same role as
 * the feature switches.
 */
async function putAiRouting(ctx, request, context) {
  const auth = await ctx.guard.requireRole(request, 'editor');
  if (auth.error) return auth.error;
  try {
    const body = validBody(await request.json().catch(() => null));
    if (!body) return json(400, { error: routingRequestError(null) });

    const current = await readCurrent(ctx, context);
    const next = nextSelection(ctx, body, current);
    if (next.status) return json(next.status, next.body);

    const nowIso = ctx.now().toISOString();
    const selection = {
      ...next.selection,
      updatedAt: nowIso,
      updatedBy: actorName(auth.user),
    };
    // A full replace rather than a patch: the stored v1 `routes` map has to
    // leave the document, not linger beside the v2 fields; the Cosmos
    // system fields of the stored document are kept.
    const base = { ...(current.stored || {}) };
    delete base.routes;
    await ctx.store.upsertDoc(SETTINGS_CONTAINER, {
      ...base,
      id: ROUTING_DOC_ID,
      version: SELECTION_VERSION,
      ...selection,
    });
    ctx.aiConfigChanged();
    return json(200, answer(selection));
  } catch (error) {
    context.error('putAiRouting failed:', error);
    return json(500, { error: 'Failed to save AI routing' });
  }
}

/**
 * @param {{ guard: object, store: object, now: () => Date, aiConfigChanged: () => void,
 *           availableProviders?: () => string[] }} ctx
 */
export function createAiRoutingHandlers(ctx) {
  return {
    getAiRouting: (request, context) => getAiRouting(ctx, request, context),
    putAiRouting: (request, context) => putAiRouting(ctx, request, context),
  };
}
