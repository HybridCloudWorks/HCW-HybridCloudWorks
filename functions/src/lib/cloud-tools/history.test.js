import { describe, expect, it, vi } from 'vitest';

import {
  CACHE_CONTAINER,
  CHANGE_WINDOWS,
  HISTORY_CONTAINER,
  LOOKBACK_TOLERANCE_DAYS,
  buildHistoryDoc,
  cellKey,
  computePriceChanges,
  diffPricing,
  emptyPriceChanges,
  historyCells,
  historyDocId,
  priceChangesDocId,
  rowSource,
  utcDay,
} from './history.js';
import { SERVICE_LABELS } from './pricing/regions.js';

const live = (pricePerUnit, over = {}) => ({
  pricePerUnit,
  unit: 'hour',
  sku: 'sku',
  currency: 'USD',
  source: 'live',
  ...over,
});
const baseline = (pricePerUnit, over = {}) => live(pricePerUnit, { source: 'baseline', ...over });

describe('ids and days', () => {
  it('keys history by region and UTC day, and changes by region', () => {
    expect(utcDay('2026-09-15T23:59:59.999Z')).toBe('2026-09-15');
    expect(utcDay(Date.parse('2026-09-16T00:00:00Z'))).toBe('2026-09-16');
    expect(historyDocId('us-east-1', '2026-09-15')).toBe('history:us-east-1:2026-09-15');
    expect(priceChangesDocId('westeurope')).toBe('price-changes:westeurope');
    expect(cellKey('compute-vm', 'aws')).toBe('compute-vm:aws');
  });

  it('names the two containers the refresh writes', () => {
    expect(CACHE_CONTAINER).toBe('tool_service_cache');
    expect(HISTORY_CONTAINER).toBe('tool_price_history');
    expect(CHANGE_WINDOWS).toEqual({ '7d': 7, '30d': 30 });
  });
});

describe('historyCells / buildHistoryDoc', () => {
  const services = [
    {
      serviceId: 'compute-vm',
      rows: [
        {
          provider: 'aws',
          model: 'retail',
          pricePerUnit: 0.192,
          unit: 'hour',
          sku: 't3',
          currency: 'USD',
        },
        {
          provider: 'azure',
          model: 'baseline-fallback',
          pricePerUnit: 0.201,
          unit: 'hour',
          sku: 'D4',
        },
      ],
    },
    { serviceId: 'database-nosql', rows: [] },
  ];

  it('flattens rows to <serviceId>:<provider> cells with a two-valued source', () => {
    expect(rowSource({ model: 'retail' })).toBe('live');
    expect(rowSource({ model: 'baseline-fallback' })).toBe('baseline');
    expect(rowSource(undefined)).toBe('baseline');
    expect(historyCells(services)).toEqual({
      'compute-vm:aws': {
        pricePerUnit: 0.192,
        unit: 'hour',
        sku: 't3',
        currency: 'USD',
        source: 'live',
      },
      'compute-vm:azure': {
        pricePerUnit: 0.201,
        unit: 'hour',
        sku: 'D4',
        currency: 'USD',
        source: 'baseline',
      },
    });
    expect(historyCells(undefined)).toEqual({});
  });

  it('builds one document per region per UTC day', () => {
    const doc = buildHistoryDoc({
      region: 'us-east-1',
      refreshedAt: '2026-09-15T02:00:00.000Z',
      services,
    });
    expect(doc).toEqual({
      id: 'history:us-east-1:2026-09-15',
      region: 'us-east-1',
      day: '2026-09-15',
      refreshedAt: '2026-09-15T02:00:00.000Z',
      cells: historyCells(services),
    });
  });
});

