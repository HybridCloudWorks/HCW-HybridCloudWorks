import { describe, expect, it, vi } from 'vitest';

import { createPublicPriceChangesHandlers } from './public-price-changes.js';

const context = { log: vi.fn(), error: vi.fn() };
const request = (query = {}) => ({ method: 'GET', query: { get: (k) => query[k] ?? null } });
const body = (res) => JSON.parse(res.body);

const EMPTY_WINDOWS = {
  '7d': { since: null, sampleDay: null, items: [] },
  '30d': { since: null, sampleDay: null, items: [] },
};

const item = {
  serviceId: 'compute-vm',
  label: 'Virtual machines',
  provider: 'aws',
  unit: 'hour',
  sku: 'm5.xlarge',
  from: 0.192,
  to: 0.201,
  deltaPct: 4.7,
};

const doc = (over = {}) => ({
  id: 'price-changes:us-east-1',
  region: 'us-east-1',
  asOf: '2026-09-15T02:00:00.000Z',
  windows: {
    '7d': { since: '2026-09-08', sampleDay: '2026-09-08', items: [item] },
    '30d': { since: '2026-08-16', sampleDay: null, items: [] },
  },
  sampleDays: 1,
  _rid: 'r',
  _etag: '"e"',
  _ts: 1,
  ...over,
});

const handlers = (stored) =>
  createPublicPriceChangesHandlers({
    store: { readDoc: vi.fn(async (_c, id) => (stored && stored.id === id ? stored : null)) },
  });

describe('GET /api/public/cloud-tools/price-changes', () => {
  it('defaults to us-east-1 and reads the changes document by its id as partition key', async () => {
    const store = { readDoc: vi.fn(async () => doc()) };
    const res = await createPublicPriceChangesHandlers({ store }).getPriceChanges(
      request(),
      context
    );
    expect(res.status).toBe(200);
    expect(body(res).changes.region).toBe('us-east-1');
    expect(store.readDoc).toHaveBeenCalledWith(
      'tool_service_cache',
      'price-changes:us-east-1',
      'price-changes:us-east-1'
    );
  });

  it('answers 400 for a region that is not an option', async () => {
    const h = handlers(doc());
    for (const bad of ['eastus', 'US-EAST-1', 'mars']) {
      const res = await h.getPriceChanges(request({ region: bad }), context);
      expect(res.status, bad).toBe(400);
      expect(body(res)).toEqual({ error: 'Unknown region' });
    }
  });

  it('serves the document as a four-field projection with a 15-minute cache', async () => {
    const res = await handlers(doc()).getPriceChanges(request({ region: 'us-east-1' }), context);
    expect(res.headers['Cache-Control']).toBe('public, max-age=900');
    expect(body(res)).toEqual({
      success: true,
      changes: {
        region: 'us-east-1',
        asOf: '2026-09-15T02:00:00.000Z',
        windows: {
          '7d': { since: '2026-09-08', sampleDay: '2026-09-08', items: [item] },
          '30d': { since: '2026-08-16', sampleDay: null, items: [] },
        },
        sampleDays: 1,
      },
    });
    for (const field of ['_rid', '_etag', '_ts', '"id"']) expect(res.body).not.toContain(field);
  });

  it('answers "nothing computed yet" as a 200 with empty windows, cached a minute', async () => {
    const res = await handlers(null).getPriceChanges(request({ region: 'westeurope' }), context);
    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toBe('public, max-age=60');
    expect(body(res)).toEqual({
      success: true,
      changes: { region: 'westeurope', asOf: null, windows: EMPTY_WINDOWS, sampleDays: 0 },
    });
  });

  it('fills in a window a stored document lacks rather than serving a hole', async () => {
    const stored = doc({
      windows: { '7d': { since: '2026-09-08', sampleDay: null } },
      sampleDays: 'x',
    });
    const { changes } = body(await handlers(stored).getPriceChanges(request(), context));
    expect(changes.windows).toEqual({
      '7d': { since: '2026-09-08', sampleDay: null, items: [] },
      '30d': { since: null, sampleDay: null, items: [] },
    });
    expect(changes.sampleDays).toBe(0);
  });

  it('never calls a provider — one point read and nothing else', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const store = { readDoc: vi.fn(async () => null) };
      await createPublicPriceChangesHandlers({ store }).getPriceChanges(request(), context);
      expect(store.readDoc).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('answers 500 without leaking the error when the read throws', async () => {
    const store = {
      readDoc: vi.fn(async () => {
        throw new Error('cosmos said no: /dbs/x/colls/tool_service_cache');
      }),
    };
    const res = await createPublicPriceChangesHandlers({ store }).getPriceChanges(
      request(),
      context
    );
    expect(res.status).toBe(500);
    expect(body(res)).toEqual({ error: 'Failed to get price changes' });
    expect(context.error).toHaveBeenCalled();
  });
});
