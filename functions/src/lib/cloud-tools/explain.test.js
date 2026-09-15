import { describe, expect, it, vi } from 'vitest';

import {
  EXPLAIN_CACHE_TTL_SECONDS,
  EXPLAIN_FEATURE,
  EXPLAIN_MAX_BODY_BYTES,
  EXPLAIN_PER_CLIENT_PER_HOUR,
  EXPLAIN_PER_DAY,
  EXPLAIN_QUOTA_TTL_SECONDS,
  EXPLAIN_SYSTEM_PROMPT,
  canonicalExplainRequest,
  createExplainHandlers,
  explainCacheId,
  stripUrls,
  takeDailyQuota,
  validateExplainRequest,
} from './explain.js';

const NOW = Date.parse('2026-09-15T12:00:00Z');

const validBody = () => ({
  region: 'us-east-1',
  scenarioId: 'three-tier',
  scenarioLabel: 'Three-tier web app',
  extras: ['backup', 'dr-pilot-light'],
  egressGb: 500,
  results: [
    {
      provider: 'azure',
      total: 512.5,
      base: 400,
      segments: [
        { extraId: 'backup', label: 'Backup', cost: 50 },
        { extraId: 'dr-pilot-light', label: 'DR: pilot light', cost: 62.5 },
      ],
      unavailable: [],
    },
    {
      provider: 'aws',
      total: 498.2,
      base: 390,
      segments: [{ extraId: 'backup', label: 'Backup', cost: 48.2 }],
      unavailable: ['compute-serverless'],
    },
  ],
});

/** An in-memory store with the five operations the handler needs, Cosmos error codes included. */
function memStore(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const key = (container, id) => `${container}/${id}`;
  const cosmosError = (code) => Object.assign(new Error(`cosmos ${code}`), { code });
  return {
    docs,
    readDoc: vi.fn(async (container, id) => docs.get(key(container, id)) ?? null),
    upsertDoc: vi.fn(async (container, doc) => {
      docs.set(key(container, doc.id), doc);
      return doc;
    }),
    createDoc: vi.fn(async (container, doc) => {
      if (docs.has(key(container, doc.id))) throw cosmosError(409);
      docs.set(key(container, doc.id), doc);
      return doc;
    }),
    replaceDocIfMatch: vi.fn(async (container, doc) => {
      docs.set(key(container, doc.id), doc);
      return doc;
    }),
    incrementIf: vi.fn(async (container, id, { path, value, condition, conditionValues }) => {
      const doc = docs.get(key(container, id));
      if (!doc) throw cosmosError(404);
      const field = path.slice(1);
      // The two predicates the handler uses, evaluated the way Cosmos would.
      const passes = condition.includes('windowStartMs')
        ? doc.windowStartMs > conditionValues.windowFloor && doc.count < conditionValues.limit
        : doc.count < conditionValues.limit;
      if (!passes) throw cosmosError(412);
      doc[field] += value;
      return doc;
    }),
  };
}

const identity = { anonymousKey: vi.fn(() => ({ key: 'client-hash', trusted: true })) };
const refusingIdentity = {
  anonymousKey: () => {
    throw new Error('unverified origin');
  },
};

const fakeAi = ({
  providers = ['gemini'],
  refuse = null,
  text = 'Azure is cheapest by $14. Extras add $112. Egress could flip it.',
} = {}) => ({
  // The real router throws AiNotConfiguredError (code AI_NOT_CONFIGURED) with
  // no usable provider and AiFeatureDisabledError (AI_FEATURE_DISABLED) when
  // the feature is off in the portal; `refuse` names the code to throw.
  resolveProvider: vi.fn(async () => {
    if (refuse) throw Object.assign(new Error(`router: ${refuse}`), { code: refuse });
    return providers.map((provider) => ({ provider, model: null }));
  }),
  generateTextResponse: vi.fn(async ({ usageOut }) => {
    usageOut?.push({ provider: 'gemini', model: 'gemini-3.5-flash-lite' });
    return text;
  }),
});

