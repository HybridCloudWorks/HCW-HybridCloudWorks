/**
 * POST /api/public/cloud-tools/explain — "Explain this number" (#613 Phase 3).
 *
 * The comparison page posts the scenario it has already priced — the
 * region, the scenario, the extras, and up to three per-provider totals with
 * their segments — and gets back two short paragraphs from the site's AI
 * router saying which provider is cheapest for that shape and why, what the
 * extras add, and one thing that could flip the answer. The page labels the
 * text as generated.
 *
 * This is an ANONYMOUS route that spends money, so it is bounded four ways,
 * in this order, and each bound is a test:
 *
 *   1. **Validation** (validate.js). The body is at most 8 KB, JSON, and
 *      exactly the documented shape — every field checked, every string
 *      capped, unknown keys refused.
 *   2. **Cache first.** The canonical body is hashed and `explain:<sha256>`
 *      is read from tool_service_cache. A hit costs one point read and no
 *      model call, however many visitors open the same shared link. Cached
 *      documents carry a 7-day `ttl`.
 *   3. **Per-client rate limit**, 5 per hour (quota.js), on the same
 *      Cloudflare-verified hashed identity the anonymous submission and
 *      newsletter routes use. In production a request that did not arrive
 *      through Cloudflare is refused, not counted.
 *   4. **Daily cap**, 200 per UTC day across every client (quota.js). Above
 *      it the route pauses until tomorrow rather than failing: the page shows
 *      the pause.
 *
 * The provider check sits between 2 and 3: the router's own selection for
 * the `pricingExplain` feature — key present, provider not disabled in the
 * portal, feature switched on — and when it refuses, nothing is counted
 * against anyone, because nothing could have been spent. The feature toggle
 * is the owner's off switch for the one anonymous AI call.
 *
 * The model's text is stripped of anything that looks like a URL (prompt.js)
 * before it is stored or returned.
 *
 * The handler is a pipeline of module-scope steps over one `state`: each step either
 * answers (returns a reply) or fills in what the next step needs (returns
 * null). One place turns a reply into an HTTP response, one place turns a
 * throw into the 500.
 */

import { CACHE_CONTAINER, utcDay } from '../history.js';
import { EXPLAIN_FEATURE, EXPLAIN_SYSTEM_PROMPT, stripUrls } from './prompt.js';
import { takeClientQuota, takeDailyQuota } from './quota.js';
import {
  EXPLAIN_MAX_BODY_BYTES,
  canonicalExplainRequest,
  explainCacheId,
  validateExplainRequest,
} from './validate.js';

export const EXPLAIN_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Seconds a cache hit may be served from an HTTP cache: the text is a week old at most anyway. */
const HIT_CACHE_SECONDS = 3600;

const reply = (status, body, headers = {}) => ({ status, body, headers });
const unavailable = () => reply(503, { error: 'Explanations are not available' });

