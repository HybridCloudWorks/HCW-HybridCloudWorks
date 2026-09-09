/**
 * The Social Hub's Publer request builders (#463).
 *
 * Five defects were found by reading Publer's documentation against this code,
 * and every one of them was in a function no test had ever called: the job
 * poll compared an HTTP status to a job state, the delete used a path Publer
 * does not define, and "publish now" sent a `state` the API rejects. They
 * survived because the only way to reach them was to drive the whole Compose
 * tab, so nobody did.
 *
 * The fixtures here are proxy envelopes — `{ ok, status, data }` — because
 * that is what `publerProxy` returns for every outcome, including a refusal.
 * A bare Publer body would be testing a shape the server has never sent, which
 * is exactly how defect 1 stayed green while broken.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  describePublerEnvelope,
  describePublerJobFailures,
  publerDeletePost,
  publerPollJob,
  publerScheduleBulk,
} from './SocialHubPage';

const postJSON = vi.fn();
vi.mock('@/lib/api', () => ({
  getJSON: vi.fn(),
  sendJSON: vi.fn(),
  postJSON: (...args) => postJSON(...args),
}));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const ok = (data) => ({ ok: true, status: 200, data });
/** Publer refused. The proxy still answers HTTP 200, so this RESOLVES. */
const refused = {
  ok: false,
  status: 401,
  data: { errors: ['Missing or invalid Authorization header'] },
};

beforeEach(() => postJSON.mockReset());

describe('scheduling versus publishing now (#463 item 3)', () => {
  const bulk = { state: 'scheduled', posts: [] };

  it('schedules through /posts/schedule', async () => {
    postJSON.mockResolvedValue(ok({ job_id: 'j1' }));
    await publerScheduleBulk(bulk);
    expect(postJSON).toHaveBeenCalledWith('publerProxy', {
      path: '/posts/schedule',
      method: 'POST',
      body: { bulk },
    });
  });

  it('publishes now through /posts/schedule/publish — a different ENDPOINT, not a state', async () => {
    // `state: 'published'` was sent here and is not among the states the bulk
    // API accepts (`scheduled`, `auto`, `recycle`). Immediate publishing is
    // its own endpoint, and the absent `scheduled_at` is what means "now".
    postJSON.mockResolvedValue(ok({ job_id: 'j1' }));
    await publerScheduleBulk(bulk, { immediate: true });
    expect(postJSON.mock.calls[0][1].path).toBe('/posts/schedule/publish');
    expect(postJSON.mock.calls[0][1].body.bulk.state).toBe('scheduled');
  });
});

describe('polling a job (#463 item 1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** The poll sleeps 2 s before each attempt; this runs it without the wait. */
  const poll = async (jobId) => {
    const promise = publerPollJob(jobId);
    // Attached before the timers run so a rejection is never unhandled.
    const settled = promise.then(
      (value) => ({ value }),
      (error) => ({ error })
    );
    await vi.runAllTimersAsync();
    return settled;
  };

  it('reads the job state from data.status, not from the proxy HTTP status', async () => {
    // THE BUG: `publerFetch` resolves to `{ ok, status: 200, data }`, so
    // `res.status === 'complete'` compared 200 to a string and could never be
    // true. Every scheduled post ran all fifteen polls, threw "Timed out",
    // skipped the save and toasted "Failed to schedule" — for a post Publer
    // had accepted and would publish on time.
    postJSON.mockResolvedValue(ok({ status: 'completed', payload: { failures: {} } }));
    expect(await poll('j1')).toEqual({ value: { status: 'completed', payload: { failures: {} } } });
    expect(postJSON).toHaveBeenCalledTimes(1);
  });

  it('accepts "complete" as well as "completed", so it cannot turn on one character', async () => {
    postJSON.mockResolvedValue(ok({ status: 'complete' }));
    expect((await poll('j1')).value).toEqual({ status: 'complete' });
  });

  it('keeps polling while the job is still working', async () => {
    postJSON
      .mockResolvedValueOnce(ok({ status: 'working' }))
      .mockResolvedValueOnce(ok({ status: 'working' }))
      .mockResolvedValue(ok({ status: 'completed' }));
    expect((await poll('j1')).value).toEqual({ status: 'completed' });
    expect(postJSON).toHaveBeenCalledTimes(3);
  });

  it('surfaces per-account failures on a job that otherwise finished', async () => {
    // The difference between "nothing published" and "three of four accounts
    // published". `payload.failures` was never read, so a job in which every
    // account failed was reported to the operator as a success.
    postJSON.mockResolvedValue(
      ok({ status: 'completed', payload: { failures: { 'acc-1': 'Token expired' } } })
    );
    expect((await poll('j1')).error.message).toBe(
      'Publer could not post to every account — acc-1: Token expired'
    );
  });

  it('names the failure on a failed job', async () => {
    postJSON.mockResolvedValue(
      ok({ status: 'failed', payload: { failures: { 'acc-2': 'Rejected' } } })
    );
    expect((await poll('j1')).error.message).toBe('Publer job failed — acc-2: Rejected');
  });

  it("stops on a refused envelope with Publer's own sentence, rather than polling fifteen times", async () => {
    postJSON.mockResolvedValue(refused);
    expect((await poll('j1')).error.message).toBe(
      'Publer job status unavailable — Publer answered 401 — Missing or invalid Authorization header'
    );
    expect(postJSON).toHaveBeenCalledTimes(1);
  });

  it('still times out when the job never finishes', async () => {
    postJSON.mockResolvedValue(ok({ status: 'working' }));
    expect((await poll('j1')).error.message).toBe('Timed out waiting for Publer job');
    expect(postJSON).toHaveBeenCalledTimes(15);
  });
});

