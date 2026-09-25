/**
 * The `pricing` kind of POST public/cloud-tools/explain — the original
 * "Explain this number" (#613 Phase 3) — as a kind (#669). It is the default:
 * a body with no `kind`, or `kind: "pricing"`, is validated by ../validate.js,
 * hashed by its canonical form and asked of the model with ../prompt.js
 * exactly as before, so the route's existing contract, cache ids and stored
 * documents are unchanged byte for byte.
 */

import { EXPLAIN_FEATURE, EXPLAIN_SYSTEM_PROMPT } from '../prompt.js';
import { canonicalExplainRequest, validateExplainRequest } from '../validate.js';

export const PRICING_KIND_ID = 'pricing';

/**
 * The shape every kind has, dispatched on by kinds/index.js and run by
 * ../handler.js:
 *
 *   - `id`          the `kind` value in the request.
 *   - `feature`     the AI_FEATURES key the router is asked to serve (the
 *                   owner's off switch), before any counter moves.
 *   - `validate`    `(rawBody) => { value } | { error }`; the body arrives
 *                   with `kind` removed.
 *   - `canonical`   `(value) => string`, the text whose sha256 is the cache
 *                   id. A kind other than pricing puts `kind` in it, so the
 *                   cache key carries the kind.
 *   - `cacheFields` `(value) => object`, what the stored document records
 *                   about the request besides the text.
 *   - `generate`    `(ai, { value, canonical, usageOut }) => Promise<string>`,
 *                   the one model call, declaring its feature as a literal so
 *                   ai-call-sites.test.js can see it.
 */
export const PRICING_KIND = Object.freeze({
  id: PRICING_KIND_ID,
  feature: EXPLAIN_FEATURE,
  validate: validateExplainRequest,
  canonical: canonicalExplainRequest,
  cacheFields: (value) => ({ region: value.region, scenarioId: value.scenarioId }),
  generate: (ai, { canonical, usageOut }) =>
    ai.generateTextResponse({
      prompt: canonical,
      systemPrompt: EXPLAIN_SYSTEM_PROMPT,
      purpose: 'general',
      usageOut,
      // The literal, not EXPLAIN_FEATURE: ai-call-sites.test.js reads the
      // feature off the call by source scan, and a constant here would read
      // as an ungated call. explain.test.js pins the two agree.
      feature: 'pricingExplain',
    }),
});
