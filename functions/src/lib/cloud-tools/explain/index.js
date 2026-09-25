/**
 * "Explain this number" (#613 Phase 3), in four modules: the request and
 * its canonical hash (validate.js), the two spend bounds (quota.js), the
 * prompt and the URL stripping (prompt.js), and the pipeline that orders
 * them (handler.js, which carries the route's header) — plus, since #669,
 * the kinds the one route serves (kinds/): pricing, the default, and
 * landing-zone. Everything a caller or a test needs is re-exported here.
 */

export { createExplainHandlers, EXPLAIN_CACHE_TTL_SECONDS } from './handler.js';
export {
  DEFAULT_EXPLAIN_KIND,
  EXPLAIN_KIND_IDS,
  EXPLAIN_KINDS,
  selectExplainKind,
} from './kinds/index.js';
export {
  LANDING_ZONE_COMPONENT_IDS,
  LANDING_ZONE_EXPLAIN_FEATURE,
  LANDING_ZONE_KIND,
  LANDING_ZONE_MAX_SELECTED,
  LANDING_ZONE_MAX_TEACHES_CHARS,
  LANDING_ZONE_MODULES,
  LANDING_ZONE_OPTION_KEYS,
  LANDING_ZONE_SYSTEM_PROMPT,
  canonicalLandingZoneExplainRequest,
  landingZoneExplainPrompt,
  validateLandingZoneExplainRequest,
} from './kinds/landingZone.js';
export { PRICING_KIND } from './kinds/pricing.js';
export { EXPLAIN_FEATURE, EXPLAIN_SYSTEM_PROMPT, stripUrls } from './prompt.js';
export {
  EXPLAIN_PER_CLIENT_PER_HOUR,
  EXPLAIN_PER_DAY,
  EXPLAIN_QUOTA_TTL_SECONDS,
  explainQuotaId,
  takeClientQuota,
  takeDailyQuota,
} from './quota.js';
export {
  EXPLAIN_MAX_BODY_BYTES,
  canonicalExplainRequest,
  explainCacheId,
  validateExplainRequest,
} from './validate.js';
