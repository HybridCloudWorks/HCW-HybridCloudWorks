/**
 * AI Engine — feature switches, per-feature placement and routing by task
 * (ADR 0033 §4). Imported through `@/lib/aiEngine`, which re-exports it.
 */
import { getJSON, sendJSON } from '@/lib/api';

/**
 * Which parts of the site may call a model.
 *
 * Returns `{ features, catalogue }`. The catalogue is the API's own list — the
 * page renders its toggles from it rather than from a copy kept here, because a
 * second copy of a list like this is exactly how DEFAULT_PROVIDERS came to
 * describe a platform that no longer existed.
 */
export async function getAiFeatures() {
  const res = await getJSON('cms/ai-features');
  return {
    features: res.features || {},
    catalogue: res.catalogue || {},
    // #701: { nvidia: { <feature>: 'first'|'order'|'off' } } as the router
    // will apply it, and the code-level defaults — where a default is 'off'
    // the feature is locked and the page shows it as such.
    placement: res.placement || {},
    placementDefaults: res.placementDefaults || {},
  };
}

/** Turn one feature on or off. Merges server-side; other features are untouched. */
export async function setAiFeature(name, enabled) {
  const res = await sendJSON('cms/ai-features', 'PUT', { features: { [name]: enabled } });
  return res.features || {};
}

/**
 * Place a per-feature provider for one feature: 'first', 'order' or 'off'.
 * Returns the resolved placement map. The API refuses anything but 'off' for
 * a locked feature — configuration can disable, never enable.
 */
export async function setAiPlacement(provider, feature, placement) {
  const res = await sendJSON('cms/ai-features', 'PUT', {
    placement: { [provider]: { [feature]: placement } },
  });
  return res.placement || {};
}

/**
 * Which provider and model serve each feature. `routes` holds only the
 * features that have a route; a feature absent from it follows the global
 * order ("Simple mode"). The catalogue and provider list come from the API,
 * never from a copy here.
 */
export async function getAiRouting() {
  const res = await getJSON('cms/ai-routing');
  return {
    routes: res.routes || {},
    catalogue: res.catalogue || {},
    providers: res.providers || [],
    maxFallbacks: res.maxFallbacks || 3,
    updatedAt: res.updatedAt || null,
  };
}

/**
 * Set one feature's route, or clear it with `null` so it follows the global
 * order again. Merges server-side; other features are untouched. Returns
 * every route as stored.
 */
export async function setAiRoute(feature, route) {
  const res = await sendJSON('cms/ai-routing', 'PUT', { routes: { [feature]: route } });
  return res.routes || {};
}
