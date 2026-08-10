/**
 * The Labs agent API.
 *
 * The load-bearing assertions are about containment. This is the entire
 * surface a credential on a third-party VPS can reach, so what matters is not
 * that the happy path works but that a compromised agent cannot claim job
 * types it was not registered for, complete jobs it does not hold, report a
 * status that hides work, or grant itself new capabilities.
 */
import { describe, it, expect, vi } from 'vitest';
import { createLabAgentHandlers, AGENT_TERMINAL_STATUSES, OUTPUT_CAP_BYTES } from './lab-agent.js';

const context = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
const NOW = new Date('2026-08-10T04:00:00.000Z');

const allowGuard = (agent = {}) => ({
  requireAgent: vi.fn(async () => ({
    agent: { agentId: 'vps-1', active: true, capabilities: ['shell-echo'], ...agent },
    identity: { oid: 'oid-1' },
    error: null,
  })),
});
const denyGuard = () => ({
  requireAgent: vi.fn(async () => ({
    agent: null,
    identity: null,
    error: { status: 403, body: JSON.stringify({ ok: false, error: 'Agent access required' }) },
  })),
});

const emptyStore = () => ({
  queryDocs: vi.fn(async () => []),
  readDoc: vi.fn(async () => null),
  patchDoc: vi.fn(async () => ({})),
  replaceDocIfMatch: vi.fn(async (c, doc) => doc),
});

const req = (body) => ({ json: async () => body });
const make = (guard, store) => createLabAgentHandlers({ guard, store, now: () => NOW });

const parse = (res) => JSON.parse(res.body);

describe('every handler is guarded', () => {
  it.each(['claimLabJob', 'heartbeatAgent', 'completeLabJob'])(
    '%s makes zero store calls when the guard denies',
    async (name) => {
      const store = emptyStore();
      const h = make(denyGuard(), store);
      const res = await h[name](
        req({ agentId: 'vps-1', jobId: 'j1', status: 'succeeded' }),
        context
      );

      expect(res.status).toBe(403);
      for (const fn of Object.values(store)) expect(fn).not.toHaveBeenCalled();
    }
  );

  it.each(['claimLabJob', 'heartbeatAgent', 'completeLabJob'])(
    '%s rejects a malformed body before authenticating',
    async (name) => {
      const guard = allowGuard();
      const h = make(guard, emptyStore());
      const res = await h[name](
        {
          json: async () => {
            throw new Error('not json');
          },
        },
        context
      );

      expect(res.status).toBe(400);
      expect(guard.requireAgent).not.toHaveBeenCalled();
    }
  );
});

