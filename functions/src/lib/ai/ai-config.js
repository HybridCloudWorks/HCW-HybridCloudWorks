/**
 * ai-config.js — the admin portal's AI settings, made to actually mean something.
 *
 * WHY THIS EXISTS. The admin portal has had provider cards with enable toggles
 * and an order field since it was ported. They wrote documents into the
 * `ai_providers` container and **the router never opened that container**.
 * `getActiveAiProvider()` looked at environment variables and nothing else, so
 * every toggle in the UI was decorative: turning Claude off in the portal left
 * Claude serving every request. The portal was not merely out of date, it was
 * actively misleading — it also listed Vertex as enabled (a provider the
 * Function App cannot authenticate) and OpenAI as deprecated (a provider the
 * router calls today).
 *
 * This module is the missing half. It reads that configuration and turns it
 * into two answers the router asks for:
 *
 *   1. Which providers, in which order?   resolveProviderOrder()
 *   2. May this feature call a model?     isFeatureEnabled()
 *   3. Where does a per-feature provider  applyFeaturePlacement()  (#701)
 *      go for this feature?
 *
 * THREE RULES DECIDE EVERY EDGE CASE HERE. They are worth stating plainly
 * because each one is the answer to "what happens when configuration and
 * reality disagree", and getting any of them backwards breaks the site in a way
 * that is hard to see.
 *
 *   A KEY IS AUTHORITATIVE; CONFIGURATION IS ADVISORY. Configuration can
 *   disable a provider that has a key and can reorder the ones that do. It can
 *   never enable a provider whose key is absent. If it could, an administrator
 *   could tick a box and every AI call would start failing at the API with a
 *   401 — configuration must not be able to describe a state the platform
 *   cannot enter.
 *
 *   UNREADABLE CONFIGURATION IS NOT EMPTY CONFIGURATION. If Cosmos is
 *   unreachable, `load()` reports null and the router behaves exactly as it did
 *   before this module existed: environment order, every feature on. A
 *   configuration read failure must never be able to turn the site's AI off.
 *   That is why `load()` distinguishes "I could not read" from "I read, and
 *   everything is disabled" — the second is a legitimate instruction and is
 *   obeyed, the first is an outage and is ignored.
 *
 *   ABSENT MEANS ON. A feature with no stored setting is enabled, because that
 *   is the state the site is in today. A new feature must not arrive switched
 *   off, and an empty container must not read as "all off".
 *
 * The cache exists because this is consulted on every AI call and the answer
 * changes when an administrator clicks something — minutes apart at most, never
 * per request. A stale answer is served in preference to no answer when a
 * refresh fails, for the same reason as the second rule.
 */

/**
 * The features an administrator can switch off, and what actually stops when
 * they do. Every entry corresponds to a real call site — this catalogue is not
 * aspirational, and `ai-call-sites.test.js` fails if a call site appears that
 * is not listed here, or if a listed feature has no call site.
 *
 * `route` is the human answer to "what will I notice?", which is the question
 * someone is holding when they look at a toggle.
 */
