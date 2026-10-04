/**
 * The chunking behind "Forge Selected": a selection larger than the job's
 * batch limit goes out in several enqueues, a refused chunk is recorded
 * rather than thrown, and the two banners count what happened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api', () => ({ postJSON: vi.fn() }));

const { postJSON } = await import('@/lib/api');
const { FORGE_MAX_BATCH, enqueueForgeBatches, forgeQueuedMessage, forgeFailureMessage } =
  await import('./forgeSelected.js');

const ids = (n) => Array.from({ length: n }, (_, i) => `doc-${i + 1}`);

describe('enqueueForgeBatches', () => {
  beforeEach(() => {
    postJSON.mockReset();
  });

  it('splits a selection into chunks of FORGE_MAX_BATCH and collects the job ids', async () => {
    postJSON.mockImplementation(async (_fn, body) => ({
      ok: true,
      jobId: `job-${body.payload.sourceContentIds[0]}`,
    }));
    const result = await enqueueForgeBatches(ids(25));
    expect(postJSON).toHaveBeenCalledTimes(3);
    for (const [, body] of postJSON.mock.calls) {
      expect(body.type).toBe('forge-article');
      expect(body.payload.sourceContentIds.length).toBeLessThanOrEqual(FORGE_MAX_BATCH);
    }
    expect(result.jobIds).toEqual(['job-doc-1', 'job-doc-11', 'job-doc-21']);
    expect(result.failures).toEqual([]);
  });

  it('records a refused chunk with its size and reason, and goes on to the next', async () => {
    postJSON
      .mockResolvedValueOnce({ ok: false, error: 'budget exhausted' })
      .mockResolvedValueOnce({ ok: true, jobId: 'job-2' });
    const result = await enqueueForgeBatches(ids(12));
    expect(result.jobIds).toEqual(['job-2']);
    expect(result.failures).toEqual([{ count: 10, message: 'budget exhausted' }]);
  });

  it('treats a thrown enqueue the same as a refused one', async () => {
    postJSON.mockRejectedValueOnce(new Error('network down'));
    const result = await enqueueForgeBatches(ids(3));
    expect(result.jobIds).toEqual([]);
    expect(result.failures).toEqual([{ count: 3, message: 'network down' }]);
  });
});

describe('the banners', () => {
  it('counts the items that queued, net of the failed chunks, and names the jobs', () => {
    expect(forgeQueuedMessage(12, ['job-2'], [{ count: 10, message: 'x' }])).toBe(
      'Forge queued for 2 items (job job-2). Results land back here as forge_ready or editing — refresh in a few minutes.'
    );
    expect(forgeQueuedMessage(1, ['a'], [])).toMatch(/^Forge queued for 1 item \(job a\)/);
    expect(forgeQueuedMessage(20, ['a', 'b'], [])).toMatch(
      /^Forge queued for 20 items \(jobs a, b\)/
    );
  });

  it('sums the failed items and quotes the first reason', () => {
    expect(
      forgeFailureMessage([
        { count: 10, message: 'budget exhausted' },
        { count: 2, message: 'later' },
      ])
    ).toBe('12 item(s) failed to queue: budget exhausted');
  });
});