const context = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
const request = (body, { method = 'POST' } = {}) => ({
  method,
  headers: { get: () => null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const parse = (res) => JSON.parse(res.body);

const handler = ({ store = memStore(), ai = fakeAi(), id = identity, now = () => NOW } = {}) =>
  createExplainHandlers({ identity: id, store, ai, now });

describe('validateExplainRequest', () => {
  it('accepts the page’s shape and returns it in canonical key order', () => {
    const { value, error } = validateExplainRequest(validBody());
    expect(error).toBeUndefined();
    expect(Object.keys(value)).toEqual([
      'region',
      'scenarioId',
      'scenarioLabel',
      'extras',
      'egressGb',
      'results',
    ]);
    expect(Object.keys(value.results[0])).toEqual([
      'provider',
      'total',
      'base',
      'segments',
      'unavailable',
    ]);
    expect(value.results[1].unavailable).toEqual(['compute-serverless']);
  });

  it('defaults absent extras, segments and unavailable to empty lists', () => {
    const body = validBody();
    delete body.extras;
    delete body.results[0].segments;
    delete body.results[0].unavailable;
    const { value } = validateExplainRequest(body);
    expect(value.extras).toEqual([]);
    expect(value.results[0]).toMatchObject({ segments: [], unavailable: [] });
  });

  it.each([
    ['not an object', 'nope', /must be a JSON object/],
    [
      'an unknown top-level key',
      { ...validBody(), quantities: {} },
      /unknown field\(s\): quantities/,
    ],
    ['a region that is not an option', { ...validBody(), region: 'eastus' }, /region is not one/],
    ['a missing scenarioId', { ...validBody(), scenarioId: undefined }, /scenarioId is required/],
    [
      'an empty scenarioLabel',
      { ...validBody(), scenarioLabel: '   ' },
      /scenarioLabel must not be empty/,
    ],
    ['a label over 80 characters', { ...validBody(), scenarioLabel: 'x'.repeat(81) }, /at most 80/],
    [
      'extras that is not an array',
      { ...validBody(), extras: 'backup' },
      /extras must be an array/,
    ],
    [
      'more than 8 extras',
      { ...validBody(), extras: Array(9).fill('e') },
      /extras may hold at most 8/,
    ],
    ['a non-string extra', { ...validBody(), extras: [1] }, /extras\[0\] must be a string/],
    [
      'a non-finite egressGb',
      { ...validBody(), egressGb: Infinity },
      /egressGb must be a finite number/,
    ],
    ['a string egressGb', { ...validBody(), egressGb: '500' }, /egressGb must be a finite number/],
    ['a negative egressGb', { ...validBody(), egressGb: -1 }, /egressGb must not be negative/],
    ['no results', { ...validBody(), results: [] }, /results must be a non-empty array/],
    [
      'four results',
      { ...validBody(), results: Array(4).fill(validBody().results[0]) },
      /at most 3/,
    ],
    [
      'a result that is not an object',
      { ...validBody(), results: ['aws'] },
      /results\[0\] must be an object/,
    ],
    [
      'an unknown result key',
      { ...validBody(), results: [{ ...validBody().results[0], yearly: 1 }] },
      /results\[0\] has unknown field/,
    ],
    [
      'an unknown provider',
      { ...validBody(), results: [{ ...validBody().results[0], provider: 'oracle' }] },
      /not a known provider/,
    ],
    [
      'a repeated provider',
      { ...validBody(), results: [validBody().results[0], validBody().results[0]] },
      /repeats azure/,
    ],
    [
      'a NaN total',
      { ...validBody(), results: [{ ...validBody().results[0], total: NaN }] },
      /total must be a finite number/,
    ],
    [
      'a string base',
      { ...validBody(), results: [{ ...validBody().results[0], base: '400' }] },
      /base must be a finite number/,
    ],
    [
      'segments that is not an array',
      { ...validBody(), results: [{ ...validBody().results[0], segments: {} }] },
      /segments must be an array/,
    ],
    [
      'nine segments',
      {
        ...validBody(),
        results: [
          {
            ...validBody().results[0],
            segments: Array(9).fill({ extraId: 'e', label: 'l', cost: 1 }),
          },
        ],
      },
      /segments may hold at most 8/,
    ],
    [
      'a segment with an unknown key',
      {
        ...validBody(),
        results: [
          {
            ...validBody().results[0],
            segments: [{ extraId: 'e', label: 'l', cost: 1, note: 'x' }],
          },
        ],
      },
      /segments\[0\] has unknown field/,
    ],
    [
      'a segment cost that is not a number',
      {
        ...validBody(),
        results: [
          { ...validBody().results[0], segments: [{ extraId: 'e', label: 'l', cost: '1' }] },
        ],
      },
      /cost must be a finite number/,
    ],
    [
      'a segment label over 80 characters',
      {
        ...validBody(),
        results: [
          {
            ...validBody().results[0],
            segments: [{ extraId: 'e', label: 'x'.repeat(81), cost: 1 }],
          },
        ],
      },
      /label must be at most 80/,
    ],
    [
      'unavailable that is not an array',
      { ...validBody(), results: [{ ...validBody().results[0], unavailable: 'x' }] },
      /unavailable must be an array/,
    ],
    [
      'nine unavailable',
      { ...validBody(), results: [{ ...validBody().results[0], unavailable: Array(9).fill('s') }] },
      /unavailable may hold at most 8/,
    ],
  ])('refuses %s', (_name, body, message) => {
    const { error, value } = validateExplainRequest(body);
    expect(value).toBeUndefined();
    expect(error).toMatch(message);
  });
});

describe('canonicalExplainRequest / explainCacheId', () => {
  it('hashes the same scenario the same whichever order the providers came in', () => {
    const a = validateExplainRequest(validBody()).value;
    const swapped = validBody();
    swapped.results.reverse();
    const b = validateExplainRequest(swapped).value;
    expect(canonicalExplainRequest(a)).toBe(canonicalExplainRequest(b));
    expect(explainCacheId(canonicalExplainRequest(a))).toMatch(/^explain:[0-9a-f]{64}$/);
  });

  it('hashes a different scenario differently', () => {
    const a = validateExplainRequest(validBody()).value;
    const b = validateExplainRequest({ ...validBody(), egressGb: 501 }).value;
    expect(explainCacheId(canonicalExplainRequest(a))).not.toBe(
      explainCacheId(canonicalExplainRequest(b))
    );
  });
});

describe('stripUrls', () => {
  it('removes anything URL-shaped and keeps the words around it', () => {
    expect(
      stripUrls(
        'Azure is cheapest. See https://evil.example/x?y=1 or www.bad.com/path and [read this](http://x.y) and evil.dev today.'
      )
    ).toBe('Azure is cheapest. See or and read this and today.');
    expect(stripUrls('  two   spaces  ')).toBe('two spaces');
    expect(stripUrls(null)).toBe('');
    expect(stripUrls('x'.repeat(3000))).toHaveLength(2000);
  });
});

describe('takeDailyQuota', () => {
  it('creates today’s counter on first use and increments it after, up to the cap', async () => {
    const store = memStore();
    const args = { day: '2026-09-15', nowIso: '2026-09-15T12:00:00.000Z', limit: 2 };
    expect(await takeDailyQuota(store, args)).toBe(true);
    expect(store.docs.get('tool_service_cache/explain-quota:2026-09-15')).toMatchObject({
      count: 1,
      day: '2026-09-15',
      ttl: EXPLAIN_QUOTA_TTL_SECONDS,
    });
    expect(await takeDailyQuota(store, args)).toBe(true);
    expect(await takeDailyQuota(store, args)).toBe(false);
    expect(store.docs.get('tool_service_cache/explain-quota:2026-09-15').count).toBe(2);
  });

  it('goes round again when another instance created the counter first', async () => {
    const store = memStore();
    store.incrementIf.mockImplementationOnce(async () => {
      throw Object.assign(new Error('404'), { code: 404 });
    });
    store.createDoc.mockImplementationOnce(async () => {
      throw Object.assign(new Error('409'), { code: 409 });
    });
    store.docs.set('tool_service_cache/explain-quota:2026-09-15', {
      id: 'explain-quota:2026-09-15',
      count: 1,
    });
    expect(await takeDailyQuota(store, { day: '2026-09-15', nowIso: 'x', limit: 5 })).toBe(true);
    expect(store.docs.get('tool_service_cache/explain-quota:2026-09-15').count).toBe(2);
  });

  it('propagates a real fault rather than reading it as allowed', async () => {
    const store = memStore();
    store.incrementIf.mockImplementationOnce(async () => {
      throw Object.assign(new Error('503'), { code: 503 });
    });
    await expect(takeDailyQuota(store, { day: 'd', nowIso: 'x' })).rejects.toThrow('503');
  });
});

describe('POST /api/public/cloud-tools/explain', () => {
  it('answers 405 to anything but POST', async () => {
    const res = await handler().explain(request(validBody(), { method: 'GET' }), context);
    expect(res.status).toBe(405);
  });

  it('answers 400 for a body that is not JSON, too large, or invalid — before any store or model call', async () => {
    const store = memStore();
    const ai = fakeAi();
    const h = handler({ store, ai });
    for (const [body, message] of [
      ['{not json', /valid JSON/],
      [{ ...validBody(), scenarioLabel: 'x'.repeat(EXPLAIN_MAX_BODY_BYTES) }, /at most 8192 bytes/],
      [{ ...validBody(), region: 'mars' }, /region is not one/],
    ]) {
      const res = await h.explain(request(body), context);
      expect(res.status).toBe(400);
      expect(parse(res).error).toMatch(message);
    }
    expect(store.readDoc).not.toHaveBeenCalled();
    expect(store.incrementIf).not.toHaveBeenCalled();
    expect(ai.generateTextResponse).not.toHaveBeenCalled();
  });

  it('serves a cached explanation with no identity check, no counters and no model call', async () => {
    const canonical = canonicalExplainRequest(validateExplainRequest(validBody()).value);
    const id = explainCacheId(canonical);
    const store = memStore({
      [`tool_service_cache/${id}`]: {
        id,
        text: 'Cached text.',
        model: 'gemini-3.5-flash-lite',
        generatedAt: '2026-09-14T00:00:00.000Z',
      },
    });
    const ai = fakeAi();
    const res = await handler({ store, ai, id: refusingIdentity }).explain(
      request(validBody()),
      context
    );
    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toBe('public, max-age=3600');
    expect(parse(res)).toEqual({
      success: true,
      explanation: {
        text: 'Cached text.',
        model: 'gemini-3.5-flash-lite',
        generatedAt: '2026-09-14T00:00:00.000Z',
        cached: true,
      },
    });
    expect(store.readDoc).toHaveBeenCalledWith('tool_service_cache', id, id);
    expect(store.incrementIf).not.toHaveBeenCalled();
    expect(ai.generateTextResponse).not.toHaveBeenCalled();
  });

  it('answers 503 "not available" with no AI provider configured, or the feature off, counting nothing', async () => {
    for (const refuse of ['AI_NOT_CONFIGURED', 'AI_FEATURE_DISABLED']) {
      const store = memStore();
      const ai = fakeAi({ refuse });
      const res = await handler({ store, ai }).explain(request(validBody()), context);
      expect(res.status, refuse).toBe(503);
      expect(parse(res)).toEqual({ error: 'Explanations are not available' });
      // The router's own selection for THIS feature, so the portal toggle is
      // the off switch for the one anonymous AI call.
      expect(ai.resolveProvider).toHaveBeenCalledWith('pricingExplain');
      expect(ai.generateTextResponse).not.toHaveBeenCalled();
      expect(store.incrementIf).not.toHaveBeenCalled();
      expect(store.createDoc).not.toHaveBeenCalled();
    }
  });

  it('lets a real router fault through to the 500, rather than reading it as "not available"', async () => {
    const store = memStore();
    const res = await handler({ store, ai: fakeAi({ refuse: 'ECONNRESET' }) }).explain(
      request(validBody()),
      context
    );
    expect(res.status).toBe(500);
    expect(store.incrementIf).not.toHaveBeenCalled();
  });

  it('answers 503 "not available" when the router refuses at call time, after the counters', async () => {
    const store = memStore();
    const ai = fakeAi();
    ai.generateTextResponse.mockImplementation(async () => {
      throw Object.assign(new Error('Every configured AI provider is disabled'), {
        code: 'AI_NOT_CONFIGURED',
      });
    });
    const res = await handler({ store, ai }).explain(request(validBody()), context);
    expect(res.status).toBe(503);
    expect(parse(res)).toEqual({ error: 'Explanations are not available' });
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('answers 403 when the origin is not verifiably Cloudflare', async () => {
    const store = memStore();
    const res = await handler({ store, id: refusingIdentity }).explain(
      request(validBody()),
      context
    );
    expect(res.status).toBe(403);
    expect(store.incrementIf).not.toHaveBeenCalled();
  });

  it('limits each client to 5 per hour on the submission counter, then 429', async () => {
    const store = memStore();
    const ai = fakeAi();
    const h = handler({ store, ai });
    // A different scenario each time, or the cache would answer.
    for (let i = 0; i < EXPLAIN_PER_CLIENT_PER_HOUR; i += 1) {
      const res = await h.explain(request({ ...validBody(), egressGb: i }), context);
      expect(res.status, `call ${i + 1}`).toBe(200);
    }
    const res = await h.explain(request({ ...validBody(), egressGb: 99 }), context);
    expect(res.status).toBe(429);
    expect(parse(res)).toEqual({ error: 'Too many requests' });
    expect(res.headers['Retry-After']).toBe('3600');
    expect(ai.generateTextResponse).toHaveBeenCalledTimes(EXPLAIN_PER_CLIENT_PER_HOUR);
    expect(store.docs.get('submission_quota/explain-caller:client-hash')).toMatchObject({
      count: EXPLAIN_PER_CLIENT_PER_HOUR,
    });
    // The daily counter moved exactly once per model call.
    expect(store.docs.get('tool_service_cache/explain-quota:2026-09-15').count).toBe(
      EXPLAIN_PER_CLIENT_PER_HOUR
    );
  });

  it('pauses for the day at 200 across every client, with 503', async () => {
    const store = memStore({
      'tool_service_cache/explain-quota:2026-09-15': {
        id: 'explain-quota:2026-09-15',
        count: EXPLAIN_PER_DAY,
      },
    });
    const ai = fakeAi();
    const res = await handler({ store, ai }).explain(request(validBody()), context);
    expect(res.status).toBe(503);
    expect(parse(res)).toEqual({ error: 'Explanations are paused for today' });
    expect(ai.generateTextResponse).not.toHaveBeenCalled();
    expect(store.docs.get('tool_service_cache/explain-quota:2026-09-15').count).toBe(
      EXPLAIN_PER_DAY
    );
  });

  it('asks the router once with the fixed system prompt and the canonical JSON, strips URLs, stores for 7 days', async () => {
    const store = memStore();
    const ai = fakeAi({
      text: 'Azure is cheapest by $14 a month. Compare at https://evil.example/steal — extras add $112.',
    });
    const res = await handler({ store, ai }).explain(request(validBody()), context);
    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toBeUndefined();
    const { explanation } = parse(res);
    expect(explanation).toEqual({
      text: 'Azure is cheapest by $14 a month. Compare at — extras add $112.',
      model: 'gemini-3.5-flash-lite',
      generatedAt: '2026-09-15T12:00:00.000Z',
      cached: false,
    });

    expect(ai.generateTextResponse).toHaveBeenCalledTimes(1);
    const call = ai.generateTextResponse.mock.calls[0][0];
    expect(call.systemPrompt).toBe(EXPLAIN_SYSTEM_PROMPT);
    expect(call.purpose).toBe('general');
    expect(call.feature).toBe('pricingExplain');
    expect(call.feature).toBe(EXPLAIN_FEATURE);
    expect(call.prompt).toBe(canonicalExplainRequest(validateExplainRequest(validBody()).value));
    // The prompt is the validated body and nothing else: no headers, no key.
    expect(JSON.parse(call.prompt)).toMatchObject({
      region: 'us-east-1',
      scenarioId: 'three-tier',
    });

    const id = explainCacheId(call.prompt);
    expect(store.docs.get(`tool_service_cache/${id}`)).toEqual({
      id,
      kind: 'explain',
      region: 'us-east-1',
      scenarioId: 'three-tier',
      text: explanation.text,
      model: 'gemini-3.5-flash-lite',
      generatedAt: '2026-09-15T12:00:00.000Z',
      ttl: EXPLAIN_CACHE_TTL_SECONDS,
    });

    // And the next identical request is a cache hit.
    const again = await handler({ store, ai }).explain(request(validBody()), context);
    expect(parse(again).explanation.cached).toBe(true);
    expect(ai.generateTextResponse).toHaveBeenCalledTimes(1);
  });

  it('answers 502 and stores nothing when the model returns nothing usable', async () => {
    const store = memStore();
    const res = await handler({ store, ai: fakeAi({ text: 'https://only.a/link' }) }).explain(
      request(validBody()),
      context
    );
    expect(res.status).toBe(502);
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('answers 500 without leaking the error when the store throws', async () => {
    const store = memStore();
    store.readDoc.mockImplementation(async () => {
      throw new Error('cosmos said no: /dbs/x');
    });
    const res = await handler({ store }).explain(request(validBody()), context);
    expect(res.status).toBe(500);
    expect(parse(res)).toEqual({ error: 'Failed to explain' });
    expect(context.error).toHaveBeenCalled();
  });

  it('names the system prompt’s rules', () => {
    for (const rule of [
      'two short paragraphs',
      'Use only the numbers given',
      'cheapest',
      'flip',
      '180 words',
      'No marketing',
    ]) {
      expect(EXPLAIN_SYSTEM_PROMPT).toContain(rule);
    }
  });
});
