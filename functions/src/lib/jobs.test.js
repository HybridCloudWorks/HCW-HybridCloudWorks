/**
 * Platform jobs (T-322) — the contract every long handler will sit on.
 * Load-bearing: the type allowlist and payload cap at enqueue, the
 * etag-conditioned claim (at-least-once delivery must not run a job twice),
 * the three terminal outcomes, and that a job-level failure never throws
 * back into the queue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createJobHandlers,
  registerJobType,
  getJobType,
  listJobTypes,
  resetJobTypes,
  publicJob,
  JOBS_CONTAINER,
  TERMINAL_JOB_STATUSES,
} from './jobs.js';

const context = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
const USER = { oid: 'u1', email: 'editor@hcw.dev' };
const guardAs = (role) => ({
  requireRole: vi.fn(async () => ({ user: USER, role, error: null })),
});
const denyGuard = {
  requireRole: vi.fn(async () => ({
    user: null,
    role: null,
    error: { status: 403, body: '{}' },
  })),
};

const makeRequest = (body, { method = 'POST', query = {} } = {}) => ({
  method,
  headers: { get: () => 'vitest' },
  query: { get: (k) => query[k] ?? null },
  json: async () => body ?? {},
});

function makeStore(docs = {}) {
  const etags = new Map();
  return {
    docs,
    readDoc: vi.fn(async (_c, id) =>
      docs[id] ? { ...docs[id], _etag: etags.get(id) ?? 'e1' } : null
    ),
    upsertDoc: vi.fn(async (_c, d) => {
      docs[d.id] = { ...d };
      return d;
    }),
    patchDoc: vi.fn(async (_c, id, u) => {
      docs[id] = { ...docs[id], ...u };
      return docs[id];
    }),
    replaceDocIfMatch: vi.fn(async (_c, d) => {
      const { _etag, ...rest } = d;
      docs[d.id] = rest;
      etags.set(d.id, 'e2');
      return rest;
    }),
  };
}

const NOW = new Date('2026-08-21T05:00:00.000Z');
const fixed = { now: () => NOW, uuid: () => 'job-1' };

beforeEach(() => {
  resetJobTypes();
  vi.clearAllMocks();
});

describe('registry', () => {
  it('ships noop and refuses bad registrations', () => {
    expect(getJobType('noop')).toMatchObject({
      type: 'noop',
      role: 'editor',
      maxPayloadBytes: 1024,
    });
    expect(() => registerJobType('Bad Name', { worker: async () => {} })).toThrow(/kebab-case/);
    expect(() => registerJobType('no-worker', {})).toThrow(/worker/);
    expect(() => registerJobType('noop', { worker: async () => {} })).toThrow(/already registered/);
    expect(listJobTypes().map((t) => t.type)).toEqual(['noop']);
  });
});

describe('enqueueJob', () => {
  it('requires the editor role before reading the body', async () => {
    const store = makeStore();
    const h = createJobHandlers({ guard: denyGuard, store, ...fixed });
    const res = await h.enqueueJob(makeRequest({ type: 'noop' }), context, {
      enqueue: vi.fn(),
    });
    expect(res.status).toBe(403);
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('rejects unknown types, oversized payloads and a missing queue', async () => {
    const store = makeStore();
    const h = createJobHandlers({ guard: guardAs('editor'), store, ...fixed });
    const enqueue = vi.fn();

    const unknown = await h.enqueueJob(makeRequest({ type: 'forge-article' }), context, {
      enqueue,
    });
    expect(unknown.status).toBe(400);
    expect(JSON.parse(unknown.body).error).toContain('noop');

    const big = await h.enqueueJob(
      makeRequest({ type: 'noop', payload: { x: 'y'.repeat(1100) } }),
      context,
      { enqueue }
    );
    expect(big.status).toBe(413);

    const unwired = await h.enqueueJob(makeRequest({ type: 'noop' }), context, {});
    expect(unwired.status).toBe(500);

    expect(store.upsertDoc).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('writes the document, sends the message, answers 202 with a poll hint', async () => {
    const store = makeStore();
    const enqueue = vi.fn();
    const h = createJobHandlers({ guard: guardAs('editor'), store, ...fixed });
    const res = await h.enqueueJob(
      makeRequest({ type: 'noop', payload: { delayMs: 5 } }),
      context,
      { enqueue }
    );
    expect(res.status).toBe(202);
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      jobId: 'job-1',
      type: 'noop',
      status: 'queued',
      poll: 'getJob?jobId=job-1',
    });
    expect(store.upsertDoc).toHaveBeenCalledWith(
      JOBS_CONTAINER,
      expect.objectContaining({
        id: 'job-1',
        type: 'noop',
        status: 'queued',
        attempts: 0,
        requestedBy: USER,
        createdAt: NOW.toISOString(),
      })
    );
    expect(enqueue).toHaveBeenCalledWith({ jobId: 'job-1', type: 'noop' });
  });

  it('enforces a stricter per-type role on top of editor', async () => {
    registerJobType('admin-only', { worker: async () => 1, role: 'admin' });
    const guard = {
      requireRole: vi.fn(async (_r, role) =>
        role === 'admin' ? { error: { status: 403 } } : { user: USER, role }
      ),
    };
    const h = createJobHandlers({ guard, store: makeStore(), ...fixed });
    const res = await h.enqueueJob(makeRequest({ type: 'admin-only' }), context, {
      enqueue: vi.fn(),
    });
    expect(res.status).toBe(403);
    expect(guard.requireRole).toHaveBeenCalledTimes(2);
  });
});

describe('getJob', () => {
  it('reads by query on GET and by body on POST, hides system fields', async () => {
    const store = makeStore({
      'job-1': {
        id: 'job-1',
        type: 'noop',
        status: 'succeeded',
        _rid: 'r',
        _self: 's',
        _ts: 1,
      },
    });
    const h = createJobHandlers({ guard: guardAs('viewer'), store, ...fixed });

    const byQuery = await h.getJob(
      makeRequest(null, { method: 'GET', query: { jobId: 'job-1' } }),
      context
    );
    expect(byQuery.status).toBe(200);
    expect(JSON.parse(byQuery.body).job).toEqual({
      id: 'job-1',
      type: 'noop',
      status: 'succeeded',
    });

    const byBody = await h.getJob(makeRequest({ jobId: 'job-1' }), context);
    expect(byBody.status).toBe(200);

    const missing = await h.getJob(makeRequest({ jobId: 'nope' }), context);
    expect(missing.status).toBe(404);

    const blank = await h.getJob(makeRequest({}), context);
    expect(blank.status).toBe(400);
  });

  it('publicJob strips every Cosmos system field', () => {
    expect(
      publicJob({
        id: 'a',
        _rid: 1,
        _self: 2,
        _etag: 3,
        _attachments: 4,
        _ts: 5,
        status: 'queued',
      })
    ).toEqual({ id: 'a', status: 'queued' });
  });
});

describe('runJob', () => {
  const queued = () => ({
    id: 'job-1',
    type: 'noop',
    payload: { delayMs: 0 },
    status: 'queued',
    attempts: 0,
  });

  it('claims with the etag, runs the worker, records success', async () => {
    const store = makeStore({ 'job-1': queued() });
    const h = createJobHandlers({ guard: guardAs('editor'), store, ...fixed });
    const out = await h.runJob({ jobId: 'job-1' }, context);
    expect(out).toEqual({ jobId: 'job-1', outcome: 'succeeded' });
    expect(store.replaceDocIfMatch).toHaveBeenCalledWith(
      JOBS_CONTAINER,
      expect.objectContaining({
        id: 'job-1',
        status: 'running',
        attempts: 1,
        _etag: 'e1',
        startedAt: NOW.toISOString(),
      })
    );
    expect(store.docs['job-1']).toMatchObject({
      status: 'succeeded',
      result: { echoed: { delayMs: 0 }, delayedMs: 0 },
      error: null,
    });
    expect(TERMINAL_JOB_STATUSES).toContain(store.docs['job-1'].status);
  });

  it('skips a message whose job is not queued (duplicate delivery) and a lost claim race', async () => {
    const store = makeStore({ 'job-1': { ...queued(), status: 'running' } });
    const h = createJobHandlers({ guard: guardAs('editor'), store, ...fixed });
    expect(await h.runJob({ jobId: 'job-1' }, context)).toEqual({
      jobId: 'job-1',
      outcome: 'skipped',
    });
    expect(store.replaceDocIfMatch).not.toHaveBeenCalled();

    const racy = makeStore({ 'job-2': { ...queued(), id: 'job-2' } });
    racy.replaceDocIfMatch.mockRejectedValueOnce(
      Object.assign(new Error('precondition'), { code: 412 })
    );
    const h2 = createJobHandlers({
      guard: guardAs('editor'),
      store: racy,
      ...fixed,
    });
    expect(await h2.runJob({ jobId: 'job-2' }, context)).toEqual({
      jobId: 'job-2',
      outcome: 'skipped',
    });
    expect(racy.patchDoc).not.toHaveBeenCalled();
  });

  it('ignores malformed messages and missing documents without throwing', async () => {
    const store = makeStore();
    const h = createJobHandlers({ guard: guardAs('editor'), store, ...fixed });
    expect(await h.runJob({}, context)).toEqual({
      jobId: null,
      outcome: 'ignored',
    });
    expect(await h.runJob({ jobId: 'ghost' }, context)).toEqual({
      jobId: 'ghost',
      outcome: 'missing',
    });
  });

  it('records a worker failure as failed, with the message, and does not throw', async () => {
    registerJobType('explode', {
      worker: async () => {
        throw new Error('boom ' + 'x'.repeat(3000));
      },
    });
    const store = makeStore({ 'job-1': { ...queued(), type: 'explode' } });
    const h = createJobHandlers({ guard: guardAs('editor'), store, ...fixed });
    expect(await h.runJob({ jobId: 'job-1' }, context)).toEqual({
      jobId: 'job-1',
      outcome: 'failed',
    });
    expect(store.docs['job-1'].status).toBe('failed');
    expect(store.docs['job-1'].error.length).toBeLessThanOrEqual(2001);
  });

  it('records a timeout as timeout', async () => {
    registerJobType('slow', {
      timeoutMs: 10,
      worker: () => new Promise((r) => setTimeout(r, 200)),
    });
    const store = makeStore({ 'job-1': { ...queued(), type: 'slow' } });
    const h = createJobHandlers({ guard: guardAs('editor'), store, ...fixed });
    expect(await h.runJob({ jobId: 'job-1' }, context)).toEqual({
      jobId: 'job-1',
      outcome: 'timeout',
    });
    expect(store.docs['job-1']).toMatchObject({
      status: 'timeout',
      error: 'job timed out',
    });
  });

  it('fails a job whose type is not registered in this deployment', async () => {
    const store = makeStore({
      'job-1': { ...queued(), type: 'from-the-future' },
    });
    const h = createJobHandlers({ guard: guardAs('editor'), store, ...fixed });
    expect(await h.runJob({ jobId: 'job-1' }, context)).toEqual({
      jobId: 'job-1',
      outcome: 'failed',
    });
    expect(store.docs['job-1'].error).toContain('not registered');
  });

  it('invokes onComplete after the terminal write, success and failure alike (T-607)', async () => {
    const seen = [];
    registerJobType('hooked-ok', {
      worker: async () => ({ done: true }),
      onComplete: async ({ status, result, error }) => seen.push({ status, result, error }),
    });
    registerJobType('hooked-bad', {
      worker: async () => {
        throw new Error('nope');
      },
      onComplete: async ({ status, error }) => seen.push({ status, error }),
    });
    const store = makeStore({
      'job-1': { ...queued(), type: 'hooked-ok' },
      'job-2': { ...queued(), id: 'job-2', type: 'hooked-bad' },
    });
    const h = createJobHandlers({ guard: guardAs('editor'), store, ...fixed });
    await h.runJob({ jobId: 'job-1' }, context);
    await h.runJob({ jobId: 'job-2' }, context);
    expect(seen).toEqual([
      { status: 'succeeded', result: { done: true }, error: null },
      { status: 'failed', error: 'nope' },
    ]);
    // The terminal status was already persisted when each hook ran.
    expect(store.docs['job-1'].status).toBe('succeeded');
    expect(store.docs['job-2'].status).toBe('failed');
  });

  it('a throwing onComplete is logged and never changes the job outcome', async () => {
    registerJobType('hook-explodes', {
      worker: async () => 'fine',
      onComplete: async () => {
        throw new Error('hook boom');
      },
    });
    const store = makeStore({ 'job-1': { ...queued(), type: 'hook-explodes' } });
    const h = createJobHandlers({ guard: guardAs('editor'), store, ...fixed });
    expect(await h.runJob({ jobId: 'job-1' }, context)).toEqual({
      jobId: 'job-1',
      outcome: 'succeeded',
    });
    expect(store.docs['job-1'].status).toBe('succeeded');
    expect(context.warn).toHaveBeenCalledWith(expect.stringContaining('hook boom'));
  });
});
