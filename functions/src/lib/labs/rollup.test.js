import { describe, it, expect, vi } from 'vitest';
import {
  CODER_STATUS_CACHE_ID,
  DAY_JOBS_QUERY,
  ESTATE_CACHE_ID,
  LABS_DAY_TTL_SECONDS,
  MAX_JOB_TYPES,
  arcConnectedFrom,
  coderRunningFrom,
  computeDayRollup,
  createLabsDayRollup,
  dayBounds,
  jobsByTypeFrom,
  labsDayDocId,
  mergeArc,
  mergeMax,
  readLabsWeek,
  shiftDay,
} from './rollup.js';

const DAY = '2026-09-24';
const AT = new Date('2026-09-24T23:55:00.000Z');

/** A `labs:estate` minute-cache document as estate.js writes it: `value` is `{ status, body }`. */
const estateDoc = (body, over = {}) => ({
  id: ESTATE_CACHE_ID,
  kind: 'labs-estate',
  value: { status: 200, body },
  cachedAt: '2026-09-24T23:54:30.000Z',
  ttl: 60,
  ...over,
});
const connected = (body = {}, over = {}) =>
  estateDoc(
    {
      configured: true,
      arc: { status: 'Connected', lastHeartbeatAt: '2026-09-24T20:00:00Z', agentVersion: '1.50', osName: 'linux' },
      policy: { compliant: 3, nonCompliant: 0 },
      agent: { online: true, queued: 0 },
      coder: { reachable: true, running: 2, max: 5 },
      asOf: '2026-09-24T23:54:30.000Z',
      ...body,
    },
    over
  );
/** A `labs:coder-status` document: `value` is the status body itself. */
const coderDoc = (running, over = {}) => ({
  id: CODER_STATUS_CACHE_ID,
  kind: 'labs-coder-status',
  value: { configured: true, reachable: true, templates: [], capacity: { running, max: 5 }, asOf: '2026-09-24T23:54:00Z' },
  cachedAt: '2026-09-24T23:54:00.000Z',
  ttl: 60,
  ...over,
});

/** A store over a map keyed `container/id`; the lab_jobs query answers `rows`. */
function makeStore(docs = {}, rows = []) {
  const written = new Map(Object.entries(docs));
  return {
    written,
    readDoc: vi.fn(async (container, id) => written.get(`${container}/${id}`) ?? null),
    upsertDoc: vi.fn(async (container, doc) => {
      written.set(`${container}/${doc.id}`, doc);
      return doc;
    }),
    queryDocs: vi.fn(async () => rows),
  };
}

describe('day arithmetic', () => {
  it('names the document by UTC day and bounds the day as a half-open ISO range', () => {
    expect(labsDayDocId(DAY)).toBe('labs:day:2026-09-24');
    expect(dayBounds(DAY)).toEqual({ from: '2026-09-24T00:00:00.000Z', to: '2026-09-25T00:00:00.000Z' });
    expect(shiftDay('2026-10-01', 1)).toBe('2026-09-30');
    expect(shiftDay('2026-03-01', 7)).toBe('2026-02-22');
    expect(() => labsDayDocId('24/09/2026')).toThrow(/not a UTC day/);
  });
});

describe('arcConnectedFrom', () => {
  it('is true for a configured estate whose Arc status is Connected, in any case', () => {
    expect(arcConnectedFrom(connected(), DAY)).toBe(true);
    expect(arcConnectedFrom(connected({ arc: { status: 'connected' } }), DAY)).toBe(true);
  });

  it('is false for a configured estate seen in any other state', () => {
    for (const status of ['Disconnected', 'Error', 'Expired', '', null]) {
      expect(arcConnectedFrom(connected({ arc: { status } }), DAY), String(status)).toBe(false);
    }
  });

  it('is null — not observed — for a missing, stale, unavailable or unconfigured estate', () => {
    expect(arcConnectedFrom(null, DAY)).toBeNull();
    expect(arcConnectedFrom(connected({}, { cachedAt: '2026-09-23T23:59:59.000Z' }), DAY)).toBeNull();
    expect(arcConnectedFrom(connected({}, { cachedAt: 'never' }), DAY)).toBeNull();
    expect(arcConnectedFrom(estateDoc({ error: 'unavailable' }, { value: { status: 503, body: { error: 'x' } } }), DAY)).toBeNull();
    expect(arcConnectedFrom(estateDoc({ configured: false }), DAY)).toBeNull();
    expect(arcConnectedFrom({ id: ESTATE_CACHE_ID }, DAY)).toBeNull();
  });
});

