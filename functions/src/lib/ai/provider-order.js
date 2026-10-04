/**
 * provider-order.js — the providers the router implements, in the order used
 * when configuration says nothing. Split from ai-config.js so the routing
 * table and the feature catalogue can both read it without a cycle; every
 * caller still imports it from ai-config.js or router.js (PROVIDERS).
 *
 * Owner decision, 2026-08-23: Gemini first, then OpenAI, then Claude. NVIDIA
 * (#701) is appended last and is placed per feature — see
 * PER_FEATURE_PROVIDERS in features-catalogue.js. By default it stays last
 * for content features, as their backup (2026-09-29), an administrator can
 * move it to the front for one feature, and for the public ones it is
 * removed.
 *
 * This is a cost ordering, not a quality one. Gemini Flash-Lite is roughly a
 * tenth of Claude Sonnet per token, and the work behind these calls — summarise
 * a page, write alt text, grade a draft — is well inside what the cheap model
 * does correctly. `CONTENTFORGE_AI_PROVIDER` still pins a provider outright,
 * and per-provider `order` in the portal overrides this list.
 *
 * Foundry (#849, 2026-10-04) is appended too and is also placed per feature:
 * 'first' for the content features the owner triggers, 'off' for the public
 * ones. Its global position is last so a stored card that predates it keeps
 * its order; the placement is what moves it to the front where it serves.
 */
export const DEFAULT_PROVIDER_ORDER = Object.freeze([
  'gemini',
  'openai',
  'anthropic',
  'nvidia',
  'foundry',
]);
