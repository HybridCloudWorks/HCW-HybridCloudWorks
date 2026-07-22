const axios = require('axios');
const { VertexAI } = require('@google-cloud/vertexai');

function getActiveAiProvider() {
  return String(process.env.CONTENTFORGE_AI_PROVIDER || 'vertex')
    .toLowerCase()
    .trim();
}

// Provider × purpose → [env var name, default model]. Lookup table is
// flatter than the previous nested if-tree and keeps complexity low.
const DEFAULT_MODEL_TABLE = {
  vertex: {
    draft: ['CONTENTFORGE_VERTEX_DRAFT_MODEL', 'gemini-2.5-flash-lite'],
    analysis: ['CONTENTFORGE_VERTEX_ANALYSIS_MODEL', 'gemini-2.5-flash'],
    multimodal: ['CONTENTFORGE_VERTEX_MULTIMODAL_MODEL', 'gemini-2.5-flash'],
    general: ['CONTENTFORGE_VERTEX_MODEL', 'gemini-2.5-flash-lite'],
  },
  openai: {
    draft: ['CONTENTFORGE_OPENAI_DRAFT_MODEL', 'gpt-5-mini'],
    analysis: ['CONTENTFORGE_OPENAI_ANALYSIS_MODEL', 'gpt-5-mini'],
    multimodal: ['CONTENTFORGE_OPENAI_MULTIMODAL_MODEL', 'gpt-5-mini'],
    general: ['CONTENTFORGE_OPENAI_MODEL', 'gpt-5-nano'],
  },
  anthropic: {
    draft: ['CONTENTFORGE_ANTHROPIC_DRAFT_MODEL', 'claude-sonnet-4-6'],
    analysis: ['CONTENTFORGE_ANTHROPIC_ANALYSIS_MODEL', 'claude-sonnet-4-6'],
    multimodal: ['CONTENTFORGE_ANTHROPIC_MULTIMODAL_MODEL', 'claude-sonnet-4-6'],
    general: ['CONTENTFORGE_ANTHROPIC_MODEL', 'claude-haiku-4-5'],
  },
};
const FALLBACK_MODEL = 'gemini-2.5-flash-lite';

function defaultModelFor(provider, purpose = 'general') {
  const providerEntry = DEFAULT_MODEL_TABLE[provider];
  if (!providerEntry) return FALLBACK_MODEL;
  const [envVar, defaultModel] = providerEntry[purpose] || providerEntry.general;
  return process.env[envVar] || defaultModel;
}

function sanitizeJsonText(text = '') {
  return String(text)
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
}

function parseJsonWithFallbacks(rawText = '') {
  const cleaned = sanitizeJsonText(rawText);

  try {
    return JSON.parse(cleaned || '{}');
  } catch (_err) {
    // fall through to object-extraction fallback
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const extracted = cleaned.slice(start, end + 1);
    // Remove control characters that can break JSON.parse when models leak
    // raw content with invalid bytes.
    const scrubbed = extracted.replace(/[\u0000-\u0019]/g, ' ');
    return JSON.parse(scrubbed);
  }

  throw new Error('Model response did not contain parseable JSON');
}

function isRetryableError(error) {
  const status = error?.response?.status;
  const message = String(error?.message || '');

  if ([408, 429, 500, 502, 503, 504].includes(status)) return true;
  if (/429|503|timeout|temporarily unavailable|rate/i.test(message)) return true;
  return false;
}

async function withRetry(operation, maxAttempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableError(error)) {
        break;
      }

      const delayMs = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

function buildVertexRequest(parts, prompt, systemPrompt) {
  const requestParts = Array.isArray(parts) && parts.length > 0 ? parts : [{ text: prompt }];
  const systemInstruction = systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined;
  return {
    contents: [{ role: 'user', parts: requestParts }],
    ...(systemInstruction ? { systemInstruction } : {}),
  };
}

