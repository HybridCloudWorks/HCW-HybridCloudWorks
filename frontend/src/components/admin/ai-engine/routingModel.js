/**
 * Routing's pure rules (ADR 0033 §4; split out of RoutingTab.jsx in PR #841):
 * how a provider is named, what a task will do in one sentence, and how a
 * route changes one step at a time. No React, so the tab can be read for what
 * it renders and this for what it decides.
 */

export const DEFAULT_ORDER_VALUE = '__default__';
export const AUTO_MODEL_VALUE = '__auto__';

const PROVIDER_LABELS = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Claude (Anthropic)',
  nvidia: 'NVIDIA',
};

/** A provider's display name: the card's, else a known label, else the id. */
export function providerLabel(id, providers = []) {
  return providers.find((p) => p.id === id)?.name || PROVIDER_LABELS[id] || id;
}

/** True when the card says the provider cannot serve: switched off, or no key. */
export function providerUnavailable(id, providers = []) {
  const p = providers.find((x) => x.id === id);
  return Boolean(p) && (p.enabled === false || p.status === 'unavailable');
}

/** Providers as the Services tab sorts them: by `order`, unknown last. */
export const sortByOrder = (providers) =>
  [...providers].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

/** The running global order: enabled providers with a key, in Services order. */
export const runningOrder = (providers) =>
  sortByOrder(providers.filter((p) => p.enabled && p.status !== 'unavailable')).map((p) => p.id);

/**
 * What a task will do, in one sentence, from its route and the global
 * order: the sentence the Simple view shows and the Advanced view confirms.
 */
export function describeRoute(route, { providers = [], order = [] } = {}) {
  if (!route) {
    const [first] = order;
    return first
      ? `Default order: ${providerLabel(first, providers)} first, then the rest in order.`
      : 'Default order of preference.';
  }
  const steps = [route.provider, ...(route.fallbacks || []).map((f) => f.provider)];
  const named = steps.map((id) => providerLabel(id, providers)).join(' → ');
  const model = route.model ? ` (${route.model})` : '';
  return `${named}${model}, then the rest of the default order.`;
}

/** The headline over the table, for the state it is in. */
export function routingSummary({ status, routedCount, featureCount }) {
  if (status === 'loading') return 'Reading the routing table…';
  if (routedCount === 0) {
    return 'Every task follows the order of preference on AI Services. Assign a provider and model to a task here when one of them should be served differently.';
  }
  return `${routedCount} of ${featureCount} tasks have their own route; the rest follow the order of preference.`;
}

const EMPTY_ROUTE = Object.freeze({ provider: '', model: null, fallbacks: [] });

/** `Auto` in a model select means no pin. */
const modelOrNull = (model) => (model === AUTO_MODEL_VALUE ? null : model);

/** One fallback replaced by index, the rest untouched. */
const withFallbackAt = (base, index, replace) => ({
  ...base,
  fallbacks: base.fallbacks.map((f, i) => (i === index ? replace(f) : f)),
});

/** How each kind of change rewrites a route. `null` from `primary` clears the route. */
const ROUTE_CHANGES = {
  primary: (base, change) =>
    change.provider === DEFAULT_ORDER_VALUE
      ? null
      : {
          ...base,
          provider: change.provider,
          // A model belongs to a provider; switching providers clears it.
          model: base.provider === change.provider ? base.model : null,
          fallbacks: (base.fallbacks || []).filter((f) => f.provider !== change.provider),
        },
  model: (base, change) => ({ ...base, model: modelOrNull(change.model) }),
  addFallback: (base, change) => ({
    ...base,
    fallbacks: [...(base.fallbacks || []), { provider: change.provider, model: null }],
  }),
  fallbackProvider: (base, change) =>
    withFallbackAt(base, change.index, () => ({ provider: change.provider, model: null })),
  fallbackModel: (base, change) =>
    withFallbackAt(base, change.index, (f) => ({ ...f, model: modelOrNull(change.model) })),
  removeFallback: (base, change) => ({
    ...base,
    fallbacks: base.fallbacks.filter((_, i) => i !== change.index),
  }),
};

/** The route with one step changed; `null` when the primary is cleared. */
export function updateRoute(route, change) {
  const base = route || EMPTY_ROUTE;
  const apply = ROUTE_CHANGES[change.type];
  return apply ? apply(base, change) : base;
}

/** The routes table with `feature` set to `route`, or removed when `route` is null. */
export function withRoute(routes, feature, route) {
  const next = { ...routes };
  if (route) next[feature] = route;
  else delete next[feature];
  return next;
}
