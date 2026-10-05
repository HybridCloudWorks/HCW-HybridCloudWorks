/**
 * router.js — one door to the text models, for every AI handler (T-322 §4.4).
 *
 * Ported from Site-Main `lib/ai-model-router.js` (088f458). A key makes a
 * provider POSSIBLE: seed `GEMINI_API_KEY`, `OPENAI_API_KEY` or
 * `ANTHROPIC_API_KEY` and that provider becomes available; seed none and every
 * AI handler fails with `AI_NOT_CONFIGURED` — a plain sentence, not a stack
 * trace.
 *
 * Since 2026-08-23 a key is necessary but no longer sufficient. The admin
 * portal's AI Engine page decides which of the available providers are actually
 * used, in what order, and which parts of the site may call one at all. That
 * configuration is read by `ai-config.js`, which also carries the rules for
 * what happens when it disagrees with reality — read its header before changing
 * anything here. In short: configuration can disable and reorder, never enable;
 * an unreadable configuration changes nothing.
 *
 * Default order is Gemini, OpenAI, Anthropic, and the order now FAILS OVER: a
 * provider that cannot serve a call (rejected key, unknown model, dead endpoint)
 * hands on to the next one rather than failing the call. A bad request does not
 * fail over, because it would fail identically everywhere. `callWithFailover`
 * carries the reasoning. `CONTENTFORGE_AI_PROVIDER` still pins one outright —
 * and a pin does NOT fall through, because it is an instruction rather than a
 * preference.
 *
 * What is gone from upstream and why:
 *   - Vertex. It authenticates with Application Default Credentials — a GCP
 *     identity the Function App cannot hold. Gemini is reached through the
 *     public Gemini API with an API key instead (same model names).
 *   - Azure OpenAI. Retired with the account (Migration-Plan note).
 *   - axios. `fetch` is global on Node 24 (and has been since 18); one less dependency.
 *
 * What is kept: the purpose → model table (env-overridable per provider), JSON
 * sanitising with a repair round trip, retry on 408/429/5xx, per-call usage
 * capture with cost estimates, the Anthropic prompt-cache marker.
 *
 * ONE DOOR, TWO GEMINI ENDPOINTS (#433, 2026-09-09). Everything above goes
 * through each provider's chat endpoint — for Gemini, `models/{m}:generateContent`
 * — and fails over along the chain. `generateGroundedJsonResponse` is the one
 * exception: it grounds a generation on owner-supplied web pages and YouTube
 * videos, and Google accepts a YouTube URL ONLY through its Interactions API
 * (`/v1beta/interactions`), which is also where the `url_context` tool lives.
 * That endpoint is not new to this repository — `listen-and-learn/speech/gemini.js`
 * has rendered dialogue through it since 2026-08-24 — so it is the same door the
 * speech side uses, not a second client. What goes through it: a grounded call,
 * and nothing else. What does not: every existing call site, the JSON repair
 * round trip, `callProvider`. And a grounded call does not fail over, because
 * only Gemini can read either source and the next provider down would answer,
 * successfully, from the prompt alone. The provider chain is still resolved
 * exactly as for every other call — portal order, disabled providers, the
 * `CONTENTFORGE_AI_PROVIDER` pin — and Gemini has to be in it; if it is not,
 * the call says why and stops.
 *
 * Interactions contract, verified against https://ai.google.dev/api/interactions-api,
 * https://ai.google.dev/gemini-api/docs/url-context and
 * https://ai.google.dev/gemini-api/docs/video-understanding on 2026-09-09:
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions
 *   x-goog-api-key: <key>
 *   { model,
 *     input: [ {type:'text', text}, {type:'video', uri:'https://www.youtube.com/watch?v=…'} ],
 *     tools: [ {type:'url_context'} ],
 *     system_instruction: '<plain string>',
 *     response_format: { type:'text', mime_type:'application/json', schema? } }
 *
 *   response: { status: 'completed'|'failed'|'incomplete'|'in_progress'|
 *                       'requires_action'|'cancelled'|'budget_exceeded'|'queued',
 *               steps: [ {type:'model_output', content:[{type:'text', text}]},
 *                        {type:'url_context_result', result:[{status, url}]} ],
 *               usage: { total_input_tokens, total_output_tokens,
 *                        total_thought_tokens, total_tool_use_tokens, … },
 *               errors: [{code, message}] }
 *
 *   `generation_config` has NO `temperature` (its fields are max_output_tokens,
 *   seed, stop_sequences, thinking_level, tool_choice and the media configs),
 *   so the 0.2 the chat endpoints use cannot be set here and is not. YouTube:
 *   public videos only, at most 10 per request on 2.5+ models. url_context: at
 *   most 20 URLs per request; YouTube and paywalled pages are not readable
 *   through it, and each retrieval reports `success|error|paywall|unsafe`.
 *   `total_tool_use_tokens` is "tokens present in tool-use prompt(s)", i.e. the
 *   fetched pages, so it is counted as INPUT; thought tokens as output, as on
 *   the chat endpoint. Whether `total_output_tokens` already includes thoughts
 *   is not stated on the reference page — if it does, the output count here
 *   over-reads by that amount.
 *
 * NVIDIA API CATALOG (#701, 2026-09-25). A fourth provider, `nvidia`, on the
 * OpenAI-compatible chat endpoint at https://integrate.api.nvidia.com/v1 with
 * `NVIDIA_API_KEY` as a Bearer token. It is a trial tier — free, about 40
 * requests a minute per account, trial terms — so it differs from the other
 * three in four deliberate ways:
 *
 *   - Its place in the chain is set PER FEATURE (ai-config.js,
 *     PER_FEATURE_PROVIDERS): for owner-triggered content it is the backup,
 *     after the paid providers, unless an administrator places it first for
 *     a feature (owner decision 2026-09-29; it was first by default from
 *     2026-09-25 until then). It is never used for the anonymous public
 *     explain route, and a call with no feature never uses it.
 *   - A pacing guard keeps this instance under the account limit. A call the
 *     guard refuses is not sent and fails over at once, so a burst of batch
 *     drafts degrades to the paid providers instead of failing.
 *   - A 400/422 from it fails over. "A bad request fails identically
 *     everywhere" holds for three frontier APIs; it does not hold for a
 *     catalogue of open-weight models with their own context and parameter
 *     limits, where the next provider will very likely take the same request.
 *     A part WE refused (AI_PART_REFUSED) still does not fail over.
 *   - Its usage rows are priced at zero, so the Usage tab shows the calls and
 *     the saving rather than an invented figure.
 *
 * SYNCHRONOUS CALLS HAVE A TIME BUDGET (2026-09-29). A route that answers a
 * browser holds the request open while the model works. The request dies at
 * the client's timeout (frontend lib/api.js: 90 s for a draft, 20 s by
 * default) or at the edge's ~100 s, whichever comes first. On 2026-09-29
 * NVIDIA's reasoning models took 56-58 s to reply with one word, and an
 * NVIDIA attempt may run 120 s. With NVIDIA first for drafting, the failover
 * to a paid provider started after nobody was listening. `budgetMs` on
 * generateTextResponse and generateJsonResponse is the fix. The arithmetic is
 * in time-budget.js; the contract is here:
 *
 *   - The clock starts when the call is made. It covers the configuration
 *     read, every provider, every retry and the JSON repair round trip.
 *   - Half of the budget is the failover reserve. A provider with another
 *     behind it stops early enough to leave the reserve, unless that would
 *     leave it less than MIN_ATTEMPT_MS. Then it may use all that is left,
 *     and so may the last provider.
 *   - Each attempt's timeout is the provider's own (120 s for NVIDIA, 60 s
 *     for the rest), cut to what is left of its share. It travels as the
 *     same per-call `timeoutMs` that the portal's Test passes, not as a
 *     second mechanism.
 *   - A retry is made only if its share still holds MIN_ATTEMPT_MS after the
 *     backoff. No attempt is started once less than that is left.
 *   - When less than MIN_ATTEMPT_MS is left and providers are still untried,
 *     the call fails with AI_BUDGET_EXHAUSTED (status 504). The error names
 *     each provider tried, why it failed, and which were never reached.
 *   - Pacing, the retry and failover rules, usage capture and key verdicts
 *     are unchanged.
 *
 * No budget means no change. The background paths pass none: forge jobs,
 * the schedulers, the change feed and every queue worker. They keep the full
 * timeouts and three attempts. The grounded call and `callProvider` take no
 * budget. The synchronous routes that pass one, and the client timeouts they
 * must fit under, are pinned in sync-budgets.test.js. On the trial tier's
 * measured latency, NVIDIA will seldom finish inside a synchronous share.
 * What the budget guarantees is that it can no longer stop the provider
 * behind it from answering. Since 2026-09-29 NVIDIA is not first by
 * default, so the NVIDIA case above arises only where an administrator
 * places it first; the budget still bounds any other slow first provider.
 * The weekly probe (lib/timers/ai-provider-probe.js) is the evidence for
 * placing it first again.
 *
 * MICROSOFT FOUNDRY (#849, 2026-10-04). A fifth provider, `foundry`, on the
 * OpenAI-compatible v1 chat endpoint of a Foundry account the estate owns
 * (infra/foundry.tf): `${FOUNDRY_ENDPOINT}/openai/v1/chat/completions`, with
 * the deployment name in `model`. Owner decision that day: of a USD 75 a
 * month budget, the first call is Foundry as a PAID provider for content,
 * with the cheapest text models — gpt-5-nano ($0.05 in / $0.40 out per 1M
 * tokens) for short calls and gpt-5-mini ($0.25 / $2.00) for drafts and
 * analysis. It differs from the other four in three ways:
 *
 *   - NO KEY. The account has local authentication off; the Function App's
 *     system-assigned identity holds "Cognitive Services OpenAI User" and
 *     the router sends an Entra token for the audience the Foundry v1
 *     endpoint documents, https://ai.azure.com (FOUNDRY_TOKEN_SCOPE in the
 *     environment overrides it), fetched through @azure/identity and cached
 *     until five minutes before it expires. What makes the provider POSSIBLE is the
 *     endpoint setting, which Terraform writes from the account; KEY_ENV
 *     names it so every "has a key" check reads the same way. Locally,
 *     `FOUNDRY_API_KEY` set in functions/.env sends an api-key header
 *     instead, for a developer's own account.
 *   - PLACED PER FEATURE, like NVIDIA: 'first' for the content features the
 *     owner triggers, 'off' for the anonymous public explain route and for
 *     the Gemini-only grounded call (features-catalogue.js).
 *   - Its spend has its own Cost Management budget on the `ai` resource
 *     group (USD 75, alerts at 50/90/100 %), beside the subscription one.
 *
 * A Key Vault reference that did not resolve arrives as the literal
 * `@Microsoft.KeyVault(...)` string. That is not a key; `readKey` says so.
 */

