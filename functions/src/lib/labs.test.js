/**
 * Labs platform RPCs — pinned to labs-functions.js. Load-bearing: the
 * job-type allowlist + per-type payload byte caps (the enqueue-side
 * containment), the queued-only cancel rule, and the heartbeat staleness
 * math over ISO timestamps.
 */
import { describe, it, expect, vi } from 'vitest';
import { createLabHandlers, LAB_JOB_TYPES, JOB_STATUSES } from './labs.js';

const context = { log: vi.fn(), error: vi.fn() };

const USER = { oid: 'u1', email: 'editor@hcw.dev' };
const guardAs = (role) => ({ requireRole: vi.fn(async () => ({ user: USER, role, error: null })) });
const denyGuard = { requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })) };

const makeRequest = (body) => ({ headers: { get: () => 'vitest' }, json: async () => body ?? {} });

function makeStore(over = {}) {
  return {
    queryDocs: vi.fn(async () => []),
    readDoc: vi.fn(async () => null),
    upsertDoc: vi.fn(async (_c, d) => d),
    patchDoc: vi.fn(async (_c, id, u) => ({ id, ...u })),
    ...over,
  };
}

const NOW = new Date('2026-08-07T05:30:00.000Z');
const fixed = { now: () => NOW, uuid: () => 'fixed-uuid' };

describe('enqueueLabJob', () => {
  it('rejects unknown types and oversized payloads with the source codes', async () => {
    const store = makeStore();
    const h = createLabHandlers({ guard: guardAs('editor'), store, ...fixed });

    const unknown = await h.enqueueLabJob(makeRequest({ type: 'rm-rf' }), context);
    expect(unknown.status).toBe(400);
    expect(JSON.parse(unknown.body).error).toContain('shell-echo');

    const big = await h.enqueueLabJob(
      makeRequest({ type: 'shell-echo', payload: 'x'.repeat(4 * 1024 + 1) }),
      context
    );
    expect(big.status).toBe(413);

    expect((await h.enqueueLabJob(makeRequest({ type: 'shell-echo', payload: 42 }), context)).status).toBe(400);
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('queues a valid job with the source doc shape', async () => {
    const store = makeStore();
    const h = createLabHandlers({ guard: guardAs('editor'), store, ...fixed });
    const res = await h.enqueueLabJob(
      makeRequest({ type: 'terraform-validate', payload: 'resource {}' }),
      context
    );
    expect(JSON.parse(res.body)).toEqual({ jobId: 'fixed-uuid', type: 'terraform-validate', status: 'queued' });
    expect(store.upsertDoc.mock.calls[0][1]).toMatchObject({
      id: 'fixed-uuid',
      status: 'queued',
      requestedBy: 'u1',
      requestedByEmail: 'editor@hcw.dev',
      agentId: null,
      exitCode: null,
    });
  });
});

describe('getLabsSnapshot', () => {
  it('computes agent online state from ISO heartbeats and sorts jobs desc', async () => {
    const store = makeStore({
      queryDocs: vi.fn(async (container, query) => {
        if (query.includes('VALUE COUNT')) return [3];
        if (container === 'lab_agents') {
          return [
            { id: 'fresh', lastSeenAt: new Date(NOW.getTime() - 30_000).toISOString(), capabilities: ['shell-echo'] },
            { id: 'stale', lastSeenAt: new Date(NOW.getTime() - 120_000).toISOString() },
            { id: 'never' },
          ];
        }
        return [
          { id: 'old', createdAt: '2026-08-07T04:00:00Z', type: 'shell-echo', status: 'succeeded' },
          { id: 'new', createdAt: '2026-08-07T05:00:00Z', type: 'ansible-check', status: 'queued' },
        ];
      }),
    });
    const h = createLabHandlers({ guard: guardAs('viewer'), store, ...fixed });
    const body = JSON.parse((await h.getLabsSnapshot(makeRequest({}), context)).body);

    const online = Object.fromEntries(body.agents.map((a) => [a.agentId, a.online]));
    expect(online).toEqual({ fresh: true, stale: false, never: false });
    expect(body.jobs.map((j) => j.id)).toEqual(['new', 'old']);
    expect(body.queueDepth).toBe(3);
    expect(body.jobTypes.map((t) => t.type)).toEqual(Object.keys(LAB_JOB_TYPES));
    expect(body.statuses).toEqual(JOB_STATUSES);
  });
});

describe('cancelLabJob', () => {
  it('cancels only queued jobs; 404 missing, 409 otherwise', async () => {
    const h404 = createLabHandlers({ guard: guardAs('editor'), store: makeStore(), ...fixed });
    expect((await h404.cancelLabJob(makeRequest({ jobId: 'x' }), context)).status).toBe(404);

    const running = makeStore({ readDoc: vi.fn(async () => ({ id: 'j1', status: 'running' })) });
    const h409 = createLabHandlers({ guard: guardAs('editor'), store: running, ...fixed });
    expect((await h409.cancelLabJob(makeRequest({ jobId: 'j1' }), context)).status).toBe(409);
    expect(running.patchDoc).not.toHaveBeenCalled();

    const queued = makeStore({ readDoc: vi.fn(async () => ({ id: 'j1', status: 'queued' })) });
    const h = createLabHandlers({ guard: guardAs('editor'), store: queued, ...fixed });
    const res = await h.cancelLabJob(makeRequest({ jobId: 'j1' }), context);
    expect(JSON.parse(res.body)).toEqual({ jobId: 'j1', status: 'cancelled' });
    expect(queued.patchDoc.mock.calls[0][2]).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'u1',
      finishedAt: NOW.toISOString(),
    });
  });
});

