/**
 * model-catalog.js — the model catalogue document and its refresh (ADR 0034
 * slice 2, #857).
 *
 * Every model the site may select, per provider, populated from each
 * provider's own list endpoint and enriched from a code table keyed by id
 * pattern. Until this the lists were typed into the frontend seed, so a new
 * deployment, a retired id or a price change was a pull request, and the
 * card could offer a model the provider had stopped serving.
 *
 * WHERE IT LIVES. ADR 0034 §1 names `admin_config/ai-model-catalog`; the
 * document is written to `admin_settings` (SETTINGS_CONTAINER) instead,
 * beside `ai-features` and `ai-routing`, the two AI documents it is read
 * with. `admin_config` is partitioned on a constant for the forge's
 * transactional batch (cosmos-client.js) and holds nothing the AI code
 * reads; one container for the AI settings is one partition rule to get
 * right.
 *
 * THREE RULES, EACH A REVIEW FINDING ON THE ADR.
 *
 *   A FAILED LIST CHANGES NO MODEL. A provider that cannot be listed — a
 *   timeout, a 401, a malformed answer — records `refresh.lastError` and
 *   `lastAttempt` and keeps every model exactly as it was. `lastOk` moves
 *   only on success, and the page derives `stale` from its age, so an
 *   outage reads as "the list is old", never as "every model retired".
 *
 *   RETIRED TAKES TWO MISSES. A model absent from one successful list has
 *   `missed` incremented; absent from a second consecutive one it becomes
 *   `retired`. One list that omits a model by accident (a provider's paging
 *   hiccup, a deployment mid-update) is not a retirement. A model seen again
 *   is `live` with `missed` back at zero.
 *
 *   HIDDEN IS THE ADMINISTRATOR'S. A refresh never reads or writes `hidden`;
 *   only the PATCH route does. A model hidden on the card stays hidden
 *   through every refresh, live or retired.
 *
 * Enrichment never trusts a provider's free text: capabilities, context and
 * pricing come from ENRICHMENT_TABLE and COST_TABLE, both code. A model
 * with no table row is `['text']` and unpriced, and an unpriced model is
 * badged on the card and never recommended (ADR 0034 §2).
 */
import {
  COST_TABLE,
  DEFAULT_MODEL_TABLE,
  KEY_ENV,
  NVIDIA_BASE_URL,
  PROVIDERS,
  createFoundryTokenProvider,
  defaultGetToken,
  foundryBaseUrl,
  foundryTokenScope,
  readKey,
} from './router.js';
import { SETTINGS_CONTAINER } from './ai-config.js';
import { CAPABILITIES, MODALITIES } from './tasks.js';

export const CATALOG_DOC_ID = 'ai-model-catalog';
export const CATALOG_SCHEMA_VERSION = 1;
export const MODEL_STATUSES = Object.freeze(['live', 'retired', 'unknown']);
/** Consecutive successful lists without a model before it is retired. */
export const RETIRE_AFTER_MISSED = 2;
/** The refresh is weekly; a `lastOk` older than this is `stale` at read time. */
export const STALE_AFTER_MS = 8 * 24 * 60 * 60 * 1000;
/** One list call's limit; a provider that takes longer records a timeout. */
export const LIST_TIMEOUT_MS = 20_000;
/** Pages followed per provider; Anthropic pages at 100 and Gemini at 1000. */
const MAX_PAGES = 20;

// ── enrichment ───────────────────────────────────────────────────────────────

const TEXT_JSON = Object.freeze(['text', 'json']);
const TEXT_JSON_VISION = Object.freeze(['text', 'json', 'vision']);

/**
 * Capabilities and context by id pattern, first match wins. Small and
 * honest: a context is written only where the provider publishes one for
 * the family, and a model that is not a chat model (speech, audio,
 * transcription, image generation, embeddings, moderation) carries no
 * capability at all until slice 5 names the audio and image modalities.
 * Pricing is never here; COST_TABLE prices, and a model it lacks is unpriced.
 *
 * `modality` is the kind of answer the model is listed for, in the task
 * registry's vocabulary (tasks.js MODALITIES); null for a model whose
 * modality that registry does not name yet.
 */
