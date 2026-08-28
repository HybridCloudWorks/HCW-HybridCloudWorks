import { describe, it, expect, vi } from 'vitest';
import {
  createJobSweeper,
  STALE_QUEUED_MS,
  RUNNING_GRACE_MS,
  JOBS_CONTAINER,
  registerJobType,
  resetJobTypes,
} from './jobs.js';

const NOW = new Date('2026-08-21T18:00:00.000Z');

describe('job sweeper', () => {
  it('re-enqueues stale queued jobs and stamps them; a stamp failure skips that job', async () => {
    const store = {
      // Two queries now run per sweep; answer the queued one and leave the
      // running one empty so this case still exercises only the queued path.
      queryDocs: vi.fn(async (_c, sql) =>
        sql.includes("'running'")
          ? []
          : [
              { id: 'j1', type: 'noop' },
              { id: 'j2', type: 'batch-inspect', requeueCount: 1 },
            ]
      ),
      patchDoc: vi.fn(async (_c, id) => {
        if (id === 'j2') throw new Error('412');
      }),
    };
    const { requeued, reaped } = await createJobSweeper({ store, now: () => NOW }).sweep();
    expect(reaped).toEqual([]);
    expect(requeued).toEqual([{ jobId: 'j1', type: 'noop' }]);
    expect(store.queryDocs.mock.calls[0][0]).toBe(JOBS_CONTAINER);
    expect(store.queryDocs.mock.calls[0][2]).toEqual([
      { name: '@cutoff', value: new Date(NOW.getTime() - STALE_QUEUED_MS).toISOString() },
    ]);
    expect(store.patchDoc).toHaveBeenCalledWith(JOBS_CONTAINER, 'j1', {
      requeuedAt: NOW.toISOString(),
      requeueCount: 1,
    });
  });

  it('returns nothing when nothing is stale', async () => {
    const store = { queryDocs: vi.fn(async () => []), patchDoc: vi.fn() };
    expect(await createJobSweeper({ store }).sweep()).toEqual({ requeued: [], reaped: [] });
    expect(store.patchDoc).not.toHaveBeenCalled();
  });
});

describe('abandoned running jobs (T-710)', () => {
  const runningRows = (rows) => vi.fn(async (_c, sql) => (sql.includes("'running'") ? rows : []));

  it('reaps a job whose own budget plus grace has elapsed, and fires onComplete', async () => {
    resetJobTypes();
    const onComplete = vi.fn(async () => {});
    registerJobType('short-job', {
      role: 'editor',
      worker: async () => {},
      timeoutMs: 60_000,
      onComplete,
    });
    const startedAt = new Date(NOW.getTime() - 60_000 - RUNNING_GRACE_MS - 1000).toISOString();
    const store = {
      queryDocs: runningRows([{ id: 'r1', type: 'short-job', startedAt }]),
      patchDoc: vi.fn(async () => ({})),
    };
    const { reaped } = await createJobSweeper({ store, now: () => NOW }).sweep();
    expect(reaped).toEqual([{ jobId: 'r1', type: 'short-job' }]);
    const [, id, update] = store.patchDoc.mock.calls[0];
    expect(id).toBe('r1');
    expect(update.status).toBe('timeout');
    expect(update.finishedAt).toBe(NOW.toISOString());
    expect(update.error).toMatch(/abandoned while running/);
    // The failure notification that would otherwise never fire.
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toMatchObject({ status: 'timeout', result: null });
  });

  it('leaves a job that is merely slow — its own budget has not elapsed', async () => {
    resetJobTypes();
    registerJobType('long-job', { role: 'editor', worker: async () => {}, timeoutMs: 28 * 60_000 });
    // Older than the grace margin, but well inside a 28-minute budget.
    const startedAt = new Date(NOW.getTime() - 10 * 60_000).toISOString();
    const store = {
      queryDocs: runningRows([{ id: 'r2', type: 'long-job', startedAt }]),
      patchDoc: vi.fn(),
    };
    const { reaped } = await createJobSweeper({ store, now: () => NOW }).sweep();
    expect(reaped).toEqual([]);
    expect(store.patchDoc).not.toHaveBeenCalled();
  });

  it('never reaps a row with an unreadable startedAt', async () => {
    resetJobTypes();
    const warn = vi.fn();
    const store = {
      queryDocs: runningRows([
        { id: 'r3', type: 'noop', startedAt: undefined },
        { id: 'r4', type: 'noop', startedAt: 'not-a-date' },
      ]),
      patchDoc: vi.fn(),
    };
    const { reaped } = await createJobSweeper({ store, now: () => NOW, log: { warn } }).sweep();
    expect(reaped).toEqual([]);
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('a throwing onComplete does not change the outcome already written', async () => {
    resetJobTypes();
    registerJobType('hooked', {
      role: 'editor',
      worker: async () => {},
      timeoutMs: 60_000,
      onComplete: async () => {
        throw new Error('hook exploded');
      },
    });
    const warn = vi.fn();
    const startedAt = new Date(NOW.getTime() - 60_000 - RUNNING_GRACE_MS - 1000).toISOString();
    const store = {
      queryDocs: runningRows([{ id: 'r5', type: 'hooked', startedAt }]),
      patchDoc: vi.fn(async () => ({})),
    };
    const { reaped } = await createJobSweeper({ store, now: () => NOW, log: { warn } }).sweep();
    expect(reaped).toEqual([{ jobId: 'r5', type: 'hooked' }]);
    expect(warn.mock.calls.some((c) => /onComplete/.test(String(c[0])))).toBe(true);
  });
});