describe('auth', () => {
  it('every handler denies with zero store calls', async () => {
    const store = makeStore();
    const h = createLabHandlers({ guard: denyGuard, store, ...fixed });
    for (const call of [
      h.enqueueLabJob(makeRequest({ type: 'shell-echo', payload: '' }), context),
      h.getLabsSnapshot(makeRequest({}), context),
      h.cancelLabJob(makeRequest({ jobId: 'j' }), context),
    ]) {
      expect((await call).status).toBe(403);
    }
    expect(store.queryDocs).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });
});

describe('getLabJob', () => {
  const makeStore = (over = {}) => ({
    queryDocs: vi.fn(async () => []),
    readDoc: vi.fn(async () => null),
    upsertDoc: vi.fn(),
    patchDoc: vi.fn(),
    ...over,
  });

  it('returns the job with its output for a viewer', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({
        id: 'job-1',
        type: 'shell-echo',
        status: 'succeeded',
        output: 'hello',
        exitCode: 0,
        payload: 'SECRETISH',
        createdAt: '2026-08-01T00:00:00Z',
      })),
    });
    const h = createLabHandlers({ guard: guardAs('viewer'), store, ...fixed });
    const res = await h.getLabJob(
      { method: 'GET', query: { get: (k) => (k === 'jobId' ? 'job-1' : null) } },
      context
    );
    const body = JSON.parse(res.body);
    expect(body.job.output).toBe('hello');
    expect(body.job.status).toBe('succeeded');
    // Projection only — the raw payload is not echoed back.
    expect(body.job).not.toHaveProperty('payload');
  });

  it('denial makes zero store calls; missing job 404s', async () => {
    const store = makeStore();
    const denied = createLabHandlers({ guard: denyGuard, store, ...fixed });
    const res = await denied.getLabJob(
      { method: 'GET', query: { get: () => 'job-1' } },
      context
    );
    expect(res.status).toBe(403);
    expect(store.readDoc).not.toHaveBeenCalled();

    const h = createLabHandlers({ guard: guardAs('viewer'), store, ...fixed });
    const miss = await h.getLabJob(
      { method: 'GET', query: { get: (k) => (k === 'jobId' ? 'nope' : null) } },
      context
    );
    expect(miss.status).toBe(404);
  });
});
