/**
 * AI Engine — browser client library
 *
 * Provides a unified interface for:
 *   • Calling any configured AI provider (via the Azure aiProxy RPC)
 *   • Calling MCP server tools (via the Azure mcpProxy RPC)
 *   • Reading/writing provider and server configs via cms/config/*
 *
 * All calls are authenticated with the current user's Entra access token and
 * terminate at the Azure Functions API.
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

/**
 * Bumped when the seed takes ownership of a field back from whatever is stored.
 * Version 2 (2026-08-23) reclaims `enabled`, `order` and `apiKeyEnvVar`, which
 * were written by a UI the API never read. See seedAiEngineIfEmpty.
 */
export const PROVIDER_SCHEMA_VERSION = 2;

/**
 * The text providers the API actually implements, in default preference order.
 *
 * THIS LIST USED TO BE FICTION. It was carried over from Site-Main unchanged and
 * described a platform that no longer existed: Vertex was listed `enabled: true`
 * though the router dropped it at the port (Vertex authenticates with GCP
 * Application Default Credentials, which a Function App cannot hold); OpenAI was
 * in DEPRECATED_PROVIDERS and deleted on sight though the router calls it; and
 * Perplexity, Bedrock and Replicate were offered though nothing routes text to
 * them. Reading this page told you the opposite of what the API would do.
 *
 * It is now the same three providers as `functions/src/lib/ai/router.js`, in the
 * same order, and `aiEngine.test.js` fails if the two lists diverge.
 *
 * Order is cost, not quality — see DEFAULT_PROVIDER_ORDER in ai-config.js. These
 * are seed values only: `order` and `enabled` are the administrator's to change
 * from this page, and the API honours both on every call.
 *
 * Replicate has NOT gone away — it generates article cover images, reached
 * directly through REPLICATE_API_KEY. It was never a text provider, and listing
 * it as one is what made this page confusing.
 */
export const DEFAULT_PROVIDERS = [
  {
    id: 'gemini',
    name: 'Gemini (Google AI)',
    description: 'Gemini 3.6 Flash, 3.5 Flash-Lite, 2.5 Pro — lowest cost per token',
    icon: '🔵',
    enabled: true,
    defaultModel: 'gemini-3.5-flash-lite',
    models: [
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    apiKeyEnvVar: 'GEMINI_API_KEY',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    status: 'untested',
    order: 1,
    schemaVersion: PROVIDER_SCHEMA_VERSION,
    notes:
      'Public Generative Language API, not Vertex. Seed GEMINI-API-KEY in Key Vault; until then the API falls through to the next provider.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-5 mini and nano',
    icon: '🟢',
    enabled: true,
    defaultModel: 'gpt-5-mini',
    models: ['gpt-5-mini', 'gpt-5-nano', 'gpt-4o', 'gpt-4o-mini'],
    apiKeyEnvVar: 'OPENAI_API_KEY',
    docsUrl: 'https://platform.openai.com/docs',
    status: 'untested',
    order: 2,
    schemaVersion: PROVIDER_SCHEMA_VERSION,
    notes:
      'Seed OPENAI-API-KEY in Key Vault. gpt-5 rates are not in the cost table yet, so usage totals fall back to gpt-4o pricing.',
  },
  {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    description: 'Claude Opus 4.6, Sonnet 4.6, Haiku 4.5',
    icon: '🟣',
    enabled: true,
    defaultModel: 'claude-sonnet-4-6',
    models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    docsUrl: 'https://docs.anthropic.com',
    status: 'untested',
    order: 3,
    schemaVersion: PROVIDER_SCHEMA_VERSION,
    notes: 'Seed ANTHROPIC-API-KEY in Key Vault. Highest cost per token of the three.',
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
      'OAuth auth. To connect: go to the Recordings page → Connect tab, follow the OAuth flow, and paste your access token. Token is stored server-side in Cosmos DB — never in the browser. Docs: https://docs.plaud.ai/documentation/plaud_app/mcp',
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
// Realtime config listeners use fetch-plus-notify:
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
  //
  // `openai` used to be on this list and was deleted from the container on every
  // admin page load, while the API called it happily. The four ids here are the
  // real removals: none is reachable through the AI router, so their documents
  // govern nothing — verified against the backend, which reads `ai_providers` in
  // exactly one place (lib/ai/ai-config.js) and looks up only providers the
  // router implements.
  //
  // `vertex` in particular cannot be made to work from a Function App at all: it
  // authenticates with GCP Application Default Credentials. Gemini is reached
  // through the public API instead, as the `gemini` provider above.
  const DEPRECATED_PROVIDERS = ['vertex', 'perplexity', 'bedrock', 'replicate'];
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

  // ONE-TIME RESET OF enabled/order ON PROVIDERS THAT ALREADY EXIST.
  //
  // Documents written before PROVIDER_SCHEMA_VERSION 2 hold values that never
  // meant anything: until 2026-08-23 the API read providers from environment
  // variables alone and never opened this container, so every switch and every
  // order field on this page was decorative. The stored `anthropic` document,
  // for instance, says `enabled: false` while Claude was in fact serving every
  // request as the first-choice provider.
  //
  // There is therefore no administrator intent to preserve in those fields, and
  // carrying them forward would land the new, working UI with Claude switched
  // off and a stale order — which reads as a broken feature rather than a
  // migrated one. The version marker is what keeps this a migration rather than
  // a reset: once stamped, real choices made through the UI are never touched
  // again. Fields the seed does not own (defaultModel, status, notes) are left
  // alone even on the first pass.
  for (const existing of providers) {
    const seed = DEFAULT_PROVIDERS.find((p) => p.id === existing.id);
    if (!seed || existing.schemaVersion >= PROVIDER_SCHEMA_VERSION) continue;
    writes.push(
      patchConfig('ai-providers', existing.id, {
        enabled: seed.enabled,
        order: seed.order,
        apiKeyEnvVar: seed.apiKeyEnvVar,
        schemaVersion: PROVIDER_SCHEMA_VERSION,
      })
    );
  }

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
// Azure Function calls
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

// ─────────────────────────────────────────────────────────────────────────────
// Preference order and feature switches
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist a new preference order.
 *
 * Rewrites `order` on every provider from its position in `orderedIds`, rather
 * than patching the two that moved. Contiguous 1..n values mean the API never
 * has to break a tie, and a tie is the one case where the active provider could
 * look non-deterministic between Function App instances.
 */
export async function setProviderOrder(orderedIds) {
  await Promise.all(
    orderedIds.map((id, index) =>
      sendJSON(`cms/config/ai-providers/${id}`, 'PATCH', { order: index + 1 })
    )
  );
  await notifyConfigSubscribers('ai-providers');
}

/**
 * Which parts of the site may call a model.
 *
 * Returns `{ features, catalogue }`. The catalogue is the API's own list — the
 * page renders its toggles from it rather than from a copy kept here, because a
 * second copy of a list like this is exactly how DEFAULT_PROVIDERS came to
 * describe a platform that no longer existed.
 */
export async function getAiFeatures() {
  const res = await getJSON('cms/ai-features');
  return { features: res.features || {}, catalogue: res.catalogue || {} };
}

/** Turn one feature on or off. Merges server-side; other features are untouched. */
export async function setAiFeature(name, enabled) {
  const res = await sendJSON('cms/ai-features', 'PUT', { features: { [name]: enabled } });
  return res.features || {};
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
  setProviderOrder,
  getAiFeatures,
  setAiFeature,
  setMcpOAuthToken,
  addMcpServer,
  removeMcpServer,
  getUsageRecords,
  aggregateByProvider,
};

export default aiEngine;