export const ENRICHMENT_TABLE = Object.freeze([
  {
    pattern: /(^|[-/])(tts|audio|realtime|transcribe|whisper|embedding|embed|moderation|image|imagen|veo|dall-e)([-/.]|$)/i,
    capabilities: [],
    modality: null,
    context: null,
  },
  // Gemini: every generateContent model reads images and returns JSON; the
  // Interactions API grounds on pages and YouTube (router.js header).
  { pattern: /^gemini-/, capabilities: ['text', 'json', 'vision', 'grounding'], modality: 'text', context: 1_048_576 },
  { pattern: /^gpt-5/, capabilities: TEXT_JSON_VISION, modality: 'text', context: 400_000 },
  { pattern: /^gpt-4\.1/, capabilities: TEXT_JSON_VISION, modality: 'text', context: 1_047_576 },
  { pattern: /^gpt-4/, capabilities: TEXT_JSON_VISION, modality: 'text', context: 128_000 },
  { pattern: /^o\d/, capabilities: TEXT_JSON, modality: 'text', context: 200_000 },
  { pattern: /^claude-/, capabilities: TEXT_JSON_VISION, modality: 'text', context: 200_000 },
  // NVIDIA's catalogue ids are `<org>/<model>`; context is not published
  // per trial-tier model, so it stays null rather than guessed.
  { pattern: /^z-ai\/glm-/, capabilities: TEXT_JSON, modality: 'text', context: null },
  { pattern: /^(deepseek-ai\/)?deepseek-/, capabilities: TEXT_JSON, modality: 'text', context: null },
]);

/** The row for a model no pattern names: text only, unpriced (ADR 0034 §2). */
export const DEFAULT_ENRICHMENT = Object.freeze({
  capabilities: Object.freeze(['text']),
  modality: 'text',
  context: null,
});

/** `{ inputPer1M, outputPer1M }` from the cost table's own row, or null. */
export function pricingFor(provider, id) {
  const rates = COST_TABLE[provider];
  if (!rates || !Object.hasOwn(rates, id) || !Array.isArray(rates[id])) return null;
  const [inputPer1M, outputPer1M] = rates[id];
  return { inputPer1M, outputPer1M };
}

/**
 * What the code knows about a model: capabilities, modality and context from
 * ENRICHMENT_TABLE, pricing from COST_TABLE. `unpriced` is the badge the
 * card shows and the recommendation rule reads.
 */
export function enrichModel(provider, id) {
  const row = ENRICHMENT_TABLE.find(({ pattern }) => pattern.test(id)) || DEFAULT_ENRICHMENT;
  const pricing = pricingFor(provider, id);
  return {
    capabilities: [...row.capabilities],
    modality: row.modality,
    context: row.context,
    pricing,
    unpriced: pricing === null,
  };
}

/** The models the router's own table names for a provider, in table order, unique. */
export function seedModelsFor(provider) {
  const purposes = DEFAULT_MODEL_TABLE[provider];
  if (!purposes) return [];
  return [...new Set(Object.values(purposes).map(([, model]) => model))];
}

// ── list adapters ────────────────────────────────────────────────────────────

/** Upstream text, shortened: the error line names the status, not the body. */
function shortDetail(data, text) {
  const message = data?.error?.message || data?.message || (typeof text === 'string' ? text : '');
  return String(message || '')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
}

async function getJson(fetchImpl, url, headers, timeoutMs) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const detail = shortDetail(data, text);
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  if (data === null || typeof data !== 'object') {
    throw new Error('List answer was not JSON');
  }
  return data;
}

const idsOf = (rows) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => (typeof row?.id === 'string' ? row.id.trim() : ''))
    .filter(Boolean);

async function listOpenAiCompatible(ctx, url, headers) {
  const data = await getJson(ctx.fetchImpl, url, headers, ctx.timeoutMs);
  return idsOf(data.data);
}