describe('coderRunningFrom', () => {
  it('takes the larger of the estate and Coder samples, and null when neither has one', () => {
    expect(coderRunningFrom(connected(), coderDoc(4), DAY)).toBe(4);
    expect(coderRunningFrom(connected(), coderDoc(1), DAY)).toBe(2);
    expect(coderRunningFrom(connected({ coder: null }), coderDoc(1), DAY)).toBe(1);
    expect(coderRunningFrom(connected(), null, DAY)).toBe(2);
    expect(coderRunningFrom(null, null, DAY)).toBeNull();
    // An unreachable Coder reports running: null; unknown stays unknown.
    expect(coderRunningFrom(connected({ coder: { reachable: false, running: null, max: 5 } }), coderDoc(null), DAY)).toBeNull();
    expect(coderRunningFrom(null, coderDoc(3, { value: { configured: false } }), DAY)).toBeNull();
    expect(coderRunningFrom(null, coderDoc(3, { cachedAt: '2026-09-23T10:00:00Z' }), DAY)).toBeNull();
  });
});

describe('jobsByTypeFrom', () => {
  it('folds the grouped rows into counts per type, sorted by type, with unknown statuses and unreadable counts dropped', () => {
    expect(
      jobsByTypeFrom([
        { type: 'terraform-validate', status: 'succeeded', n: 5 },
        { type: 'terraform-validate', status: 'failed', n: 1 },
        { type: 'ansible-check', status: 'timeout', n: 2 },
        { type: 'ansible-check', status: 'cancelled', n: 9 },
        // Cosmos counts are numbers; a row that is not one is not a count.
        { type: 'shell-echo', status: 'succeeded', n: '3' },
        { type: '', status: 'succeeded', n: 1 },
        { type: 'shell-echo', status: 'succeeded', n: -1 },
        { type: 'shell-echo', status: 'succeeded', n: 1.5 },
        null,
      ])
    ).toEqual({
      'ansible-check': { succeeded: 0, failed: 0, timeout: 2 },
      'terraform-validate': { succeeded: 5, failed: 1, timeout: 0 },
    });
    expect(jobsByTypeFrom(undefined)).toEqual({});
  });

  it('caps the number of types it keeps', () => {
    const rows = Array.from({ length: MAX_JOB_TYPES + 5 }, (_, i) => ({ type: `t${String(i).padStart(2, '0')}`, status: 'succeeded', n: 1 }));
    expect(Object.keys(jobsByTypeFrom(rows))).toHaveLength(MAX_JOB_TYPES);
  });
});

describe('merging a rerun', () => {
  it('keeps a connected observation, keeps an observation over none, and the larger Coder peak', () => {
    expect(mergeArc(null, null)).toBeNull();
    expect(mergeArc(true, null)).toBe(true);
    expect(mergeArc(null, false)).toBe(false);
    expect(mergeArc(false, true)).toBe(true);
    expect(mergeArc(true, false)).toBe(true);
    expect(mergeMax(null, null)).toBeNull();
    expect(mergeMax(3, null)).toBe(3);
    expect(mergeMax(null, 2)).toBe(2);
    expect(mergeMax(3, 5)).toBe(5);
    expect(mergeMax('3', 1)).toBe(1);
  });
});

describe('computeDayRollup', () => {
  it('builds the day document with a sixty-day TTL from the caches and the grouped rows', () => {
    const doc = computeDayRollup({
      day: DAY,
      estateDoc: connected(),
      coderDoc: coderDoc(3),
      jobRows: [{ type: 'terraform-validate', status: 'succeeded', n: 2 }],
      previous: null,
      asOf: AT.toISOString(),
    });
    expect(doc).toEqual({
      id: 'labs:day:2026-09-24',
      kind: 'labs-day',
      day: DAY,
      arcConnected: true,
      jobsByType: { 'terraform-validate': { succeeded: 2, failed: 0, timeout: 0 } },
      coderRunningMax: 3,
      asOf: '2026-09-24T23:55:00.000Z',
      ttl: LABS_DAY_TTL_SECONDS,
    });
    expect(LABS_DAY_TTL_SECONDS).toBe(60 * 24 * 60 * 60);
  });

  it('with nothing observed writes nulls and an empty map — a day the section counts as unobserved', () => {
    expect(computeDayRollup({ day: DAY, estateDoc: null, coderDoc: null, jobRows: [], previous: null, asOf: AT.toISOString() })).toMatchObject({
      arcConnected: null,
      jobsByType: {},
      coderRunningMax: null,
    });
  });

  it('merges over a document a previous run wrote for the same day', () => {
    const previous = { id: 'labs:day:2026-09-24', arcConnected: true, coderRunningMax: 4, jobsByType: { 'shell-echo': { succeeded: 9, failed: 0, timeout: 0 } } };
    const doc = computeDayRollup({ day: DAY, estateDoc: null, coderDoc: coderDoc(1), jobRows: [], previous, asOf: AT.toISOString() });
    expect(doc.arcConnected).toBe(true);
    expect(doc.coderRunningMax).toBe(4);
    // Job counts come from the query, which covers the whole day so far.
    expect(doc.jobsByType).toEqual({});
  });
});