import {
  DEFAULT_PROVIDER_ORDER,
  applyFeaturePlacement,
  applyFeatureRoute,
  createAiConfigLoader,
  configuredModelFor,
  isFeatureEnabled,
  resolveProviderOrder,
  routeFor,
} from './ai-config.js';
import { featureSource, recordAiUsage } from './usage.js';
// Source grounding (#433): the pure half — source checks, prompt, request
// body, response readers — is grounding.js; the call is on the router below.
// The public names are re-exported so callers and tests are unchanged.
import {
  GROUNDED_TIMEOUT_MS,
  INTERACTIONS_URL,
  buildGroundedRequest,
  failedRetrievals,
  groundedOutputText,
  groundingUnavailable,
  validateGroundingSources,
} from './grounding.js';
import { MIN_ATTEMPT_MS, providerShareMs, startBudget } from './time-budget.js';
import { createKeyVerdictReporter, recordKeyVerdict } from '../key-verdict.js';

export {
  GROUNDING_LIMITS,
  buildGroundedPrompt,
  buildGroundedRequest,
  isYouTubeVideoUrl,
  validateGroundingSources,
} from './grounding.js';

/**
 * The providers this platform implements, in default preference order.
 *
 * Set and order are deliberately the same list: there is no implemented
 * provider without a place in the order, and no place in the order for a
 * provider that is not implemented. Keeping them as one constant is what stops
 * the two drifting — `ai-config.test.js` asserts the members match.
 *
 * The order changed on 2026-08-23 (owner decision) from Anthropic-first to
 * Gemini-first; the reasoning is on DEFAULT_PROVIDER_ORDER.
 */
export const PROVIDERS = DEFAULT_PROVIDER_ORDER;

export const KEY_ENV = Object.freeze({
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  // Not a key (header: MICROSOFT FOUNDRY): the endpoint Terraform sets. Its
  // presence is what makes the provider available; the token is fetched.
  foundry: 'FOUNDRY_ENDPOINT',
});

/**
 * Providers with no secret behind them. A 401/403 from one of these is a
 * missing role, not a bad key, so the router reports no key verdict for it:
 * there is no API-keys row to turn red, and the secret catalogue (which the
 * Terraform cross-check holds to the vault references exactly) carries no
 * entry for it. secret-catalog.test.js pins the probed set to the rest.
 */
export const KEYLESS_PROVIDERS = Object.freeze(['foundry']);

// Provider × purpose → [env var, default model].
export const DEFAULT_MODEL_TABLE = Object.freeze({
  anthropic: {
    draft: ['CONTENTFORGE_ANTHROPIC_DRAFT_MODEL', 'claude-sonnet-4-6'],
    analysis: ['CONTENTFORGE_ANTHROPIC_ANALYSIS_MODEL', 'claude-sonnet-4-6'],
    multimodal: ['CONTENTFORGE_ANTHROPIC_MULTIMODAL_MODEL', 'claude-sonnet-4-6'],
    general: ['CONTENTFORGE_ANTHROPIC_MODEL', 'claude-haiku-4-5'],
  },
  openai: {
    draft: ['CONTENTFORGE_OPENAI_DRAFT_MODEL', 'gpt-5-mini'],
    analysis: ['CONTENTFORGE_OPENAI_ANALYSIS_MODEL', 'gpt-5-mini'],
    multimodal: ['CONTENTFORGE_OPENAI_MULTIMODAL_MODEL', 'gpt-5-mini'],
    general: ['CONTENTFORGE_OPENAI_MODEL', 'gpt-5-nano'],
  },
  // Same model ids as upstream's Vertex table; the public Gemini API serves
  // them too. Env var names keep the GEMINI_ prefix so a Vertex-era override
  // cannot silently apply here.
  gemini: {
    draft: ['CONTENTFORGE_GEMINI_DRAFT_MODEL', 'gemini-3.5-flash-lite'],
    analysis: ['CONTENTFORGE_GEMINI_ANALYSIS_MODEL', 'gemini-3.6-flash'],
    multimodal: ['CONTENTFORGE_GEMINI_MULTIMODAL_MODEL', 'gemini-3.6-flash'],
    general: ['CONTENTFORGE_GEMINI_MODEL', 'gemini-3.5-flash-lite'],
  },
  // NVIDIA API Catalog (#701). Ids read from each model's page on
  // https://build.nvidia.com on 2026-09-25 — the `model` value in the page's
  // own curl sample, which is NOT always the URL slug (the page
  // build.nvidia.com/z-ai/glm-5-3 serves `z-ai/glm-5.3`):
  //   deepseek-ai/deepseek-v4.1-flash  build.nvidia.com/deepseek-ai/deepseek-v4.1-flash
  //   z-ai/glm-5.3                     build.nvidia.com/z-ai/glm-5-3
  //   z-ai/glm-5.3-flash               build.nvidia.com/z-ai/glm-5-3-flash
  // GLM-5.3, the large text MoE, serves every purpose. On the trial tier the
  // "flash" models were the slow ones, measured direct from a workstation on
  // 2026-10-04 with a one-line prompt: z-ai/glm-5.3 2.6 s,
  // z-ai/glm-5.3-flash 70 s, deepseek-ai/deepseek-v4.1-flash over 120 s. The
  // portal's Test gives up at 45 s, so the GLM-5.3-Flash default failed every
  // Test while the key was good (#701). Both keep their cost-table rows, so
  // history still prices, and a CONTENTFORGE_NVIDIA_*_MODEL override can bring
  // either back once NVIDIA serves it faster; the portal offers only the
  // defaults below (frontend aiEngine.test.js holds the two lists equal).
  // Kimi K3 is on the catalogue too, but its page's sample left `model` blank
  // on the day, so it is not a default. The catalogue changes often: a
  // retired id is a 404, which fails over to the next provider.
  nvidia: {
    draft: ['CONTENTFORGE_NVIDIA_DRAFT_MODEL', 'z-ai/glm-5.3'],
    analysis: ['CONTENTFORGE_NVIDIA_ANALYSIS_MODEL', 'z-ai/glm-5.3'],
    multimodal: ['CONTENTFORGE_NVIDIA_MULTIMODAL_MODEL', 'z-ai/glm-5.3'],
    general: ['CONTENTFORGE_NVIDIA_MODEL', 'z-ai/glm-5.3'],
  },
  // Microsoft Foundry (#849): deployment names, which infra/foundry.tf keeps
  // equal to the model names. Mini for the work that reads a whole draft,
  // nano for the short calls; the owner picks otherwise on the card.
  foundry: {
    draft: ['CONTENTFORGE_FOUNDRY_DRAFT_MODEL', 'gpt-5-mini'],
    analysis: ['CONTENTFORGE_FOUNDRY_ANALYSIS_MODEL', 'gpt-5-mini'],
    multimodal: ['CONTENTFORGE_FOUNDRY_MULTIMODAL_MODEL', 'gpt-5-mini'],
    general: ['CONTENTFORGE_FOUNDRY_MODEL', 'gpt-5-nano'],
  },
});

/**
 * Cost table: provider → model → [input USD per 1M, output USD per 1M].
 * Ported verbatim, including rows for providers this router no longer calls
 * (vertex, azure, perplexity, bedrock, replicate): `ai_usage` holds history
 * recorded against them and the admin usage page prices it through here.
 * Re-pricing history would rewrite past spend attribution.
 */