const LISTERS = {
  openai: (ctx) =>
    listOpenAiCompatible(ctx, 'https://api.openai.com/v1/models', {
      Authorization: `Bearer ${readKey(ctx.env, KEY_ENV.openai)}`,
    }),
  nvidia: (ctx) =>
    listOpenAiCompatible(ctx, `${NVIDIA_BASE_URL}/models`, {
      Authorization: `Bearer ${readKey(ctx.env, KEY_ENV.nvidia)}`,
    }),
  foundry: async (ctx) => {
    // The same two ways in as the chat call (router.js openAiCompatibleTable):
    // a local FOUNDRY_API_KEY on a workstation, else the app identity's token.
    const local = readKey(ctx.env, 'FOUNDRY_API_KEY');
    const headers = local
      ? { 'api-key': local }
      : { Authorization: `Bearer ${await ctx.foundryToken()}` };
    return listOpenAiCompatible(ctx, `${foundryBaseUrl(ctx.env)}/openai/v1/models`, headers);
  },
  anthropic: async (ctx) => {
    const headers = {
      'x-api-key': readKey(ctx.env, KEY_ENV.anthropic),
      'anthropic-version': '2023-06-01',
    };
    const ids = [];
    let afterId = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL('https://api.anthropic.com/v1/models');
      url.searchParams.set('limit', '100');
      if (afterId) url.searchParams.set('after_id', afterId);
      const data = await getJson(ctx.fetchImpl, url.toString(), headers, ctx.timeoutMs);
      ids.push(...idsOf(data.data));
      if (!data.has_more || !data.last_id) break;
      afterId = data.last_id;
    }
    return ids;
  },
  gemini: async (ctx) => {
    const headers = { 'x-goog-api-key': readKey(ctx.env, KEY_ENV.gemini) };
    const ids = [];
    let pageToken = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const data = await getJson(ctx.fetchImpl, url.toString(), headers, ctx.timeoutMs);
      ids.push(...geminiChatIdsOf(data.models));
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
    return ids;
  },
};

/**
 * One Gemini page's chat-capable ids: `models/<id>` entries whose
 * `supportedGenerationMethods` include `generateContent`; embedding and
 * image-only models (which the list also returns) are left out.
 */
