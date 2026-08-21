import { describe, it, expect, vi } from 'vitest';
import { createJobSweeper, STALE_QUEUED_MS, JOBS_CONTAINER } from './jobs.js';

const NOW = new Date('2026-08-21T18:00:00.000Z');

describe('job sweeper', () => {
  it('re-enqueues stale queued jobs and stamps them; a stamp failure skips that job', async () => {
    const store = {
      queryDocs: vi.fn(async () => [
        { id: 'j1', type: 'noop' },
        { id: 'j2', type: 'batch-inspect', requeueCount: 1 },
      ]),
      patchDoc: vi.fn(async (_c, id) => {
        if (id === 'j2') throw new Error('412');
      }),
    };
    const { requeued } = await createJobSweeper({ store, now: () => NOW }).sweep();
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
    expect(await createJobSweeper({ store }).sweep()).toEqual({ requeued: [] });
    expect(store.patchDoc).not.toHaveBeenCalled();
  });
});
