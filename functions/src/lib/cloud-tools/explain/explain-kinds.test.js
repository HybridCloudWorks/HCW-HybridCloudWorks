/**
 * The `kind` discriminator of POST public/cloud-tools/explain (#669): the
 * dispatch, the unchanged default, and the bounds the kinds share. The
 * pricing kind's own behaviour is explain.test.js, unchanged by #669; the
 * landing-zone validator and prompt are kinds/landingZone.test.js.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_EXPLAIN_KIND,
  EXPLAIN_CACHE_TTL_SECONDS,
  EXPLAIN_KIND_IDS,
  EXPLAIN_KINDS,
  EXPLAIN_PER_CLIENT_PER_HOUR,
  EXPLAIN_PER_DAY,
  EXPLAIN_SYSTEM_PROMPT,
  LANDING_ZONE_KIND,
  LANDING_ZONE_SYSTEM_PROMPT,
  PRICING_KIND,
  canonicalExplainRequest,
  canonicalLandingZoneExplainRequest,
  createExplainHandlers,
  explainCacheId,
  landingZoneExplainPrompt,
  selectExplainKind,
  validateExplainRequest,
  validateLandingZoneExplainRequest,
} from './index.js';

const NOW = Date.parse('2026-09-25T12:00:00Z');

const pricingBody = () => ({
  region: 'us-east-1',
  scenarioId: 'three-tier',
  scenarioLabel: 'Three-tier web app',
  extras: ['backup'],
  egressGb: 500,
  results: [
    { provider: 'azure', total: 512.5, base: 400, segments: [], unavailable: [] },
    { provider: 'aws', total: 498.2, base: 390, segments: [], unavailable: [] },
  ],
});

const landingZoneBody = () => ({
  kind: 'landing-zone',
  componentId: 'policy',
  selected: ['management-groups', 'policy', 'management', 'corp'],
  options: { location: 'centralus', corpCount: 1 },
  teaches:
    'Azure Policy evaluates every resource against rules and can audit, deny or fix what it finds.',
});

/** The in-memory store explain.test.js uses, with the Cosmos error codes the counters read. */
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

/** `refuse` names the router error code to throw for the given features (or every feature). */
const fakeAi = ({ refuse = null, refuseFeatures = null, text = 'Generated text.' } = {}) => ({
  resolveProvider: vi.fn(async (feature) => {
    if (refuse && (!refuseFeatures || refuseFeatures.includes(feature))) {
      throw Object.assign(new Error(`router: ${refuse}`), { code: refuse });
    }
    return [{ provider: 'gemini', model: null }];
  }),
  generateTextResponse: vi.fn(async ({ usageOut }) => {
    usageOut?.push({ provider: 'gemini', model: 'gemini-3.5-flash-lite' });
    return text;
  }),
});

const context = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
const request = (body) => ({
  method: 'POST',
  headers: { get: () => null },
  text: async () => JSON.stringify(body),
});
const parse = (res) => JSON.parse(res.body);

const handler = ({ store = memStore(), ai = fakeAi() } = {}) =>
  createExplainHandlers({ identity, store, ai, now: () => NOW });