export const AI_FEATURES = Object.freeze({
  inspector: Object.freeze({
    label: 'Content Inspector',
    description: 'Generates title, summary and tags for an ingested article.',
    route: 'Article ingest (change feed) and the Inspect action in the portal.',
  }),
  altText: Object.freeze({
    label: 'Image alt text',
    description: 'Writes alt text for images found on an inspected page.',
    route: 'Runs with the inspector; accessibility text on article images.',
  }),
  critique: Object.freeze({
    label: 'Inspector critique',
    description: 'Second pass that judges and improves the inspector output.',
    route: 'Article ingest. Turning it off keeps the inspector, drops the review.',
  }),
  forgeDrafting: Object.freeze({
    label: 'Forge drafting',
    description: 'Writes the draft body for a Content Forge job.',
    route: 'Forge jobs and the nightly Auto-Forge timer. This is the writing.',
  }),
  forgeGrading: Object.freeze({
    label: 'Forge grading',
    description: 'Scores a forged draft before it is offered for publication.',
    route: 'Forge jobs. Off means drafts arrive ungraded, not that they stop.',
  }),
  telegram: Object.freeze({
    label: 'Telegram assistant',
    description: 'Free-form replies to messages sent to the Telegram bot.',
    route: 'The bot answers commands either way; only AI replies stop.',
  }),
  voiceCalibration: Object.freeze({
    label: 'Voice calibration',
    description: 'Suggests voice-profile additions from recent published posts.',
    route: 'The Calibrate button in Forge Studio. Suggestions only, never auto-applied.',
  }),
  socialCaption: Object.freeze({
    label: 'Social captions',
    description: 'Writes a social-media caption for a published article.',
    route: 'The Social Hub Generate button and the on-publish auto-queue to Publer.',
  }),
  listenAndLearn: Object.freeze({
    label: 'Listen & Learn scripts',
    description: 'Scripts a two-host study episode for one skill area of a certification guide.',
    route:
      'The Generate button on the Listen & Learn page, and Regenerate on one area. Off means the run fails before the model is called; existing episodes stay.',
  }),
  sourceGrounding: Object.freeze({
    label: 'Source grounding',
    description: 'Reads owner-supplied web pages and YouTube videos to ground a generation.',
    route: 'Listen & Learn source-grounded episodes (#433).',
  }),
  podcastScript: Object.freeze({
    label: 'Podcast transcripts',
    description: 'Scripts a two-host podcast episode from a published article.',
    route:
      'The Podcast transcript action on the Publish page. Off means the job fails before the model is called; existing transcripts stay.',
  }),
  pricingExplain: Object.freeze({
    label: 'Pricing explanations',
    description:
      'Explains a priced scenario on the public cloud pricing comparison: which provider is cheapest and what could flip it.',
    route:
      'The "Explain this number" button on /tools/comparison — the one anonymous AI call. Off answers "Explanations are not available" before any quota is counted; cached explanations still serve (#613).',
  }),
  landingZoneExplain: Object.freeze({
    label: 'Landing zone explanations',
    description:
      'Explains one Landing Zone Builder component for the learner’s selection and options: why it matters, and what changes without it.',
    route:
      'The "Explain this component" button on /tools/landing-zone — the same anonymous explain route, cache and quota as pricing explanations, as kind landing-zone. Off answers "Explanations are not available" before any quota is counted; cached explanations still serve (#669).',
  }),
});

export const FEATURE_NAMES = Object.freeze(Object.keys(AI_FEATURES));

/**
 * Order used when configuration says nothing. Owner decision, 2026-08-23:
 * Gemini first, then OpenAI, then Claude. NVIDIA (#701) is appended last and
 * is placed per feature — see PER_FEATURE_PROVIDERS below — so for content
 * features it is moved to the front, and for the public ones it is removed.
 *
 * This is a cost ordering, not a quality one. Gemini Flash-Lite is roughly a
 * tenth of Claude Sonnet per token, and the work behind these calls — summarise
 * a page, write alt text, grade a draft — is well inside what the cheap model
 * does correctly. `CONTENTFORGE_AI_PROVIDER` still pins a provider outright,
 * and per-provider `order` in the portal overrides this list.
 */
export const DEFAULT_PROVIDER_ORDER = Object.freeze(['gemini', 'openai', 'anthropic', 'nvidia']);

/**
 * Providers whose place in the chain is decided PER FEATURE (#701).
 *
 * NVIDIA's API Catalog is a trial tier: free, about 40 requests a minute per
 * account, and governed by trial terms rather than a production SLA. That is
 * an excellent fit for owner-triggered content work — a slow or refused call
 * there costs nothing visible, because the router hands it to the next
 * provider — and a poor one for the anonymous public routes, where a trial
 * ceiling and trial terms are weakest. One global position cannot express
 * both, so for these providers each feature carries a placement:
 *
 *   'first'  ahead of the global order — the free model writes, the paid ones
 *            are the failover.
 *   'order'  wherever the global order puts it (last, by default): used only
 *            when every provider above it cannot serve.
 *   'off'    never in this feature's chain.
 *
 * Its global position still exists (it is last in DEFAULT_PROVIDER_ORDER, and
 * the portal can move it and switch it off like any other provider); a
 * placement then moves it or removes it for one feature.
 */
export const PER_FEATURE_PROVIDERS = Object.freeze(['nvidia']);

export const PLACEMENTS = Object.freeze(['first', 'order', 'off']);