describe('diffPricing', () => {
  it('reports a live cell whose price moved, with the label, unit, sku and a one-decimal delta', () => {
    const items = diffPricing(
      { 'compute-vm:aws': live(0.201, { sku: 'm5.xlarge' }) },
      { 'compute-vm:aws': live(0.192) }
    );
    expect(items).toEqual([
      {
        serviceId: 'compute-vm',
        label: SERVICE_LABELS['compute-vm'],
        provider: 'aws',
        unit: 'hour',
        sku: 'm5.xlarge',
        from: 0.192,
        to: 0.201,
        deltaPct: 4.7,
      },
    ]);
  });

  it('rounds the delta to one decimal place in both directions', () => {
    expect(diffPricing({ 'a:aws': live(1.03456) }, { 'a:aws': live(1) })[0].deltaPct).toBe(3.5);
    expect(diffPricing({ 'a:aws': live(0.96) }, { 'a:aws': live(1) })[0].deltaPct).toBe(-4);
    expect(diffPricing({ 'a:aws': live(1.0004) }, { 'a:aws': live(1) })[0].deltaPct).toBe(0);
  });

  it('ignores unchanged cells, live↔baseline flips, baseline pairs, unit changes and absent cells', () => {
    const current = {
      'same:aws': live(1),
      'flip-up:aws': live(2),
      'flip-down:aws': baseline(2),
      'baseline:aws': baseline(2),
      'unit:aws': live(2, { unit: 'GB-month' }),
      'new:aws': live(2),
    };
    const previous = {
      'same:aws': live(1),
      'flip-up:aws': baseline(1),
      'flip-down:aws': live(1),
      'baseline:aws': baseline(1),
      'unit:aws': live(1, { unit: 'hour' }),
      'gone:aws': live(1),
    };
    expect(diffPricing(current, previous)).toEqual([]);
  });

  it('skips a previous price of zero, which has no percentage', () => {
    expect(diffPricing({ 'a:aws': live(1) }, { 'a:aws': live(0) })).toEqual([]);
    expect(diffPricing({ 'a:aws': live(1) }, { 'a:aws': live('n/a') })).toEqual([]);
  });

  it('sorts by the size of the move, then service id, then provider', () => {
    const current = {
      'storage-object:gcp': live(1.1),
      'compute-vm:azure': live(0.5),
      'compute-vm:aws': live(1.1),
      'edge-cdn:aws': live(1.1),
    };
    const previous = {
      'storage-object:gcp': live(1),
      'compute-vm:azure': live(1),
      'compute-vm:aws': live(1),
      'edge-cdn:aws': live(1),
    };
    expect(
      diffPricing(current, previous).map((i) => `${i.serviceId}:${i.provider}=${i.deltaPct}`)
    ).toEqual([
      'compute-vm:azure=-50',
      'compute-vm:aws=10',
      'edge-cdn:aws=10',
      'storage-object:gcp=10',
    ]);
  });

  it('is total over empty or missing inputs', () => {
    expect(diffPricing({}, {})).toEqual([]);
    expect(diffPricing(undefined, undefined)).toEqual([]);
    expect(diffPricing({ 'a:aws': live(1) }, undefined)).toEqual([]);
  });
});

