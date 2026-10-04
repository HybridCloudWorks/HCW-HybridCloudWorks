/**
 * AI Engine — the default provider and MCP server documents, and the seed
 * that writes them through the config API on first admin page load.
 * Imported through `@/lib/aiEngine`, which re-exports it.
 */
import { sendJSON } from '@/lib/api';
import { fetchConfig, notifyConfigSubscribers } from './config';

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
 * It is now the same providers as `functions/src/lib/ai/router.js`, in the
 * same order, and `aiEngine.test.js` fails if the two lists diverge. The
 * fourth, NVIDIA (#701), is also placed per feature — see getAiFeatures.
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
  {
    // #701. Last in the global order on purpose: its real position is set
    // per feature under "Where AI is used" — the backup for owner-triggered
    // content unless placed first there (2026-09-29), never for the public
    // explain route.
    id: 'nvidia',
    name: 'NVIDIA API',
    description: 'GLM-5.3, DeepSeek-V4.1-Flash — free trial tier, ~40 requests a minute',
    icon: '🟩',
    enabled: true,
    // Unset on purpose: with no pin the router picks a model per purpose
    // (GLM-5.3 for drafts, DeepSeek-V4.1-Flash for analysis, GLM-5.3-Flash
    // for short calls). Choosing one here pins it for every purpose.
    defaultModel: null,
    models: ['z-ai/glm-5.3', 'z-ai/glm-5.3-flash', 'deepseek-ai/deepseek-v4.1-flash'],
    apiKeyEnvVar: 'NVIDIA_API_KEY',
    docsUrl: 'https://build.nvidia.com/models',
    status: 'untested',
    order: 4,
    schemaVersion: PROVIDER_SCHEMA_VERSION,
    notes:
      'Seed NVIDIA-API-KEY (an nvapi- key from build.nvidia.com/settings/api-keys). Free, so usage shows at $0. Trial terms and a ~40 requests/minute limit: the API paces itself and hands busy or failed calls to the next provider.',
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

/**
 * The provider fields the seed owns and keeps current: what the card is
 * called, the line under the name, and the icon. The page has no control to
 * edit any of them, so a stored value that differs from `DEFAULT_PROVIDERS` is
 * only ever an old copy of the seed. Seeding writes a document once, when it is
 * missing, and the card renders the stored document, so without this a rename
 * never reached the page: #701 renamed "NVIDIA API Catalog" to "NVIDIA API" on
 * 2026-09-29, and the card still said Catalog after the deploy.
 */
export const SEED_OWNED_PROVIDER_FIELDS = Object.freeze(['name', 'description', 'icon']);

/**
 * `[{ id, patch }]` bringing each stored provider's seed-owned fields back to
 * the seed. Providers the seed does not know are left alone; an empty list
 * means nothing to write.
 */
export function providerDisplayPatches(stored, defaults = DEFAULT_PROVIDERS) {
  return (stored || []).flatMap((existing) => {
    const seed = defaults.find((p) => p.id === existing?.id);
    if (!seed) return [];
    const patch = {};
    for (const field of SEED_OWNED_PROVIDER_FIELDS) {
      if (seed[field] !== undefined && existing[field] !== seed[field]) patch[field] = seed[field];
    }
    return Object.keys(patch).length ? [{ id: existing.id, patch }] : [];
  });
}

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

const putConfig = (route, id, data) => sendJSON(`cms/config/${route}/${id}`, 'PUT', data);
const patchConfig = (route, id, patch) => sendJSON(`cms/config/${route}/${id}`, 'PATCH', patch);
const deleteConfig = (route, id) => sendJSON(`cms/config/${route}/${id}`, 'DELETE');

/** Delete the deprecated documents of one collection and write the missing defaults. */
function seedCollectionWrites(route, stored, defaults, deprecated) {
  const ids = new Set(stored.map((doc) => doc.id));
  const writes = deprecated.filter((id) => ids.has(id)).map((id) => deleteConfig(route, id));
  defaults.forEach((doc) => {
    if (stored.length === 0 || !ids.has(doc.id)) writes.push(putConfig(route, doc.id, doc));
  });
  return writes;
}

/**
 * ONE-TIME RESET OF enabled/order ON PROVIDERS THAT ALREADY EXIST.
 *
 * Documents written before PROVIDER_SCHEMA_VERSION 2 hold values that never
 * meant anything: until 2026-08-23 the API read providers from environment
 * variables alone and never opened this container, so every switch and every
 * order field on this page was decorative. The stored `anthropic` document,
 * for instance, says `enabled: false` while Claude was in fact serving every
 * request as the first-choice provider.
 *
 * There is therefore no administrator intent to preserve in those fields, and
 * carrying them forward would land the new, working UI with Claude switched
 * off and a stale order — which reads as a broken feature rather than a
 * migrated one. The version marker is what keeps this a migration rather than
 * a reset: once stamped, real choices made through the UI are never touched
 * again. Fields the seed does not own (defaultModel, status, notes) are left
 * alone even on the first pass.
 */
function providerSchemaWrites(providers) {
  return providers.flatMap((existing) => {
    const seed = DEFAULT_PROVIDERS.find((p) => p.id === existing.id);
    if (!seed || existing.schemaVersion >= PROVIDER_SCHEMA_VERSION) return [];
    return [
      patchConfig('ai-providers', existing.id, {
        enabled: seed.enabled,
        order: seed.order,
        apiKeyEnvVar: seed.apiKeyEnvVar,
        schemaVersion: PROVIDER_SCHEMA_VERSION,
      }),
    ];
  });
}

/** The URL and transport a stored server should move to, if it has not. */
function serverEndpointPatch(server) {
  const patch = {};
  if (MCP_URL_PATCHES[server.id] && server.url !== MCP_URL_PATCHES[server.id]) {
    patch.url = MCP_URL_PATCHES[server.id];
  }
  if (MCP_TRANSPORT_PATCHES[server.id] && server.transport !== MCP_TRANSPORT_PATCHES[server.id]) {
    patch.transport = MCP_TRANSPORT_PATCHES[server.id];
  }
  return patch;
}

function serverEndpointWrites(servers) {
  return servers.flatMap((server) => {
    const patch = serverEndpointPatch(server);
    return Object.keys(patch).length > 0 ? [patchConfig('mcp-servers', server.id, patch)] : [];
  });
}

/** Seed the config collections if empty.
 *  Also deletes deprecated provider/server docs and patches stale URLs.
 *  Called once on admin page load.
 */
export async function seedAiEngineIfEmpty() {
  const [providers, servers] = await Promise.all([
    fetchConfig('ai-providers'),
    fetchConfig('mcp-servers'),
  ]);

  const writes = [
    // ─ AI Providers ───────────────────────────────────────────────
    ...seedCollectionWrites('ai-providers', providers, DEFAULT_PROVIDERS, DEPRECATED_PROVIDERS),
    ...providerSchemaWrites(providers),
    // Names, descriptions and icons follow the seed on every load, so a rename
    // in DEFAULT_PROVIDERS reaches the stored document the card renders.
    ...providerDisplayPatches(providers).map(({ id, patch }) =>
      patchConfig('ai-providers', id, patch)
    ),
    // ─ MCP Servers ───────────────────────────────────────────────
    ...seedCollectionWrites('mcp-servers', servers, DEFAULT_MCP_SERVERS, DEPRECATED_MCP_SERVERS),
    ...serverEndpointWrites(servers),
  ];

  if (writes.length > 0) {
    await Promise.all(writes);
    await Promise.all([
      notifyConfigSubscribers('ai-providers'),
      notifyConfigSubscribers('mcp-servers'),
    ]);
  }
}