/**
 * The placement each feature gets when configuration says nothing, and the
 * ceiling configuration can never lift.
 *
 * 'off' HERE IS A LOCK, not a default. The header's first rule is that
 * configuration can reorder and disable, never enable, and a feature whose
 * code-level placement is 'off' is one where routing to the trial tier is not
 * a decision an administrator can make from a toggle:
 *
 *   pricingExplain, landingZoneExplain — the anonymous public explain route.
 *     Unauthenticated traffic against a 40 RPM trial account, under trial
 *     terms, is exactly the use the issue ruled out.
 *   altText — sends images; the default NVIDIA models are chosen for text.
 *   sourceGrounding — Gemini-only by construction (router.js header).
 *
 * A feature missing from this table is 'off' too, so a new feature arrives
 * without the trial tier until someone decides otherwise — the opposite of
 * rule 3, deliberately: rule 3 is about the feature running at all, this is
 * about a trial-tier provider joining it.
 *
 * Content features the owner triggers are 'first'. The Telegram assistant is
 * owner-only chat rather than content, so it keeps the global order.
 */
export const PROVIDER_PLACEMENT_DEFAULTS = Object.freeze({
  nvidia: Object.freeze({
    inspector: 'first',
    critique: 'first',
    forgeDrafting: 'first',
    forgeGrading: 'first',
    voiceCalibration: 'first',
    socialCaption: 'first',
    listenAndLearn: 'first',
    podcastScript: 'first',
    telegram: 'order',
    altText: 'off',
    sourceGrounding: 'off',
    pricingExplain: 'off',
    landingZoneExplain: 'off',
  }),
});

/**
 * Where a per-feature provider goes for one feature.
 *
 * A call with no feature (or an unknown one) gets 'off': an undeclared call is
 * not one anybody chose to send to a trial tier. `ai-call-sites.test.js` makes
 * sure every real call site declares one.
 *
 * @param {object|null} settings The `ai-features` document, or null.
 * @param {string} provider      One of PER_FEATURE_PROVIDERS.
 * @param {string|null} feature  A key of AI_FEATURES.
 * @returns {'first'|'order'|'off'}
 */
export function placementFor(settings, provider, feature) {
  const defaults = PROVIDER_PLACEMENT_DEFAULTS[provider];
  if (!defaults || !feature) return 'off';
  const fallback = defaults[feature] || 'off';
  // The lock: nothing stored can put a provider into a feature it is off for.
  if (fallback === 'off') return 'off';
  const stored = settings?.placement?.[provider]?.[feature];
  return PLACEMENTS.includes(stored) ? stored : fallback;
}

/** Can configuration place `provider` in `feature` at all? False means locked off. */
export function isPlacementConfigurable(provider, feature) {
  const fallback = PROVIDER_PLACEMENT_DEFAULTS[provider]?.[feature];
  return Boolean(fallback) && fallback !== 'off';
}

/**
 * Apply every per-feature placement to an already-resolved order.
 *
 * Runs AFTER resolveProviderOrder, so it only ever sees providers that hold a
 * key and are enabled: it can move one to the front or remove it, never add
 * one. That is rule 1 carried through.
 *
 * @param {string[]} order
 * @param {object|null} settings
 * @param {string|null} feature
 * @returns {{order: string[], excluded: string[]}} `excluded` names providers
 *          that were available but are not used for this feature, so an empty
 *          chain can say why.
 */
export function applyFeaturePlacement(order, settings, feature) {
  const first = [];
  const rest = [];
  const excluded = [];
  for (const provider of order) {
    if (!PER_FEATURE_PROVIDERS.includes(provider)) {
      rest.push(provider);
      continue;
    }
    const placement = placementFor(settings, provider, feature);
    if (placement === 'off') excluded.push(provider);
    else if (placement === 'first') first.push(provider);
    else rest.push(provider);
  }
  return { order: [...first, ...rest], excluded };
}

export const PROVIDERS_CONTAINER = 'ai_providers';
export const SETTINGS_CONTAINER = 'admin_settings';
export const FEATURES_DOC_ID = 'ai-features';

/** Ranked lowest-first, so an unordered provider sorts after every ordered one. */
function rankOf(doc, id) {
  const order = Number(doc?.order);
  if (Number.isFinite(order)) return order;
  const fallback = DEFAULT_PROVIDER_ORDER.indexOf(id);
  return fallback === -1 ? Number.MAX_SAFE_INTEGER : 1000 + fallback;
}

