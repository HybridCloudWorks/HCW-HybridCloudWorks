/**
 * ai-routing.js — AI routing by task (lib/ai/ai-config.js, ADR 0033 §4):
 * `admin_settings/ai-routing`, which provider and model serve each feature.
 *
 * Each handler body is a module-level function over `ctx` (guard, store, now,
 * aiConfigChanged); the factory at the bottom only wires them.
 */
import {
  AI_FEATURES,
  DEFAULT_PROVIDER_ORDER,
  FEATURE_NAMES,
  MAX_ROUTE_FALLBACKS,
  ROUTING_DOC_ID,
  normalizeRoute,
  normalizeRouting,
} from '../ai/ai-config.js';
import { json, validBody } from '../http/admin-handler.js';

const SETTINGS_CONTAINER = 'admin_settings';

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
 * Validate one route of a PUT cms/ai-routing body. Returns the error
 * sentence, or null. Stricter than the router's normaliser on purpose: the
 * router drops what it cannot use so a stored oddity never breaks a call,
 * while a save names the mistake so it is never stored.
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
 * The whole `routes` map of a PUT cms/ai-routing body: an object of known
 * features, each a valid route or null. Returns the error sentence, or null.
 */
function routingRequestError(incoming) {
  if (!isPlainObject(incoming)) {
    return 'Body must be { routes: { <feature>: { provider, model?, fallbacks?: [{ provider, model? }] } | null } }';
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
 * GET /api/cms/ai-routing — which provider and model serve each feature.
 *
 * `routes` holds only the features that have one; a feature absent here
 * follows the global order of preference ("Simple mode"). The catalogue
 * travels with the answer for the same reason getAiFeatures sends it.
 */
async function getAiRouting(ctx, request, context) {
  const auth = await ctx.guard.requireRole(request, 'editor');
  if (auth.error) return auth.error;
  try {
    const doc = await ctx.store.readDoc(SETTINGS_CONTAINER, ROUTING_DOC_ID, ROUTING_DOC_ID);
    return json(200, {
      success: true,
      routes: normalizeRouting(doc).routes,
      catalogue: AI_FEATURES,
      providers: DEFAULT_PROVIDER_ORDER,
      maxFallbacks: MAX_ROUTE_FALLBACKS,
      updatedAt: doc?.updatedAt || null,
    });
  } catch (error) {
    context.error('getAiRouting failed:', error);
    return json(500, { error: 'Failed to read AI routing' });
  }
}

/**
 * PUT /api/cms/ai-routing — body { routes: { <feature>: route | null } }.
 * Merges: a feature not in the body keeps its route; `null` removes one
 * (back to the global order). Same role as the feature switches.
 */
async function putAiRouting(ctx, request, context) {
  const auth = await ctx.guard.requireRole(request, 'editor');
  if (auth.error) return auth.error;
  try {
    const body = validBody(await request.json().catch(() => null));
    const incoming = body?.routes;
    const problem = routingRequestError(incoming);
    if (problem) return json(400, { error: problem });

    const existing = await ctx.store.readDoc(SETTINGS_CONTAINER, ROUTING_DOC_ID, ROUTING_DOC_ID);
    const routes = { ...normalizeRouting(existing).routes };
    for (const [feature, raw] of Object.entries(incoming)) {
      if (raw === null) delete routes[feature];
      else routes[feature] = normalizeRoute(raw);
    }
    const nowIso = ctx.now().toISOString();
    const doc = { id: ROUTING_DOC_ID, routes, updatedAt: nowIso };
    // A full replace rather than a patch: `routes` is one map, and a
    // removed feature has to leave the stored document, not linger as a
    // key the patch never touched.
    await ctx.store.upsertDoc(SETTINGS_CONTAINER, existing ? { ...existing, ...doc } : doc);
    ctx.aiConfigChanged();
    return json(200, { success: true, routes, updatedAt: nowIso });
  } catch (error) {
    context.error('putAiRouting failed:', error);
    return json(500, { error: 'Failed to save AI routing' });
  }
}

/** @param {{ guard: object, store: object, now: () => Date, aiConfigChanged: () => void }} ctx */
export function createAiRoutingHandlers(ctx) {
  return {
    getAiRouting: (request, context) => getAiRouting(ctx, request, context),
    putAiRouting: (request, context) => putAiRouting(ctx, request, context),
  };
}
