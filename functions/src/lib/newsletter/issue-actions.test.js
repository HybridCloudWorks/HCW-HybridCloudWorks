/**
 * The documents an issue becomes when its broadcast is canceled, moved or
 * given up on (ADR 0033 Amplify slice; PR #841). The routes themselves are
 * exercised in admin-handlers.amplify.test.js; these pin the transitions and
 * the shared action shape without Resend.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  canceledIssue,
  createIssueActions,
  releasedBroadcast,
  rescheduledIssue,
  retriedIssue,
  revertedIssue,
  scheduledWithBroadcast,
} from './issue-actions.js';

const AT = '2026-10-03T12:00:00.000Z';
const scheduled = {
  id: 'issue-2026-09-29',
  status: 'scheduled',
  broadcastId: 'bc-old',
  broadcastStatus: 'scheduled',
  scheduledAt: '2026-09-29T14:00:00.000Z',
  approvedAt: '2026-09-28T12:00:00.000Z',
  approvedBy: 'oid-1',
  lastError: 'earlier',
  _etag: 'e1',
};

describe('document transitions', () => {
  it('a released broadcast is a kept draft again, keeping an earlier savedAt', () => {
    expect(releasedBroadcast(scheduled, AT)).toEqual({
      status: 'draft',
      savedAt: AT,
      canceledAt: AT,
      canceledBroadcastId: 'bc-old',
      broadcastId: null,
      broadcastStatus: null,
      scheduledAt: null,
      approvedAt: null,
      approvedBy: null,
      updatedAt: AT,
    });
    expect(releasedBroadcast({ ...scheduled, savedAt: 'kept' }, AT).savedAt).toBe('kept');
  });

  it('cancel clears lastError; a refused reschedule writes the reason into it', () => {
    expect(canceledIssue(scheduled, AT)).toMatchObject({
      id: scheduled.id,
      status: 'draft',
      lastError: null,
      _etag: 'e1',
    });
    const reverted = revertedIssue(scheduled, 'HTTP 422: scheduled_at is in the past', AT);
    expect(reverted.status).toBe('draft');
    expect(reverted.lastError).toBe(
      'The previous broadcast was canceled but Resend refused the new one: HTTP 422: scheduled_at is in the past. Approve again to reschedule.'
    );
  });

  it('a rescheduled issue stays scheduled against the new broadcast and time', () => {
    expect(rescheduledIssue(scheduled, 'bc-new', '2026-10-07T14:00:00.000Z', AT)).toMatchObject({
      status: 'scheduled',
      broadcastId: 'bc-new',
      broadcastStatus: 'scheduled',
      scheduledAt: '2026-10-07T14:00:00.000Z',
      sendAt: '2026-10-07T14:00:00.000Z',
      rescheduledAt: AT,
      lastError: null,
      updatedAt: AT,
    });
  });

  it('a retried issue is a draft that remembers the failed broadcast and keeps lastError', () => {
    const failed = { ...scheduled, status: 'failed', sentAt: 'x' };
    expect(retriedIssue(failed, AT)).toMatchObject({
      status: 'draft',
      retriedAt: AT,
      failedBroadcastId: 'bc-old',
      broadcastId: null,
      scheduledAt: null,
      sentAt: null,
      approvedAt: null,
      lastError: 'earlier',
    });
    expect(retriedIssue({ ...failed, broadcastId: undefined }, AT).failedBroadcastId).toBeNull();
  });

  it('scheduledWithBroadcast needs both the status and the id', () => {
    expect(scheduledWithBroadcast(scheduled)).toBe(true);
    expect(scheduledWithBroadcast({ ...scheduled, broadcastId: null })).toBe(false);
    expect(scheduledWithBroadcast({ ...scheduled, status: 'draft' })).toBe(false);
  });
});

describe('createIssueActions', () => {
  const bodyOf = (res) => JSON.parse(res.body);
  const request = (body) => ({ params: { id: scheduled.id }, json: async () => body });
  const context = () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), invocationId: 'inv-1' });

  function build({ issue = { ...scheduled, status: 'failed' }, role = 'publisher' } = {}) {
    const store = {
      replaceDocIfMatch: vi.fn(async (_c, doc) => ({ ...doc, _etag: 'e2' })),
    };
    const deps = {
      guard: {
        requireRole: vi.fn(async (_r, needed) =>
          role === needed ? { user: { oid: 'oid-1' } } : { error: { status: 403, body: '{}' } }
        ),
      },
      store,
      now: () => new Date(AT),
      readIssue: vi.fn(async () => issue),
      readSettings: vi.fn(async () => ({ postalAddress: 'PO Box 1' })),
      present: vi.fn(async (doc) => ({ ok: true, issue: doc })),
      renderChosenDesign: vi.fn(),
      clientOrNull: vi.fn(() => null),
      fromAddress: vi.fn(),
    };
    return { actions: createIssueActions(deps), deps, store };
  }

  it('retry walks the shared shape: role, etag, status, then the write and the presented issue', async () => {
    const { actions, store } = build();
    const ok = await actions.retry(request({ etag: 'e1' }), context());
    expect(ok.status).toBe(200);
    expect(bodyOf(ok).issue).toMatchObject({ status: 'draft', _etag: 'e2' });
    expect(store.replaceDocIfMatch).toHaveBeenCalledTimes(1);

    expect(
      (await build({ role: 'editor' }).actions.retry(request({ etag: 'e1' }), context())).status
    ).toBe(403);
    expect(bodyOf(await actions.retry(request({}), context())).code).toBe('ETAG_REQUIRED');
    expect(bodyOf(await actions.retry(request({ etag: 'stale' }), context())).code).toBe(
      'ISSUE_CHANGED'
    );
    const notFailed = build({ issue: scheduled });
    const refused = await notFailed.actions.retry(request({ etag: 'e1' }), context());
    expect(refused.status).toBe(409);
    expect(bodyOf(refused).error).toBe(
      'Only a failed issue can be retried; this issue is scheduled.'
    );
    expect(
      (await build({ issue: null }).actions.retry(request({ etag: 'e1' }), context())).status
    ).toBe(404);
  });

  it('a write that loses the race is the same 409 as a stale view; a throw is the 500 with a content-free log line', async () => {
    const lost = build();
    lost.store.replaceDocIfMatch.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 412 })
    );
    expect(bodyOf(await lost.actions.retry(request({ etag: 'e1' }), context())).code).toBe(
      'ISSUE_CHANGED'
    );

    const broken = build();
    broken.store.replaceDocIfMatch.mockRejectedValueOnce(
      Object.assign(new Error('secret document id'), { name: 'CosmosError', code: 503 })
    );
    const ctx = context();
    const res = await broken.actions.retry(request({ etag: 'e1' }), ctx);
    expect(res.status).toBe(500);
    expect(bodyOf(res).error).toBe('Failed to retry the newsletter issue');
    expect(ctx.error.mock.calls[0][0]).toBe(
      'retryNewsletter failed [invocation inv-1]: CosmosError code 503'
    );
  });

  it('cancel and reschedule refuse before reading when Resend is not configured, and reschedule parses its body first', async () => {
    const { actions, deps } = build({ issue: scheduled });
    const cancel = await actions.cancel(request({ etag: 'e1' }), context());
    expect(cancel.status).toBe(503);
    expect(deps.readIssue).not.toHaveBeenCalled();
    const past = await actions.reschedule(
      request({ etag: 'e1', scheduledAt: '2020-01-01T00:00:00Z' }),
      context()
    );
    expect(past.status).toBe(400);
    expect(bodyOf(past).error).toMatch(/a minute ahead/);
    const unconfigured = await actions.reschedule(
      request({ etag: 'e1', scheduledAt: '2026-10-07T14:00:00Z' }),
      context()
    );
    expect(unconfigured.status).toBe(503);
  });
});