describe('claimLabJob', () => {
  const job = (over = {}) => ({
    id: 'j1',
    type: 'shell-echo',
    payload: 'hello',
    status: 'queued',
    createdAt: '2026-08-10T03:00:00.000Z',
    _etag: '"abc"',
    ...over,
  });

  it('claims the oldest matching job and returns only what the agent needs', async () => {
    const store = emptyStore();
    store.queryDocs = vi.fn(async () => [
      job({ id: 'newer', createdAt: '2026-08-10T03:30:00.000Z' }),
      job({ id: 'older', createdAt: '2026-08-10T03:00:00.000Z' }),
    ]);
    const h = make(allowGuard(), store);
    const res = await h.claimLabJob(req({ agentId: 'vps-1' }), context);

    const body = parse(res);
    expect(body.job.id).toBe('older');
    // Not the whole document: no _etag, no internal status, no agentId.
    expect(Object.keys(body.job).sort()).toEqual(['id', 'payload', 'type']);
  });

  it('scopes the query to the registry capabilities, not the request', async () => {
    // An agent that names its own capabilities can claim any job type, which
    // makes the enqueue-side LAB_JOB_TYPES allowlist decorative.
    const store = emptyStore();
    const h = make(allowGuard({ capabilities: ['shell-echo'] }), store);
    await h.claimLabJob(req({ agentId: 'vps-1', capabilities: ['terraform-validate'] }), context);

    const params = store.queryDocs.mock.calls[0][2];
    const types = params.find((p) => p.name === '@types');
    expect(types.value).toEqual(['shell-echo']);
  });

  it('returns no job, and touches nothing, for an agent with no capabilities', async () => {
    const store = emptyStore();
    const h = make(allowGuard({ capabilities: [] }), store);
    const res = await h.claimLabJob(req({ agentId: 'vps-1' }), context);

    expect(parse(res).job).toBeNull();
    expect(store.queryDocs).not.toHaveBeenCalled();
  });

  it('moves to the next candidate when it loses the claim race', async () => {
    const store = emptyStore();
    store.queryDocs = vi.fn(async () => [job({ id: 'contended' }), job({ id: 'free' })]);
    store.replaceDocIfMatch = vi.fn(async (container, doc) => {
      if (doc.id === 'contended') throw Object.assign(new Error('conflict'), { code: 412 });
      return doc;
    });
    const h = make(allowGuard(), store);
    const res = await h.claimLabJob(req({ agentId: 'vps-1' }), context);

    expect(parse(res).job.id).toBe('free');
    expect(store.replaceDocIfMatch).toHaveBeenCalledTimes(2);
  });

  it('500s on a write failure that is not a lost race', async () => {
    const store = emptyStore();
    store.queryDocs = vi.fn(async () => [job()]);
    store.replaceDocIfMatch = vi.fn(async () => {
      throw Object.assign(new Error('throttled'), { code: 429 });
    });
    const h = make(allowGuard(), store);
    const res = await h.claimLabJob(req({ agentId: 'vps-1' }), context);

    expect(res.status).toBe(500);
  });

  it('offers stale claimed jobs so a dead agent does not strand work', async () => {
    const store = emptyStore();
    const h = make(allowGuard(), store);
    await h.claimLabJob(req({ agentId: 'vps-1' }), context);

    const [, query, params] = store.queryDocs.mock.calls[0];
    expect(query).toContain("c.status = 'claimed'");
    const stale = params.find((p) => p.name === '@staleBefore');
    expect(new Date(stale.value).getTime()).toBeLessThan(NOW.getTime());
  });

  it('reports no work rather than failing when nothing matches', async () => {
    const h = make(allowGuard(), emptyStore());
    const res = await h.claimLabJob(req({ agentId: 'vps-1' }), context);

    expect(res.status).toBe(200);
    expect(parse(res).job).toBeNull();
  });
});

describe('heartbeatAgent', () => {
  it('writes lastSeenAt, the field the Labs snapshot actually reads', async () => {
    // The stub agent wrote lastPing while labs.js reads lastSeenAt, so the
    // connected indicator could never be true (TODO.md T-401).
    const store = emptyStore();
    const h = make(allowGuard(), store);
    await h.heartbeatAgent(req({ agentId: 'vps-1', status: 'idle' }), context);

    const [container, id, updates] = store.patchDoc.mock.calls[0];
    expect(container).toBe('lab_agents');
    expect(id).toBe('vps-1');
    expect(updates.lastSeenAt).toBe(NOW.toISOString());
    expect(updates).not.toHaveProperty('lastPing');
  });

  it('never sends undefined values, which patchDoc would treat as deletions', async () => {
    const store = emptyStore();
    const h = make(allowGuard(), store);
    await h.heartbeatAgent(req({ agentId: 'vps-1' }), context);

    const updates = store.patchDoc.mock.calls[0][2];
    expect(Object.values(updates).every((v) => v !== undefined)).toBe(true);
    expect(updates).not.toHaveProperty('hostname');
  });

  it('refuses to let the agent grant itself capabilities or rebind its identity', async () => {
    const store = emptyStore();
    const h = make(allowGuard(), store);
    await h.heartbeatAgent(
      req({
        agentId: 'vps-1',
        capabilities: ['terraform-validate'],
        oid: 'attacker',
        active: true,
      }),
      context
    );

    const updates = store.patchDoc.mock.calls[0][2];
    expect(updates).not.toHaveProperty('capabilities');
    expect(updates).not.toHaveProperty('oid');
    expect(updates).not.toHaveProperty('active');
  });

  it('derives busy from activeJobs rather than trusting the reported status', async () => {
    const store = emptyStore();
    const h = make(allowGuard(), store);
    await h.heartbeatAgent(req({ agentId: 'vps-1', status: 'idle', activeJobs: 2 }), context);

    expect(store.patchDoc.mock.calls[0][2].status).toBe('busy');
  });

  it('falls back to idle for an unrecognised status', async () => {
    const store = emptyStore();
    const h = make(allowGuard(), store);
    await h.heartbeatAgent(req({ agentId: 'vps-1', status: 'pwned' }), context);

    expect(store.patchDoc.mock.calls[0][2].status).toBe('idle');
  });
});