export const COST_TABLE = Object.freeze({
  anthropic: {
    'claude-opus-4-6': [15.0, 75.0],
    'claude-sonnet-4-6': [3.0, 15.0],
    'claude-haiku-4-5': [0.8, 4.0],
    'claude-haiku-4-5-20251001': [0.8, 4.0],
    default: [3.0, 15.0],
  },
  openai: {
    'gpt-4o': [5.0, 15.0],
    'gpt-4o-mini': [0.15, 0.6],
    o1: [15.0, 60.0],
    'o3-mini': [1.1, 4.4],
    // gpt-5-mini / gpt-5-nano were UNPRICED (null) from ADR 0033 until
    // 2026-10-05, when the owner confirmed OpenAI's published rates — the
    // same figures the Azure OpenAI pricing page lists for the same models
    // (read 2026-10-04). Rows written while they were null stay at 0 with
    // `unpriced: true`; the Usage tab counts and says so. A null row is still
    // how a model with no confirmed rate is kept honest (isPriced).
    'gpt-5-mini': [0.25, 2.0],
    'gpt-5-nano': [0.05, 0.4],
    default: [5.0, 15.0],
  },
  gemini: {
    'gemini-3.6-flash': [1.5, 7.5],
    'gemini-3.5-flash': [1.5, 9.0],
    'gemini-3.5-flash-lite': [0.3, 2.5],
    'gemini-2.5-pro': [3.5, 10.5],
    'gemini-2.5-flash': [0.3, 2.5],
    'gemini-2.5-flash-lite': [0.1, 0.4],
    // Text-to-speech (Listen & Learn). The output rate prices AUDIO tokens and
    // is an order of magnitude above the text rates, which is why an episode's
    // cost is dominated by its length rather than its prompt. Read from the
    // published paid-tier pricing on 2026-08-24; the flash TTS model is half
    // the price of the other two, which is why it is the default in
    // listen-and-learn/speech/gemini.js.
    'gemini-2.5-flash-preview-tts': [0.5, 10.0],
    'gemini-2.5-pro-preview-tts': [1.0, 20.0],
    'gemini-3.1-flash-tts-preview': [1.0, 20.0],
    default: [0.3, 2.5],
  },
  vertex: {
    'gemini-3.6-flash': [1.5, 7.5],
    'gemini-3.5-flash': [1.5, 9.0],
    'gemini-3.5-flash-lite': [0.3, 2.5],
    'gemini-2.5-pro': [3.5, 10.5],
    'gemini-2.5-flash': [0.3, 2.5],
    'gemini-2.5-flash-lite': [0.1, 0.4],
    default: [0.3, 2.5],
  },
  perplexity: {
    'sonar-pro': [3.0, 15.0],
    sonar: [1.0, 1.0],
    default: [3.0, 15.0],
  },
  azure: {
    'gpt-4o': [5.0, 15.0],
    'gpt-4o-mini': [0.15, 0.6],
    default: [5.0, 15.0],
  },
  bedrock: {
    'amazon.nova-micro-v1:0': [0.035, 0.14],
    'amazon.nova-lite-v1:0': [0.06, 0.24],
    'amazon.nova-pro-v1:0': [0.8, 3.2],
    default: [0.06, 0.24],
  },
  // ElevenLabs speech (Listen & Learn), priced PER CHARACTER: the "output"
  // unit of a row is the billed character count, promptTokens is always 0,
  // and USD 0.10 per 1,000 characters is USD 100 per 1M. Read from the API
  // pricing page for the Starter and Creator plans on 2026-09-08. Expressed
  // in the table's per-1M shape so getCostEstimate and the admin usage page
  // price these rows without learning a new unit — see the header of
  // listen-and-learn/speech/elevenlabs.js.
  elevenlabs: {
    eleven_v3: [0, 100.0],
    default: [0, 100.0],
  },
  // NVIDIA API Catalog trial tier (#701): free, so every row is zero — the
  // Usage tab then shows these calls, and what they did not cost, instead of
  // pricing them at a guessed rate. `default` covers a model the portal or an
  // env override pins. If the owner ever moves to a paid NVIDIA plan, these
  // rows are what change.
  nvidia: {
    'z-ai/glm-5.3': [0, 0],
    'z-ai/glm-5.3-flash': [0, 0],
    'deepseek-ai/deepseek-v4.1-flash': [0, 0],
    default: [0, 0],
  },
  // Microsoft Foundry (#849): Global Standard, USD per 1M tokens, read from
  // the Azure OpenAI pricing page on 2026-10-04. `default` is the mini rate
  // so a deployment added on the card prices high rather than free.
  foundry: {
    'gpt-5-nano': [0.05, 0.4],
    'gpt-5-mini': [0.25, 2.0],
    'gpt-4.1-nano': [0.1, 0.4],
    default: [0.25, 2.0],
  },
  replicate: {
    'meta/llama-3.1-405b-instruct': [0.65, 2.75],
    'meta/llama-3.1-70b-instruct': [0.35, 1.4],
    'meta/llama-3.1-8b-instruct': [0.05, 0.25],
    'mistralai/mistral-7b-instruct-v0.2': [0.05, 0.25],
    default: [0.35, 1.4],
  },
});

/**
 * Does the cost table price this model? False for a row deliberately set to
 * null (a model whose rate is not known), so a caller can mark the usage
 * row `unpriced` instead of letting a zero read as free.
 */
export function isPriced(provider, model) {
  const rates = COST_TABLE[provider] || {};
  return !(Object.hasOwn(rates, model) && rates[model] === null);
}

export function getCostEstimate(provider, model, promptTokens = 0, completionTokens = 0) {
  const rates = COST_TABLE[provider] || {};
  if (!isPriced(provider, model)) return 0;
  const [inRate, outRate] = rates[model] || rates.default || [0, 0];
  return parseFloat(
    ((promptTokens / 1_000_000) * inRate + (completionTokens / 1_000_000) * outRate).toFixed(8)
  );
}

export class AiNotConfiguredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiNotConfiguredError';
    this.code = 'AI_NOT_CONFIGURED';
  }
}

/**
 * An administrator switched this feature off in the portal. Distinct from
 * AiNotConfiguredError because it is a decision, not a fault: callers that
 * degrade gracefully (skip alt text, publish an ungraded draft) should catch
 * this and carry on, and nothing should page anyone about it.
 */
export class AiFeatureDisabledError extends Error {
  constructor(feature) {
    super(`The '${feature}' AI feature is turned off in the admin portal.`);
    this.name = 'AiFeatureDisabledError';
    this.code = 'AI_FEATURE_DISABLED';
    this.feature = feature;
  }
}

/** An env value that is a real key: non-empty and not an unresolved Key Vault reference. */
export function readKey(env, name) {
  const raw = env?.[name];
  if (typeof raw !== 'string') return '';
  const value = raw.replace(/^\uFEFF/, '').trim();
  if (!value || value.startsWith('@Microsoft.KeyVault(')) return '';
  return value;
}

export function sanitizeJsonText(text = '') {
  return String(text)
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
}

export function parseJsonWithFallbacks(rawText = '') {
  const cleaned = sanitizeJsonText(rawText);
  try {
    return JSON.parse(cleaned || '{}');
  } catch {
    // fall through to object extraction
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    // Control characters a model leaked into a string value break JSON.parse.
    return JSON.parse(cleaned.slice(start, end + 1).replace(/[\u0000-\u0019]/g, ' '));
  }
  throw new Error('Model response did not contain parseable JSON');
}

export function isRetryableError(error) {
  const status = error?.status;
  if ([408, 429, 500, 502, 503, 504].includes(status)) return true;
  return /429|503|timeout|temporarily unavailable|rate/i.test(String(error?.message || ''));
}

const JSON_ONLY =
  'Return only valid JSON. Do not include markdown code fences, prose, or extra commentary.';

function recordUsage(usageOut, provider, model, promptTokens, completionTokens) {
  if (!Array.isArray(usageOut)) return;
  const inTokens = Number(promptTokens) || 0;
  const outTokens = Number(completionTokens) || 0;
  usageOut.push({
    provider,
    model,
    promptTokens: inTokens,
    completionTokens: outTokens,
    costUsd: getCostEstimate(provider, model, inTokens, outTokens),
    ...(isPriced(provider, model) ? {} : { unpriced: true }),
  });
}

/**
 * A part a converter cannot carry is refused, never dropped.
 *
 * Until #433 each converter returned null for a shape it did not recognise and
 * filtered it out, so a `fileData` part reached the model as nothing and the
 * model answered — confidently — without it. Nothing errored and nothing
 * logged. The refusal is a 400 on purpose: `isRetryableError` will not retry
 * it and `isProviderUnusable` will not fail over from it, because the next
 * provider would refuse the same part (or, worse, be the one that drops it).
 * The wording avoids every token those two predicates match on.
 */
function refusePart(provider, part, expected) {
  const shape =
    part && typeof part === 'object' ? `{${Object.keys(part).join(', ')}}` : String(typeof part);
  const err = new Error(
    `Cannot send a prompt part to ${provider}: expected ${expected}, got ${shape}. Nothing was sent.`
  );
  err.status = 400;
  err.code = 'AI_PART_REFUSED';
  return err;
}