describe('createLabsDayRollup', () => {
  it('makes three point reads and one bounded grouped query, then upserts the day document', async () => {
    const store = makeStore(
      { [`tool_service_cache/${ESTATE_CACHE_ID}`]: connected(), [`tool_service_cache/${CODER_STATUS_CACHE_ID}`]: coderDoc(1) },
      [
        { type: 'terraform-validate', status: 'succeeded', n: 3 },
        { type: 'terraform-validate', status: 'timeout', n: 1 },
      ]
    );
    const result = await createLabsDayRollup({ store, now: () => AT }).run();

    expect(result).toEqual({ id: 'labs:day:2026-09-24', day: DAY, arcConnected: true, jobs: 4, coderRunningMax: 2, merged: false });
    expect(store.readDoc.mock.calls.map(([c, id, pk]) => [c, id, pk])).toEqual([
      ['tool_service_cache', 'labs:estate', 'labs:estate'],
      ['tool_service_cache', 'labs:coder-status', 'labs:coder-status'],
      ['tool_service_cache', 'labs:day:2026-09-24', 'labs:day:2026-09-24'],
    ]);
    expect(store.queryDocs).toHaveBeenCalledTimes(1);
    const [container, sql, params] = store.queryDocs.mock.calls[0];
    expect(container).toBe('lab_jobs');
    expect(sql).toBe(DAY_JOBS_QUERY);
    expect(sql).toMatch(/^SELECT c\.type, c\.status, COUNT\(1\) AS n FROM c WHERE c\.createdAt >= @from AND c\.createdAt < @to/);
    expect(sql).toMatch(/GROUP BY c\.type, c\.status$/);
    expect(sql).not.toMatch(/finishedAt/);
    expect(params).toEqual([
      { name: '@from', value: '2026-09-24T00:00:00.000Z' },
      { name: '@to', value: '2026-09-25T00:00:00.000Z' },
    ]);
    const written = store.written.get('tool_service_cache/labs:day:2026-09-24');
    expect(written).toMatchObject({ kind: 'labs-day', ttl: LABS_DAY_TTL_SECONDS, arcConnected: true, coderRunningMax: 2 });
    expect(written.jobsByType).toEqual({ 'terraform-validate': { succeeded: 3, failed: 0, timeout: 1 } });
  });

  it('reports a rerun as merged and lets a store failure surface', async () => {
    const store = makeStore({ 'tool_service_cache/labs:day:2026-09-24': { id: 'labs:day:2026-09-24', kind: 'labs-day', arcConnected: false, coderRunningMax: null, jobsByType: {} } });
    const result = await createLabsDayRollup({ store, now: () => AT }).run();
    expect(result).toMatchObject({ merged: true, arcConnected: false, jobs: 0 });

    const broken = makeStore();
    broken.queryDocs.mockRejectedValue(new Error('container gone'));
    await expect(createLabsDayRollup({ store: broken, now: () => AT }).run()).rejects.toThrow('container gone');
    expect(broken.upsertDoc).not.toHaveBeenCalled();
  });
});

describe('readLabsWeek', () => {
  it('point-reads the seven days ending yesterday, newest first, and skips the missing ones', async () => {
    const day = (d, over = {}) => ({ id: `labs:day:${d}`, kind: 'labs-day', day: d, arcConnected: true, jobsByType: {}, coderRunningMax: null, ...over });
    const store = makeStore({
      'tool_service_cache/labs:day:2026-09-23': day('2026-09-23'),
      'tool_service_cache/labs:day:2026-09-20': day('2026-09-20'),
      // Today's document, and one from before the week: neither is read.
      'tool_service_cache/labs:day:2026-09-24': day('2026-09-24'),
      'tool_service_cache/labs:day:2026-09-16': day('2026-09-16'),
      // A foreign document under a day id is not a day document.
      'tool_service_cache/labs:day:2026-09-21': { id: 'labs:day:2026-09-21', kind: 'other' },
    });
    const docs = await readLabsWeek({ store, until: new Date('2026-09-24T13:00:00Z') });
    expect(docs.map((d) => d.day)).toEqual(['2026-09-23', '2026-09-20']);
    expect(store.readDoc.mock.calls.map(([, id]) => id)).toEqual([
      'labs:day:2026-09-23',
      'labs:day:2026-09-22',
      'labs:day:2026-09-21',
      'labs:day:2026-09-20',
      'labs:day:2026-09-19',
      'labs:day:2026-09-18',
      'labs:day:2026-09-17',
    ]);
  });
});
