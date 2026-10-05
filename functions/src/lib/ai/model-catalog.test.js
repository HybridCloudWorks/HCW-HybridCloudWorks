/**
 * The model catalogue (ADR 0034 slice 2, #857): what the adapters read from
 * each list endpoint, the enrichment contract (every model priced or badged
 * unpriced, every capability from the registry's vocabulary), the retire
 * rule (two consecutive successful lists without a model), the
 * failed-refresh rule (no model changes; only `lastAttempt` and `lastError`
 * move), and the read rule (`stale` from `lastOk`, a seeded list before the
 * first refresh).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CATALOG_DOC_ID,
  ENRICHMENT_TABLE,
  RETIRE_AFTER_MISSED,
  STALE_AFTER_MS,
  createListContext,
  enrichModel,
  listModels,
  readModelCatalog,
  refreshModelCatalog,
  seedModelsFor,
  setModelHidden,
  visibleModelsFor,
} from './model-catalog.js';
import { COST_TABLE, DEFAULT_MODEL_TABLE, PROVIDERS, isPriced } from './router.js';
import { CAPABILITIES, MODALITIES } from './tasks.js';
import { RECOMMENDED_BY_MODALITY } from './provider-recommendations.js';

const T0 = new Date('2026-10-05T06:15:00.000Z');
const T1 = new Date('2026-10-12T06:15:00.000Z');
const T2 = new Date('2026-10-19T06:15:00.000Z');

const ENV = {
  OPENAI_API_KEY: 'sk-openai',
  GEMINI_API_KEY: 'g-key',
  ANTHROPIC_API_KEY: 'sk-ant',
  NVIDIA_API_KEY: 'nvapi-key',
  FOUNDRY_ENDPOINT: 'https://hcw.services.ai.azure.com/',
};

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

function makeStore(doc = null) {
  return {
    readDoc: vi.fn(async () => (doc ? structuredClone(doc) : null)),
    upsertDoc: vi.fn(async (_c, d) => d),
  };
}

const written = (store) => store.upsertDoc.mock.calls.at(-1)[1];

describe('enrichment', () => {
  it('every table row stays inside the registry vocabulary', () => {
    for (const row of ENRICHMENT_TABLE) {
      for (const cap of row.capabilities) expect(CAPABILITIES).toContain(cap);
      if (row.modality !== null) expect(MODALITIES).toContain(row.modality);
      expect(row.context === null || Number.isInteger(row.context)).toBe(true);
    }
  });

  it('prices from the cost table and badges the rest unpriced, never a default row', () => {
    expect(enrichModel('foundry', 'gpt-5-nano')).toMatchObject({
      capabilities: ['text', 'json', 'vision'],
      modality: 'text',
      context: 400_000,
      pricing: { inputPer1M: 0.05, outputPer1M: 0.4 },
      unpriced: false,
    });
    // The cost table has a `default` row for openai; it must not price an unknown id.
    expect(enrichModel('openai', 'gpt-5.5-ultra')).toMatchObject({ pricing: null, unpriced: true });
    // A model with no pattern is text only and unpriced (ADR 0034 §2).
    expect(enrichModel('openai', 'babbage-002')).toEqual({
      capabilities: ['text'],
      modality: 'text',
      context: null,
      pricing: null,
      unpriced: true,
    });
  });

  it('a model the cost table deliberately leaves at null is unpriced', () => {
    const nullRow = Object.entries(COST_TABLE).flatMap(([provider, rates]) =>
      Object.entries(rates)
        .filter(([, rate]) => rate === null)
        .map(([id]) => [provider, id])
    );
    for (const [provider, id] of nullRow) {
      expect(isPriced(provider, id)).toBe(false);
      expect(enrichModel(provider, id).unpriced).toBe(true);
    }
  });

  it('speech, audio, image and embedding ids carry no text capability', () => {
    for (const id of [
      'gemini-2.5-flash-preview-tts',
      'gpt-4o-realtime-preview',
      'gpt-4o-transcribe',
      'whisper-1',
      'text-embedding-3-small',
      'gemini-embedding-001',
      'dall-e-3',
      'imagen-4.0-generate-001',
    ]) {
      expect(enrichModel('openai', id).capabilities, id).toEqual([]);
    }
  });

  it('every model the router defaults to, and every recommendation, is priced', () => {
    for (const provider of PROVIDERS) {
      for (const id of seedModelsFor(provider)) {
        expect(enrichModel(provider, id).unpriced, `${provider}/${id}`).toBe(false);
      }
      for (const { model } of Object.values(RECOMMENDED_BY_MODALITY[provider] || {})) {
        expect(enrichModel(provider, model).unpriced, `${provider}/${model}`).toBe(false);
      }
    }
  });

  it('seedModelsFor is the unique models of the router table, in table order', () => {
    expect(seedModelsFor('foundry')).toEqual(['gpt-5-mini', 'gpt-5-nano']);
    expect(seedModelsFor('nvidia')).toEqual([
      ...new Set(Object.values(DEFAULT_MODEL_TABLE.nvidia).map(([, m]) => m)),
    ]);
    expect(seedModelsFor('vertex')).toEqual([]);
  });
});

describe('listModels', () => {
  it('OpenAI and NVIDIA: GET /models with the bearer key, data[].id', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { data: [{ id: 'gpt-5-mini' }, { id: 'gpt-5-mini' }, { id: 'whisper-1' }] })
    );
    const ctx = createListContext({ env: ENV, fetchImpl, foundryToken: async () => 'tok' });
    expect(await listModels(ctx, 'openai')).toEqual(['gpt-5-mini', 'whisper-1']);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer sk-openai' } })
    );
    await listModels(ctx, 'nvidia');
    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://integrate.api.nvidia.com/v1/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer nvapi-key' } })
    );
  });

  it('Anthropic: x-api-key and the version header, following has_more / last_id', async () => {
    const pages = [
      { data: [{ id: 'claude-sonnet-4-6' }], has_more: true, last_id: 'claude-sonnet-4-6' },
      { data: [{ id: 'claude-haiku-4-5' }], has_more: false, last_id: 'claude-haiku-4-5' },
    ];
    const fetchImpl = vi.fn(async () => jsonResponse(200, pages.shift()));
    const ctx = createListContext({ env: ENV, fetchImpl, foundryToken: async () => 'tok' });
    expect(await listModels(ctx, 'anthropic')).toEqual(['claude-sonnet-4-6', 'claude-haiku-4-5']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/models?limit=100');
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'https://api.anthropic.com/v1/models?limit=100&after_id=claude-sonnet-4-6'
    );
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({
      'x-api-key': 'sk-ant',
      'anthropic-version': '2023-06-01',
    });
  });

  it('Gemini: x-goog-api-key, generateContent models only, models/ stripped, pages followed', async () => {
    const pages = [
      {
        models: [
          { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
        ],
        nextPageToken: 'p2',
      },
      {
        models: [
          {
            name: 'models/gemini-3.5-flash-lite',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
        ],
      },
    ];
    const fetchImpl = vi.fn(async () => jsonResponse(200, pages.shift()));
    const ctx = createListContext({ env: ENV, fetchImpl, foundryToken: async () => 'tok' });
    expect(await listModels(ctx, 'gemini')).toEqual(['gemini-3.6-flash', 'gemini-3.5-flash-lite']);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000'
    );
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=p2'
    );
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ 'x-goog-api-key': 'g-key' });
  });

  it('Foundry: the endpoint without its trailing slash, the app identity bearer token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { data: [{ id: 'gpt-5-nano' }] }));
    const foundryToken = vi.fn(async () => 'entra-token');
    const ctx = createListContext({ env: ENV, fetchImpl, foundryToken });
    expect(await listModels(ctx, 'foundry')).toEqual(['gpt-5-nano']);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hcw.services.ai.azure.com/openai/v1/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer entra-token' } })
    );
    expect(foundryToken).toHaveBeenCalledTimes(1);
  });

  it('a provider with no key is skipped (null), never fetched', async () => {
    const fetchImpl = vi.fn();
    const ctx = createListContext({ env: {}, fetchImpl, foundryToken: async () => 'tok' });
    for (const provider of PROVIDERS) expect(await listModels(ctx, provider)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(listModels(ctx, 'vertex')).rejects.toThrow('Unknown AI provider: vertex');
  });

  it('a refused or malformed answer throws with the status, never the key', async () => {
    const ctx = (body, status = 401) =>
      createListContext({
        env: ENV,
        fetchImpl: vi.fn(async () => jsonResponse(status, body)),
        foundryToken: async () => 'tok',
      });
    await expect(
      listModels(ctx({ error: { message: 'Incorrect API key provided' } }), 'openai')
    ).rejects.toThrow('HTTP 401: Incorrect API key provided');
    await expect(listModels(ctx('<html>bad gateway</html>', 502), 'nvidia')).rejects.toThrow(
      'HTTP 502: <html>bad gateway</html>'
    );
    await expect(listModels(ctx('not json', 200), 'openai')).rejects.toThrow(
      'List answer was not JSON'
    );
    try {
      await listModels(ctx({ error: { message: 'nope' } }), 'openai');
    } catch (error) {
      expect(error.message).not.toContain('sk-openai');
    }
  });
});

describe('refreshModelCatalog', () => {
  const lists = (byProvider) => async (provider) => {
    const answer = byProvider[provider];
    if (answer instanceof Error) throw answer;
    return answer === undefined ? null : answer;
  };

  it('writes a first document: every listed model live, firstSeen and lastSeen now, enriched', async () => {
    const store = makeStore();
    const summary = await refreshModelCatalog({
      store,
      now: () => T0,
      providers: ['foundry', 'nvidia'],
      listModels: lists({ foundry: ['gpt-5-mini', 'gpt-5-nano'], nvidia: ['z-ai/glm-5.3'] }),
    });
    expect(store.readDoc).toHaveBeenCalledWith('admin_settings', CATALOG_DOC_ID, CATALOG_DOC_ID);
    const doc = written(store);
    expect(doc).toMatchObject({ id: CATALOG_DOC_ID, schemaVersion: 1, updatedAt: T0.toISOString() });
    expect(doc.providers.foundry.refresh).toEqual({
      lastOk: T0.toISOString(),
      lastAttempt: T0.toISOString(),
      lastError: null,
    });
    expect(doc.providers.foundry.models['gpt-5-nano']).toEqual({
      id: 'gpt-5-nano',
      status: 'live',
      firstSeen: T0.toISOString(),
      lastSeen: T0.toISOString(),
      missed: 0,
      hidden: false,
      capabilities: ['text', 'json', 'vision'],
      modality: 'text',
      context: 400_000,
      pricing: { inputPer1M: 0.05, outputPer1M: 0.4 },
      unpriced: false,
    });
    // NVIDIA ids carry a slash and are keys like any other.
    expect(doc.providers.nvidia.models['z-ai/glm-5.3'].status).toBe('live');
    expect(summary).toEqual({
      updatedAt: T0.toISOString(),
      providers: {
        foundry: { listed: 2, added: 2, retired: 0, error: null },
        nvidia: { listed: 1, added: 1, retired: 0, error: null },
      },
    });
  });

  it('retires a model only after two consecutive successful lists without it', async () => {
    const store = makeStore();
    const run = async (now, ids) => {
      store.readDoc.mockResolvedValueOnce(structuredClone(written(store)));
      return refreshModelCatalog({ store, now: () => now, providers: ['foundry'], listModels: lists({ foundry: ids }) });
    };
    await refreshModelCatalog({
      store,
      now: () => T0,
      providers: ['foundry'],
      listModels: lists({ foundry: ['gpt-5-mini', 'gpt-5-nano'] }),
    });

    const first = await run(T1, ['gpt-5-mini']);
    expect(first.providers.foundry).toEqual({ listed: 1, added: 0, retired: 0, error: null });
    expect(written(store).providers.foundry.models['gpt-5-nano']).toMatchObject({
      status: 'live',
      missed: 1,
      lastSeen: T0.toISOString(),
    });

    const second = await run(T2, ['gpt-5-mini']);
    expect(second.providers.foundry.retired).toBe(1);
    expect(written(store).providers.foundry.models['gpt-5-nano']).toMatchObject({
      status: 'retired',
      missed: RETIRE_AFTER_MISSED,
      lastSeen: T0.toISOString(),
    });
    expect(written(store).providers.foundry.models['gpt-5-mini']).toMatchObject({
      status: 'live',
      missed: 0,
      lastSeen: T2.toISOString(),
    });
  });

  it('a model seen again is live with missed back at zero, and a retired one returns the same way', async () => {
    const doc = {
      id: CATALOG_DOC_ID,
      providers: {
        foundry: {
          refresh: { lastOk: T0.toISOString(), lastAttempt: T0.toISOString(), lastError: null },
          models: {
            'gpt-5-nano': { id: 'gpt-5-nano', status: 'retired', missed: 2, firstSeen: T0.toISOString(), lastSeen: T0.toISOString(), hidden: true },
            'gpt-5-mini': { id: 'gpt-5-mini', status: 'live', missed: 1, firstSeen: T0.toISOString(), lastSeen: T0.toISOString(), hidden: false },
          },
        },
      },
    };
    const store = makeStore(doc);
    await refreshModelCatalog({
      store,
      now: () => T2,
      providers: ['foundry'],
      listModels: lists({ foundry: ['gpt-5-nano', 'gpt-5-mini'] }),
    });
    const models = written(store).providers.foundry.models;
    expect(models['gpt-5-nano']).toMatchObject({ status: 'live', missed: 0, lastSeen: T2.toISOString(), firstSeen: T0.toISOString() });
    expect(models['gpt-5-mini']).toMatchObject({ status: 'live', missed: 0 });
    // The administrator's hide survives the refresh.
    expect(models['gpt-5-nano'].hidden).toBe(true);
  });

  it('a failed list changes no model and records only lastAttempt and lastError (ADR 0034 finding 3)', async () => {
    const doc = {
      id: CATALOG_DOC_ID,
      updatedAt: T0.toISOString(),
      providers: {
        foundry: {
          refresh: { lastOk: T0.toISOString(), lastAttempt: T0.toISOString(), lastError: null },
          models: {
            'gpt-5-nano': { id: 'gpt-5-nano', status: 'live', missed: 1, firstSeen: T0.toISOString(), lastSeen: T0.toISOString(), hidden: false },
          },
        },
      },
    };
    const store = makeStore(doc);
    const summary = await refreshModelCatalog({
      store,
      now: () => T1,
      providers: ['foundry', 'gemini'],
      listModels: lists({ foundry: new Error('HTTP 401: token audience'), gemini: ['gemini-3.6-flash'] }),
    });
    const foundry = written(store).providers.foundry;
    expect(foundry.refresh).toEqual({
      lastOk: T0.toISOString(),
      lastAttempt: T1.toISOString(),
      lastError: 'HTTP 401: token audience',
    });
    expect(foundry.models['gpt-5-nano']).toMatchObject({ status: 'live', missed: 1, lastSeen: T0.toISOString() });
    // The provider that listed still refreshed.
    expect(written(store).providers.gemini.refresh.lastOk).toBe(T1.toISOString());
    expect(summary.providers).toEqual({
      foundry: { listed: 0, added: 0, retired: 0, error: 'HTTP 401: token audience' },
      gemini: { listed: 1, added: 1, retired: 0, error: null },
    });
  });

  it('a provider with no key is skipped: no entry, no attempt recorded', async () => {
    const store = makeStore();
    const summary = await refreshModelCatalog({
      store,
      now: () => T0,
      providers: ['openai', 'vertex'],
      listModels: lists({}),
    });
    expect(summary.providers).toEqual({ openai: { skipped: true } });
    expect(written(store).providers).toEqual({});
  });

  it('re-applies the enrichment to stored models, so a new cost row reaches the document', async () => {
    const doc = {
      id: CATALOG_DOC_ID,
      providers: {
        openai: {
          refresh: { lastOk: T0.toISOString(), lastAttempt: T0.toISOString(), lastError: null },
          models: {
            'gpt-5-mini': { id: 'gpt-5-mini', status: 'live', missed: 0, firstSeen: T0.toISOString(), lastSeen: T0.toISOString(), hidden: false, pricing: null, unpriced: true },
          },
        },
      },
    };
    const store = makeStore(doc);
    await refreshModelCatalog({ store, now: () => T1, providers: ['openai'], listModels: lists({ openai: ['gpt-5-mini'] }) });
    expect(written(store).providers.openai.models['gpt-5-mini']).toMatchObject({
      pricing: { inputPer1M: 0.25, outputPer1M: 2.0 },
      unpriced: false,
    });
  });
});

describe('readModelCatalog', () => {
  it('seeds a provider with no entry from the router table, unknown and stale, without writing', async () => {
    const store = makeStore();
    const catalog = await readModelCatalog({ store, now: () => T0 });
    expect(Object.keys(catalog.providers)).toEqual([...PROVIDERS]);
    expect(catalog.providers.nvidia).toMatchObject({ stale: true, seeded: true });
    expect(catalog.providers.nvidia.refresh).toEqual({ lastOk: null, lastAttempt: null, lastError: null });
    expect(Object.keys(catalog.providers.nvidia.models)).toEqual(seedModelsFor('nvidia'));
    expect(catalog.providers.nvidia.models['z-ai/glm-5.3']).toMatchObject({
      status: 'unknown',
      firstSeen: null,
      lastSeen: null,
      hidden: false,
      pricing: { inputPer1M: 0, outputPer1M: 0 },
    });
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('derives stale from lastOk at read time: fresh inside 8 days, stale after, stale when missing', async () => {
    const at = (lastOk) => ({
      id: CATALOG_DOC_ID,
      providers: {
        foundry: { refresh: { lastOk, lastAttempt: lastOk, lastError: null }, models: {} },
        gemini: { refresh: { lastOk: null, lastAttempt: T0.toISOString(), lastError: 'HTTP 500' }, models: {} },
      },
    });
    const fresh = await readModelCatalog({ store: makeStore(at(T0.toISOString())), now: () => T1 });
    expect(fresh.providers.foundry).toMatchObject({ stale: false, seeded: false });
    expect(fresh.providers.gemini).toMatchObject({ stale: true, seeded: false });
    const old = new Date(T1.getTime() - STALE_AFTER_MS - 1);
    const stale = await readModelCatalog({ store: makeStore(at(old.toISOString())), now: () => T1 });
    expect(stale.providers.foundry.stale).toBe(true);
  });
});

describe('setModelHidden', () => {
  it('sets hidden on a listed model and writes the document', async () => {
    const doc = {
      id: CATALOG_DOC_ID,
      providers: {
        nvidia: {
          refresh: { lastOk: T0.toISOString(), lastAttempt: T0.toISOString(), lastError: null },
          models: { 'z-ai/glm-5.3': { id: 'z-ai/glm-5.3', status: 'live', missed: 0, firstSeen: T0.toISOString(), lastSeen: T0.toISOString(), hidden: false } },
        },
      },
    };
    const store = makeStore(doc);
    const model = await setModelHidden({ store, now: () => T1 }, { provider: 'nvidia', model: 'z-ai/glm-5.3', hidden: true });
    expect(model).toMatchObject({ id: 'z-ai/glm-5.3', hidden: true, status: 'live' });
    expect(written(store).providers.nvidia.models['z-ai/glm-5.3'].hidden).toBe(true);
    expect(written(store).updatedAt).toBe(T1.toISOString());
  });

  it('materialises a router-default model before the first refresh, and refuses any other id', async () => {
    const store = makeStore();
    const model = await setModelHidden({ store, now: () => T0 }, { provider: 'foundry', model: 'gpt-5-nano', hidden: true });
    expect(model).toMatchObject({ status: 'unknown', hidden: true });
    expect(written(store).providers.foundry.refresh.lastOk).toBeNull();
    expect(await setModelHidden({ store, now: () => T0 }, { provider: 'foundry', model: 'gpt-9', hidden: true })).toBeNull();
    expect(store.upsertDoc).toHaveBeenCalledTimes(1);
  });
});

describe('visibleModelsFor', () => {
  it('offers live and unknown models that are not hidden, live first then by id', () => {
    const catalog = {
      providers: {
        openai: {
          models: {
            'gpt-5-nano': { id: 'gpt-5-nano', status: 'live', hidden: false },
            'gpt-4o': { id: 'gpt-4o', status: 'retired', hidden: false },
            'gpt-5-mini': { id: 'gpt-5-mini', status: 'live', hidden: true },
            'o3-mini': { id: 'o3-mini', status: 'unknown', hidden: false },
            'gpt-4o-mini': { id: 'gpt-4o-mini', status: 'live', hidden: false },
          },
        },
      },
    };
    expect(visibleModelsFor(catalog, 'openai')).toEqual(['gpt-4o-mini', 'gpt-5-nano', 'o3-mini']);
    expect(visibleModelsFor(catalog, 'gemini')).toEqual([]);
    expect(visibleModelsFor(null, 'openai')).toEqual([]);
  });
});
