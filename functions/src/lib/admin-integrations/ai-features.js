/**
 * ai-features.js — the AI feature switches and per-feature provider
 * placement of the admin integrations surface (lib/ai/ai-config.js, #701):
 * `admin_settings/ai-features`.
 *
 * Each handler body is a module-level function over `ctx` (guard, store, now,
 * aiConfigChanged); the factory at the bottom only wires them.
 */
import {
  AI_FEATURES,
  FEATURE_NAMES,
  FEATURES_DOC_ID,
  PER_FEATURE_PROVIDERS,
  PLACEMENTS,
  PROVIDER_PLACEMENT_DEFAULTS,
  isPlacementConfigurable,
  placementFor,
} from '../ai/ai-config.js';
import { json, validBody } from '../http/admin-handler.js';

const SETTINGS_CONTAINER = 'admin_settings';
/** Kept in step with the router's reader by ai-config.js exporting it. */
const AI_FEATURES_DOC_ID = FEATURES_DOC_ID;

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Every per-feature provider's placement for every feature, as the router
 * will apply it — lock included — so the portal renders what will happen
 * rather than what was stored (#701).
 */
function resolvedPlacement(doc) {
  return Object.fromEntries(
    PER_FEATURE_PROVIDERS.map((provider) => [
      provider,
      Object.fromEntries(FEATURE_NAMES.map((name) => [name, placementFor(doc, provider, name)])),
    ])
  );
}

/**
 * One feature's placement value for a provider: the error sentence, or null.
 * A locked feature accepts only 'off': configuration can reorder and
 * disable, never enable (ai-config.js), and storing a 'first' the router
 * will ignore would leave a setting in the document that reads as working
 * and governs nothing.
 */
function placementValueError(provider, feature, value) {
  if (!FEATURE_NAMES.includes(feature)) return `Unknown AI feature: ${feature}`;
  if (!PLACEMENTS.includes(value)) {
    return `placement.${provider}.${feature} must be one of ${PLACEMENTS.join(', ')}`;
  }
  if (value !== 'off' && !isPlacementConfigurable(provider, feature)) {
    return `${provider} is never used for ${feature}; that cannot be changed from the portal.`;
  }
  return null;
}

/** One provider's `{ <feature>: placement }` map: the error sentence, or null. */
function providerPlacementError(provider, byFeature) {
  if (!PER_FEATURE_PROVIDERS.includes(provider)) {
    return `Unknown per-feature provider: ${provider}. Known: ${PER_FEATURE_PROVIDERS.join(', ')}`;
  }
  if (!isPlainObject(byFeature)) {
    return `placement.${provider} must be { <feature>: "first" | "order" | "off" }`;
  }
  for (const [feature, value] of Object.entries(byFeature)) {
    const problem = placementValueError(provider, feature, value);
    if (problem) return problem;
  }
  return null;
}

/**
 * Validate a `placement` patch: `{ <provider>: { <feature>: 'first'|'order'|'off' } }`.
 * Returns the error sentence, or null.
 */
function placementError(placement) {
  if (!isPlainObject(placement)) {
    return 'placement must be { <provider>: { <feature>: "first" | "order" | "off" } }';
  }
  for (const [provider, byFeature] of Object.entries(placement)) {
    const problem = providerPlacementError(provider, byFeature);
    if (problem) return problem;
  }
  return null;
}

/**
 * The body of a PUT, checked: `{ incoming, hasPlacement }` or `{ error }`.
 * An unknown name is either a typo or a hand-made request, and silently
 * storing it would leave a switch in the document that governs nothing.
 */
function checkAiFeaturesBody(body) {
  const hasPlacement = body?.placement !== undefined;
  const incoming = body?.features ?? (hasPlacement ? {} : undefined);
  if (!isPlainObject(incoming)) {
    return {
      error:
        'Body must be { features: { <name>: boolean } } and/or { placement: { <provider>: { <name>: "first" | "order" | "off" } } }',
    };
  }
  const problem = hasPlacement ? placementError(body.placement) : null;
  if (problem) return { error: problem };
  const unknown = Object.keys(incoming).filter((name) => !FEATURE_NAMES.includes(name));
  if (unknown.length > 0) {
    return {
      error: `Unknown AI feature(s): ${unknown.join(', ')}. Known: ${FEATURE_NAMES.join(', ')}`,
    };
  }
  return { incoming, hasPlacement };
}

/**
 * Placement merges one level deeper than the switches: setting one
 * feature's nvidia placement must not clear another's.
 */
function mergedPlacement(existing, incoming) {
  const providers = new Set([...Object.keys(existing || {}), ...Object.keys(incoming)]);
  return Object.fromEntries(
    [...providers].map((provider) => [
      provider,
      { ...(existing?.[provider] || {}), ...(incoming[provider] || {}) },
    ])
  );
}

/**
 * GET /api/cms/ai-features — which parts of the site may call a model.
 *
 * The catalogue travels with the answer so the portal renders its toggles
 * from the server's list rather than a copy of it. That copy is exactly how
 * the AI Engine page came to advertise Vertex as enabled and OpenAI as
 * deprecated while the router did the opposite — a second list nobody
 * updated. There is one list, and it is AI_FEATURES.
 */
async function getAiFeatures(ctx, request, context) {
  const auth = await ctx.guard.requireRole(request, 'editor');
  if (auth.error) return auth.error;
  try {
    const doc = await ctx.store.readDoc(SETTINGS_CONTAINER, AI_FEATURES_DOC_ID, AI_FEATURES_DOC_ID);
    const stored = doc?.features || {};
    // Absent means on, the same rule the router applies. Resolving it here
    // means the UI renders real state instead of an empty object.
    const features = Object.fromEntries(
      FEATURE_NAMES.map((name) => [name, stored[name] !== false])
    );
    return json(200, {
      success: true,
      features,
      catalogue: AI_FEATURES,
      // #701: where each per-feature provider goes, and the code-level
      // defaults ('off' there is a lock the portal renders as such).
      placement: resolvedPlacement(doc),
      placementDefaults: PROVIDER_PLACEMENT_DEFAULTS,
    });
  } catch (error) {
    context.error('getAiFeatures failed:', error);
    return json(500, { error: 'Failed to read AI feature settings' });
  }
}

/**
 * PUT /api/cms/ai-features — body { features?: { <name>: boolean },
 * placement?: { <provider>: { <name>: 'first'|'order'|'off' } } }, at
 * least one of the two. Both merge; neither replaces.
 */
async function putAiFeatures(ctx, request, context) {
  const auth = await ctx.guard.requireRole(request, 'editor');
  if (auth.error) return auth.error;
  try {
    const body = validBody(await request.json().catch(() => null));
    const checked = checkAiFeaturesBody(body);
    if (checked.error) return json(400, { error: checked.error });
    const { incoming, hasPlacement } = checked;

    // Stored as strict booleans. The router only treats an explicit false as
    // off, so a stray 0 or "false" would read as ON — coercing here means
    // the document cannot express that ambiguity in the first place.
    const features = Object.fromEntries(
      Object.entries(incoming).map(([name, value]) => [name, value !== false])
    );

    const existing = await ctx.store.readDoc(
      SETTINGS_CONTAINER,
      AI_FEATURES_DOC_ID,
      AI_FEATURES_DOC_ID
    );
    const merged = { ...(existing?.features || {}), ...features };
    const placement = hasPlacement
      ? mergedPlacement(existing?.placement, body.placement)
      : undefined;
    const fields = {
      features: merged,
      ...(placement ? { placement } : {}),
      updatedAt: ctx.now().toISOString(),
    };
    const saved = existing
      ? await ctx.store.patchDoc(SETTINGS_CONTAINER, AI_FEATURES_DOC_ID, fields)
      : await ctx.store.upsertDoc(SETTINGS_CONTAINER, { id: AI_FEATURES_DOC_ID, ...fields });
    const result = saved || { ...existing, ...fields };
    ctx.aiConfigChanged();
    return json(200, {
      success: true,
      features: result.features || merged,
      placement: resolvedPlacement(result),
    });
  } catch (error) {
    context.error('putAiFeatures failed:', error);
    return json(500, { error: 'Failed to save AI feature settings' });
  }
}

/** @param {{ guard: object, store: object, now: () => Date, aiConfigChanged: () => void }} ctx */
export function createAiFeatureHandlers(ctx) {
  return {
    getAiFeatures: (request, context) => getAiFeatures(ctx, request, context),
    putAiFeatures: (request, context) => putAiFeatures(ctx, request, context),
  };
}