describe('deleting a post (#463 item 2)', () => {
  it('sends the documented bulk form, not DELETE /posts/{id}', async () => {
    postJSON.mockResolvedValue(ok({ deleted_ids: ['p1'] }));
    await publerDeletePost('p1');
    expect(postJSON).toHaveBeenCalledWith('publerProxy', {
      path: '/posts?post_ids[]=p1',
      method: 'DELETE',
      body: undefined,
    });
  });

  it('REFUSES to build the call without an id', async () => {
    // `DELETE /posts` with no `post_ids` is documented as "delete every
    // non-published post in the workspace". An id that goes missing must fail
    // here, not interpolate `undefined` into a path and hope.
    for (const id of [undefined, null, '']) {
      await expect(publerDeletePost(id)).rejects.toThrow(/without an id/);
    }
    expect(postJSON).not.toHaveBeenCalled();
  });

  it('treats an id missing from deleted_ids as not deleted, despite the 200', async () => {
    postJSON.mockResolvedValue(ok({ deleted_ids: [] }));
    await expect(publerDeletePost('p1')).rejects.toThrow(/did not report this post as deleted/);
  });

  it('reports a refusal with the reason Publer gave', async () => {
    postJSON.mockResolvedValue(refused);
    await expect(publerDeletePost('p1')).rejects.toThrow(
      'Publer refused the delete — Publer answered 401 — Missing or invalid Authorization header'
    );
  });

  it('encodes an id rather than pasting it into the query', async () => {
    postJSON.mockResolvedValue(ok({ deleted_ids: ['a&b'] }));
    await publerDeletePost('a&b');
    expect(postJSON.mock.calls[0][1].path).toBe('/posts?post_ids[]=a%26b');
  });
});

describe('describePublerJobFailures', () => {
  it('reads the object form Publer documents', () => {
    expect(describePublerJobFailures({ failures: { a: 'one', b: 'two' } })).toBe('a: one; b: two');
  });

  it('reads an array form too, in case the shape shifts', () => {
    expect(describePublerJobFailures({ failures: [{ account_id: 'a', message: 'one' }] })).toBe(
      'a: one'
    );
  });

  it('is empty when there is nothing to report, so a clean job reads as clean', () => {
    for (const payload of [undefined, null, {}, { failures: {} }, { failures: [] }]) {
      expect(describePublerJobFailures(payload)).toBe('');
    }
  });
});

describe('describePublerEnvelope', () => {
  it("prefers the proxy's own explanation, which describes what happened to the call", () => {
    expect(
      describePublerEnvelope({
        ok: false,
        error: 'Publer is not configured: PUBLER_WORKSPACE_ID is not set',
      })
    ).toBe('Publer is not configured: PUBLER_WORKSPACE_ID is not set');
  });

  it("falls back to Publer's errors array", () => {
    expect(describePublerEnvelope(refused)).toBe(
      'Publer answered 401 — Missing or invalid Authorization header'
    );
  });

  it('is the status alone when the body carried no reason', () => {
    expect(describePublerEnvelope({ ok: false, status: 500, data: {} })).toBe(
      'Publer answered 500'
    );
  });
});