/**
 * Configured providers ∩ providers that hold a key, in configured order.
 *
 * @param {Array<object>|null} docs   `ai_providers` documents, or null when the
 *                                    configuration could not be read.
 * @param {string[]} available        Providers whose API key is present. This is
 *                                    the authority: nothing outside it is ever
 *                                    returned, whatever the documents say.
 * @returns {{order: string[], disabled: string[]}} `disabled` names providers
 *          that hold a key but were switched off, which is the difference
 *          between "not configured" and "turned off" in the router's error.
 */
export function resolveProviderOrder(docs, available) {
  // `available` is the router's PROVIDERS ∩ keys-present, so it is already the
  // authoritative set. Nothing here needs the full provider list: documents for
  // providers this platform does not implement (vertex, perplexity, bedrock,
  // replicate) are simply never looked up. They stay in the container untouched
  // — they are historical rows, and dropping stored configuration as a side
  // effect of a read would be worse than ignoring it.
  const withKeys = [...new Set(available)];

  // No readable configuration — behave exactly as the env-only router did.
  if (!Array.isArray(docs)) {
    return {
      order: [...withKeys].sort(
        (a, b) => DEFAULT_PROVIDER_ORDER.indexOf(a) - DEFAULT_PROVIDER_ORDER.indexOf(b)
      ),
      disabled: [],
    };
  }

  const byId = new Map();
  for (const doc of docs) {
    const id = String(doc?.id || '')
      .toLowerCase()
      .trim();
    if (id) byId.set(id, doc);
  }

  const enabled = withKeys.filter((id) => byId.get(id)?.enabled !== false);
  const disabled = withKeys.filter((id) => byId.get(id)?.enabled === false);

  enabled.sort((a, b) => {
    const delta = rankOf(byId.get(a), a) - rankOf(byId.get(b), b);
    // A stable tiebreak, so two providers sharing an order value do not swap
    // between instances and make the active provider look non-deterministic.
    return delta !== 0
      ? delta
      : DEFAULT_PROVIDER_ORDER.indexOf(a) - DEFAULT_PROVIDER_ORDER.indexOf(b);
  });

  return { order: enabled, disabled };
}

/** The model an administrator pinned for a provider, if any. */
export function configuredModelFor(docs, provider) {
  if (!Array.isArray(docs)) return null;
  const doc = docs.find((d) => String(d?.id || '').toLowerCase() === provider);
  const model = typeof doc?.defaultModel === 'string' ? doc.defaultModel.trim() : '';
  return model || null;
}

/**
 * Absent means on — see the header. Only an explicit `false` disables.
 *
 * @param {object|null} settings The `ai-features` settings document, or null.
 * @param {string} feature       A key of AI_FEATURES.
 */
export function isFeatureEnabled(settings, feature) {
  if (!feature) return true;
  return settings?.features?.[feature] !== false;
}

/**
 * Reads both documents, cached, with a stale-over-nothing failure policy.
 *
 * @param {object} deps
 * @param {{queryDocs: Function, readDoc: Function}} [deps.store] Omit and the
 *        loader reports null for everything, which is the pre-configuration
 *        behaviour. Unit tests of the router rely on that.
 * @param {number} [deps.ttlMs]
 */
export function createAiConfigLoader({
  store = null,
  ttlMs = 60_000,
  now = () => Date.now(),
  log = console,
} = {}) {
  const EMPTY = Object.freeze({ providers: null, features: null });

  let cache = null; // { at, value }
  let inflight = null;

  async function read() {
    const [providers, features] = await Promise.all([
      store.queryDocs(PROVIDERS_CONTAINER, 'SELECT * FROM c'),
      store.readDoc(SETTINGS_CONTAINER, FEATURES_DOC_ID, FEATURES_DOC_ID),
    ]);
    return {
      providers: Array.isArray(providers) ? providers : [],
      features: features || null,
    };
  }

  async function load() {
    if (!store) return EMPTY;
    if (cache && now() - cache.at < ttlMs) return cache.value;
    if (inflight) return inflight;

    inflight = read().then(
      (value) => {
        cache = { at: now(), value };
        inflight = null;
        return value;
      },
      (error) => {
        inflight = null;
        log.warn?.(`[ai-config] could not read AI configuration: ${error?.message || error}`);
        // Stale beats nothing: an administrator's disable stays in force through
        // a Cosmos blip rather than silently reverting to "everything on".
        if (cache) {
          cache = { at: now(), value: cache.value };
          return cache.value;
        }
        return EMPTY;
      }
    );
    return inflight;
  }

  return { load, invalidate: () => (cache = null) };
}
