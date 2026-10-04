/**
 * features-catalogue.js — the features an administrator can switch off, and
 * where a per-feature provider goes for each of them. Split from
 * ai-config.js (which re-exports everything here) so the catalogue and the
 * placement rules read as one page; the three rules that decide every edge
 * case are in the ai-config.js header.
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
  forgeAssist: Object.freeze({
    label: 'Forge Studio assist',
    description:
      'Outlines, expands, condenses, rewrites, retitles or fact-checks a draft from an action in Forge Studio.',
    route:
      'The AI actions on the Draft tab in Forge Studio (ADR 0033). Off means each button answers that the feature is switched off; the draft text is untouched.',
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
export const PER_FEATURE_PROVIDERS = Object.freeze(['nvidia', 'foundry']);

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
 * Content features the owner triggers were 'first' from #701 until 2026-09-29,
 * then 'order' (owner decision that day). Measured through the portal's Test:
 * the free tier took 56-117 s to say "ok" with the drafting limits, and did not
 * answer 16 tokens inside 45 s once the Test was capped (#806), so the delay is
 * the trial tier queueing, not the model thinking. As 'first' every
 * synchronous call waited out NVIDIA's budget share (about 35 s, #807) before
 * the paid provider answered, and every background call waited up to two
 * minutes. As 'order' NVIDIA is the backup: used when the providers above it
 * cannot serve. A weekly probe (the `probeAiProviders` timer, Monday 06:15
 * UTC, lib/timers/ai-provider-probe.js) runs the portal's Test against every
 * provider with a key and records the latency on each provider card, so
 * moving a feature back to 'first' is a choice made on evidence. The Telegram
 * assistant is owner-only chat rather than content, and was 'order' already.
 */
/**
 * One provider's table: every content feature at `content`, altText as
 * given (it sends images, so it depends on the provider's models), and the
 * three locks 'off' for every per-feature provider: the anonymous public
 * explain route and the Gemini-only grounded call.
 */
const placements = ({ content, altText }) =>
  Object.freeze({
    inspector: content,
    critique: content,
    forgeDrafting: content,
    forgeGrading: content,
    voiceCalibration: content,
    socialCaption: content,
    listenAndLearn: content,
    podcastScript: content,
    telegram: content,
    forgeAssist: content,
    altText,
    sourceGrounding: 'off',
    pricingExplain: 'off',
    landingZoneExplain: 'off',
  });

export const PROVIDER_PLACEMENT_DEFAULTS = Object.freeze({
  // The backup since 2026-09-29 (the comment above); its text models are not
  // chosen for images.
  nvidia: placements({ content: 'order', altText: 'off' }),
  // Microsoft Foundry (#849). Owner decision 2026-10-04: first for the
  // content features, not for the public route. It is a paid provider under
  // its own budget, so 'first' is the point of it; altText is included
  // because gpt-5-mini reads images.
  foundry: placements({ content: 'first', altText: 'first' }),
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

/**
 * Absent means on — see the ai-config.js header. Only an explicit `false`
 * disables.
 *
 * @param {object|null} settings The `ai-features` settings document, or null.
 * @param {string} feature       A key of AI_FEATURES.
 */
export function isFeatureEnabled(settings, feature) {
  if (!feature) return true;
  return settings?.features?.[feature] !== false;
}
