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
 *   1. **Validation.** The body is at most 8 KB, JSON, and exactly the shape
 *      below — every field checked, every string capped, unknown keys
 *      refused. The numbers are the page's own arithmetic, echoed back; the
 *      model is told to use only those numbers, and the body is what it is
 *      told them in, so nothing unvalidated reaches the prompt.
 *   2. **Cache first.** The canonical body is hashed and `explain:<sha256>`
 *      is read from tool_service_cache. A hit costs one point read and no
 *      model call, however many visitors open the same shared link. Cached
 *      documents carry a 7-day `ttl`.
 *   3. **Per-client rate limit**, 5 per hour, through the same Cloudflare-
 *      verified hashed identity and the same compare-and-increment counter
 *      the anonymous submission and newsletter routes use (client-identity.js,
 *      submissions.js enforceSubmissionQuota). In production a request that
 *      did not arrive through Cloudflare is refused, not counted.
 *   4. **Daily cap**, 200 per UTC day across every client, as a counter
 *      document `explain-quota:<day>` incremented with `incrementIf` so a
 *      burst cannot read-then-write its way past it. Above the cap the route
 *      pauses until tomorrow rather than failing: the page shows the pause.
 *
 * The provider check sits between 2 and 3: the router's own chain
 * resolution for the `pricingExplain` feature — key present, provider not
 * disabled in the portal, feature switched on — and when it refuses, nothing
 * is counted against anyone, because nothing could have been spent. The
 * feature toggle is the owner's off switch for the one anonymous AI call.
 *
 * The model's text is stripped of anything that looks like a URL before it
 * is stored or returned. The prompt carries visitor-supplied strings (a
 * scenario label, extra labels), and a link written into generated text on a
 * public page is the one thing an injected label could usefully produce.
 */

import { createHash } from 'node:crypto';

import { enforceSubmissionQuota } from '../submissions.js';
import { CACHE_CONTAINER, utcDay } from './history.js';
import { PROVIDERS } from './pricing/baseline.js';
import { regionOption } from './pricing/regions.js';

/** The AI_FEATURES key (lib/ai/ai-config.js) this route runs under. */
export const EXPLAIN_FEATURE = 'pricingExplain';
export const EXPLAIN_MAX_BODY_BYTES = 8 * 1024;
export const EXPLAIN_PER_CLIENT_PER_HOUR = 5;
export const EXPLAIN_PER_DAY = 200;
export const EXPLAIN_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const EXPLAIN_QUOTA_TTL_SECONDS = 2 * 24 * 60 * 60;
/** Seconds a cache hit may be served from an HTTP cache: the text is a week old at most anyway. */
const HIT_CACHE_SECONDS = 3600;

const MAX_STRING = 80;
const MAX_RESULTS = 3;
const MAX_SEGMENTS = 8;
const MAX_EXTRAS = 8;
/** More than this and the model is padding; the page shows two paragraphs. */
const MAX_TEXT_CHARS = 2000;

export const EXPLAIN_SYSTEM_PROMPT = [
  'You are writing two short paragraphs for a public cloud-pricing comparison page.',
  'The user message is a JSON object: a scenario priced on up to three cloud providers, with each',
  "provider's monthly total, its base cost, the cost each extra adds, and the services it could",
  'not price. Use only the numbers given; do not invent, estimate or recall any price.',
  'Say which provider is cheapest for this scenario and by how much, what the extras add, and one',
  'thing that could flip the answer. No marketing, no recommendations to buy, no links, at most',
  '180 words, plain text with no headings, lists or markdown.',
].join(' ');

const json = (status, body, headers = {}) => ({
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

/** The router's two "not a fault" refusals: no provider, or the feature switched off. */
const isUnavailable = (error) =>
  error?.code === 'AI_NOT_CONFIGURED' || error?.code === 'AI_FEATURE_DISABLED';

/** A refusal in the validator: a sentence naming the field, never the value. */
class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message);
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function onlyKeys(value, allowed, where) {
  const extra = Object.keys(value).filter((k) => !allowed.includes(k));
  if (extra.length) refuse(`${where} has unknown field(s): ${extra.join(', ')}`);
}

function text(value, where, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) refuse(`${where} is required`);
    return '';
  }
  if (typeof value !== 'string') refuse(`${where} must be a string`);
  const trimmed = value.trim();
  if (required && !trimmed) refuse(`${where} must not be empty`);
  if (trimmed.length > MAX_STRING) refuse(`${where} must be at most ${MAX_STRING} characters`);
  return trimmed;
}

function money(value, where) {
  if (typeof value !== 'number' || !Number.isFinite(value))
    refuse(`${where} must be a finite number`);
  return value;
}

function stringList(value, where, max) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) refuse(`${where} must be an array of strings`);
  if (value.length > max) refuse(`${where} may hold at most ${max} entries`);
  return value.map((entry, i) => text(entry, `${where}[${i}]`));
}

/**
 * The request body, validated field by field, in the canonical key order.
 *
 * @returns {{ value: object } | { error: string }}
 */
