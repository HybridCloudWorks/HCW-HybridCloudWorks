/**
 * routing-table.js — per-task routing (ADR 0033 §4): `admin_settings/ai-routing`.
 *
 *   { routes: { <feature>: { provider, model, fallbacks: [{ provider, model }] } } }
 *
 * A feature with a route is served by its primary provider first, then its
 * fallbacks in order, then whatever the global order still offers — so a
 * route can never leave a task with fewer options than the default ("Simple
 * mode") had. A feature without a route uses the global order unchanged.
 * Rule 1 of the ai-config.js header still holds: a routed provider that has
 * no key, or is switched off, is skipped, never added. The model named on a
 * route wins over the provider card's `defaultModel`; a route with no model
 * leaves the card's choice (or the purpose table) in force.
 *
 * Split from ai-config.js, which re-exports everything here.
 *
 * DEPRECATED: the v1 document (ADR 0034 slice 3, #858). The router no
 * longer calls `applyFeatureRoute`; a stored v1 document is migrated in
 * memory to the version 2 selection document (migrate-selection.js: a
 * route → a `custom` chain with `thenGlobal: true`) and the first PUT after
 * the merge stores version 2. `normalizeRouting` stays as the migration's
 * reader and for the v1 view the Routing tab reads until slice 4 (#859)
 * replaces it with the Tasks tab.
 */
import { FEATURE_NAMES } from './features-catalogue.js';
import { DEFAULT_PROVIDER_ORDER } from './provider-order.js';

export const ROUTING_DOC_ID = 'ai-routing';
export const MAX_ROUTE_FALLBACKS = 3;

const cleanModel = (value) => {
  const model = typeof value === 'string' ? value.trim() : '';
  return model || null;
};

const cleanProvider = (value) =>
  String(value || '')
    .toLowerCase()
    .trim();

/**
 * One stored route, normalised: a provider the router implements, an optional
 * model, and up to MAX_ROUTE_FALLBACKS fallbacks that are neither the primary
 * nor each other. Null when the entry names no usable provider.
 *
 * @param {unknown} raw
 * @returns {{provider: string, model: string|null, fallbacks: Array<{provider: string, model: string|null}>}|null}
 */
export function normalizeRoute(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const provider = cleanProvider(raw.provider);
  if (!DEFAULT_PROVIDER_ORDER.includes(provider)) return null;
  const seen = new Set([provider]);
  const fallbacks = [];
  for (const entry of Array.isArray(raw.fallbacks) ? raw.fallbacks : []) {
    const fallbackProvider = cleanProvider(entry?.provider);
    if (!DEFAULT_PROVIDER_ORDER.includes(fallbackProvider) || seen.has(fallbackProvider)) continue;
    seen.add(fallbackProvider);
    fallbacks.push({
      provider: fallbackProvider,
      model: cleanModel(entry?.model),
    });
    if (fallbacks.length >= MAX_ROUTE_FALLBACKS) break;
  }
  return { provider, model: cleanModel(raw.model), fallbacks };
}

/**
 * The routing document, normalised to known features and valid routes.
 *
 * @param {object|null} doc The `ai-routing` document, or null.
 * @returns {{routes: Record<string, ReturnType<typeof normalizeRoute>>}}
 */
export function normalizeRouting(doc) {
  const routes = {};
  const stored = doc?.routes;
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const [feature, raw] of Object.entries(stored)) {
      if (!FEATURE_NAMES.includes(feature)) continue;
      const route = normalizeRoute(raw);
      if (route) routes[feature] = route;
    }
  }
  return { routes };
}

/** The route for a feature, or null when it follows the global order. */
export function routeFor(routing, feature) {
  if (!feature || !routing?.routes) return null;
  return Object.hasOwn(routing.routes, feature) ? routing.routes[feature] : null;
}

/**
 * Apply a feature's route to an already-resolved order.
 *
 * Runs AFTER resolveProviderOrder and applyFeaturePlacement, so `order` holds
 * only providers that hold a key, are enabled, and are allowed for this
 * feature: the route can move them, never add one. The result is
 * `[primary, ...fallbacks, ...rest of order]`, each with the model the route
 * named (or null, meaning "the card's choice"). `skipped` names routed
 * providers that were not available, so a log line can say why the primary
 * did not serve.
 *
 * @param {string[]} order
 * @param {ReturnType<typeof normalizeRoute>|null} route
 * @returns {{chain: Array<{provider: string, model: string|null}>, skipped: string[]}}
 */
export function applyFeatureRoute(order, route) {
  if (!route)
    return {
      chain: order.map((provider) => ({ provider, model: null })),
      skipped: [],
    };
  const wanted = [{ provider: route.provider, model: route.model }, ...route.fallbacks];
  const chain = [];
  const skipped = [];
  const used = new Set();
  for (const entry of wanted) {
    if (order.includes(entry.provider)) {
      chain.push(entry);
      used.add(entry.provider);
    } else {
      skipped.push(entry.provider);
    }
  }
  for (const provider of order) {
    if (!used.has(provider)) chain.push({ provider, model: null });
  }
  return { chain, skipped };
}
