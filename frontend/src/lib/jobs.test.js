import { describe, it, expect, vi } from 'vitest';
import { runJob } from './jobs.js';

const noSleep = vi.fn(async () => {});

describe('runJob', () => {
  it('enqueues, polls until a terminal status, and returns the job', async () => {
    const enqueue = vi.fn(async () => ({ ok: true, jobId: 'j1', status: 'queued' }));
    const statuses = ['queued', 'running', 'running', 'succeeded'];
    const get = vi.fn(async () => ({
      ok: true,
      job: { id: 'j1', status: statuses.shift(), result: { n: 1 } },
    }));
    const onUpdate = vi.fn();

    const job = await runJob(
      'noop',
      { a: 1 },
      { fetchers: { enqueue, get }, sleep: noSleep, onUpdate }
    );

    expect(enqueue).toHaveBeenCalledWith({ type: 'noop', payload: { a: 1 } });
    expect(get).toHaveBeenCalledTimes(4);
    expect(job).toEqual({ id: 'j1', status: 'succeeded', result: { n: 1 } });
    expect(onUpdate).toHaveBeenCalledTimes(4);
  });

  it('throws the server error when the job is not accepted', async () => {
    const enqueue = vi.fn(async () => ({ ok: false, error: 'Unknown job type' }));
    await expect(
      runJob('nope', {}, { fetchers: { enqueue, get: vi.fn() }, sleep: noSleep })
    ).rejects.toThrow('Unknown job type');
  });

  it('survives transient poll errors with backoff and keeps going', async () => {
    const enqueue = vi.fn(async () => ({ ok: true, jobId: 'j1' }));
    let calls = 0;
    const get = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('502');
      return { ok: true, job: { id: 'j1', status: 'failed', error: 'boom' } };
    });
    const sleep = vi.fn(async () => {});
    const job = await runJob('noop', {}, { fetchers: { enqueue, get }, sleep });
    expect(job.status).toBe('failed');
    // backoff grew while errors accumulated, then the terminal poll landed
    expect(sleep.mock.calls.length).toBe(3);
    expect(sleep.mock.calls[1][0]).toBeGreaterThan(sleep.mock.calls[0][0]);
  });

  it('gives up after maxWaitMs with the last known job attached', async () => {
    const enqueue = vi.fn(async () => ({ ok: true, jobId: 'j1' }));
    const get = vi.fn(async () => ({ ok: true, job: { id: 'j1', status: 'running' } }));
    let t = 0;
    const now = () => (t += 60_000);
    await expect(
      runJob('noop', {}, { fetchers: { enqueue, get }, sleep: noSleep, now, maxWaitMs: 120_000 })
    ).rejects.toMatchObject({ code: 'JOB_WAIT_EXCEEDED', job: { status: 'running' } });
  });

  it('aborts cleanly', async () => {
    const controller = new AbortController();
    const enqueue = vi.fn(async () => ({ ok: true, jobId: 'j1' }));
    const get = vi.fn(async () => {
      controller.abort();
      return { ok: true, job: { id: 'j1', status: 'running' } };
    });
    await expect(
      runJob('noop', {}, { fetchers: { enqueue, get }, sleep: noSleep, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