export function validateExplainRequest(body) {
  try {
    if (!isPlainObject(body)) refuse('Body must be a JSON object');
    onlyKeys(
      body,
      ['region', 'scenarioId', 'scenarioLabel', 'extras', 'egressGb', 'results'],
      'body'
    );

    const region = text(body.region, 'region');
    if (!regionOption(region)) refuse('region is not one of the comparison regions');
    const scenarioId = text(body.scenarioId, 'scenarioId');
    const scenarioLabel = text(body.scenarioLabel, 'scenarioLabel');
    const extras = stringList(body.extras, 'extras', MAX_EXTRAS);
    const egressGb = money(body.egressGb, 'egressGb');
    if (egressGb < 0) refuse('egressGb must not be negative');

    if (!Array.isArray(body.results) || body.results.length === 0) {
      refuse('results must be a non-empty array');
    }
    if (body.results.length > MAX_RESULTS)
      refuse(`results may hold at most ${MAX_RESULTS} entries`);
    const seen = new Set();
    const results = body.results.map((result, i) => {
      const where = `results[${i}]`;
      if (!isPlainObject(result)) refuse(`${where} must be an object`);
      onlyKeys(result, ['provider', 'total', 'base', 'segments', 'unavailable'], where);
      const provider = text(result.provider, `${where}.provider`);
      if (!PROVIDERS.includes(provider)) refuse(`${where}.provider is not a known provider`);
      if (seen.has(provider)) refuse(`${where}.provider repeats ${provider}`);
      seen.add(provider);
      const total = money(result.total, `${where}.total`);
      const base = money(result.base, `${where}.base`);
      if (result.segments !== undefined && !Array.isArray(result.segments)) {
        refuse(`${where}.segments must be an array`);
      }
      const segments = (result.segments ?? []).map((segment, j) => {
        const at = `${where}.segments[${j}]`;
        if (!isPlainObject(segment)) refuse(`${at} must be an object`);
        onlyKeys(segment, ['extraId', 'label', 'cost'], at);
        return {
          extraId: text(segment.extraId, `${at}.extraId`),
          label: text(segment.label, `${at}.label`),
          cost: money(segment.cost, `${at}.cost`),
        };
      });
      if (segments.length > MAX_SEGMENTS) {
        refuse(`${where}.segments may hold at most ${MAX_SEGMENTS} entries`);
      }
      const unavailable = stringList(result.unavailable, `${where}.unavailable`, MAX_SEGMENTS);
      return { provider, total, base, segments, unavailable };
    });

    return { value: { region, scenarioId, scenarioLabel, extras, egressGb, results } };
  } catch (error) {
    if (error instanceof Refusal) return { error: error.message };
    throw error;
  }
}

/**
 * The canonical text of a validated request: the validator's own key order,
 * results sorted by provider, so the same scenario hashes the same whichever
 * order the page listed the providers in.
 */
export function canonicalExplainRequest(value) {
  return JSON.stringify({
    ...value,
    results: [...value.results].sort((a, b) => a.provider.localeCompare(b.provider)),
  });
}

export function explainCacheId(canonical) {
  return `explain:${createHash('sha256').update(canonical).digest('hex')}`;
}

export function explainQuotaId(day) {
  return `explain-quota:${day}`;
}

const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const URL_LIKE = /(?:https?:\/\/|www\.)[^\s<>()"']+/gi;
const BARE_DOMAIN =
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|cloud|ai|co|us|uk|eu|info|biz|xyz|app)\b(?:\/[^\s<>()"']*)?/gi;

/**
 * Generated text with anything URL-shaped removed: markdown links keep their
 * text, `https://…` and `www.…` go, and so does a bare domain with a common
 * TLD. A defence against a link injected through a visitor-supplied label,
 * not a guarantee; the page renders the result as text, never as HTML.
 */
export function stripUrls(value) {
  return String(value ?? '')
    .replace(MARKDOWN_LINK, '$1')
    .replace(URL_LIKE, '')
    .replace(BARE_DOMAIN, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:])/g, '$1')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/**
 * Take one of today's 200, or say no. `incrementIf` is the compare-and-
 * increment cosmos-client.js documents; 404 means today's counter does not
 * exist yet and `createDoc` races to make it (409: someone else did, go
 * round); 412 means the predicate failed, which for `count < limit` is the
 * cap. Anything else is a fault and propagates.
 *
 * @returns {Promise<boolean>} true when the call may proceed
 */
export async function takeDailyQuota(store, { day, nowIso, limit = EXPLAIN_PER_DAY }) {
  const id = explainQuotaId(day);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await store.incrementIf(CACHE_CONTAINER, id, {
        path: '/count',
        value: 1,
        condition: 'FROM c WHERE c.count < @limit',
        conditionValues: { limit },
      });
      return true;
    } catch (error) {
      if (error?.code === 412) return false;
      if (error?.code !== 404) throw error;
    }
    try {
      await store.createDoc(CACHE_CONTAINER, {
        id,
        kind: 'explain-quota',
        day,
        count: 1,
        createdAt: nowIso,
        ttl: EXPLAIN_QUOTA_TTL_SECONDS,
      });
      return true;
    } catch (error) {
      if (error?.code !== 409) throw error;
    }
  }
  return false;
}