describe('completeLabJob', () => {
  const held = (over = {}) => ({ id: 'j1', status: 'claimed', agentId: 'vps-1', ...over });

  it('records a terminal result for a job the agent holds', async () => {
    const store = emptyStore();
    store.readDoc = vi.fn(async () => held());
    const h = make(allowGuard(), store);
    const res = await h.completeLabJob(
      req({ agentId: 'vps-1', jobId: 'j1', status: 'succeeded', exitCode: 0, output: 'done' }),
      context
    );

    expect(res.status).toBe(200);
    const updates = store.patchDoc.mock.calls[0][2];
    expect(updates).toMatchObject({ status: 'succeeded', exitCode: 0, output: 'done' });
    expect(updates.finishedAt).toBe(NOW.toISOString());
  });

  it('refuses a job held by another agent', async () => {
    // Otherwise the results surface is an arbitrary write.
    const store = emptyStore();
    store.readDoc = vi.fn(async () => held({ agentId: 'vps-2' }));
    const h = make(allowGuard(), store);
    const res = await h.completeLabJob(
      req({ agentId: 'vps-1', jobId: 'j1', status: 'succeeded' }),
      context
    );

    expect(res.status).toBe(403);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'queued', 'claimed', 'running', 'nonsense'])(
    'refuses the non-agent status %s',
    async (status) => {
      const store = emptyStore();
      const h = make(allowGuard(), store);
      const res = await h.completeLabJob(req({ agentId: 'vps-1', jobId: 'j1', status }), context);

      expect(res.status).toBe(400);
      expect(store.readDoc).not.toHaveBeenCalled();
    }
  );

  it('accepts exactly the three terminal statuses', () => {
    expect(AGENT_TERMINAL_STATUSES).toEqual(['succeeded', 'failed', 'timeout']);
  });

  it('will not reopen a cancelled job', async () => {
    const store = emptyStore();
    store.readDoc = vi.fn(async () => held({ status: 'cancelled' }));
    const h = make(allowGuard(), store);
    const res = await h.completeLabJob(
      req({ agentId: 'vps-1', jobId: 'j1', status: 'succeeded' }),
      context
    );

    expect(res.status).toBe(409);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('404s an unknown job', async () => {
    const store = emptyStore();
    const h = make(allowGuard(), store);
    const res = await h.completeLabJob(
      req({ agentId: 'vps-1', jobId: 'ghost', status: 'failed' }),
      context
    );

    expect(res.status).toBe(404);
  });

  it('requires a jobId', async () => {
    const store = emptyStore();
    const h = make(allowGuard(), store);
    const res = await h.completeLabJob(req({ agentId: 'vps-1', status: 'failed' }), context);

    expect(res.status).toBe(400);
    expect(store.readDoc).not.toHaveBeenCalled();
  });

  it('clamps output so a compromised agent cannot inflate storage', async () => {
    const store = emptyStore();
    store.readDoc = vi.fn(async () => held());
    const h = make(allowGuard(), store);
    await h.completeLabJob(
      req({
        agentId: 'vps-1',
        jobId: 'j1',
        status: 'failed',
        output: 'x'.repeat(OUTPUT_CAP_BYTES * 3),
      }),
      context
    );

    expect(store.patchDoc.mock.calls[0][2].output).toHaveLength(OUTPUT_CAP_BYTES);
  });

  it('defaults a non-integer exit code rather than storing it', async () => {
    const store = emptyStore();
    store.readDoc = vi.fn(async () => held());
    const h = make(allowGuard(), store);
    await h.completeLabJob(
      req({ agentId: 'vps-1', jobId: 'j1', status: 'failed', exitCode: 'boom' }),
      context
    );

    expect(store.patchDoc.mock.calls[0][2].exitCode).toBe(-1);
  });
});
