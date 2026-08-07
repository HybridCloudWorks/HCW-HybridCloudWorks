/**
 * AI Engine — browser client library
 *
 * Provides a unified interface for:
 *   • Calling any configured AI provider (via the aiProxy RPC)
 *   • Calling MCP server tools (via the mcpProxy RPC)
 *   • Reading/writing provider and server configs via cms/config/*
 *
 * All calls are authenticated with the current user's Entra access token.
 *
 * Config reads note: mcp_servers documents carry hasOauthToken (boolean)
 * instead of the token itself — the value is write-only on the API.
 *
 * Usage:
 *   import { aiEngine } from '@/lib/aiEngine';
 *   const { text } = await aiEngine.chat('anthropic', 'claude-sonnet-4-6', 'Hello!');
 *   const result    = await aiEngine.mcpTool('brave-search', 'brave_web_search', { query: 'test' });
 */

import { postJSON, getJSON, sendJSON } from '@/lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Default provider & MCP server seed data
// Written through the config API on first admin page load if empty.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    description: 'claude-opus-4, claude-sonnet-4, claude-haiku-4',
    icon: '🟣',
    enabled: false,
    defaultModel: 'claude-sonnet-4-6',
    models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    docsUrl: 'https://docs.anthropic.com',
    status: 'untested',
    order: 1,
    notes: 'Set ANTHROPIC_API_KEY in functions/.env',
  },

  {
    id: 'vertex',
    name: 'Gemini (Google Vertex AI)',
    description: 'Gemini 2.5 Flash, Flash-Lite, Pro',
    icon: '🔵',
    enabled: true,
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
    apiKeyEnvVar: null,
    docsUrl: 'https://cloud.google.com/vertex-ai/docs',
    status: 'untested',
    order: 3,
    notes:
      'Uses Application Default Credentials — no API key needed in Cloud Functions. Set GCLOUD_PROJECT env var.',
  },
  {
    id: 'perplexity',
    name: 'Perplexity (Sonar)',
    description: 'Search-augmented AI with live web access',
    icon: '🔍',
    enabled: false,
    defaultModel: 'sonar-pro',
    models: ['sonar-pro', 'sonar'],
    apiKeyEnvVar: 'PERPLEXITY_API_KEY',
    docsUrl: 'https://docs.perplexity.ai',
    status: 'untested',
    order: 4,
    notes: 'Set PERPLEXITY_API_KEY in functions/.env',
  },
  {
    id: 'bedrock',
    name: 'AWS Bedrock (Nova)',
    description: 'Amazon Nova Lite/Pro — very affordable inference',
    icon: '🟠',
    enabled: false,
    defaultModel: 'amazon.nova-lite-v1:0',
    models: ['amazon.nova-micro-v1:0', 'amazon.nova-lite-v1:0', 'amazon.nova-pro-v1:0'],
    apiKeyEnvVar: 'AWS_ACCESS_KEY_ID',
    docsUrl: 'https://docs.aws.amazon.com/bedrock',
    status: 'untested',
    order: 5,
    notes:
      'Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION (default: us-east-1) in functions/.env. Nova Lite is near-free.',
  },
  {
    id: 'replicate',
    name: 'Replicate',
    description: 'Run and fine-tune open-source models — Llama, SDXL, Flux, Imagen-4',
    icon: '🎨',
    enabled: false,
    defaultModel: 'meta/llama-3.1-405b-instruct',
    models: [
      'meta/llama-3.1-405b-instruct',
      'meta/llama-3.1-70b-instruct',
      'meta/llama-3.1-8b-instruct',
      'mistralai/mistral-7b-instruct-v0.2',
    ],
    apiKeyEnvVar: 'REPLICATE_API_KEY',
    docsUrl: 'https://replicate.com/docs',
    status: 'untested',
    order: 6,
    notes:
      'Set REPLICATE_API_KEY in Firebase secrets (already used for image generation). Text models use the predictions endpoint. Llama 405B is near-GPT-4 quality.',
  },
];