async function callVertex({
  prompt = '',
  parts = null,
  model,
  purpose = 'general',
  systemPrompt = '',
}) {
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'hybridcloudworks-61e8d';
  const location = process.env.CONTENTFORGE_VERTEX_LOCATION || 'us-central1';
  const selectedModel = model || defaultModelFor('vertex', purpose);

  const vertexAI = new VertexAI({ project, location });
  const generativeModel = vertexAI.getGenerativeModel({ model: selectedModel });
  const request = buildVertexRequest(parts, prompt, systemPrompt);

  const result = await generativeModel.generateContent(request);

  if (process.env.CONTENTFORGE_LOG_TOKEN_USAGE === 'true') {
    const usage = result.response?.usageMetadata || {};
    console.warn('[ai-model] vertex token usage', { ...usage, model: selectedModel, purpose });
  }

  return result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function toOpenAiContent(parts, prompt) {
  if (!Array.isArray(parts) || parts.length === 0) {
    return [{ type: 'text', text: prompt }];
  }

  return parts
    .map((part) => {
      if (typeof part?.text === 'string') {
        return { type: 'text', text: part.text };
      }

      if (
        part?.inlineData?.mimeType &&
        part?.inlineData?.data &&
        String(part.inlineData.mimeType).toLowerCase().startsWith('image/')
      ) {
        return {
          type: 'image_url',
          image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` },
        };
      }

      return null;
    })
    .filter(Boolean);
}

async function callOpenAi({
  prompt = '',
  parts = null,
  model,
  purpose = 'general',
  expectJson,
  systemPrompt = '',
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required when CONTENTFORGE_AI_PROVIDER=openai');
  }

  const selectedModel = model || defaultModelFor('openai', purpose);
  const content = toOpenAiContent(parts, prompt);

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content });

  const payload = {
    model: selectedModel,
    messages,
    temperature: 0.2,
  };

  if (expectJson) {
    payload.response_format = { type: 'json_object' };
  }

  const response = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
    timeout: 60000,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (process.env.CONTENTFORGE_LOG_TOKEN_USAGE === 'true') {
    const usage = response.data?.usage || {};
    console.warn('[ai-model] openai token usage', { ...usage, model: selectedModel, purpose });
  }

  return response.data?.choices?.[0]?.message?.content || '';
}

function toAnthropicContent(parts, prompt) {
  if (!Array.isArray(parts) || parts.length === 0) {
    return [{ type: 'text', text: prompt }];
  }

  return parts
    .map((part) => {
      if (typeof part?.text === 'string') {
        return { type: 'text', text: part.text };
      }

      if (
        part?.inlineData?.mimeType &&
        part?.inlineData?.data &&
        String(part.inlineData.mimeType).toLowerCase().startsWith('image/')
      ) {
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

async function callAnthropic({
  prompt = '',
  parts = null,
  model,
  purpose = 'general',
  expectJson,
  systemPrompt = '',
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required when CONTENTFORGE_AI_PROVIDER=anthropic');
  }

  const selectedModel = model || defaultModelFor('anthropic', purpose);
  const content = toAnthropicContent(parts, prompt);

  // R5: if a static systemPrompt is provided (≥1,024 tokens), mark it with
  // cache_control so Anthropic caches it across calls within the 5-min TTL.
  // The JSON-only instruction is appended as a non-cached trailing block so
  // the cache boundary stays on the expensive static context.
  let system;
  if (systemPrompt) {
    system = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
    if (expectJson) {
      system.push({
        type: 'text',
        text: 'Return only valid JSON. Do not include markdown code fences, prose, or extra commentary.',
      });
    }
  } else if (expectJson) {
    system =
      'Return only valid JSON. Do not include markdown code fences, prose, or extra commentary.';
  }

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: selectedModel,
      max_tokens: 4096,
      temperature: 0.2,
      messages: [{ role: 'user', content }],
      ...(system !== undefined ? { system } : {}),
    },
    {
      timeout: 60000,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'Content-Type': 'application/json',
      },
    }
  );

  if (process.env.CONTENTFORGE_LOG_TOKEN_USAGE === 'true') {
    const usage = response.data?.usage || {};
    console.warn('[ai-model] anthropic token usage', { ...usage, model: selectedModel, purpose });
  }

  const blocks = response.data?.content || [];
  const textBlocks = blocks.filter((b) => b?.type === 'text').map((b) => b.text);
  return textBlocks.join('\n');
}

async function generateTextResponse({
  prompt = '',
  parts = null,
  model = null,
  purpose = 'general',
  systemPrompt = '',
}) {
  const provider = getActiveAiProvider();

  return withRetry(async () => {
    if (provider === 'vertex') {
      return callVertex({ prompt, parts, model, purpose, systemPrompt });
    }

    if (provider === 'openai') {
      return callOpenAi({ prompt, parts, model, purpose, expectJson: false, systemPrompt });
    }

    if (provider === 'anthropic') {
      return callAnthropic({ prompt, parts, model, purpose, expectJson: false, systemPrompt });
    }

    throw new Error(`Unsupported CONTENTFORGE_AI_PROVIDER: ${provider}`);
  });
}

async function generateJsonResponse({
  prompt = '',
  parts = null,
  model = null,
  purpose = 'general',
  systemPrompt = '',
}) {
  const provider = getActiveAiProvider();

  const text = await withRetry(async () => {
    if (provider === 'vertex') {
      return callVertex({ prompt, parts, model, purpose, systemPrompt });
    }

    if (provider === 'openai') {
      return callOpenAi({ prompt, parts, model, purpose, expectJson: true, systemPrompt });
    }

    if (provider === 'anthropic') {
      return callAnthropic({ prompt, parts, model, purpose, expectJson: true, systemPrompt });
    }

    throw new Error(`Unsupported CONTENTFORGE_AI_PROVIDER: ${provider}`);
  });

  try {
    return parseJsonWithFallbacks(text);
  } catch (parseError) {
    const repairPrompt = `The following should be JSON but is malformed. Repair it and return ONLY valid JSON with no markdown fences, no explanation, and no extra keys.\n\n${sanitizeJsonText(
      text
    ).slice(0, 30000)}`;

    const repairedText = await generateTextResponse({
      prompt: repairPrompt,
      model,
      purpose,
      systemPrompt:
        'You repair malformed JSON. Return only strict RFC 8259 JSON. Do not add commentary.',
    });

    try {
      return parseJsonWithFallbacks(repairedText);
    } catch (_repairParseError) {
      throw parseError;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Engine — additional providers + cost table
// Used by the aiProxy / testAiProvider / aiEngine admin page.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cost table: provider → model → [inputPer1M_USD, outputPer1M_USD]
 * Approximate pricing as of May 2026. Update as rates change.
 */
const COST_TABLE = {
  anthropic: {
    'claude-opus-4-6': [15.0, 75.0],
    'claude-sonnet-4-6': [3.0, 15.0],
    'claude-haiku-4-5-20251001': [0.8, 4.0],
    default: [3.0, 15.0],
  },
  openai: {
    'gpt-4o': [5.0, 15.0],
    'gpt-4o-mini': [0.15, 0.6],
    o1: [15.0, 60.0],
    'o3-mini': [1.1, 4.4],
    default: [5.0, 15.0],
  },
  vertex: {
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
  replicate: {
    'meta/llama-3.1-405b-instruct': [0.65, 2.75],
    'meta/llama-3.1-70b-instruct': [0.35, 1.4],
    'meta/llama-3.1-8b-instruct': [0.05, 0.25],
    'mistralai/mistral-7b-instruct-v0.2': [0.05, 0.25],
    default: [0.35, 1.4],
  },
};

function getCostEstimate(provider, model, promptTokens = 0, completionTokens = 0) {
  const providerRates = COST_TABLE[provider] || {};
  const [inRate, outRate] = providerRates[model] || providerRates.default || [0, 0];
  return parseFloat(
    ((promptTokens / 1_000_000) * inRate + (completionTokens / 1_000_000) * outRate).toFixed(8)
  );
}

// ── Perplexity ─────────────────────────────────────────────────────────────────
async function callPerplexity({ prompt, model, systemPrompt = '' }) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error('PERPLEXITY_API_KEY is required for Perplexity');

  const selectedModel = model || 'sonar-pro';
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const response = await axios.post(
    'https://api.perplexity.ai/chat/completions',
    { model: selectedModel, messages },
    {
      timeout: 60000,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    }
  );

  const usage = response.data?.usage || {};
  return {
    text: response.data?.choices?.[0]?.message?.content || '',
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
  };
}

// ── Azure OpenAI ───────────────────────────────────────────────────────────────
async function callAzureOpenAI({ prompt, model, systemPrompt = '' }) {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
  const deployment = model || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';

  if (!apiKey || !endpoint) {
    throw new Error('AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT are required for Azure OpenAI');
  }

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-01`;
  const response = await axios.post(
    url,
    { model: deployment, messages },
    {
      timeout: 60000,
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    }
  );

  const usage = response.data?.usage || {};
  return {
    text: response.data?.choices?.[0]?.message?.content || '',
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
  };
}

// ── AWS Bedrock — Amazon Nova (SigV4 via built-in crypto) ─────────────────────
function _awsSigV4Headers(method, url, body, region, service, accessKeyId, secretKey) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const parsed = new URL(url);

  const payloadHash = require('crypto').createHash('sha256').update(body).digest('hex');
  const canonicalHeaders = `content-type:application/json\nhost:${parsed.host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';

  const canonicalRequest = [
    method,
    parsed.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    require('crypto').createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const crypto = require('crypto');
  const kDate = crypto.createHmac('sha256', `AWS4${secretKey}`).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  const sigKey = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const signature = crypto.createHmac('sha256', sigKey).update(stringToSign).digest('hex');

  return {
    'Content-Type': 'application/json',
    'x-amz-date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

async function callAWSNova({ prompt, model, systemPrompt = '' }) {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || 'us-east-1';

  if (!accessKeyId || !secretKey) {
    throw new Error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY required for AWS Bedrock');
  }

  const selectedModel = model || 'amazon.nova-lite-v1:0';
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(selectedModel)}/invoke`;

  const payload = JSON.stringify({
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    ...(systemPrompt ? { system: [{ text: systemPrompt }] } : {}),
    inferenceConfig: { max_new_tokens: 2048, temperature: 0.2 },
  });

  const headers = _awsSigV4Headers('POST', url, payload, region, 'bedrock', accessKeyId, secretKey);
  const response = await axios.post(url, payload, { headers, timeout: 60000 });

  const usage = response.data?.usage || {};
  return {
    text: response.data?.output?.message?.content?.[0]?.text || '',
    promptTokens: usage.inputTokens || 0,
    completionTokens: usage.outputTokens || 0,
  };
}

// ── Replicate (LLM via predictions API) ──────────────────────────────────────
async function callReplicateChat({ prompt, model, systemPrompt = '' }) {
  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) throw new Error('REPLICATE_API_KEY is required for Replicate');

  const selectedModel = model || 'meta/llama-3.1-70b-instruct';
  // Replicate prediction input schema varies by model; Llama models accept `prompt` + `system_prompt`
  const input = {
    prompt,
    ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
    max_tokens: 1024,
  };

  // POST to predictions endpoint for latest model version
  const createResp = await axios.post(
    `https://api.replicate.com/v1/models/${selectedModel}/predictions`,
    { input },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    }
  );

  const predictionUrl = createResp.data?.urls?.get;
  if (!predictionUrl) throw new Error('Replicate: no prediction URL in response');

  // Poll until succeeded or failed (max 60s)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollResp = await axios.get(predictionUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 15000,
    });
    const { status, output, error } = pollResp.data || {};
    if (status === 'succeeded') {
      const text = Array.isArray(output) ? output.join('') : output || '';
      return { text, promptTokens: 0, completionTokens: 0 };
    }
    if (status === 'failed' || status === 'canceled') {
      throw new Error(`Replicate prediction ${status}: ${error || 'unknown error'}`);
    }
  }
  throw new Error('Replicate prediction timed out after 60 seconds');
}