describe('computePriceChanges', () => {
  const REFRESHED_AT = '2026-09-15T02:00:00.000Z';
  const snapshot = (day, cells) => ({
    id: historyDocId('us-east-1', day),
    region: 'us-east-1',
    day,
    cells,
  });
  const storeWith = (docs) => {
    const byId = new Map(docs.map((d) => [d.id, d]));
    return {
      readDoc: vi.fn(async (container, id) =>
        container === HISTORY_CONTAINER ? (byId.get(id) ?? null) : null
      ),
    };
  };

  it('diffs today against the newest snapshot at least 7 and at least 30 days old, by point reads', async () => {
    const store = storeWith([
      snapshot('2026-09-10', { 'compute-vm:aws': live(0.15) }), // 5 days: too new for either window
      snapshot('2026-09-08', { 'compute-vm:aws': live(0.18) }), // 7 days: the 7d sample
      snapshot('2026-09-06', { 'compute-vm:aws': live(0.17) }), // 9 days: shadowed by the 8th
      snapshot('2026-08-14', { 'compute-vm:aws': live(0.16) }), // 32 days: the 30d sample
    ]);
    const doc = await computePriceChanges({
      store,
      region: 'us-east-1',
      cells: { 'compute-vm:aws': live(0.2) },
      refreshedAt: REFRESHED_AT,
    });
    expect(doc).toMatchObject({
      id: 'price-changes:us-east-1',
      region: 'us-east-1',
      asOf: REFRESHED_AT,
      sampleDays: 2,
    });
    expect(doc.windows['7d']).toMatchObject({ since: '2026-09-08', sampleDay: '2026-09-08' });
    expect(doc.windows['7d'].items.map((i) => [i.from, i.to, i.deltaPct])).toEqual([
      [0.18, 0.2, 11.1],
    ]);
    expect(doc.windows['30d']).toMatchObject({ since: '2026-08-16', sampleDay: '2026-08-14' });
    expect(doc.windows['30d'].items.map((i) => [i.from, i.to, i.deltaPct])).toEqual([
      [0.16, 0.2, 25],
    ]);

    // Every read is a point read of a day id — id as partition key — and the
    // walk stops at the first hit: 7d hits on its first day, 30d on its third.
    for (const [container, id, pk] of store.readDoc.mock.calls) {
      expect(container).toBe(HISTORY_CONTAINER);
      expect(pk).toBe(id);
      expect(id).toMatch(/^history:us-east-1:\d{4}-\d{2}-\d{2}$/);
    }
    expect(store.readDoc.mock.calls.map(([, id]) => id)).toEqual([
      'history:us-east-1:2026-09-08',
      'history:us-east-1:2026-08-16',
      'history:us-east-1:2026-08-15',
      'history:us-east-1:2026-08-14',
    ]);
  });

  it('walks at most the tolerance past a window, then reports no comparison day rather than a query', async () => {
    const store = storeWith([]);
    const doc = await computePriceChanges({
      store,
      region: 'us-east-1',
      cells: { 'compute-vm:aws': live(0.2) },
      refreshedAt: REFRESHED_AT,
    });
    expect(doc.windows['7d']).toEqual({ since: '2026-09-08', sampleDay: null, items: [] });
    expect(doc.windows['30d']).toEqual({ since: '2026-08-16', sampleDay: null, items: [] });
    expect(doc.sampleDays).toBe(0);
    expect(store.readDoc).toHaveBeenCalledTimes(2 * (LOOKBACK_TOLERANCE_DAYS + 1));
    expect(store.readDoc.mock.calls.map(([, id]) => id)).toContain('history:us-east-1:2026-09-02');
    expect(store.readDoc.mock.calls.map(([, id]) => id)).not.toContain(
      'history:us-east-1:2026-09-01'
    );
  });

  it('a window with a comparison day but no moves is an empty list, not a missing window', async () => {
    const store = storeWith([snapshot('2026-09-08', { 'compute-vm:aws': live(0.2) })]);
    const doc = await computePriceChanges({
      store,
      region: 'us-east-1',
      cells: { 'compute-vm:aws': live(0.2) },
      refreshedAt: REFRESHED_AT,
    });
    expect(doc.windows['7d']).toEqual({ since: '2026-09-08', sampleDay: '2026-09-08', items: [] });
    expect(doc.sampleDays).toBe(1);
  });
});

describe('emptyPriceChanges', () => {
  it('is the miss shape the public read answers', () => {
    expect(emptyPriceChanges('us-west-2')).toEqual({
      region: 'us-west-2',
      asOf: null,
      windows: {
        '7d': { since: null, sampleDay: null, items: [] },
        '30d': { since: null, sampleDay: null, items: [] },
      },
      sampleDays: 0,
    });
  });
});
