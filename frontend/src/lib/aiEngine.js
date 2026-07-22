/**
 * AI Engine — browser client library
 *
 * Provides a unified interface for:
 *   • Calling any configured AI provider (via aiProxy Cloud Function)
 *   • Calling MCP server tools (via mcpProxy Cloud Function)
 *   • Reading/writing provider and server configs from Firestore
 *
 * All calls are authenticated with the current user's Firebase ID token.
 *
 * Usage:
 *   import { aiEngine } from '@/lib/aiEngine';
 *   const { text } = await aiEngine.chat('anthropic', 'claude-sonnet-4-6', 'Hello!');
 *   const result    = await aiEngine.mcpTool('brave-search', 'brave_web_search', { query: 'test' });
 */

import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  where,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore';
import { postJSON } from '@/lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Default provider & MCP server seed data
// Written to Firestore on first admin page load if collections are empty.
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

/** Seed Firestore if either collection is empty.
 *  Also deletes deprecated provider/server docs and patches stale URLs.
 *  Called once on admin page load.
 */
export async function seedAiEngineIfEmpty() {
  const db = getFirestore();

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

  const [providersSnap, serversSnap] = await Promise.all([
    getDocs(collection(db, 'ai_providers')),
    getDocs(collection(db, 'mcp_servers')),
  ]);

  const writes = [];

  // ─ AI Providers ───────────────────────────────────────────────
  if (providersSnap.empty) {
    DEFAULT_PROVIDERS.forEach((p) => {
      writes.push(setDoc(doc(db, 'ai_providers', p.id), { ...p, createdAt: serverTimestamp() }));
    });
  } else {
    const existingIds = new Set(providersSnap.docs.map((d) => d.id));
    // Delete deprecated providers
    for (const id of DEPRECATED_PROVIDERS) {
      if (existingIds.has(id)) {
        writes.push(deleteDoc(doc(db, 'ai_providers', id)));
      }
    }
    // Seed any new providers that don't exist yet
    DEFAULT_PROVIDERS.forEach((p) => {
      if (!existingIds.has(p.id)) {
        writes.push(setDoc(doc(db, 'ai_providers', p.id), { ...p, createdAt: serverTimestamp() }));
      }
    });
  }

  // ─ MCP Servers ───────────────────────────────────────────────
  if (serversSnap.empty) {
    DEFAULT_MCP_SERVERS.forEach((s) => {
      writes.push(setDoc(doc(db, 'mcp_servers', s.id), { ...s, createdAt: serverTimestamp() }));
    });
  } else {
    const existingIds = new Set(serversSnap.docs.map((d) => d.id));
    // Delete deprecated servers
    for (const id of DEPRECATED_MCP_SERVERS) {
      if (existingIds.has(id)) {
        writes.push(deleteDoc(doc(db, 'mcp_servers', id)));
      }
    }
    // Seed any new servers that don't exist yet
    DEFAULT_MCP_SERVERS.forEach((s) => {
      if (!existingIds.has(s.id)) {
        writes.push(setDoc(doc(db, 'mcp_servers', s.id), { ...s, createdAt: serverTimestamp() }));
      }
    });
    // Patch stale URLs in existing docs
    for (const serverDoc of serversSnap.docs) {
      const { id } = serverDoc;
      const data = serverDoc.data();
      const patch = {};
      if (MCP_URL_PATCHES[id] && data.url !== MCP_URL_PATCHES[id]) {
        patch.url = MCP_URL_PATCHES[id];
      }
      if (MCP_TRANSPORT_PATCHES[id] && data.transport !== MCP_TRANSPORT_PATCHES[id]) {
        patch.transport = MCP_TRANSPORT_PATCHES[id];
      }
      if (Object.keys(patch).length > 0) {
        writes.push(updateDoc(doc(db, 'mcp_servers', id), patch));
      }
    }
  }

  if (writes.length > 0) await Promise.all(writes);
}

/** Real-time listener on ai_providers, sorted by order. */
export function subscribeProviders(callback) {
  const db = getFirestore();
  return onSnapshot(query(collection(db, 'ai_providers'), orderBy('order', 'asc')), (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  );
}

/** Real-time listener on mcp_servers, sorted by order. */
export function subscribeMcpServers(callback) {
  const db = getFirestore();
  return onSnapshot(query(collection(db, 'mcp_servers'), orderBy('order', 'asc')), (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  );
}

/** Toggle enable flag on a provider or MCP server. */
export async function setEnabled(colName, docId, enabled) {
  const db = getFirestore();
  await updateDoc(doc(db, colName, docId), { enabled, updatedAt: serverTimestamp() });
}

/** Update the default model for a provider. */
export async function setProviderModel(providerId, model) {
  const db = getFirestore();
  await updateDoc(doc(db, 'ai_providers', providerId), {
    defaultModel: model,
    updatedAt: serverTimestamp(),
  });
}

/** Add a custom MCP server. */
export async function addMcpServer(data) {
  const db = getFirestore();
  const ref = doc(collection(db, 'mcp_servers'));
  await setDoc(ref, {
    ...data,
    id: ref.id,
    tools: [],
    status: 'untested',
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Store an OAuth access token for an MCP server (e.g. Plaud).
 * Written to the mcp_servers document — only readable server-side by mcpProxy.
 * The browser never reads this field back (Firestore rules block it if you set them up
 * to deny `oauthToken` field reads; for now it's admin-write only).
 */
export async function setMcpOAuthToken(serverId, oauthToken) {
  const db = getFirestore();
  await updateDoc(doc(db, 'mcp_servers', serverId), {
    oauthToken,
    status: 'untested', // force re-test after token update
    updatedAt: serverTimestamp(),
  });
}

/** Delete a custom MCP server (only non-seed servers). */
export async function removeMcpServer(serverId) {
  const db = getFirestore();
  await deleteDoc(doc(db, 'mcp_servers', serverId));
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
 * Writes result directly to Firestore; returns { ok, latencyMs, status, error? }
 */
export async function testProvider(providerId) {
  return postJSON('testAiProvider', { providerId });
}

/**
 * Sync tools from an MCP server via syncMcpTools.
 * Writes tool list to Firestore; returns { ok, tools }
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
  const db = getFirestore();
  const constraints = [orderBy('timestamp', 'desc'), limit(limitN)];
  if (startAfterDate) constraints.push(where('timestamp', '>=', startAfterDate));
  const snap = await getDocs(query(collection(db, 'ai_usage'), ...constraints));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