// ── Unified callProvider — explicit provider override ─────────────────────────
/**
 * Calls a specific AI provider with an explicit `provider` param.
 * Used by the AI Engine admin page; does NOT respect CONTENTFORGE_AI_PROVIDER.
 *
 * @param {{ provider: string, model?: string, prompt: string, systemPrompt?: string }} opts
 * @returns {Promise<{ text: string, promptTokens: number, completionTokens: number }>}
 */
async function callProvider({ provider, model, prompt, systemPrompt = '' }) {
  // Clean potential environment secrets to strip any UTF-16 BOM and whitespace
  const keysToClean = [
    'REPLICATE_API_KEY',
    'FIRECRAWL_API_KEY',
    'VPS_API_TOKEN',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'PERPLEXITY_API_KEY',
    'GEMINI_API_KEY',
  ];
  keysToClean.forEach((key) => {
    if (process.env[key]) {
      process.env[key] = process.env[key].replace(/^\ufeff/, '').trim();
    }
  });

  switch (provider) {
    case 'anthropic': {
      const text = await callAnthropic({ prompt, model, purpose: 'general', systemPrompt });
      return { text, promptTokens: 0, completionTokens: 0 };
    }
    case 'openai': {
      const text = await callOpenAi({ prompt, model, purpose: 'general', systemPrompt });
      return { text, promptTokens: 0, completionTokens: 0 };
    }
    case 'vertex': {
      const text = await callVertex({ prompt, model, purpose: 'general', systemPrompt });
      return { text, promptTokens: 0, completionTokens: 0 };
    }
    case 'perplexity':
      return callPerplexity({ prompt, model, systemPrompt });
    case 'azure':
      return callAzureOpenAI({ prompt, model, systemPrompt });
    case 'bedrock':
      return callAWSNova({ prompt, model, systemPrompt });
    case 'replicate':
      return callReplicateChat({ prompt, model, systemPrompt });
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

module.exports = {
  defaultModelFor,
  getActiveAiProvider,
  generateTextResponse,
  generateJsonResponse,
  sanitizeJsonText,
  callProvider,
  getCostEstimate,
  COST_TABLE,
};