function geminiChatIdsOf(models) {
  const chatCapable = (model) =>
    Array.isArray(model?.supportedGenerationMethods) &&
    model.supportedGenerationMethods.includes('generateContent');
  return (Array.isArray(models) ? models : [])
    .filter(chatCapable)
    .map((model) => (typeof model?.name === 'string' ? model.name : ''))
    .map((name) => name.replace(/^models\//, '').trim())
    .filter(Boolean);
}

/**
 * The context `listModels` reads: the environment, a fetch, and the Foundry
 * token source. Production builds it with no arguments; a test hands in
 * `fetchImpl` and never touches the network.
 *
 * @param {object} [options]
 * @param {object} [options.env]
 * @param {Function} [options.fetchImpl]
 * @param {() => Promise<string>} [options.foundryToken]
 * @param {number} [options.timeoutMs]
 */
export function createListContext({
  env = process.env,
  fetchImpl = globalThis.fetch,
  foundryToken,
  timeoutMs = LIST_TIMEOUT_MS,
} = {}) {
  return {
    env,
    fetchImpl,
    timeoutMs,
    foundryToken:
      foundryToken ||
      createFoundryTokenProvider({ getToken: defaultGetToken, scope: foundryTokenScope(env) }),
  };
}

/**
 * The model ids a provider serves today, from its own list endpoint, unique
 * and in the provider's order. `null` when the provider has no key (or, for
 * Foundry, no endpoint): that is "not configured", not a failure, and the
 * refresh skips it. Throws on any other failure, with a message that names
 * the status and never the key.
 *
 * @param {ReturnType<typeof createListContext>} ctx
 * @param {string} provider
 * @returns {Promise<string[] | null>}
 */
export async function listModels(ctx, provider) {
  const lister = LISTERS[provider];
  if (!lister) throw new Error(`Unknown AI provider: ${provider}`);
  if (!readKey(ctx.env, KEY_ENV[provider])) return null;
  const ids = await lister(ctx);
  return [...new Set(ids)];
}

// ── the document ─────────────────────────────────────────────────────────────

const emptyRefresh = () => ({ lastOk: null, lastAttempt: null, lastError: null });

function emptyDoc() {
  return {
    id: CATALOG_DOC_ID,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    updatedAt: null,
    providers: {},
  };
}

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** One stored model entry, every field present and typed, enrichment re-applied. */
function normalizeModel(provider, id, stored) {
  const base = isPlainObject(stored) ? stored : {};
  return {
    id,
    status: MODEL_STATUSES.includes(base.status) ? base.status : 'unknown',
    firstSeen: typeof base.firstSeen === 'string' ? base.firstSeen : null,
    lastSeen: typeof base.lastSeen === 'string' ? base.lastSeen : null,
    missed: Number.isInteger(base.missed) && base.missed >= 0 ? base.missed : 0,
    hidden: base.hidden === true,
    ...enrichModel(provider, id),
  };
}

/** One provider's entry as stored, or an empty one. */
function normalizeProvider(provider, stored) {
  const base = isPlainObject(stored) ? stored : {};
  const refresh = isPlainObject(base.refresh) ? base.refresh : {};
  const models = {};
  for (const [id, model] of Object.entries(isPlainObject(base.models) ? base.models : {})) {
    models[id] = normalizeModel(provider, id, model);
  }
  return {
    refresh: {
      lastOk: typeof refresh.lastOk === 'string' ? refresh.lastOk : null,
      lastAttempt: typeof refresh.lastAttempt === 'string' ? refresh.lastAttempt : null,
      lastError: typeof refresh.lastError === 'string' ? refresh.lastError : null,
    },
    models,
  };
}

/** The stored document with every present provider normalised; providers are never dropped. */
function normalizeDoc(stored) {
  const doc = emptyDoc();
  if (!isPlainObject(stored)) return doc;
  doc.updatedAt = typeof stored.updatedAt === 'string' ? stored.updatedAt : null;
  for (const [provider, entry] of Object.entries(
    isPlainObject(stored.providers) ? stored.providers : {}
  )) {
    doc.providers[provider] = normalizeProvider(provider, entry);
  }
  return doc;
}

/** A never-listed model in a provider's entry: `unknown` until a list confirms it. */
function unknownModel(provider, id) {
  return {
    id,
    status: 'unknown',
    firstSeen: null,
    lastSeen: null,
    missed: 0,
    hidden: false,
    ...enrichModel(provider, id),
  };
}

/**
 * The provider's entry before its first refresh: the router's own defaults
 * as `unknown` models, so the card has a list on day one. In memory only;
 * nothing is written until a refresh or a hide.
 */
export function seedProviderEntry(provider) {
  return {
    refresh: emptyRefresh(),
    models: Object.fromEntries(seedModelsFor(provider).map((id) => [id, unknownModel(provider, id)])),
  };
}

/** Apply one successful list to a provider's entry (mutates); returns the counts. */
function applyListing(provider, entry, ids, nowIso) {
  const seen = new Set(ids);
  let added = 0;
  let retired = 0;
  for (const id of ids) {
    const existing = entry.models[id];
    if (!existing) {
      entry.models[id] = { ...unknownModel(provider, id), firstSeen: nowIso };
      added += 1;
    }
    const model = entry.models[id];
    model.status = 'live';
    model.lastSeen = nowIso;
    model.missed = 0;
  }
  for (const model of Object.values(entry.models)) {
    if (seen.has(model.id) || model.status === 'retired') continue;
    model.missed += 1;
    if (model.missed >= RETIRE_AFTER_MISSED) {
      model.status = 'retired';
      retired += 1;
    }
  }
  entry.refresh.lastOk = nowIso;
  entry.refresh.lastError = null;
  return { listed: ids.length, added, retired, error: null };
}

/**
 * List every provider and write the document. One provider's failure is a
 * line in its `refresh` and in the summary; the others still refresh. Only a
 * store that cannot be read or written throws.
 *
 * @param {object} deps
 * @param {{ readDoc: Function, upsertDoc: Function }} deps.store
 * @param {string[]} deps.providers   the providers with a key (ai.availableProviders())
 * @param {(provider: string) => Promise<string[] | null>} deps.listModels
 * @param {() => Date} [deps.now]
 * @returns {Promise<{ updatedAt: string, providers: Record<string, object> }>}
 */
export async function refreshModelCatalog({ store, providers, listModels: list, now = () => new Date() }) {
  const nowIso = now().toISOString();
  const stored = await store.readDoc(SETTINGS_CONTAINER, CATALOG_DOC_ID, CATALOG_DOC_ID);
  const doc = normalizeDoc(stored);
  const summary = {};

  for (const provider of providers) {
    if (!PROVIDERS.includes(provider)) continue;
    const entry = doc.providers[provider] || { refresh: emptyRefresh(), models: {} };
    let ids;
    try {
      ids = await list(provider);
    } catch (error) {
      doc.providers[provider] = entry;
      entry.refresh.lastAttempt = nowIso;
      entry.refresh.lastError = String(error?.message || error);
      summary[provider] = { listed: 0, added: 0, retired: 0, error: entry.refresh.lastError };
      continue;
    }
    if (ids === null) {
      summary[provider] = { skipped: true };
      continue;
    }
    doc.providers[provider] = entry;
    entry.refresh.lastAttempt = nowIso;
    summary[provider] = applyListing(provider, entry, ids, nowIso);
  }

  doc.updatedAt = nowIso;
  await store.upsertDoc(SETTINGS_CONTAINER, doc);
  return { updatedAt: nowIso, providers: summary };
}

/** True when the provider's last successful list is missing or older than STALE_AFTER_MS. */
export function isStale(refresh, now = new Date()) {
  const lastOk = refresh?.lastOk ? new Date(refresh.lastOk).getTime() : NaN;
  if (!Number.isFinite(lastOk)) return true;
  return now.getTime() - lastOk > STALE_AFTER_MS;
}

/**
 * The document as the page reads it: every provider the router implements,
 * `stale` derived from `lastOk` at read time, and a provider with no entry
 * yet seeded in memory from the router's defaults so the card has a list
 * before the first refresh (`seeded: true`, nothing written).
 *
 * @param {object} deps
 * @param {{ readDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 */
export async function readModelCatalog({ store, now = () => new Date() }) {
  const stored = await store.readDoc(SETTINGS_CONTAINER, CATALOG_DOC_ID, CATALOG_DOC_ID);
  const doc = normalizeDoc(stored);
  const at = now();
  const providers = {};
  for (const provider of PROVIDERS) {
    const entry = doc.providers[provider];
    const seeded = !entry;
    const resolved = entry || seedProviderEntry(provider);
    providers[provider] = {
      ...resolved,
      stale: isStale(resolved.refresh, at),
      seeded,
    };
  }
  return {
    id: CATALOG_DOC_ID,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    updatedAt: doc.updatedAt,
    providers,
  };
}

/**
 * Set `hidden` on one model and write the document. A model the catalogue
 * has never listed but the router's table names is materialised as
 * `unknown` so it can be hidden before the first refresh; any other id is
 * not found. Returns the model entry, or null when not found.
 *
 * @param {object} deps
 * @param {{ readDoc: Function, upsertDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {{ provider: string, model: string, hidden: boolean }} change
 */
export async function setModelHidden({ store, now = () => new Date() }, { provider, model, hidden }) {
  const stored = await store.readDoc(SETTINGS_CONTAINER, CATALOG_DOC_ID, CATALOG_DOC_ID);
  const doc = normalizeDoc(stored);
  const entry = doc.providers[provider] || { refresh: emptyRefresh(), models: {} };
  if (!entry.models[model]) {
    if (!seedModelsFor(provider).includes(model)) return null;
    entry.models[model] = unknownModel(provider, model);
  }
  entry.models[model].hidden = hidden === true;
  doc.providers[provider] = entry;
  doc.updatedAt = now().toISOString();
  await store.upsertDoc(SETTINGS_CONTAINER, doc);
  return entry.models[model];
}

/**
 * The ids a card may offer for a provider: live or unknown, not hidden, in a
 * stable order — live first, then by id. Reads the document shape
 * `readModelCatalog` returns; the frontend carries the same rule
 * (frontend/src/lib/aiEngine/catalog.js) and aiEngine.test.js holds the two
 * equal.
 */
export function visibleModelsFor(catalog, provider) {
  const models = catalog?.providers?.[provider]?.models;
  if (!isPlainObject(models)) return [];
  const rank = (status) => (status === 'live' ? 0 : 1);
  return Object.values(models)
    .filter((m) => (m.status === 'live' || m.status === 'unknown') && m.hidden !== true)
    .sort((a, b) => rank(a.status) - rank(b.status) || a.id.localeCompare(b.id))
    .map((m) => m.id);
}

/** The vocabularies the enrichment table must stay inside; pinned by model-catalog.test.js. */
export const ENRICHMENT_VOCABULARY = Object.freeze({ CAPABILITIES, MODALITIES });
