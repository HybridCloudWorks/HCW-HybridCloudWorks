/**
 * Scheduled becomes sent by asking Resend (ADR 0033 Amplify slice). What must
 * hold: Resend's five statuses map to exactly one issue state each, a 404 is
 * a failure the owner can retry, the write is ETag-conditional, and a list
 * read asks about overdue issues only and never more than the limit.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  mapBroadcastToIssue,
  overdue,
  reconcilable,
  reconcileIssue,
  reconcileIssues,
} from './reconcile.js';

const NOW = new Date('2026-10-03T12:00:00.000Z');
const scheduled = (over = {}) => ({
  id: 'issue-2026-09-29',
  kind: 'weekly_issue',
  status: 'scheduled',
  broadcastId: 'bc-1',
  scheduledAt: '2026-09-29T14:00:00.000Z',
  _etag: 'e1',
  ...over,
});
const ok = (data) => ({ ok: true, status: 200, data });

describe('mapBroadcastToIssue', () => {
  it('sent → sent with Resend sent_at; queued and scheduled keep the issue scheduled', () => {
    expect(
      mapBroadcastToIssue(
        scheduled(),
        ok({ status: 'sent', sent_at: '2026-09-29T14:00:03.000Z' }),
        NOW
      )
    ).toMatchObject({
      status: 'sent',
      sentAt: '2026-09-29T14:00:03.000Z',
      lastError: null,
    });
    expect(mapBroadcastToIssue(scheduled(), ok({ status: 'sent' }), NOW).sentAt).toBe(
      NOW.toISOString()
    );
    expect(mapBroadcastToIssue(scheduled(), ok({ status: 'queued' }), NOW)).toEqual({
      broadcastStatus: 'queued',
      reconciledAt: NOW.toISOString(),
    });
    expect(
      mapBroadcastToIssue(
        scheduled(),
        ok({ status: 'scheduled', scheduled_at: '2026-09-30T14:00:00.000Z' }),
        NOW
      )
    ).toMatchObject({
      scheduledAt: '2026-09-30T14:00:00.000Z',
    });
  });

  it('canceled and a missing broadcast are failures with a reason; other answers change nothing', () => {
    expect(mapBroadcastToIssue(scheduled(), ok({ status: 'canceled' }), NOW)).toMatchObject({
      status: 'failed',
      lastError: expect.stringMatching(/canceled/),
    });
    expect(
      mapBroadcastToIssue(scheduled(), { ok: false, status: 404, data: {} }, NOW)
    ).toMatchObject({
      status: 'failed',
      lastError: expect.stringMatching(/no longer has broadcast bc-1/),
    });
    expect(mapBroadcastToIssue(scheduled(), { ok: false, status: 500, data: {} }, NOW)).toBeNull();
    expect(mapBroadcastToIssue(scheduled(), ok({ status: 'draft' }), NOW)).toBeNull();
  });

  it('an issue stuck in sending whose broadcast exists is scheduled again', () => {
    expect(
      mapBroadcastToIssue(scheduled({ status: 'sending' }), ok({ status: 'scheduled' }), NOW)
    ).toMatchObject({ status: 'scheduled' });
  });
});

describe('reconcileIssue', () => {
  it('writes the mapped state conditionally and reports a lost race as unchanged', async () => {
    const client = {
      getBroadcast: vi.fn(async () => ok({ status: 'sent', sent_at: '2026-09-29T14:00:03.000Z' })),
    };
    const store = {
      replaceDocIfMatch: vi.fn(async (_c, doc) => ({ ...doc, _etag: 'e2' })),
    };
    const outcome = await reconcileIssue({
      store,
      client,
      issue: scheduled(),
      now: () => NOW,
    });
    expect(outcome.changed).toBe(true);
    expect(outcome.issue).toMatchObject({ status: 'sent', _etag: 'e2' });
    expect(store.replaceDocIfMatch.mock.calls[0][1]._etag).toBe('e1');

    const raced = {
      replaceDocIfMatch: vi.fn(async () => Object.assign(new Error('412'), { code: 412 })),
    };
    raced.replaceDocIfMatch.mockRejectedValue(Object.assign(new Error('412'), { code: 412 }));
    expect(
      await reconcileIssue({
        store: raced,
        client,
        issue: scheduled(),
        now: () => NOW,
      })
    ).toMatchObject({ changed: false, reason: 'changed meanwhile' });
  });

  it('leaves a draft alone and reports an unreadable Resend answer', async () => {
    const client = {
      getBroadcast: vi.fn(async () => ({ ok: false, status: 500, data: {} })),
    };
    const store = { replaceDocIfMatch: vi.fn() };
    expect(
      await reconcileIssue({
        store,
        client,
        issue: scheduled({ status: 'draft' }),
        now: () => NOW,
      })
    ).toMatchObject({ changed: false });
    expect(client.getBroadcast).not.toHaveBeenCalled();
    expect(
      await reconcileIssue({
        store,
        client,
        issue: scheduled(),
        now: () => NOW,
      })
    ).toMatchObject({ changed: false, reason: 'Resend answered HTTP 500' });
    expect(store.replaceDocIfMatch).not.toHaveBeenCalled();
  });
});

describe('reconcileIssues', () => {
  it('asks only about overdue issues unless told all, and at most the limit', async () => {
    const issues = [
      scheduled({ id: 'a' }),
      scheduled({ id: 'b', scheduledAt: '2099-01-01T00:00:00.000Z' }),
      scheduled({ id: 'c' }),
      scheduled({ id: 'd', status: 'draft', broadcastId: null }),
    ];
    const client = { getBroadcast: vi.fn(async () => ok({ status: 'sent' })) };
    const store = { replaceDocIfMatch: vi.fn(async (_c, doc) => doc) };
    const outcome = await reconcileIssues({
      store,
      client,
      issues,
      now: () => NOW,
      limit: 1,
    });
    expect(outcome).toEqual({ reconciled: 1, changed: ['a'], warnings: [] });
    const everything = await reconcileIssues({
      store,
      client,
      issues,
      now: () => NOW,
      all: true,
    });
    expect(everything.changed).toEqual(['a', 'b', 'c']);
  });

  it('predicates: reconcilable needs a broadcast; overdue needs a past scheduledAt', () => {
    expect(reconcilable(scheduled())).toBe(true);
    expect(reconcilable(scheduled({ broadcastId: null }))).toBe(false);
    expect(overdue(scheduled(), NOW)).toBe(true);
    expect(overdue(scheduled({ scheduledAt: '2099-01-01T00:00:00.000Z' }), NOW)).toBe(false);
  });
});