describe('selectExplainKind', () => {
  it('knows two kinds and defaults to pricing', () => {
    expect(EXPLAIN_KIND_IDS).toEqual(['pricing', 'landing-zone']);
    expect(DEFAULT_EXPLAIN_KIND).toBe('pricing');
    expect(EXPLAIN_KINDS.pricing).toBe(PRICING_KIND);
    expect(EXPLAIN_KINDS['landing-zone']).toBe(LANDING_ZONE_KIND);
    for (const kind of Object.values(EXPLAIN_KINDS)) {
      for (const fn of ['validate', 'canonical', 'cacheFields', 'generate']) {
        expect(typeof kind[fn], `${kind.id}.${fn}`).toBe('function');
      }
      expect(typeof kind.feature).toBe('string');
    }
  });

  it('hands a body with no kind, or that is not an object, to the pricing kind untouched', () => {
    const body = pricingBody();
    expect(selectExplainKind(body)).toEqual({ kind: PRICING_KIND, body });
    expect(selectExplainKind('nope')).toEqual({ kind: PRICING_KIND, body: 'nope' });
    expect(selectExplainKind(null)).toEqual({ kind: PRICING_KIND, body: null });
  });

  it('takes kind out of the body it hands the chosen kind', () => {
    const picked = selectExplainKind({ ...pricingBody(), kind: 'pricing' });
    expect(picked.kind).toBe(PRICING_KIND);
    expect(picked.body).toEqual(pricingBody());
    const lz = selectExplainKind(landingZoneBody());
    expect(lz.kind).toBe(LANDING_ZONE_KIND);
    expect(lz.body.kind).toBeUndefined();
    expect(lz.body.componentId).toBe('policy');
  });

  it.each([
    ['an unknown kind', 'terraform'],
    ['a kind that is a prototype key', 'constructor'],
    ['a kind that is not a string', 3],
    ['a null kind', null],
  ])('refuses %s, naming the field and not the value', (_name, kind) => {
    expect(selectExplainKind({ ...pricingBody(), kind })).toEqual({
      error: 'kind is not a known explanation kind',
    });
  });
});