const toResponse = ({ status, body, headers }) => ({
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

/** The router's two "not a fault" refusals: no provider, or the feature switched off. */
const isUnavailable = (error) =>
  error?.code === 'AI_NOT_CONFIGURED' || error?.code === 'AI_FEATURE_DISABLED';

const explanation = (doc, cached) => ({
  text: doc.text,
  model: doc.model ?? null,
  generatedAt: doc.generatedAt ?? null,
  cached,
});

/** The raw body as JSON, or the sentence for the 400. */
async function parseBody(request) {
  const raw = String((await request.text().catch(() => '')) ?? '');
  if (Buffer.byteLength(raw, 'utf8') > EXPLAIN_MAX_BODY_BYTES) {
    return { error: `Body must be at most ${EXPLAIN_MAX_BODY_BYTES} bytes` };
  }
  try {
    return { body: JSON.parse(raw) };
  } catch {
    return { error: 'Body must be valid JSON' };
  }
}

/**
 * The pipeline's steps, each `(deps, state) => Promise<reply|null>` at module
 * scope: a step either answers (returns a reply) or fills in what the next
 * step needs (returns null). `deps` is `{ identity, store, ai, now }` — see
 * createExplainHandlers.
 */

async function readRequest(_deps, state) {
  if (String(state.request.method).toUpperCase() !== 'POST') {
    return reply(405, { error: 'POST only' });
  }
  const read = await parseBody(state.request);
  const validated = read.error ? read : validateExplainRequest(read.body);
  if (validated.error) return reply(400, { error: validated.error });
  state.value = validated.value;
  state.canonical = canonicalExplainRequest(validated.value);
  state.id = explainCacheId(state.canonical);
  return null;
}

async function serveCached({ store }, state) {
  const cached = await store.readDoc(CACHE_CONTAINER, state.id, state.id);
  if (typeof cached?.text !== 'string' || !cached.text) return null;
  return reply(
    200,
    { success: true, explanation: explanation(cached, true) },
    { 'Cache-Control': `public, max-age=${HIT_CACHE_SECONDS}` }
  );
}

// Nothing could be spent, so nothing is counted: the router's own selection
// before any counter moves. The same refusal at call time is handled in
// `generate`.
async function checkProvider({ ai }, state) {
  try {
    await ai.resolveProvider(EXPLAIN_FEATURE);
    return null;
  } catch (error) {
    if (!isUnavailable(error)) throw error;
    state.context.warn?.(`explain unavailable: ${error.message}`);
    return unavailable();
  }
}

async function checkIdentity({ identity }, state) {
  try {
    state.clientKey = identity.anonymousKey(state.request).key;
    return null;
  } catch {
    state.context.warn?.('explain rejected: unverified origin');
    return reply(403, { error: 'Forbidden' });
  }
}

async function checkClientQuota({ store, now }, state) {
  const allowed = await takeClientQuota(store, { clientKey: state.clientKey, now: now() });
  return allowed ? null : reply(429, { error: 'Too many requests' }, { 'Retry-After': '3600' });
}

async function checkDailyQuota({ store, now }, state) {
  state.nowIso = new Date(now()).toISOString();
  const allowed = await takeDailyQuota(store, { day: utcDay(state.nowIso), nowIso: state.nowIso });
  return allowed ? null : reply(503, { error: 'Explanations are paused for today' });
}

async function generate({ ai, store }, state) {
  const usageOut = [];
  let generated;
  try {
    generated = await ai.generateTextResponse({
      prompt: state.canonical,
      systemPrompt: EXPLAIN_SYSTEM_PROMPT,
      purpose: 'general',
      usageOut,
      // The literal, not EXPLAIN_FEATURE: ai-call-sites.test.js reads the
      // feature off the call by source scan, and a constant here would read
      // as an ungated call. The test pins the two agree.
      feature: 'pricingExplain',
    });
  } catch (error) {
    if (!isUnavailable(error)) throw error;
    state.context.warn?.(`explain unavailable: ${error.message}`);
    return unavailable();
  }
  const text = stripUrls(generated);
  if (!text) return reply(502, { error: 'The model returned nothing' });
  const doc = {
    id: state.id,
    kind: 'explain',
    region: state.value.region,
    scenarioId: state.value.scenarioId,
    text,
    model: usageOut[0]?.model ?? null,
    generatedAt: state.nowIso,
    ttl: EXPLAIN_CACHE_TTL_SECONDS,
  };
  await store.upsertDoc(CACHE_CONTAINER, doc);
  return reply(200, { success: true, explanation: explanation(doc, false) });
}

/** The pipeline, in the order the header describes. */
const STEPS = Object.freeze([
  readRequest,
  serveCached,
  checkProvider,
  checkIdentity,
  checkClientQuota,
  checkDailyQuota,
  generate,
]);

/**
 * @param {object} deps
 * @param {{ anonymousKey: Function }} deps.identity client-identity.js
 * @param {{ readDoc: Function, upsertDoc: Function, incrementIf: Function, createDoc: Function, replaceDocIfMatch: Function }} deps.store
 * @param {{ resolveProvider: Function, generateTextResponse: Function }} deps.ai the router
 * @param {() => number} [deps.now] epoch ms
 */
export function createExplainHandlers({ identity, store, ai, now = Date.now }) {
  const deps = { identity, store, ai, now };

  return {
    /** POST /api/public/cloud-tools/explain */
    async explain(request, context) {
      const state = { request, context };
      try {
        for (const step of STEPS) {
          const outcome = await step(deps, state);
          if (outcome) return toResponse(outcome);
        }
        // `generate` always replies; reaching here is a programming error.
        throw new Error('explain pipeline ended without a reply');
      } catch (error) {
        context.error?.('publicCloudToolsExplain failed:', error);
        return toResponse(reply(500, { error: 'Failed to explain' }));
      }
    },
  };
}
