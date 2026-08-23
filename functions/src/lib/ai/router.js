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
 *   - Azure OpenAI. Retired with the account (Migration_Plan note).
 *   - axios. `fetch` is global on Node 22; one less dependency.
 *
 * What is kept: the purpose → model table (env-overridable per provider), JSON
 * sanitising with a repair round trip, retry on 408/429/5xx, per-call usage
 * capture with cost estimates, the Anthropic prompt-cache marker.
 *
 * A Key Vault reference that did not resolve arrives as the literal
 * `@Microsoft.KeyVault(...)` string. That is not a key; `readKey` says so.
 */

import {
  DEFAULT_PROVIDER_ORDER,
  createAiConfigLoader,
  configuredModelFor,
  isFeatureEnabled,
  resolveProviderOrder,
} from './ai-config.js';

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

const KEY_ENV = Object.freeze({
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
});

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
    // gpt-5-mini / gpt-5-nano (the defaults) are deliberately not priced here:
    // upstream never priced them either, and a guessed figure is worse than
    // the visible fallback. Add the rows when the owner confirms the rates.
    default: [5.0, 15.0],
  },
  gemini: {
    'gemini-3.6-flash': [1.5, 7.5],
    'gemini-3.5-flash': [1.5, 9.0],
    'gemini-3.5-flash-lite': [0.3, 2.5],
    'gemini-2.5-pro': [3.5, 10.5],
    'gemini-2.5-flash': [0.3, 2.5],
    'gemini-2.5-flash-lite': [0.1, 0.4],
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
  perplexity: { 'sonar-pro': [3.0, 15.0], sonar: [1.0, 1.0], default: [3.0, 15.0] },
  azure: { 'gpt-4o': [5.0, 15.0], 'gpt-4o-mini': [0.15, 0.6], default: [5.0, 15.0] },
  bedrock: {
    'amazon.nova-micro-v1:0': [0.035, 0.14],
    'amazon.nova-lite-v1:0': [0.06, 0.24],
    'amazon.nova-pro-v1:0': [0.8, 3.2],
    default: [0.06, 0.24],
  },
  replicate: {
    'meta/llama-3.1-405b-instruct': [0.65, 2.75],
    'meta/llama-3.1-70b-instruct': [0.35, 1.4],
    'meta/llama-3.1-8b-instruct': [0.05, 0.25],
    'mistralai/mistral-7b-instruct-v0.2': [0.05, 0.25],
    default: [0.35, 1.4],
  },
});

export function getCostEstimate(provider, model, promptTokens = 0, completionTokens = 0) {
  const rates = COST_TABLE[provider] || {};
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
  });
}