/**
 * @param {object} deps
 * @param {{ anonymousKey: Function }} deps.identity client-identity.js
 * @param {{ readDoc: Function, upsertDoc: Function, incrementIf: Function, createDoc: Function, replaceDocIfMatch: Function }} deps.store
 * @param {{ resolveProvider: Function, generateTextResponse: Function }} deps.ai the router
 * @param {() => number} [deps.now] epoch ms
 */
export function createExplainHandlers({ identity, store, ai, now = Date.now }) {
  const explanation = (doc, cached) => ({
    text: doc.text,
    model: doc.model ?? null,
    generatedAt: doc.generatedAt ?? null,
    cached,
  });

  async function readBody(request) {
    let raw;
    try {
      raw = await request.text();
    } catch {
      return { error: 'Body must be valid JSON' };
    }
    if (Buffer.byteLength(String(raw ?? ''), 'utf8') > EXPLAIN_MAX_BODY_BYTES) {
      return { error: `Body must be at most ${EXPLAIN_MAX_BODY_BYTES} bytes` };
    }
    try {
      return { body: JSON.parse(raw) };
    } catch {
      return { error: 'Body must be valid JSON' };
    }
  }

  return {
    /** POST /api/public/cloud-tools/explain */
    async explain(request, context) {
      try {
        if (String(request.method).toUpperCase() !== 'POST') {
          return json(405, { error: 'POST only' });
        }
        const read = await readBody(request);
        if (read.error) return json(400, { error: read.error });
        const validated = validateExplainRequest(read.body);
        if (validated.error) return json(400, { error: validated.error });

        const canonical = canonicalExplainRequest(validated.value);
        const id = explainCacheId(canonical);
        const cached = await store.readDoc(CACHE_CONTAINER, id, id);
        if (typeof cached?.text === 'string' && cached.text) {
          return json(
            200,
            { success: true, explanation: explanation(cached, true) },
            { 'Cache-Control': `public, max-age=${HIT_CACHE_SECONDS}` }
          );
        }

        // Nothing could be spent, so nothing is counted: the router's own
        // selection — a key, an enabled provider, the feature on — before any
        // counter moves. The same refusal at call time is handled below.
        try {
          await ai.resolveProvider(EXPLAIN_FEATURE);
        } catch (error) {
          if (!isUnavailable(error)) throw error;
          context.warn?.(`explain unavailable: ${error.message}`);
          return json(503, { error: 'Explanations are not available' });
        }

        let clientKey;
        try {
          clientKey = identity.anonymousKey(request).key;
        } catch {
          context.warn?.('explain rejected: unverified origin');
          return json(403, { error: 'Forbidden' });
        }
        try {
          await enforceSubmissionQuota(store, `explain-caller:${clientKey}`, {
            now: now(),
            limit: EXPLAIN_PER_CLIENT_PER_HOUR,
          });
        } catch (error) {
          if (error?.code !== 'SUBMISSION_RATE_LIMIT') throw error;
          return json(429, { error: 'Too many requests' }, { 'Retry-After': '3600' });
        }

        const nowIso = new Date(now()).toISOString();
        if (!(await takeDailyQuota(store, { day: utcDay(nowIso), nowIso }))) {
          return json(503, { error: 'Explanations are paused for today' });
        }

        const usageOut = [];
        let generated;
        try {
          generated = await ai.generateTextResponse({
            prompt: canonical,
            systemPrompt: EXPLAIN_SYSTEM_PROMPT,
            purpose: 'general',
            usageOut,
            // The literal, not EXPLAIN_FEATURE: ai-call-sites.test.js reads
            // the feature off the call by source scan, and a constant here
            // would read as an ungated call. The test pins the two agree.
            feature: 'pricingExplain',
          });
        } catch (error) {
          if (!isUnavailable(error)) throw error;
          context.warn?.(`explain unavailable: ${error.message}`);
          return json(503, { error: 'Explanations are not available' });
        }
        const cleaned = stripUrls(generated);
        if (!cleaned) return json(502, { error: 'The model returned nothing' });

        const doc = {
          id,
          kind: 'explain',
          region: validated.value.region,
          scenarioId: validated.value.scenarioId,
          text: cleaned,
          model: usageOut[0]?.model ?? null,
          generatedAt: nowIso,
          ttl: EXPLAIN_CACHE_TTL_SECONDS,
        };
        await store.upsertDoc(CACHE_CONTAINER, doc);
        return json(200, { success: true, explanation: explanation(doc, false) });
      } catch (error) {
        context.error?.('publicCloudToolsExplain failed:', error);
        return json(500, { error: 'Failed to explain' });
      }
    },
  };
}