export const DEFAULT_MCP_SERVERS = [
  {
    id: 'plaud',
    name: 'Plaud (Voice Recordings)',
    description:
      'Access your Plaud recordings, transcripts & AI notes live — no manual export needed',
    url: 'https://mcp.plaud.ai/mcp',
    transport: 'http',
    enabled: false,
    apiKeyEnvVar: null, // OAuth — token stored in oauthToken field, not an env var
    authType: 'oauth',
    tools: [
      { name: 'list_files', description: 'List recordings with optional date/keyword filters' },
      { name: 'get_file', description: 'Full details + presigned audio URL for one recording' },
      { name: 'get_note', description: 'AI-generated summary, action items & key topics' },
      { name: 'get_transcript', description: 'Full transcript with timestamps and speaker labels' },
      { name: 'get_current_user', description: 'Your Plaud account details' },
    ],
    status: 'untested',
    order: 1,
    notes:
      'OAuth auth. To connect: go to the Recordings page → Connect tab, follow the OAuth flow, and paste your access token. Token is stored server-side in Firestore — never in the browser. Docs: https://docs.plaud.ai/documentation/plaud_app/mcp',
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    description: 'Web scraping and content extraction — already in your project',
    url: 'https://mcp.firecrawl.dev/sse',
    transport: 'sse',
    enabled: false,
    apiKeyEnvVar: 'FIRECRAWL_API_KEY',
    tools: [],
    status: 'untested',
    order: 2,
    notes:
      'Your project already uses @mendable/firecrawl-js. Connect via MCP for tool-based access.',
  },
  {
    id: 'context7',
    name: 'Context7 (Library Docs)',
    description: 'Up-to-date library documentation for any npm/PyPI package',
    url: 'https://mcp.context7.com/mcp',
    transport: 'http',
    enabled: false,
    apiKeyEnvVar: null,
    tools: [],
    status: 'untested',
    order: 3,
    notes: 'Free public MCP server. No API key required.',
  },

  {
    id: 'replicate-mcp',
    name: 'Replicate MCP',
    description: 'Run 50k+ open-source AI models as MCP tools — images, audio, video, text',
    url: 'https://mcp.replicate.com/sse',
    transport: 'sse',
    enabled: false,
    apiKeyEnvVar: 'REPLICATE_API_KEY',
    tools: [],
    status: 'untested',
    order: 6,
    notes:
      'Official Replicate remote MCP server (SSE). Uses REPLICATE_API_KEY. Docs: https://replicate.com/docs/topics/mcp',
  },
  {
    id: 'aws-knowledge-mcp',
    name: 'AWS Knowledge Base',
    description: 'Retrieve AWS documentation, architecture patterns, and knowledge base details',
    url: 'https://knowledge-mcp.global.api.aws',
    transport: 'http',
    enabled: false,
    apiKeyEnvVar: null,
    tools: [],
    status: 'untested',
    order: 8,
    notes:
      'Free public AWS MCP server. No API key required. Provides search tools for AWS developer docs and architecture guidance.',
  },
  {
    id: 'microsoftdocs-mcp',
    name: 'Microsoft Learn / Docs',
    description: 'Retrieve Microsoft documentation, learning modules, and platform resources',
    url: 'https://learn.microsoft.com/api/mcp',
    transport: 'http',
    enabled: false,
    apiKeyEnvVar: null,
    tools: [],
    status: 'untested',
    order: 9,
    notes:
      'Free public Microsoft Learn MCP server. No API key required. Provides tools to search Microsoft documentation and learning modules.',
  },
  {
    id: 'drawio-mcp',
    name: 'Draw.io (Diagrams.net)',
    description:
      'Generate, edit, and analyze draw.io diagrams programmatically from chat prompt inputs',
    url: 'https://mcp.draw.io/mcp',
    transport: 'http',
    enabled: false,
    apiKeyEnvVar: null,
    tools: [],
    status: 'untested',
    order: 10,
    notes:
      'Uses the public Draw.io MCP server (https://mcp.draw.io/mcp) to create and update charts, workflows, and diagrams. No local installation required.',
  },
  {
    id: 'hostinger-mcp',
    name: 'Hostinger MCP',
    description:
      'Administer Hostinger resources (VPS, domains, DNS, and hosting) via the Hostinger API',
    url: 'http://localhost:8100',
    transport: 'http',
    enabled: false,
    apiKeyEnvVar: 'VPS_API_TOKEN',
    tools: [],
    status: 'untested',
    order: 11,
    notes:
      'Requires the VPS_API_TOKEN secret (fetched from Notion DB). The hostinger-api-mcp server must be deployed as an HTTP endpoint for cloud proxy access.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Core API helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Route keys for the config API. Callers historically pass the container
 * names ('ai_providers'/'mcp_servers'), so both spellings resolve.
 */
const CONFIG_ROUTES = {
  ai_providers: 'ai-providers',
  'ai-providers': 'ai-providers',
  mcp_servers: 'mcp-servers',
  'mcp-servers': 'mcp-servers',
};

function configRoute(colName) {
  const route = CONFIG_ROUTES[colName];
  if (!route) throw new Error(`Unknown config collection: ${colName}`);
  return route;
}

async function fetchConfig(route) {
  const res = await getJSON(`cms/config/${route}`);
  return res.items || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Config subscriptions
//
// The Firestore onSnapshot listeners are replaced with fetch-plus-notify:
// every subscriber gets the current list on subscribe, and every write helper
// in this module re-fetches and re-notifies after it lands. Same reactive UX
// on the admin pages, no polling.
// ─────────────────────────────────────────────────────────────────────────────

const configSubscribers = {
  'ai-providers': new Set(),
  'mcp-servers': new Set(),
};

async function notifyConfigSubscribers(route) {
  if (configSubscribers[route].size === 0) return;
  try {
    const items = await fetchConfig(route);
    configSubscribers[route].forEach((callback) => callback(items));
  } catch (err) {
    console.error(`[aiEngine] refresh of ${route} failed:`, err);
  }
}

function subscribeConfig(route, callback) {
  configSubscribers[route].add(callback);
  fetchConfig(route)
    .then((items) => {
      if (configSubscribers[route].has(callback)) callback(items);
    })
    .catch((err) => console.error(`[aiEngine] load of ${route} failed:`, err));
  return () => configSubscribers[route].delete(callback);
}

/** Listener on ai_providers, sorted by order (server-sorted). */
export function subscribeProviders(callback) {
  return subscribeConfig('ai-providers', callback);
}

/** Listener on mcp_servers, sorted by order (server-sorted). */
export function subscribeMcpServers(callback) {
  return subscribeConfig('mcp-servers', callback);
}

/** Seed the config collections if empty.
 *  Also deletes deprecated provider/server docs and patches stale URLs.
 *  Called once on admin page load.
 */
export async function seedAiEngineIfEmpty() {
  // Providers and servers that have been permanently removed from defaults.
  const DEPRECATED_PROVIDERS = ['openai'];
  const DEPRECATED_MCP_SERVERS = ['anthropic-mcp', 'openai-mcp', 'perplexity-mcp'];

  // URL migrations for servers that changed endpoints.
  const MCP_URL_PATCHES = {
    'aws-knowledge-mcp': 'https://knowledge-mcp.global.api.aws',
    'microsoftdocs-mcp': 'https://learn.microsoft.com/api/mcp',
    'replicate-mcp': 'https://mcp.replicate.com/sse',
    'hostinger-mcp': 'http://localhost:8100',
  };
  const MCP_TRANSPORT_PATCHES = {
    'replicate-mcp': 'sse',
  };

  const [providers, servers] = await Promise.all([
    fetchConfig('ai-providers'),
    fetchConfig('mcp-servers'),
  ]);

  const writes = [];
  const putConfig = (route, id, data) => sendJSON(`cms/config/${route}/${id}`, 'PUT', data);
  const patchConfig = (route, id, patch) => sendJSON(`cms/config/${route}/${id}`, 'PATCH', patch);
  const deleteConfig = (route, id) => sendJSON(`cms/config/${route}/${id}`, 'DELETE');

  // ─ AI Providers ───────────────────────────────────────────────
  const providerIds = new Set(providers.map((p) => p.id));
  for (const id of DEPRECATED_PROVIDERS) {
    if (providerIds.has(id)) writes.push(deleteConfig('ai-providers', id));
  }
  DEFAULT_PROVIDERS.forEach((p) => {
    if (providers.length === 0 || !providerIds.has(p.id)) {
      writes.push(putConfig('ai-providers', p.id, p));
    }
  });

  // ─ MCP Servers ───────────────────────────────────────────────
  const serverIds = new Set(servers.map((srv) => srv.id));
  for (const id of DEPRECATED_MCP_SERVERS) {
    if (serverIds.has(id)) writes.push(deleteConfig('mcp-servers', id));
  }
  DEFAULT_MCP_SERVERS.forEach((srv) => {
    if (servers.length === 0 || !serverIds.has(srv.id)) {
      writes.push(putConfig('mcp-servers', srv.id, srv));
    }
  });
  // Patch stale URLs in existing docs
  for (const server of servers) {
    const patch = {};
    if (MCP_URL_PATCHES[server.id] && server.url !== MCP_URL_PATCHES[server.id]) {
      patch.url = MCP_URL_PATCHES[server.id];
    }
    if (MCP_TRANSPORT_PATCHES[server.id] && server.transport !== MCP_TRANSPORT_PATCHES[server.id]) {
      patch.transport = MCP_TRANSPORT_PATCHES[server.id];
    }
    if (Object.keys(patch).length > 0) {
      writes.push(patchConfig('mcp-servers', server.id, patch));
    }
  }

  if (writes.length > 0) {
    await Promise.all(writes);
    await Promise.all([
      notifyConfigSubscribers('ai-providers'),
      notifyConfigSubscribers('mcp-servers'),
    ]);
  }
}

/** Toggle enable flag on a provider or MCP server. */
export async function setEnabled(colName, docId, enabled) {
  const route = configRoute(colName);
  await sendJSON(`cms/config/${route}/${docId}`, 'PATCH', { enabled });
  await notifyConfigSubscribers(route);
}

/** Update the default model for a provider. */
export async function setProviderModel(providerId, model) {
  await sendJSON(`cms/config/ai-providers/${providerId}`, 'PATCH', { defaultModel: model });
  await notifyConfigSubscribers('ai-providers');
}

/** Add a custom MCP server. */
export async function addMcpServer(data) {
  const id = crypto.randomUUID();
  await sendJSON(`cms/config/mcp-servers/${id}`, 'PUT', {
    ...data,
    tools: [],
    status: 'untested',
  });
  await notifyConfigSubscribers('mcp-servers');
  return id;
}

/**
 * Store an OAuth access token for an MCP server (e.g. Plaud).
 * The API accepts the write but never returns the value on any read —
 * reads carry hasOauthToken (boolean) instead. Only mcpProxy uses the token
 * server-side.
 */
export async function setMcpOAuthToken(serverId, oauthToken) {
  await sendJSON(`cms/config/mcp-servers/${serverId}`, 'PATCH', {
    oauthToken,
    status: 'untested', // force re-test after token update
  });
  await notifyConfigSubscribers('mcp-servers');
}

/** Delete a custom MCP server (only non-seed servers). */
export async function removeMcpServer(serverId) {
  await sendJSON(`cms/config/mcp-servers/${serverId}`, 'DELETE');
  await notifyConfigSubscribers('mcp-servers');
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloud Function calls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a chat message to a provider via aiProxy.
 * @returns {{ text, promptTokens, completionTokens, estimatedCostUsd, latencyMs }}
 */
export async function chat(
  provider,
  model,
  prompt,
  systemPrompt = '',
  source = 'admin_playground'
) {
  const data = await postJSON('aiProxy', { provider, model, prompt, systemPrompt, source });
  if (!data.ok) throw new Error(data.error || 'aiProxy returned an error');
  return data;
}

/**
 * Test a provider's connectivity via testAiProvider.
 * Writes result server-side; returns { ok, latencyMs, status, error? }
 */
export async function testProvider(providerId) {
  return postJSON('testAiProvider', { providerId });
}

/**
 * Sync tools from an MCP server via syncMcpTools.
 * Writes tool list server-side; returns { ok, tools }
 */
export async function syncMcpTools(serverId) {
  return postJSON('syncMcpTools', { serverId });
}

/**
 * Call an MCP tool via mcpProxy.
 * @returns {{ ok, result: string, raw: any }}
 */
export async function mcpTool(serverId, tool, toolArguments = {}) {
  return postJSON('mcpProxy', { serverId, tool, arguments: toolArguments });
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage stats
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch usage records. Returns last `limitN` records ordered by timestamp desc. */
export async function getUsageRecords(limitN = 100, startAfterDate = null) {
  const params = new URLSearchParams({ limit: String(limitN) });
  if (startAfterDate) {
    const since = startAfterDate instanceof Date ? startAfterDate.toISOString() : startAfterDate;
    params.set('since', since);
  }
  const res = await getJSON(`cms/ai-usage?${params.toString()}`);
  return res.items || [];
}

/** Aggregate usage by provider. Returns { provider: { tokens, costUsd, calls } } */
export function aggregateByProvider(records) {
  const agg = {};
  for (const r of records) {
    if (!agg[r.provider]) agg[r.provider] = { tokens: 0, costUsd: 0, calls: 0 };
    agg[r.provider].tokens += r.totalTokens || 0;
    agg[r.provider].costUsd += r.estimatedCostUsd || 0;
    agg[r.provider].calls += 1;
  }
  return agg;
}

// Named export bundle for convenience
export const aiEngine = {
  chat,
  testProvider,
  syncMcpTools,
  mcpTool,
  seedAiEngineIfEmpty,
  subscribeProviders,
  subscribeMcpServers,
  setEnabled,
  setProviderModel,
  setMcpOAuthToken,
  addMcpServer,
  removeMcpServer,
  getUsageRecords,
  aggregateByProvider,
};

export default aiEngine;
