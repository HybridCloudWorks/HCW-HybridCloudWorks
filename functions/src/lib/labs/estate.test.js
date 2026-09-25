import { describe, expect, it, vi } from 'vitest';

import { CACHE_CONTAINER } from '../cloud-tools/history.js';
import {
  ARC_MACHINE_QUERY,
  ESTATE_CACHE_ID,
  ESTATE_CACHE_SECONDS,
  LAB_RESOURCE_GROUP,
  POLICY_COMPLIANCE_QUERY,
  createEstateHandlers,
  shapeArcRow,
  shapePolicyRows,
} from './estate.js';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const context = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
const request = () => ({ method: 'GET', query: { get: () => null } });
const body = (res) => JSON.parse(res.body);

const MACHINE_ROW = {
  status: 'Connected',
  lastStatusChange: '2026-09-25T11:52:10.1234567Z',
  agentVersion: '1.52.02690.2014',
  osName: 'ubuntu',
};
const POLICY_ROWS = [
  { complianceState: 'Compliant', count_: 4 },
  { complianceState: 'NonCompliant', count_: 1 },
  { complianceState: 'Exempt', count_: 2 },
];

/** Resource Graph that answers by query text. */
const armFor = (byQuery) => ({
  query: vi.fn(async (kql) => {
    const hit = byQuery[kql];
    if (hit === undefined) throw new Error(`unexpected query: ${kql}`);
    return typeof hit === 'function' ? hit() : hit;
  }),
});
const HEALTHY_ARM = { [ARC_MACHINE_QUERY]: [MACHINE_ROW], [POLICY_COMPLIANCE_QUERY]: POLICY_ROWS };

const makeStore = (over = {}) => ({
  readDoc: vi.fn(async () => null),
  upsertDoc: vi.fn(async (_c, d) => d),
  queryDocs: vi.fn(async (container) =>
    container === 'lab_agents'
      ? [{ lastSeenAt: new Date(NOW - 10_000).toISOString() }]
      : container === 'lab_jobs'
        ? [3]
        : []
  ),
  ...over,
});

const coderFor = (status) => ({ readStatus: vi.fn(async () => status) });
const HEALTHY_CODER = {
  configured: true,
  reachable: true,
  templates: [{ name: 'hcw-lab', activeVersion: 'v7' }],
  capacity: { running: 1, max: 5 },
  asOf: 'x',
};

const handlers = ({ store = makeStore(), arm = armFor(HEALTHY_ARM), coderStatus = coderFor(HEALTHY_CODER) } = {}) =>
  createEstateHandlers({ store, arm, coderStatus, now: () => NOW });

describe('the KQL', () => {
  it('is exactly this, single-quoted, scoped to the lab group, and never projects the machine name', () => {
    expect(ARC_MACHINE_QUERY).toBe(
      "resources | where type =~ 'microsoft.hybridcompute/machines' and resourceGroup =~ 'rg-lab-hybrid-prod-cus' | project status = tostring(properties.status), lastStatusChange = tostring(properties.lastStatusChange), agentVersion = tostring(properties.agentVersion), osName = tostring(properties.osName) | take 1"
    );
    expect(POLICY_COMPLIANCE_QUERY).toBe(
      "policyresources | where type =~ 'microsoft.policyinsights/policystates' and tostring(properties.resourceGroup) =~ 'rg-lab-hybrid-prod-cus' | summarize count() by complianceState = tostring(properties.complianceState)"
    );
    expect(LAB_RESOURCE_GROUP).toBe('rg-lab-hybrid-prod-cus');
    expect(ARC_MACHINE_QUERY).not.toContain('"');
    expect(POLICY_COMPLIANCE_QUERY).not.toContain('"');
    expect(ARC_MACHINE_QUERY).not.toMatch(/project[^|]*\bname\b/);
  });
});

describe('shapeArcRow / shapePolicyRows', () => {
  it('normalises the timestamp and blanks to null', () => {
    expect(shapeArcRow(MACHINE_ROW)).toEqual({
      status: 'Connected',
      lastHeartbeatAt: '2026-09-25T11:52:10.123Z',
      agentVersion: '1.52.02690.2014',
      osName: 'ubuntu',
    });
    expect(shapeArcRow({ status: '', lastStatusChange: 'never', agentVersion: null })).toEqual({
      status: null,
      lastHeartbeatAt: null,
      agentVersion: null,
      osName: null,
    });
  });

  it('counts compliant and non-compliant, ignores other states, and is zeros for no rows', () => {
    expect(shapePolicyRows(POLICY_ROWS)).toEqual({ compliant: 4, nonCompliant: 1 });
    expect(shapePolicyRows([])).toEqual({ compliant: 0, nonCompliant: 0 });
    expect(shapePolicyRows([{ complianceState: 'Compliant', count_: 'lots' }])).toEqual({ compliant: 0, nonCompliant: 0 });
  });
});