describe('POST /api/public/cloud-tools/explain — kinds', () => {
  it('serves a body with no kind exactly as before: pricing feature, prompt, cache id and document', async () => {
    const store = memStore();
    const ai = fakeAi();
    const res = await handler({ store, ai }).explain(request(pricingBody()), context);
    expect(res.status).toBe(200);
    expect(ai.resolveProvider).toHaveBeenCalledWith('pricingExplain');
    const call = ai.generateTextResponse.mock.calls[0][0];
    const canonical = canonicalExplainRequest(validateExplainRequest(pricingBody()).value);
    expect(call).toMatchObject({
      prompt: canonical,
      systemPrompt: EXPLAIN_SYSTEM_PROMPT,
      feature: 'pricingExplain',
    });
    expect(JSON.parse(call.prompt).kind).toBeUndefined();
    const id = explainCacheId(canonical);
    expect(store.docs.get(`tool_service_cache/${id}`)).toEqual({
      id,
      kind: 'explain',
      region: 'us-east-1',
      scenarioId: 'three-tier',
      text: 'Generated text.',
      model: 'gemini-3.5-flash-lite',
      generatedAt: '2026-09-25T12:00:00.000Z',
      ttl: EXPLAIN_CACHE_TTL_SECONDS,
    });
  });

  it('treats an explicit kind: "pricing" as the same request: same hash, so a cache hit', async () => {
    const store = memStore();
    const ai = fakeAi();
    const h = handler({ store, ai });
    const first = await h.explain(request(pricingBody()), context);
    expect(parse(first).explanation.cached).toBe(false);
    const second = await h.explain(request({ ...pricingBody(), kind: 'pricing' }), context);
    expect(second.status).toBe(200);
    expect(parse(second).explanation.cached).toBe(true);
    expect(ai.generateTextResponse).toHaveBeenCalledTimes(1);
  });

  it('answers 400 for an unknown kind before any store or model call', async () => {
    const store = memStore();
    const ai = fakeAi();
    const res = await handler({ store, ai }).explain(
      request({ ...landingZoneBody(), kind: 'bicep' }),
      context
    );
    expect(res.status).toBe(400);
    expect(parse(res)).toEqual({ error: 'kind is not a known explanation kind' });
    expect(store.readDoc).not.toHaveBeenCalled();
    expect(ai.resolveProvider).not.toHaveBeenCalled();
  });

  it('answers 400 with the landing-zone validator’s sentence for a bad landing-zone body', async () => {
    const store = memStore();
    for (const [body, message] of [
      [{ ...landingZoneBody(), componentId: 'bastion' }, /componentId is not a known component/],
      [{ ...landingZoneBody(), selected: Array(13).fill('corp') }, /selected may hold at most 12/],
      [{ ...landingZoneBody(), teaches: 'x'.repeat(1201) }, /teaches must be at most 1200/],
      [{ ...landingZoneBody(), tenantId: 't' }, /unknown field\(s\): tenantId/],
    ]) {
      const res = await handler({ store }).explain(request(body), context);
      expect(res.status).toBe(400);
      expect(parse(res).error).toMatch(message);
    }
    expect(store.readDoc).not.toHaveBeenCalled();
  });

  it('dispatches kind: "landing-zone" to its feature, prompt and document, sharing the response shape', async () => {
    const store = memStore();
    const ai = fakeAi({ text: 'Policy matters here. Without it nothing is enforced.' });
    const res = await handler({ store, ai }).explain(request(landingZoneBody()), context);
    expect(res.status).toBe(200);
    expect(parse(res)).toEqual({
      success: true,
      explanation: {
        text: 'Policy matters here. Without it nothing is enforced.',
        model: 'gemini-3.5-flash-lite',
        generatedAt: '2026-09-25T12:00:00.000Z',
        cached: false,
      },
    });

    expect(ai.resolveProvider).toHaveBeenCalledWith('landingZoneExplain');
    expect(ai.resolveProvider).not.toHaveBeenCalledWith('pricingExplain');
    const value = validateLandingZoneExplainRequest(landingZoneBody()).value;
    const call = ai.generateTextResponse.mock.calls[0][0];
    expect(call).toMatchObject({
      prompt: landingZoneExplainPrompt(value),
      systemPrompt: LANDING_ZONE_SYSTEM_PROMPT,
      purpose: 'general',
      feature: 'landingZoneExplain',
    });
    expect(call.prompt).toContain('"id":"policy"');
    for (const id of landingZoneBody().selected) expect(call.prompt).toContain(id);

    const id = explainCacheId(canonicalLandingZoneExplainRequest(value));
    expect(id).toMatch(/^explain:[0-9a-f]{64}$/);
    expect(store.docs.get(`tool_service_cache/${id}`)).toEqual({
      id,
      kind: 'explain',
      explainKind: 'landing-zone',
      componentId: 'policy',
      text: 'Policy matters here. Without it nothing is enforced.',
      model: 'gemini-3.5-flash-lite',
      generatedAt: '2026-09-25T12:00:00.000Z',
      ttl: EXPLAIN_CACHE_TTL_SECONDS,
    });

    // The next identical request, in any selected order, is a cache hit.
    const again = await handler({ store, ai }).explain(
      request({ ...landingZoneBody(), selected: [...landingZoneBody().selected].reverse() }),
      context
    );
    expect(parse(again).explanation.cached).toBe(true);
    expect(ai.generateTextResponse).toHaveBeenCalledTimes(1);
  });

  it('keys the cache by kind: the same bytes under another kind are another id', () => {
    // A pricing canonical never starts with "kind", and a landing-zone one always does.
    const pricing = canonicalExplainRequest(validateExplainRequest(pricingBody()).value);
    const lz = canonicalLandingZoneExplainRequest(
      validateLandingZoneExplainRequest(landingZoneBody()).value
    );
    expect(JSON.parse(pricing).kind).toBeUndefined();
    expect(JSON.parse(lz).kind).toBe('landing-zone');
    expect(explainCacheId(pricing)).not.toBe(explainCacheId(lz));
  });

  it('answers the documented 503 with the landing-zone feature off, counting nothing, while pricing still serves', async () => {
    for (const refuse of ['AI_FEATURE_DISABLED', 'AI_NOT_CONFIGURED']) {
      const store = memStore();
      const ai = fakeAi({ refuse, refuseFeatures: ['landingZoneExplain'] });
      const h = handler({ store, ai });
      const off = await h.explain(request(landingZoneBody()), context);
      expect(off.status, refuse).toBe(503);
      expect(parse(off)).toEqual({ error: 'Explanations are not available' });
      expect(ai.generateTextResponse).not.toHaveBeenCalled();
      expect(store.incrementIf).not.toHaveBeenCalled();
      expect(store.createDoc).not.toHaveBeenCalled();

      const on = await h.explain(request(pricingBody()), context);
      expect(on.status, refuse).toBe(200);
      expect(ai.generateTextResponse).toHaveBeenCalledTimes(1);
    }
  });

  it('answers 503 when the router refuses the landing-zone call at call time', async () => {
    const store = memStore();
    const ai = fakeAi();
    ai.generateTextResponse.mockImplementation(async () => {
      throw Object.assign(new Error('feature off'), { code: 'AI_FEATURE_DISABLED' });
    });
    const res = await handler({ store, ai }).explain(request(landingZoneBody()), context);
    expect(res.status).toBe(503);
    expect(parse(res)).toEqual({ error: 'Explanations are not available' });
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('spends one shared per-client budget across kinds: 5 an hour together, then 429 for either', async () => {
    const store = memStore();
    const ai = fakeAi();
    const h = handler({ store, ai });
    const bodies = [
      pricingBody(),
      landingZoneBody(),
      { ...pricingBody(), egressGb: 1 },
      { ...landingZoneBody(), componentId: 'corp' },
      { ...landingZoneBody(), componentId: 'online' },
    ];
    expect(bodies).toHaveLength(EXPLAIN_PER_CLIENT_PER_HOUR);
    for (const [i, body] of bodies.entries()) {
      const res = await h.explain(request(body), context);
      expect(res.status, `call ${i + 1} (${body.kind ?? 'pricing'})`).toBe(200);
    }
    for (const body of [
      { ...pricingBody(), egressGb: 2 },
      { ...landingZoneBody(), componentId: 'identity' },
    ]) {
      const res = await h.explain(request(body), context);
      expect(res.status, body.kind ?? 'pricing').toBe(429);
      expect(res.headers['Retry-After']).toBe('3600');
    }
    expect(ai.generateTextResponse).toHaveBeenCalledTimes(EXPLAIN_PER_CLIENT_PER_HOUR);
    // One client counter and one daily counter, whatever the kind.
    expect(store.docs.get('submission_quota/explain-caller:client-hash')).toMatchObject({
      count: EXPLAIN_PER_CLIENT_PER_HOUR,
    });
    expect(store.docs.get('tool_service_cache/explain-quota:2026-09-25').count).toBe(
      EXPLAIN_PER_CLIENT_PER_HOUR
    );
  });

  it('pauses both kinds for the day on the one daily counter', async () => {
    const store = memStore({
      'tool_service_cache/explain-quota:2026-09-25': {
        id: 'explain-quota:2026-09-25',
        count: EXPLAIN_PER_DAY,
      },
    });
    const ai = fakeAi();
    for (const body of [landingZoneBody(), pricingBody()]) {
      const res = await handler({ store, ai }).explain(request(body), context);
      expect(res.status, body.kind ?? 'pricing').toBe(503);
      expect(parse(res)).toEqual({ error: 'Explanations are paused for today' });
    }
    expect(ai.generateTextResponse).not.toHaveBeenCalled();
  });

  it('strips URLs from a landing-zone answer and answers 502 when nothing is left', async () => {
    const store = memStore();
    const withLink = await handler({
      store,
      ai: fakeAi({ text: 'Policy enforces the baseline. See https://evil.example/x for more.' }),
    }).explain(request(landingZoneBody()), context);
    expect(parse(withLink).explanation.text).toBe('Policy enforces the baseline. See for more.');

    const empty = await handler({
      store: memStore(),
      ai: fakeAi({ text: 'https://only.a/link' }),
    }).explain(request(landingZoneBody()), context);
    expect(empty.status).toBe(502);
  });
});
