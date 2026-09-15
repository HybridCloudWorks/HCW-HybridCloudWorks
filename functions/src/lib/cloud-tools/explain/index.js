/**
 * "Explain this number" (#613 Phase 3), in four modules: the request and
 * its canonical hash (validate.js), the two spend bounds (quota.js), the
 * prompt and the URL stripping (prompt.js), and the pipeline that orders
 * them (handler.js, which carries the route's header). Everything a caller
 * or a test needs is re-exported here.
 */

export { createExplainHandlers, EXPLAIN_CACHE_TTL_SECONDS } from './handler.js';
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