describe('GET /api/public/labs/estate', () => {
  it('resource group absent (no machine row): { configured: false }, cached, nothing else read', async () => {
    const store = makeStore();
    const arm = armFor({ [ARC_MACHINE_QUERY]: [] });
    const coderStatus = coderFor(HEALTHY_CODER);
    const res = await handlers({ store, arm, coderStatus }).getEstate(request(), context);

    expect(res.status).toBe(200);
    expect(body(res)).toEqual({ configured: false });
    expect(res.headers['Cache-Control']).toBe(`public, max-age=${ESTATE_CACHE_SECONDS}`);
    expect(arm.query).toHaveBeenCalledTimes(1);
    expect(store.queryDocs).not.toHaveBeenCalled();
    expect(coderStatus.readStatus).not.toHaveBeenCalled();
    expect(store.upsertDoc).toHaveBeenCalledWith(
      CACHE_CONTAINER,
      expect.objectContaining({ id: ESTATE_CACHE_ID, value: { status: 200, body: { configured: false } }, ttl: 60 })
    );
  });

  it('unscoped process (no subscription known): { configured: false }, not an outage', async () => {
    const arm = {
      query: vi.fn(async () => {
        throw Object.assign(new Error('unscoped'), { code: 'ARG_UNSCOPED' });
      }),
    };
    const res = await handlers({ arm }).getEstate(request(), context);
    expect(body(res)).toEqual({ configured: false });
  });

  it('Azure cannot be read: 503, not "not provisioned", and the 503 is cached for the minute', async () => {
    const store = makeStore();
    const arm = {
      query: vi.fn(async () => {
        throw Object.assign(new Error('Resource Graph answered 403'), { status: 403 });
      }),
    };
    const res = await handlers({ store, arm }).getEstate(request(), context);

    expect(res.status).toBe(503);
    expect(body(res)).toEqual({ error: 'Labs estate status is unavailable' });
    expect(res.headers['Cache-Control']).toBeUndefined();
    expect(store.upsertDoc).toHaveBeenCalledWith(
      CACHE_CONTAINER,
      expect.objectContaining({ value: expect.objectContaining({ status: 503 }) })
    );
  });

  it('healthy: the four blocks, from the machine row, the policy counts, the lab stores and the Coder read', async () => {
    const store = makeStore();
    const res = await handlers({ store }).getEstate(request(), context);

    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toBe(`public, max-age=${ESTATE_CACHE_SECONDS}`);
    expect(body(res)).toEqual({
      configured: true,
      arc: {
        status: 'Connected',
        lastHeartbeatAt: '2026-09-25T11:52:10.123Z',
        agentVersion: '1.52.02690.2014',
        osName: 'ubuntu',
      },
      policy: { compliant: 4, nonCompliant: 1 },
      agent: { online: true, queued: 3 },
      coder: { reachable: true, running: 1, max: 5 },
      asOf: new Date(NOW).toISOString(),
    });
    expect(store.queryDocs).toHaveBeenCalledWith('lab_agents', 'SELECT TOP 200 c.lastSeenAt FROM c', []);
    expect(store.queryDocs).toHaveBeenCalledWith(
      'lab_jobs',
      "SELECT VALUE COUNT(1) FROM c WHERE c.status = 'queued'",
      []
    );
  });

  it('agent is offline after three missed heartbeats, by the snapshot clock', async () => {
    const store = makeStore({
      queryDocs: vi.fn(async (container) =>
        container === 'lab_agents' ? [{ lastSeenAt: new Date(NOW - 91_000).toISOString() }] : [0]
      ),
    });
    const res = await handlers({ store }).getEstate(request(), context);
    expect(body(res).agent).toEqual({ online: false, queued: 0 });
  });

  it('a failed side read is null, never zero: policy, agent and Coder each on their own', async () => {
    const policyDown = armFor({
      [ARC_MACHINE_QUERY]: [MACHINE_ROW],
      [POLICY_COMPLIANCE_QUERY]: () => {
        throw new Error('policy read refused');
      },
    });
    let res = await handlers({ arm: policyDown }).getEstate(request(), context);
    expect(body(res).policy).toBeNull();
    expect(body(res).agent).toEqual({ online: true, queued: 3 });

    const storeDown = makeStore({
      queryDocs: vi.fn(async () => {
        throw new Error('cosmos down');
      }),
    });
    res = await handlers({ store: storeDown }).getEstate(request(), context);
    expect(body(res).agent).toBeNull();
    expect(body(res).policy).toEqual({ compliant: 4, nonCompliant: 1 });

    res = await handlers({
      coderStatus: {
        readStatus: vi.fn(async () => {
          throw new Error('boom');
        }),
      },
    }).getEstate(request(), context);
    expect(body(res).coder).toBeNull();
  });

  it('Coder unconfigured is null; Coder unreachable is reachable false with running null', async () => {
    let res = await handlers({ coderStatus: coderFor({ configured: false }) }).getEstate(request(), context);
    expect(body(res).coder).toBeNull();

    res = await handlers({
      coderStatus: coderFor({ configured: true, reachable: false, templates: [], capacity: { running: null, max: 5 } }),
    }).getEstate(request(), context);
    expect(body(res).coder).toEqual({ reachable: false, running: null, max: 5 });
  });

  it('no policy rows at all is honest zeros, because Resource Graph answered', async () => {
    const arm = armFor({ [ARC_MACHINE_QUERY]: [MACHINE_ROW], [POLICY_COMPLIANCE_QUERY]: [] });
    const res = await handlers({ arm }).getEstate(request(), context);
    expect(body(res).policy).toEqual({ compliant: 0, nonCompliant: 0 });
  });

  it('never carries a hostname, address or secret', async () => {
    const arm = armFor({
      [ARC_MACHINE_QUERY]: [{ ...MACHINE_ROW, name: 'vps-hcw-lab-01', id: '/subscriptions/x/…' }],
      [POLICY_COMPLIANCE_QUERY]: POLICY_ROWS,
    });
    const res = await handlers({ arm }).getEstate(request(), context);
    expect(res.body).not.toContain('vps-hcw-lab-01');
    expect(res.body).not.toContain('/subscriptions/');
    expect(Object.keys(body(res).arc)).toEqual(['status', 'lastHeartbeatAt', 'agentVersion', 'osName']);
  });

  it('cache hit: serves the stored answer — including a stored 503 — and calls nothing', async () => {
    const stored = (value) => ({
      id: ESTATE_CACHE_ID,
      value,
      cachedAt: new Date(NOW - 20_000).toISOString(),
    });
    const arm = armFor(HEALTHY_ARM);
    const coderStatus = coderFor(HEALTHY_CODER);

    let store = makeStore({ readDoc: vi.fn(async () => stored({ status: 200, body: { configured: false } })) });
    let res = await handlers({ store, arm, coderStatus }).getEstate(request(), context);
    expect(body(res)).toEqual({ configured: false });
    expect(res.headers['Cache-Control']).toBe(`public, max-age=${ESTATE_CACHE_SECONDS}`);

    store = makeStore({
      readDoc: vi.fn(async () => stored({ status: 503, body: { error: 'Labs estate status is unavailable' } })),
    });
    res = await handlers({ store, arm, coderStatus }).getEstate(request(), context);
    expect(res.status).toBe(503);

    expect(arm.query).not.toHaveBeenCalled();
    expect(coderStatus.readStatus).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('a stale entry is rebuilt live', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({
        id: ESTATE_CACHE_ID,
        value: { status: 200, body: { configured: false } },
        cachedAt: new Date(NOW - 60_000).toISOString(),
      })),
    });
    const arm = armFor(HEALTHY_ARM);
    const res = await handlers({ store, arm }).getEstate(request(), context);
    expect(body(res).configured).toBe(true);
    expect(arm.query).toHaveBeenCalledTimes(2);
  });

  it('answers 500 when something outside the guarded paths throws', async () => {
    const error = vi.fn();
    const h = createEstateHandlers({
      store: makeStore(),
      arm: armFor(HEALTHY_ARM),
      coderStatus: coderFor(HEALTHY_CODER),
      now: () => {
        throw new Error('clock broke');
      },
    });
    const res = await h.getEstate(request(), { ...context, error });
    expect(res.status).toBe(500);
    expect(body(res)).toEqual({ error: 'Failed to read the labs estate' });
    expect(error).toHaveBeenCalled();
  });
});