/** Multimodal parts → OpenAI content blocks. */
function toOpenAiContent(parts, prompt) {
  if (!Array.isArray(parts) || parts.length === 0) return [{ type: 'text', text: prompt }];
  return parts
    .map((part) => {
      if (typeof part?.text === 'string') return { type: 'text', text: part.text };
      const mime = String(part?.inlineData?.mimeType || '').toLowerCase();
      if (mime.startsWith('image/') && part?.inlineData?.data) {
        return {
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${part.inlineData.data}` },
        };
      }
      return null;
    })
    .filter(Boolean);
}

/** Multimodal parts → Anthropic content blocks. */
function toAnthropicContent(parts, prompt) {
  if (!Array.isArray(parts) || parts.length === 0) return [{ type: 'text', text: prompt }];
  return parts
    .map((part) => {
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
      return null;
    })
    .filter(Boolean);
}

/** Multimodal parts → Gemini parts (already the native shape). */
function toGeminiParts(parts, prompt) {
  if (!Array.isArray(parts) || parts.length === 0) return [{ text: prompt }];
  return parts
    .map((part) => {
      if (typeof part?.text === 'string') return { text: part.text };
      if (part?.inlineData?.mimeType && part?.inlineData?.data) {
        return { inlineData: { mimeType: part.inlineData.mimeType, data: part.inlineData.data } };
      }
      return null;
    })
    .filter(Boolean);
}

async function postJson(fetchImpl, url, { headers, body, timeoutMs = 60_000 }) {
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
} = {}) {
  // With no store the loader reports "no configuration", and every path below
  // falls back to exactly the environment-only behaviour this router had before
  // the portal's settings were wired up. That is what keeps unit tests — and
  // any caller that does not hand over a Cosmos client — working unchanged.
  const config = createAiConfigLoader({ store, ttlMs: configTtlMs, log });

  const availableProviders = () => PROVIDERS.filter((p) => readKey(env, KEY_ENV[p]));

  const pinnedProvider = () =>
    String(env.CONTENTFORGE_AI_PROVIDER || '')
      .toLowerCase()
      .trim();

  /**
   * The provider chosen from KEYS ALONE, ignoring anything stored in the portal.
   *
   * Kept synchronous and kept env-only on purpose: callers use it to label and
   * to log, and an await there would ripple through four modules for no gain.
   * It is NOT the provider a call will use once an administrator has reordered
   * or disabled something — for that, read `usageOut` after the call, which
   * records what actually ran. `resolveProvider` is the real selection.
   */
  function getActiveAiProvider() {
    const available = availableProviders();
    const pinned = pinnedProvider();
    if (pinned) {
      if (available.includes(pinned)) return pinned;
      log.warn?.(
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
  async function resolveProviderChain(feature = null) {
    const { providers: docs, features } = await config.load();

    if (feature && !isFeatureEnabled(features, feature)) {
      throw new AiFeatureDisabledError(feature);
    }

    const available = availableProviders();
    const { order, disabled } = resolveProviderOrder(docs, available);

    const pinned = pinnedProvider();
    let chain = order;
    if (pinned) {
      if (order.includes(pinned)) {
        // An explicit pin is an instruction, not a preference: it selects one
        // provider and does NOT fall through to the others.
        chain = [pinned];
      } else {
        const why = disabled.includes(pinned)
          ? 'it is disabled in the admin portal'
          : 'its key is not present';
        log.warn?.(
          `[ai-router] CONTENTFORGE_AI_PROVIDER=${pinned} but ${why}; falling back to ${order[0] || 'none'}`
        );
      }
    }

    if (chain.length === 0) {
      throw new AiNotConfiguredError(
        disabled.length > 0
          ? `Every configured AI provider is disabled in the admin portal (${disabled.join(', ')}). Re-enable one under AI Engine → AI Services.`
          : 'No AI provider is configured. Seed GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY in Key Vault (REVIEW §4.6) and the matching provider turns on.'
      );
    }

    return chain.map((provider) => ({ provider, model: configuredModelFor(docs, provider) }));
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
  function isProviderUnusable(error) {
    const status = Number(error?.status);
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
   */
  async function callWithFailover({ chain, explicitModel, ...args }) {
    const attempts = [];

    for (const { provider, model: configuredModel } of chain) {
      try {
        return await withRetry(() =>
          callWith(provider, {
            ...args,
            // An explicit model from the call site wins; then the
            // administrator's choice in the portal; then the purpose table.
            model: explicitModel || configuredModel,
          })
        );
      } catch (error) {
        attempts.push({ provider, error });
        const last = chain[chain.length - 1].provider === provider;
        if (last || !isProviderUnusable(error)) throw error;
        log.warn?.(
          `[ai-router] ${provider} could not serve this call (${error?.message || error}); trying the next provider`
        );
      }
    }

    // Unreachable: the loop either returns or throws on its last iteration.
    throw attempts.at(-1)?.error || new AiNotConfiguredError('No AI provider was tried');
  }

  /**
   * The single best provider, for callers that only need to name one.
   *
   * @param {string|null} feature A key of AI_FEATURES, or null to skip the gate.
   * @returns {Promise<{provider: string, model: string|null}>}
   */
  async function resolveProvider(feature = null) {
    return (await resolveProviderChain(feature))[0];
  }

  function defaultModelFor(provider, purpose = 'general') {
    const entry = DEFAULT_MODEL_TABLE[provider];
    if (!entry) return DEFAULT_MODEL_TABLE.gemini.general[1];
    const [envVar, fallback] = entry[purpose] || entry.general;
    return env[envVar] || fallback;
  }

  async function withRetry(operation, maxAttempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isRetryableError(error)) break;
        await sleep(2 ** attempt * 1000);
      }
    }
    throw lastError;
  }

  const logUsage = (provider, usage, model, purpose) => {
    if (env.CONTENTFORGE_LOG_TOKEN_USAGE === 'true') {
      log.warn?.(`[ai-model] ${provider} token usage`, { ...usage, model, purpose });
    }
  };

  async function callAnthropic({
    prompt,
    parts,
    model,
    purpose,
    expectJson,
    systemPrompt,
    usageOut,
  }) {
    const apiKey = readKey(env, KEY_ENV.anthropic);
    const selectedModel = model || defaultModelFor('anthropic', purpose);
    // A static system prompt is marked for the prompt cache; the JSON-only
    // instruction trails it uncached so the cache boundary stays on the
    // expensive context.
    let system;
    if (systemPrompt) {
      system = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
      if (expectJson) system.push({ type: 'text', text: JSON_ONLY });
    } else if (expectJson) {
      system = JSON_ONLY;
    }
    const data = await postJson(fetchImpl, 'https://api.anthropic.com/v1/messages', {
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
    });
    const usage = data?.usage || {};
    recordUsage(usageOut, 'anthropic', selectedModel, usage.input_tokens, usage.output_tokens);
    logUsage('anthropic', usage, selectedModel, purpose);
    return (data?.content || [])
      .filter((b) => b?.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  async function callOpenAi({ prompt, parts, model, purpose, expectJson, systemPrompt, usageOut }) {
    const apiKey = readKey(env, KEY_ENV.openai);
    const selectedModel = model || defaultModelFor('openai', purpose);
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: toOpenAiContent(parts, prompt) });
    const data = await postJson(fetchImpl, 'https://api.openai.com/v1/chat/completions', {
      headers: { Authorization: `Bearer ${apiKey}` },
      body: {
        model: selectedModel,
        messages,
        temperature: 0.2,
        ...(expectJson ? { response_format: { type: 'json_object' } } : {}),
      },
    });
    const usage = data?.usage || {};
    recordUsage(usageOut, 'openai', selectedModel, usage.prompt_tokens, usage.completion_tokens);
    logUsage('openai', usage, selectedModel, purpose);
    return data?.choices?.[0]?.message?.content || '';
  }

  async function callGemini({ prompt, parts, model, purpose, expectJson, systemPrompt, usageOut }) {
    const apiKey = readKey(env, KEY_ENV.gemini);
    const selectedModel = model || defaultModelFor('gemini', purpose);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`;
    const data = await postJson(fetchImpl, url, {
      headers: { 'x-goog-api-key': apiKey },
      body: {
        contents: [{ role: 'user', parts: toGeminiParts(parts, prompt) }],
        ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
        generationConfig: {
          temperature: 0.2,
          ...(expectJson ? { responseMimeType: 'application/json' } : {}),
        },
      },
    });
    const usage = data?.usageMetadata || {};
    // Reasoning tokens bill at the output rate — count them as output.
    const outTokens =
      (Number(usage.candidatesTokenCount) || 0) + (Number(usage.thoughtsTokenCount) || 0);
    recordUsage(usageOut, 'gemini', selectedModel, usage.promptTokenCount, outTokens);
    logUsage('gemini', usage, selectedModel, purpose);
    return (data?.candidates?.[0]?.content?.parts || [])
      .filter((p) => typeof p?.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('');
  }

  const CALLERS = { anthropic: callAnthropic, openai: callOpenAi, gemini: callGemini };

  function callWith(provider, args) {
    const caller = CALLERS[provider];
    if (!caller) throw new AiNotConfiguredError(`Unknown AI provider: ${provider}`);
    return caller(args);
  }

  async function generateTextResponse({
    prompt = '',
    parts = null,
    model = null,
    purpose = 'general',
    systemPrompt = '',
    usageOut = null,
    feature = null,
  } = {}) {
    const chain = await resolveProviderChain(feature);
    return callWithFailover({
      chain,
      explicitModel: model,
      prompt,
      parts,
      purpose,
      expectJson: false,
      systemPrompt,
      usageOut,
    });
  }

  async function generateJsonResponse({
    prompt = '',
    parts = null,
    model = null,
    purpose = 'general',
    systemPrompt = '',
    usageOut = null,
    feature = null,
  } = {}) {
    const chain = await resolveProviderChain(feature);
    const text = await callWithFailover({
      chain,
      explicitModel: model,
      prompt,
      parts,
      purpose,
      expectJson: true,
      systemPrompt,
      usageOut,
    });
    try {
      return parseJsonWithFallbacks(text);
    } catch (parseError) {
      // One repair round trip, then the original parse error wins.
      const repaired = await generateTextResponse({
        prompt: `The following should be JSON but is malformed. Repair it and return ONLY valid JSON with no markdown fences, no explanation, and no extra keys.\n\n${sanitizeJsonText(text).slice(0, 30000)}`,
        model,
        purpose,
        systemPrompt:
          'You repair malformed JSON. Return only strict RFC 8259 JSON. Do not add commentary.',
        usageOut,
        // The repair belongs to the call that is already permitted; re-checking
        // under the same cached settings keeps the two halves consistent.
        feature,
      });
      try {
        return parseJsonWithFallbacks(repaired);
      } catch {
        throw parseError;
      }
    }
  }

  /** The aiProxy / testAiProvider shape: an explicit provider, text back with token counts. */
  async function callProvider({ provider, model, prompt, systemPrompt = '' }) {
    if (!PROVIDERS.includes(provider))
      throw new AiNotConfiguredError(`Unknown AI provider: ${provider}`);
    if (!readKey(env, KEY_ENV[provider])) {
      throw new AiNotConfiguredError(
        `${provider} is not configured: ${KEY_ENV[provider]} is not set`
      );
    }
    const usageOut = [];
    const text = await callWith(provider, {
      prompt,
      parts: null,
      model,
      purpose: 'general',
      expectJson: false,
      systemPrompt,
      usageOut,
    });
    const usage = usageOut[0] || {};
    return {
      text,
      promptTokens: usage.promptTokens || 0,
      completionTokens: usage.completionTokens || 0,
      model: usage.model || model,
    };
  }

  return {
    availableProviders,
    getActiveAiProvider,
    resolveProvider,
    resolveProviderChain,
    defaultModelFor,
    generateTextResponse,
    generateJsonResponse,
    callProvider,
    getCostEstimate,
    invalidateConfig: config.invalidate,
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
  },
});

export const {
  availableProviders,
  getActiveAiProvider,
  resolveProvider,
  defaultModelFor,
  generateTextResponse,
  generateJsonResponse,
  callProvider,
  invalidateConfig,
} = defaultRouter;