/** Multimodal parts → OpenAI content blocks. */
function toOpenAiContent(parts, prompt) {
  if (!Array.isArray(parts) || parts.length === 0) return [{ type: 'text', text: prompt }];
  return parts.map((part) => {
    if (typeof part?.text === 'string') return { type: 'text', text: part.text };
    const mime = String(part?.inlineData?.mimeType || '').toLowerCase();
    if (mime.startsWith('image/') && part?.inlineData?.data) {
      return {
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${part.inlineData.data}` },
      };
    }
    throw refusePart(
      'openai',
      part,
      mime
        ? `{text} or image/* inline data, not ${mime}`
        : '{text} or {inlineData:{mimeType:image/*,data}}'
    );
  });
}

/**
 * Parts → one plain string, for a text-only provider. Only text parts are
 * possible here — `chainForParts` keeps anything else away — so any other
 * shape is refused rather than dropped, as everywhere else.
 */
function toPlainText(parts, prompt) {
  if (!Array.isArray(parts) || parts.length === 0) return prompt;
  return parts
    .map((part) => {
      if (typeof part?.text === 'string') return part.text;
      throw refusePart('nvidia', part, '{text}');
    })
    .join('\n\n');
}

/** Multimodal parts → Anthropic content blocks. */
function toAnthropicContent(parts, prompt) {
  if (!Array.isArray(parts) || parts.length === 0) return [{ type: 'text', text: prompt }];
  return parts.map((part) => {
    if (typeof part?.text === 'string') return { type: 'text', text: part.text };
    const mime = String(part?.inlineData?.mimeType || '').toLowerCase();
    if (mime.startsWith('image/') && part?.inlineData?.data) {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: part.inlineData.mimeType,
          data: part.inlineData.data,
        },
      };
    }
    throw refusePart(
      'anthropic',
      part,
      mime
        ? `{text} or image/* inline data, not ${mime}`
        : '{text} or {inlineData:{mimeType:image/*,data}}'
    );
  });
}

/** Multimodal parts → Gemini parts (already the native shape). */
function toGeminiParts(parts, prompt) {
  if (!Array.isArray(parts) || parts.length === 0) return [{ text: prompt }];
  return parts.map((part) => {
    if (typeof part?.text === 'string') return { text: part.text };
    if (part?.inlineData?.mimeType && part?.inlineData?.data) {
      return {
        inlineData: {
          mimeType: part.inlineData.mimeType,
          data: part.inlineData.data,
        },
      };
    }
    // A URL the model should fetch is not a part on this endpoint at all — it
    // is a grounded call; see generateGroundedJsonResponse.
    throw refusePart('gemini', part, '{text} or {inlineData:{mimeType,data}}');
  });
}

// ---------------------------------------------------------------------------
// NVIDIA API Catalog (#701).

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

/**
 * The Entra audience the Foundry v1 endpoint accepts. Microsoft's pages name
 * two: the keyless-authentication guide for Foundry resources on the
 * /openai/v1 path says tokens must carry `https://ai.azure.com/.default`,
 * while older Azure OpenAI pages say `https://cognitiveservices.azure.com`.
 * This is the documented one for the resource kind foundry.tf creates;
 * FOUNDRY_TOKEN_SCOPE in the environment overrides it, so a 401 on the other
 * audience is an app setting away rather than a deploy.
 */
export const FOUNDRY_TOKEN_SCOPE = 'https://ai.azure.com/.default';

/** The audience to request: the environment's override, else FOUNDRY_TOKEN_SCOPE. */
export const foundryTokenScope = (env) => readKey(env, 'FOUNDRY_TOKEN_SCOPE') || FOUNDRY_TOKEN_SCOPE;

/** The account's base URL for the OpenAI v1 surface, from FOUNDRY_ENDPOINT without a trailing slash. */
export function foundryBaseUrl(env) {
  return readKey(env, KEY_ENV.foundry).replace(/\/+$/, '');
}

/**
 * An Entra token for Foundry, fetched through @azure/identity and reused
 * until five minutes before it expires (#849). `getToken(scope)` is the
 * credential's own shape, `{ token, expiresOnTimestamp }`, so a test hands
 * in a stub and production hands in DefaultAzureCredential: the Function
 * App's system-assigned identity there, `az login` on a workstation.
 */
export function createFoundryTokenProvider({
  getToken,
  now = () => Date.now(),
  scope = FOUNDRY_TOKEN_SCOPE,
}) {
  const EARLY_MS = 5 * 60_000;
  let cached = null;
  return async () => {
    if (cached && cached.expiresOnTimestamp - now() > EARLY_MS) return cached.token;
    cached = await getToken(scope);
    return cached.token;
  };
}

/**
 * Production's token source: @azure/identity, imported only when Foundry is
 * first called. The specifier is a variable with `@vite-ignore` because the
 * frontend's contract tests import this module through Vite, which would
 * otherwise try to resolve a package only the Function App installs.
 */
export async function defaultGetToken(scope) {
  const identity = '@azure/identity';
  const { DefaultAzureCredential } = await import(/* @vite-ignore */ identity);
  return new DefaultAzureCredential().getToken(scope);
}

/**
 * Requests per rolling minute this instance will send to NVIDIA.
 *
 * The account limit is about 40 RPM (issue #701, checked 2026-09-25). 36 leaves
 * headroom for the admin portal's Test button and for clock skew between our
 * window and theirs. `NVIDIA_REQUESTS_PER_MINUTE` overrides it — lower, or
 * higher once NVIDIA raises the account's limit.
 *
 * The guard is per Function App INSTANCE. Two instances can together exceed
 * the account limit; when they do, NVIDIA answers 429, the router retries and
 * then fails over, which is the same degradation by a longer road.
 */
export const NVIDIA_DEFAULT_RPM = 36;

/** Reasoning models think before they answer; 60 s was sized for chat. */
const NVIDIA_TIMEOUT_MS = 120_000;

/**
 * A draft is long. Without it some NIM endpoints apply a small default and
 * truncate mid-article; a model whose cap is lower answers 400, which fails
 * over (see the header).
 */
const NVIDIA_MAX_TOKENS = 8192;

/**
 * A sliding-window pacing guard: at most `limit` grants in any `windowMs`.
 *
 * Sliding rather than a refilling bucket so the bound is exact — a full bucket
 * plus a minute of refill can pass nearly twice the limit inside one rolling
 * minute, which is precisely what an RPM limit counts. `take()` never waits: a
 * refusal is immediate, so the caller fails over instead of holding a request
 * open for up to a minute.
 */
export function createRequestPacer({ limit, windowMs = 60_000, now = () => Date.now() }) {
  const grants = [];
  const prune = (t) => {
    while (grants.length && t - grants[0] >= windowMs) grants.shift();
  };
  return {
    take() {
      const t = now();
      prune(t);
      if (grants.length >= limit) return false;
      grants.push(t);
      return true;
    },
    /** Grants inside the current window; for tests and diagnostics. */
    used() {
      prune(now());
      return grants.length;
    },
  };
}

function nvidiaRpm(env) {
  const n = Number.parseInt(String(env?.NVIDIA_REQUESTS_PER_MINUTE ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : NVIDIA_DEFAULT_RPM;
}

function pacedError(limit) {
  const err = new Error(
    `nvidia pacing guard: ${limit} requests in the last minute already sent from this instance; not sent.`
  );
  // 429 so it reads as what it is everywhere else; AI_PACED so withRetry does
  // not sleep and try again against a window that is still full.
  err.status = 429;
  err.code = 'AI_PACED';
  return err;
}

/** Providers that take text only, and are left out of a call carrying other parts. */
const TEXT_ONLY_PROVIDERS = Object.freeze(['nvidia']);

function hasNonTextParts(parts) {
  return Array.isArray(parts) && parts.some((part) => typeof part?.text !== 'string');
}

/** Some reasoning models inline their thinking; the answer is what follows it. */
function stripThinking(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
}

/**
 * One chat attempt's timeout for a provider whose table row sets none: every
 * provider but NVIDIA. A budgeted call cuts it shorter, never longer.
 */
const CHAT_TIMEOUT_MS = 60_000;

async function postJson(fetchImpl, url, { headers, body, timeoutMs = CHAT_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const detail = data?.error?.message || data?.message || text.slice(0, 300);
      const err = new Error(`${response.status} ${detail}`);
      err.status = response.status;
      throw err;
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const err = new Error(`timeout after ${timeoutMs} ms`);
      err.status = 408;
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Does this error mean the PROVIDER is unusable, or that the REQUEST is bad?
 *
 * The distinction decides whether trying the next provider is worth anything.
 * A rejected key, a missing model or a dead endpoint is specific to one
 * provider and the next one will very likely work. A malformed request will
 * be malformed for all three, and walking the whole chain to prove it just
 * spends money and time on the same failure.
 */
function isProviderUnusable(error, provider = null) {
  const status = Number(error?.status);
  // NVIDIA only: its models differ in context length and accepted
  // parameters, so its 400 is not evidence the request is bad everywhere
  // (header). A part we refused ourselves is, and stays put.
  if (provider === 'nvidia' && [400, 422].includes(status) && error?.code !== 'AI_PART_REFUSED') {
    return true;
  }
  // 401/403 rejected key, 404 unknown model or endpoint.
  if ([401, 403, 404].includes(status)) return true;
  // Anything retryable that survived its retries: the provider is not coming
  // back within this call.
  if (isRetryableError(error)) return true;
  return /model|not found|unsupported|deprecated|quota|billing|credit/i.test(
    String(error?.message || '')
  );
}

/**
 * How a budgeted call ends when too little time is left to try the next
 * provider.
 *
 * It names each provider that was tried with its reason, and each that was
 * never reached. "Timed out" on its own would hide which provider spent the
 * time, and that is the one thing the owner needs in order to act. Status
 * 504 and code AI_BUDGET_EXHAUSTED let a handler map it to an HTTP status.
 * Nothing retries it: it is thrown outside withRetry, and after failover.
 */
function budgetExhausted(budget, attempts, untried) {
  const seconds = Math.round(budget.totalMs / 1000);
  const notTried = untried.map((entry) => entry.provider).join(', ');
  const tried = attempts
    .map(({ provider, error }) => `${provider} (${error?.message || error})`)
    .join('; ');
  const err = new Error(
    tried
      ? `This AI call's ${seconds} s budget ran out after ${tried}. Not tried: ${notTried}.`
      : `This AI call's ${seconds} s budget left too little time to try any provider (${notTried}).`
  );
  err.status = 504;
  err.code = 'AI_BUDGET_EXHAUSTED';
  if (attempts.length) err.cause = attempts.at(-1).error;
  return err;
}

/**
 * When this provider's share of the budget ends, or the AI_BUDGET_EXHAUSTED
 * error when too little is left to start it at all.
 */
function shareEndFor(now, budget, { chain, index, attempts }) {
  const startedAt = now();
  const shareMs = providerShareMs({
    remainingMs: budget.deadline - startedAt,
    reserveMs: budget.reserveMs,
    hasNext: index < chain.length - 1,
  });
  if (shareMs === 0) throw budgetExhausted(budget, attempts, chain.slice(index));
  return startedAt + shareMs;
}

/**
 * Retry a retryable failure with backoff. `sleep` and `now` are the router's
 * clock, passed in so a test can run the backoff without waiting it out.
 *
 * Two exceptions, both about not waiting for nothing: a pacing refusal
 * (AI_PACED) is never retried — the window is still full two seconds later
 * — and NVIDIA's timeout is not either, because two more 120 s attempts
 * would hold an owner's job for six minutes before failing over.
 *
 * Inside a budget, `shareEnd` is when this provider's share runs out. A
 * retry is made only if the share still holds MIN_ATTEMPT_MS after the
 * backoff. The check is repeated once the wait is over, in case the wait
 * ran long. Otherwise the error goes straight to the failover, which is
 * worth more than a retry that cannot finish.
 */
async function withRetry(
  { sleep, now },
  operation,
  { maxAttempts = 3, provider = null, shareEnd = null } = {}
) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error?.code === 'AI_PACED') break;
      if (provider === 'nvidia' && Number(error?.status) === 408) break;
      if (attempt >= maxAttempts || !isRetryableError(error)) break;
      const backoffMs = 2 ** attempt * 1000;
      if (shareEnd !== null && shareEnd - now() - backoffMs < MIN_ATTEMPT_MS) break;
      await sleep(backoffMs);
      if (shareEnd !== null && shareEnd - now() < MIN_ATTEMPT_MS) break;
    }
  }
  throw lastError;
}

/**
 * @param {object} [deps]
 * @param {Record<string,string|undefined>} [deps.env]
 * @param {typeof fetch} [deps.fetch]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {{ warn?: Function }} [deps.log]
 */
export function createAiRouter({
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console,
  store = null,
  configTtlMs = 60_000,
  onKeyVerdict = null,
  now = () => Date.now(),
  getToken = defaultGetToken,
} = {}) {
  const ctx = createRouterContext({
    env,
    fetchImpl,
    sleep,
    log,
    store,
    configTtlMs,
    onKeyVerdict,
    now,
    getToken,
  });
  return {
    availableProviders: () => keyedProviders(ctx),
    getActiveAiProvider: () => activeProvider(ctx),
    resolveProvider: (feature) => firstProvider(ctx, feature),
    resolveProviderChain: (feature) => providerChain(ctx, feature),
    defaultModelFor: (provider, purpose) => modelFor(ctx, provider, purpose),
    generateTextResponse: (params) => generateText(ctx, params),
    generateJsonResponse: (params) => generateJson(ctx, params),
    generateGroundedJsonResponse: (params) => generateGroundedJson(ctx, params),
    callProvider: (params) => callNamedProvider(ctx, params),
    getCostEstimate,
    invalidateConfig: ctx.config.invalidate,
  };
}

/**
 * The router's context: every dependency the functions below share, built
 * once per router (#843, 2026-10-04).
 *
 * Until then those functions were closures inside `createAiRouter`, one
 * 780-line factory with 24 return statements and a complexity of 137 that
 * qlty flagged on every PR touching this file. The move is mechanical: each
 * function takes `ctx` as its first argument where it used to capture a
 * variable, and the factory is reduced to building `ctx` and binding the
 * public surface to it. Key handling (`readKey`, `KEY_ENV`), the
 * `CONTENTFORGE_AI_PROVIDER` pin, per-feature placement and routing,
 * failover order, retry and time budgets are unchanged; router.test.js,
 * sync-budgets.test.js, nvidia-provider.test.js and
 * probe-ai-providers.test.js hold that.
 *
 * The internal names differ from the public ones on purpose. The foot of
 * this file declares `export const { defaultModelFor, … } = defaultRouter`,
 * and a module-level `function defaultModelFor` beside that binding would be
 * a duplicate declaration. So `modelFor(ctx, …)` is bound as
 * `defaultModelFor`, `generateText(ctx, …)` as `generateTextResponse`, and
 * so on; the factory above is the table.
 */
function createRouterContext({
  env,
  fetchImpl,
  sleep,
  log,
  store,
  configTtlMs,
  onKeyVerdict,
  now,
  getToken,
}) {
  // With no store the loader reports "no configuration", and every path below
  // falls back to exactly the environment-only behaviour this router had before
  // the portal's settings were wired up. That is what keeps unit tests — and
  // any caller that does not hand over a Cosmos client — working unchanged.
  const config = createAiConfigLoader({ store, ttlMs: configTtlMs, log });

  // One guard per router, so the process-wide router paces every call site in
  // this instance together. See NVIDIA_DEFAULT_RPM for the multi-instance note.
  const nvidiaLimit = nvidiaRpm(env);
  const nvidiaPacer = createRequestPacer({ limit: nvidiaLimit, now });

  /**
   * Tell the API-keys page whether a provider accepted its credential.
   *
   * `lib/key-verdict.js` is the single writer of the red light for a key that
   * resolved but is not working; this is one of the reporters that feed it,
   * beside the Publer timer client (`timers/publer-sync.js`) and the Publer
   * REST proxy (`integrations/rest-proxy.js`). `secrets-health.js` cannot see
   * that state by design — "only the upstream service can say it is wrong" —
   * and each reporter is an upstream service saying so.
   *
   * The two rules that keep it off the hot path (failures always, successes
   * once per reporter per setting until a failure) and the invariant that a
   * status page which cannot record a verdict never fails the AI call it was
   * observing live in key-verdict.js, not here. Reported under the SETTING
   * name: the recorder maps a setting to its vault secret through the
   * catalogue, and a provider name would map to nothing.
   */
  const reportVerdict = createKeyVerdictReporter({
    onKeyVerdict,
    log,
    source: 'ai-router',
  });

  const ctx = {
    env,
    fetchImpl,
    log,
    store,
    now,
    // The router's clock, handed to withRetry so a test can drive the backoff.
    clock: { sleep, now },
    config,
    nvidiaLimit,
    nvidiaPacer,
    reportKeyVerdict: (provider, verdict) =>
      KEYLESS_PROVIDERS.includes(provider)
        ? Promise.resolve()
        : reportVerdict(KEY_ENV[provider], verdict),
    foundryToken: createFoundryTokenProvider({ getToken, now, scope: foundryTokenScope(env) }),
  };
  ctx.openAiCompatible = openAiCompatibleTable(ctx);
  return ctx;
}

const keyedProviders = (ctx) => PROVIDERS.filter((p) => readKey(ctx.env, KEY_ENV[p]));

const pinnedProvider = (ctx) =>
  String(ctx.env.CONTENTFORGE_AI_PROVIDER || '')
    .toLowerCase()
    .trim();

/**
 * The provider chosen from KEYS ALONE, ignoring anything stored in the portal.
 *
 * Kept synchronous and kept env-only on purpose: callers use it to label and
 * to log, and an await there would ripple through four modules for no gain.
 * It is NOT the provider a call will use once an administrator has reordered
 * or disabled something — for that, read `usageOut` after the call, which
 * records what actually ran. `firstProvider` is the real selection.
 */
function activeProvider(ctx) {
  const available = keyedProviders(ctx);
  const pinned = pinnedProvider(ctx);
  if (pinned) {
    if (available.includes(pinned)) return pinned;
    ctx.log.warn?.(
      `[ai-router] CONTENTFORGE_AI_PROVIDER=${pinned} but its key is not present; falling back to ${available[0] || 'none'}`
    );
  }
  return available[0] || null;
}

/**
 * The ordered list of providers a call may use, best first.
 *
 * Returns every eligible provider rather than only the winner, because
 * "order of preference" has to mean preference — see `callWithFailover`.
 *
 * @param {string|null} feature A key of AI_FEATURES, or null to skip the gate.
 * @returns {Promise<Array<{provider: string, model: string|null}>>}
 */
async function providerChain(ctx, feature = null) {
  const { chain, disabled, excluded } = await chainDetails(ctx, feature);

  if (chain.length === 0) {
    if (excluded.length > 0 && disabled.length === 0) {
      throw new AiNotConfiguredError(
        `The only configured AI provider (${excluded.join(', ')}) is not used for ${feature ? `'${feature}'` : 'calls that name no feature'}. Seed GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY (Required-Inputs §4.6), or change its placement under AI Engine → Where AI is used where that is allowed.`
      );
    }
    throw new AiNotConfiguredError(
      disabled.length > 0
        ? `Every configured AI provider is disabled in the admin portal (${disabled.join(', ')}). Re-enable one under AI Engine → AI Services.`
        : 'No AI provider is configured. Seed GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY in Key Vault (Required-Inputs §4.6) and the matching provider turns on.'
    );
  }

  return chain;
}

/**
 * The chain and how it was arrived at — the selection behind
 * `providerChain`, kept separate so the grounded path can apply the SAME
 * selection and then say precisely why Gemini is not in it. The empty chain
 * is left to the callers, who have different sentences for it.
 *
 * @returns {Promise<{chain: Array<{provider: string, model: string|null}>,
 *                    disabled: string[], excluded: string[], pinned: string}>}
 */
async function chainDetails(ctx, feature = null) {
  const { providers: docs, features, routing } = await ctx.config.load();

  if (feature && !isFeatureEnabled(features, feature)) {
    throw new AiFeatureDisabledError(feature);
  }

  const available = keyedProviders(ctx);
  const resolved = resolveProviderOrder(docs, available);
  const { disabled } = resolved;
  // Per-feature placement after the global order: it can move a provider
  // or remove it, never add one (ai-config.js, rule 1). A pin below is
  // checked against THIS order, so pinning nvidia cannot route a public
  // feature to it.
  const { order, excluded } = applyFeaturePlacement(resolved.order, features, feature);

  // Per-task routing (ADR 0033 §4) after placement: a route reorders the
  // providers this feature may use and names a model per step; it cannot
  // add a provider that has no key, is switched off, or is placed off.
  const route = routeFor(routing, feature);
  const routed = applyFeatureRoute(order, route);
  if (route && routed.skipped.length) {
    ctx.log.warn?.(
      `[ai-router] '${feature}' routes to ${routed.skipped.join(', ')} but ${
        routed.skipped.length === 1 ? 'it is' : 'they are'
      } not available (no key, disabled, or placed off); serving from ${
        routed.chain[0]?.provider || 'none'
      }`
    );
  }

  const pinned = pinnedProvider(ctx);
  let chain = routed.chain;
  if (pinned) {
    if (order.includes(pinned)) {
      // An explicit pin is an instruction, not a preference: it selects one
      // provider and does NOT fall through to the others — a route is a
      // preference, so the pin wins over it too.
      chain = routed.chain.filter((entry) => entry.provider === pinned);
    } else {
      let why = 'its key is not present';
      if (disabled.includes(pinned)) why = 'it is disabled in the admin portal';
      else if (excluded.includes(pinned)) why = `it is not used for '${feature || 'no feature'}'`;
      ctx.log.warn?.(
        `[ai-router] CONTENTFORGE_AI_PROVIDER=${pinned} but ${why}; falling back to ${order[0] || 'none'}`
      );
    }
  }

  return {
    // The model named on the route wins over the provider card's pin; a
    // step with no routed model keeps the card's choice (then the purpose
    // table, in callWith).
    chain: chain.map(({ provider, model }) => ({
      provider,
      model: model || configuredModelFor(docs, provider),
    })),
    disabled,
    excluded,
    pinned,
    routed: Boolean(route),
  };
}

/**
 * Every call that reaches a model is recorded in `ai_usage` HERE, once
 * (ADR 0033: "every call site records usage"). Until this, five of fourteen
 * call sites wrote a row and the rest spent invisibly. The row's `source`
 * is the feature (`ai:<feature>`), and its id travels back on the caller's
 * `usageOut` entry as `recordedRowId`, so a caller that re-records the same
 * entry with a more specific source (Listen & Learn, the podcast) UPSERTS
 * the same row instead of adding a second one. With no store (unit tests)
 * nothing is written and the entries still reach the caller.
 */
async function recordCallUsage(ctx, entries, feature) {
  const { store } = ctx;
  if (!store?.upsertDoc) return entries;
  const recorded = [];
  for (const entry of entries) {
    const row = await recordAiUsage(
      { store, ai: { getCostEstimate, isPriced } },
      { ...entry, source: featureSource(feature) }
    );
    recorded.push(row ? { ...entry, recordedRowId: row.id } : entry);
  }
  return recorded;
}

/**
 * Try each provider in order until one answers.
 *
 * WHY THIS EXISTS. The portal calls its list an "order of preference" and the
 * page says the next provider down is used if the first cannot serve. Until
 * this, that was only true of key presence and the enabled switch — an actual
 * FAILURE from the first provider failed the whole call. That gap became
 * dangerous the moment the default order changed to Gemini first (2026-08-23):
 * the Gemini model ids were ported from upstream's Vertex table, and if one of
 * them is not a valid public Generative Language API model, every AI feature
 * that worked through Anthropic the day before would return 404 and stop.
 *
 * A provider that fails is logged at warn with the reason, because silently
 * spending Anthropic money to paper over a broken Gemini configuration is its
 * own kind of failure. `usageOut` records the provider that actually served.
 *
 * With a `budget` (header: SYNCHRONOUS CALLS HAVE A TIME BUDGET), each
 * provider gets a share of what is left, and every attempt's `timeoutMs` is
 * cut to that share. When too little is left to try the next provider, the
 * call ends with AI_BUDGET_EXHAUSTED rather than sending an attempt that
 * cannot finish. Without one, nothing here differs from before budgets.
 */
async function callWithFailover(
  ctx,
  { chain, explicitModel, budget = null, feature = null, usageOut = null, ...args }
) {
  const attempts = [];
  // Collected here, recorded once the call has an answer, then handed to
  // the caller's array with the row ids attached (recordCallUsage).
  const collected = [];

  for (const [index, { provider, model: configuredModel }] of chain.entries()) {
    const shareEnd = budget ? shareEndFor(ctx.now, budget, { chain, index, attempts }) : null;
    // An explicit model from the call site wins; then the route's or the
    // administrator's choice in the portal; then the purpose table.
    const model = explicitModel || configuredModel;
    try {
      const result = await withRetry(
        ctx.clock,
        () =>
          callWith(ctx, provider, attemptArgs(ctx, provider, { args, collected, model, shareEnd })),
        { provider, shareEnd }
      );
      await ctx.reportKeyVerdict(provider, { ok: true });
      const recorded = await recordCallUsage(ctx, collected, feature);
      if (Array.isArray(usageOut)) usageOut.push(...recorded);
      return result;
    } catch (error) {
      attempts.push({ provider, error });
      await failOverOrThrow(ctx, provider, error, chain);
    }
  }

  // Unreachable: the loop either returns or throws on its last iteration.
  throw attempts.at(-1)?.error || new AiNotConfiguredError('No AI provider was tried');
}

/**
 * One attempt's arguments. Under a budget, the provider's own timeout is
 * cut to what is left of its share; withRetry starts no attempt once less
 * than MIN_ATTEMPT_MS is left.
 */
function attemptArgs(ctx, provider, { args, collected, model, shareEnd }) {
  const timeout =
    shareEnd === null
      ? {}
      : { timeoutMs: Math.min(providerTimeoutMs(ctx, provider), shareEnd - ctx.now()) };
  return { ...args, usageOut: collected, model, ...timeout };
}

/**
 * After a provider failed: report a bad credential, then either hand the
 * call to the next provider (a warning, so silently spending the next
 * provider's money is visible) or rethrow when there is none or the
 * failure is not the provider's.
 */
async function failOverOrThrow(ctx, provider, error, chain) {
  const status = Number(error?.status);
  // 401/403 ONLY. A 404 means the model id is wrong and a 429 means the
  // account is busy — neither says the credential is bad, and reporting
  // them would turn the light red for something no rotation can fix.
  if ([401, 403].includes(status)) await ctx.reportKeyVerdict(provider, { ok: false, status });
  const last = chain[chain.length - 1].provider === provider;
  if (last || !isProviderUnusable(error, provider)) throw error;
  ctx.log.warn?.(
    `[ai-router] ${provider} could not serve this call (${error?.message || error}); trying the next provider`
  );
}

/**
 * The single best provider, for callers that only need to name one.
 *
 * @param {string|null} feature A key of AI_FEATURES, or null to skip the gate.
 * @returns {Promise<{provider: string, model: string|null}>}
 */
async function firstProvider(ctx, feature = null) {
  return (await providerChain(ctx, feature))[0];
}

function modelFor(ctx, provider, purpose = 'general') {
  const entry = DEFAULT_MODEL_TABLE[provider];
  if (!entry) return DEFAULT_MODEL_TABLE.gemini.general[1];
  const [envVar, fallback] = entry[purpose] || entry.general;
  return ctx.env[envVar] || fallback;
}

const logUsage = (ctx, provider, usage, model, purpose) => {
  if (ctx.env.CONTENTFORGE_LOG_TOKEN_USAGE === 'true') {
    ctx.log.warn?.(`[ai-model] ${provider} token usage`, {
      ...usage,
      model,
      purpose,
    });
  }
};

async function callAnthropic(
  ctx,
  { prompt, parts, model, purpose, expectJson, systemPrompt, usageOut, timeoutMs }
) {
  const apiKey = readKey(ctx.env, KEY_ENV.anthropic);
  const selectedModel = model || modelFor(ctx, 'anthropic', purpose);
  // A static system prompt is marked for the prompt cache; the JSON-only
  // instruction trails it uncached so the cache boundary stays on the
  // expensive context.
  let system;
  if (systemPrompt) {
    system = [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ];
    if (expectJson) system.push({ type: 'text', text: JSON_ONLY });
  } else if (expectJson) {
    system = JSON_ONLY;
  }
  const data = await postJson(ctx.fetchImpl, 'https://api.anthropic.com/v1/messages', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: {
      model: selectedModel,
      max_tokens: 4096,
      temperature: 0.2,
      messages: [{ role: 'user', content: toAnthropicContent(parts, prompt) }],
      ...(system !== undefined ? { system } : {}),
    },
    // Undefined keeps postJson's CHAT_TIMEOUT_MS.
    timeoutMs,
  });
  const usage = data?.usage || {};
  recordUsage(usageOut, 'anthropic', selectedModel, usage.input_tokens, usage.output_tokens);
  logUsage(ctx, 'anthropic', usage, selectedModel, purpose);
  return (data?.content || [])
    .filter((b) => b?.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/**
 * The OpenAI chat-completions request path, shared by every provider that
 * speaks it. OpenAI and NVIDIA differ only in the rows of this table.
 *
 * NVIDIA's differences, each for a reason: plain-string user content and
 * the JSON rule as an instruction rather than `response_format`, because
 * neither array content nor `json_object` is accepted by every model on the
 * catalogue and an unaccepted field is a 400; an explicit `max_tokens`; a
 * longer timeout; `<think>` stripped from the answer; and a `temperature`,
 * which the GPT-5 rows leave out because those models refuse any value but
 * the default. Built per router because the pacing guard is the router's.
 *
 * Foundry's one difference is `auth`: a row without it sends the provider's
 * key as the bearer; Foundry sends an Entra token, or the api-key header a
 * developer set locally (header: MICROSOFT FOUNDRY). The URL is read when
 * the table is built, so a router built without FOUNDRY_ENDPOINT carries a
 * row it can never be routed to — availability is KEY_ENV's job.
 */
function openAiCompatibleTable(ctx) {
  return {
    openai: {
      url: 'https://api.openai.com/v1/chat/completions',
      jsonAsResponseFormat: true,
      content: toOpenAiContent,
    },
    foundry: {
      url: `${foundryBaseUrl(ctx.env)}/openai/v1/chat/completions`,
      jsonAsResponseFormat: true,
      content: toOpenAiContent,
      auth: async () => {
        const local = readKey(ctx.env, 'FOUNDRY_API_KEY');
        if (local) return { 'api-key': local };
        return { Authorization: `Bearer ${await ctx.foundryToken()}` };
      },
    },
    nvidia: {
      url: `${NVIDIA_BASE_URL}/chat/completions`,
      jsonAsResponseFormat: false,
      content: toPlainText,
      temperature: 0.2,
      maxTokens: NVIDIA_MAX_TOKENS,
      timeoutMs: NVIDIA_TIMEOUT_MS,
      clean: stripThinking,
      pace: () => {
        if (!ctx.nvidiaPacer.take()) throw pacedError(ctx.nvidiaLimit);
      },
    },
  };
}

async function callOpenAiCompatible(ctx, provider, args) {
  const { purpose, usageOut, timeoutMs } = args;
  const spec = ctx.openAiCompatible[provider];
  const selectedModel = args.model || modelFor(ctx, provider, purpose);
  const body = openAiCompatibleBody(spec, selectedModel, args);
  const headers = spec.auth
    ? await spec.auth()
    : { Authorization: `Bearer ${readKey(ctx.env, KEY_ENV[provider])}` };
  // Last, after every refusal that could still happen locally: a request
  // that is never sent must not spend a slot in the window.
  spec.pace?.();
  const data = await postJson(ctx.fetchImpl, spec.url, {
    headers,
    body,
    ...timeoutArg(timeoutMs ?? spec.timeoutMs),
  });
  const usage = data?.usage || {};
  recordUsage(usageOut, provider, selectedModel, usage.prompt_tokens, usage.completion_tokens);
  logUsage(ctx, provider, usage, selectedModel, purpose);
  const text = data?.choices?.[0]?.message?.content || '';
  return spec.clean ? spec.clean(text) : text;
}

/**
 * One chat-completions request body. The system turn carries the JSON rule
 * where the table row cannot send `response_format`; `max_tokens` goes only
 * where the row sends it at all (OpenAI's reasoning models refuse the
 * field), and a caller's cap (the portal's Test) wins over the row's.
 */
function openAiCompatibleBody(spec, model, { prompt, parts, expectJson, systemPrompt, maxTokens }) {
  const messages = [];
  const system =
    expectJson && !spec.jsonAsResponseFormat
      ? [systemPrompt, JSON_ONLY].filter(Boolean).join('\n\n')
      : systemPrompt;
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: spec.content(parts, prompt) });
  return {
    model,
    messages,
    // Only where the row sets one. The GPT-5 family on OpenAI and Foundry
    // accepts the default temperature alone and answers 400 to any other
    // value ("Only the default (1) value is supported", measured 2026-10-04
    // on the Foundry card's Test); NVIDIA's catalogue models take it.
    ...(spec.temperature === undefined ? {} : { temperature: spec.temperature }),
    ...(spec.maxTokens ? { max_tokens: maxTokens ?? spec.maxTokens } : {}),
    ...(expectJson && spec.jsonAsResponseFormat
      ? { response_format: { type: 'json_object' } }
      : {}),
  };
}

/** `{ timeoutMs }` when a limit is set; nothing otherwise, so postJson keeps CHAT_TIMEOUT_MS. */
const timeoutArg = (timeoutMs) => (timeoutMs ? { timeoutMs } : {});

/**
 * A provider's own attempt timeout: its table row's (NVIDIA's 120 s), else
 * CHAT_TIMEOUT_MS. A budgeted call cuts it to the provider's share.
 */
const providerTimeoutMs = (ctx, provider) =>
  ctx.openAiCompatible[provider]?.timeoutMs ?? CHAT_TIMEOUT_MS;

async function callGemini(
  ctx,
  { prompt, parts, model, purpose, expectJson, systemPrompt, usageOut, timeoutMs }
) {
  const apiKey = readKey(ctx.env, KEY_ENV.gemini);
  const selectedModel = model || modelFor(ctx, 'gemini', purpose);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`;
  const data = await postJson(ctx.fetchImpl, url, {
    headers: { 'x-goog-api-key': apiKey },
    body: {
      contents: [{ role: 'user', parts: toGeminiParts(parts, prompt) }],
      ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
      generationConfig: {
        temperature: 0.2,
        ...(expectJson ? { responseMimeType: 'application/json' } : {}),
      },
    },
    // Undefined keeps postJson's CHAT_TIMEOUT_MS.
    timeoutMs,
  });
  const usage = data?.usageMetadata || {};
  // Reasoning tokens bill at the output rate — count them as output.
  const outTokens =
    (Number(usage.candidatesTokenCount) || 0) + (Number(usage.thoughtsTokenCount) || 0);
  recordUsage(usageOut, 'gemini', selectedModel, usage.promptTokenCount, outTokens);
  logUsage(ctx, 'gemini', usage, selectedModel, purpose);
  return (data?.candidates?.[0]?.content?.parts || [])
    .filter((p) => typeof p?.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
}

const CALLERS = {
  anthropic: callAnthropic,
  openai: (ctx, args) => callOpenAiCompatible(ctx, 'openai', args),
  gemini: callGemini,
  nvidia: (ctx, args) => callOpenAiCompatible(ctx, 'nvidia', args),
  foundry: (ctx, args) => callOpenAiCompatible(ctx, 'foundry', args),
};

/**
 * The chain a call carrying these parts can use. A text-only provider is
 * left out of a call with an image in it — sending it would be a refusal,
 * and a refusal does not fail over. An empty result says so rather than
 * reporting "not configured".
 */
function chainForParts(chain, parts) {
  if (!hasNonTextParts(parts)) return chain;
  const usable = chain.filter(({ provider }) => !TEXT_ONLY_PROVIDERS.includes(provider));
  if (usable.length === 0) {
    throw new AiNotConfiguredError(
      `This call carries non-text parts and the only provider in its chain (${chain
        .map((c) => c.provider)
        .join(', ')}) takes text only.`
    );
  }
  return usable;
}

function callWith(ctx, provider, args) {
  const caller = CALLERS[provider];
  if (!caller) throw new AiNotConfiguredError(`Unknown AI provider: ${provider}`);
  return caller(ctx, args);
}

/**
 * A call's budget, started now: before the configuration read, which is
 * part of the call's time. No `budgetMs` is no budget (header).
 */
const budgetFor = (ctx, budgetMs) =>
  budgetMs === null || budgetMs === undefined ? null : startBudget(budgetMs, ctx.now());

/** Resolve the chain and call it: the shared body of both generate calls. */
async function generate(ctx, { feature, parts, model, budget, ...args }) {
  const chain = chainForParts(await providerChain(ctx, feature), parts);
  return callWithFailover(ctx, {
    chain,
    explicitModel: model,
    parts,
    budget,
    feature,
    ...args,
  });
}

/**
 * @param {object} [params]
 * @param {number} [params.budgetMs] Synchronous callers only: the time this
 *   call may take, from now, failover included (header: SYNCHRONOUS CALLS
 *   HAVE A TIME BUDGET). Omitted, the call runs as it always has.
 */
async function generateText(
  ctx,
  {
    prompt = '',
    parts = null,
    model = null,
    purpose = 'general',
    systemPrompt = '',
    usageOut = null,
    feature = null,
    budgetMs = null,
  } = {}
) {
  return generate(ctx, {
    feature,
    parts,
    model,
    budget: budgetFor(ctx, budgetMs),
    prompt,
    purpose,
    expectJson: false,
    systemPrompt,
    usageOut,
  });
}

/** As generateText, parsed as JSON, with one repair round trip. */
async function generateJson(
  ctx,
  {
    prompt = '',
    parts = null,
    model = null,
    purpose = 'general',
    systemPrompt = '',
    usageOut = null,
    feature = null,
    budgetMs = null,
  } = {}
) {
  const budget = budgetFor(ctx, budgetMs);
  const text = await generate(ctx, {
    feature,
    parts,
    model,
    budget,
    prompt,
    purpose,
    expectJson: true,
    systemPrompt,
    usageOut,
  });
  try {
    return parseJsonWithFallbacks(text);
  } catch (parseError) {
    // One repair round trip, then the original parse error wins. Inside a
    // budget the repair shares the same deadline. It is skipped when it
    // could not have a whole attempt, because the parse error says more
    // than "out of time" would.
    if (budget && budget.deadline - ctx.now() < MIN_ATTEMPT_MS) throw parseError;
    const repaired = await generate(ctx, {
      prompt: `The following should be JSON but is malformed. Repair it and return ONLY valid JSON with no markdown fences, no explanation, and no extra keys.\n\n${sanitizeJsonText(text).slice(0, 30000)}`,
      parts: null,
      model,
      purpose,
      expectJson: false,
      systemPrompt:
        'You repair malformed JSON. Return only strict RFC 8259 JSON. Do not add commentary.',
      usageOut,
      // The repair belongs to the call that is already permitted; re-checking
      // under the same cached settings keeps the two halves consistent.
      feature,
      budget,
    });
    try {
      return parseJsonWithFallbacks(repaired);
    } catch {
      throw parseError;
    }
  }
}

/**
 * Ground a JSON generation on owner-supplied pages and YouTube videos.
 *
 * Gemini only, through the Interactions endpoint — the header says why. The
 * chain is resolved exactly as for every other call, and then Gemini has to
 * be in it; anything else is `AiNotConfiguredError` with the reason, before
 * a byte is sent. There is no failover and no JSON repair round trip: both
 * would go through the generic chain, which is precisely what this entry
 * point exists to avoid, and JSON mode on this endpoint returns JSON or
 * reports a status other than `completed`.
 *
 * @param {object} params
 * @param {string} params.prompt
 * @param {Array<{kind: 'page'|'video', url: string}>} params.sources
 * @param {string} [params.systemPrompt]
 * @param {string} [params.purpose]       Model table purpose; `analysis` by default.
 * @param {string|null} [params.model]    Explicit model; wins over the portal pin.
 * @param {Array|null} [params.usageOut]  Receives one usage row, provider `gemini`.
 * @param {string|null} [params.feature]  A key of AI_FEATURES.
 */
async function generateGroundedJson(
  ctx,
  {
    prompt = '',
    sources = [],
    systemPrompt = '',
    purpose = 'analysis',
    model = null,
    usageOut = null,
    feature = null,
  } = {}
) {
  // Validation first: a bad list must not cost a configuration read, and a
  // good list must not be sent when the provider cannot take it.
  const { pages, videos } = validateGroundingSources(sources);

  const { chain, disabled, pinned } = await chainDetails(ctx, feature);
  const gemini = chain.find((entry) => entry.provider === 'gemini');
  if (!gemini) {
    throw new AiNotConfiguredError(
      groundingUnavailable({ available: keyedProviders(ctx), disabled, pinned })
    );
  }

  const selectedModel = model || gemini.model || modelFor(ctx, 'gemini', purpose);
  const body = buildGroundedRequest({
    model: selectedModel,
    prompt,
    pages,
    videos,
    systemPrompt,
  });

  const data = await groundedInteraction(ctx, body);

  // Usage before the status check, so a failed-but-billed interaction is
  // still on the spend page.
  const usage = data?.usage || {};
  const recorded = await recordCallUsage(ctx, groundedUsageRow(selectedModel, usage), feature);
  if (Array.isArray(usageOut)) usageOut.push(...recorded);
  logUsage(ctx, 'gemini', usage, selectedModel, purpose);

  assertGroundedComplete(data);
  return parseJsonWithFallbacks(groundedOutputText(data));
}

/**
 * The usage row of a grounded call. Tool-use tokens are the fetched pages —
 * prompt side; thought tokens bill as output, as on the chat endpoint.
 */
function groundedUsageRow(model, usage) {
  const collected = [];
  recordUsage(
    collected,
    'gemini',
    model,
    (Number(usage.total_input_tokens) || 0) + (Number(usage.total_tool_use_tokens) || 0),
    (Number(usage.total_output_tokens) || 0) + (Number(usage.total_thought_tokens) || 0)
  );
  return collected;
}

/**
 * A grounded generation is used only when the interaction completed and
 * every source was read; otherwise it would be grounded on less than it
 * claims, and the error says which.
 */
function assertGroundedComplete(data) {
  const status = data?.status;
  if (status !== 'completed') {
    const detail = (Array.isArray(data?.errors) ? data.errors : [])
      .map((e) => e?.message)
      .filter(Boolean)
      .join('; ');
    throw new Error(
      `Gemini reported status '${status || 'none'}' for the grounded call, not 'completed'${detail ? `: ${detail}` : ''}.`
    );
  }
  const unread = failedRetrievals(data);
  if (unread.length) {
    throw new Error(
      `Gemini could not read ${unread.length === 1 ? 'a source' : `${unread.length} sources`} — ${unread.join(', ')}. The generation was not used, because it would be grounded on less than it claims.`
    );
  }
}

/**
 * The grounded call itself, with the key verdict it reports. Same rule as
 * callWithFailover: 401/403 only, and then the call fails here — there is
 * nothing to hand on to.
 */
async function groundedInteraction(ctx, body) {
  let data;
  try {
    data = await withRetry(ctx.clock, () =>
      postJson(ctx.fetchImpl, INTERACTIONS_URL, {
        headers: { 'x-goog-api-key': readKey(ctx.env, KEY_ENV.gemini) },
        body,
        timeoutMs: GROUNDED_TIMEOUT_MS,
      })
    );
  } catch (error) {
    const status = Number(error?.status);
    if ([401, 403].includes(status)) await ctx.reportKeyVerdict('gemini', { ok: false, status });
    throw error;
  }
  await ctx.reportKeyVerdict('gemini', { ok: true });
  return data;
}

/**
 * One call to one named provider, with no failover (the portal's Test and
 * Playground, and the weekly probe that runs the Test): the aiProxy /
 * testAiProvider shape, an explicit provider, text back with token counts.
 * `maxTokens` is an optional per-call cap for providers whose table row
 * sends one (NVIDIA). `timeoutMs` is an optional per-call limit that every
 * provider honours; a budgeted call passes the same argument. The Test
 * passes small values of both, so a reasoning model proves it answers in
 * seconds instead of thinking past the edge's request limit (#701,
 * 2026-09-29: 56-58 s).
 */
async function callNamedProvider(
  ctx,
  { provider, model, prompt, systemPrompt = '', maxTokens, timeoutMs }
) {
  if (!PROVIDERS.includes(provider))
    throw new AiNotConfiguredError(`Unknown AI provider: ${provider}`);
  if (!readKey(ctx.env, KEY_ENV[provider])) {
    throw new AiNotConfiguredError(
      `${provider} is not configured: ${KEY_ENV[provider]} is not set`
    );
  }
  const usageOut = [];
  const text = await callWith(ctx, provider, {
    prompt,
    parts: null,
    model,
    purpose: 'general',
    expectJson: false,
    systemPrompt,
    usageOut,
    maxTokens,
    timeoutMs,
  });
  const usage = usageOut[0] || {};
  return {
    text,
    promptTokens: usage.promptTokens || 0,
    completionTokens: usage.completionTokens || 0,
    model: usage.model || model,
  };
}

/**
 * Process-wide instance for production call sites.
 *
 * The Cosmos client is imported lazily, and for two reasons. It keeps the cost
 * off the cold-start path of every function that merely imports `readKey` from
 * here (six modules do, and none of them touch a model). And it keeps this
 * module importable in tests and in tooling without a Cosmos connection string
 * — the store is only constructed when an AI call is actually made.
 */
const defaultRouter = createAiRouter({
  store: {
    queryDocs: async (...args) => (await import('../cosmos-client.js')).queryDocs(...args),
    readDoc: async (...args) => (await import('../cosmos-client.js')).readDoc(...args),
    // The usage row every call writes (recordCallUsage). Lazy for the same
    // reason as the two reads.
    upsertDoc: async (...args) => (await import('../cosmos-client.js')).upsertDoc(...args),
  },
  // The same process-wide writer the Publer timer and proxy use, so the two
  // reporters cannot disagree about what a rejected credential is. It imports
  // Cosmos lazily for the same reason the store does: nothing on the
  // cold-start path of the six modules that import only `readKey` from here.
  onKeyVerdict: recordKeyVerdict,
});

export const {
  availableProviders,
  getActiveAiProvider,
  resolveProvider,
  defaultModelFor,
  generateTextResponse,
  generateJsonResponse,
  generateGroundedJsonResponse,
  callProvider,
  invalidateConfig,
} = defaultRouter;
