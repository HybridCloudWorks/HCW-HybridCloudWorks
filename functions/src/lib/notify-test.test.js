/**
 * Test Telegram: editor-gated, goes through the production notifier with the
 * test source, reports sent / reason / Telegram's status, and never puts an
 * email on the wire (owner brief 2026-10-06).
 */
import { describe, it, expect, vi } from 'vitest';
import { TEST_SOURCE, actorName, createNotifyTestHandlers } from './notify-test.js';
import { SOURCE_DISPLAY_NAMES } from './notify.js';

const context = { log: vi.fn(), error: vi.fn() };
const NOW = new Date('2026-10-07T01:00:00.000Z');
const allow = (user = { oid: 'u1', name: 'Saul', email: 'owner@example.com' }) => ({
  requireRole: vi.fn(async () => ({ user, role: 'editor', error: null })),
});
const deny = () => ({
  requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })),
});
const parse = (res) => JSON.parse(res.body);

describe('actorName', () => {
  it('uses the display name and never anything shaped like an address', () => {
    expect(actorName({ name: ' Saul ' })).toBe('Saul');
    expect(actorName({ name: 'owner@example.com' })).toBe('an editor');
    expect(actorName({})).toBe('an editor');
    expect(actorName(null)).toBe('an editor');
  });
});

describe('sendTelegramTest', () => {
  it('passes a guard denial through with zero notifier calls', async () => {
    const notifier = { notifyTelegram: vi.fn() };
    const h = createNotifyTestHandlers({ guard: deny(), notifier, now: () => NOW });
    const res = await h.sendTelegramTest({}, context);
    expect(res.status).toBe(403);
    expect(notifier.notifyTelegram).not.toHaveBeenCalled();
  });

  it('sends through the notifier with the test source and reports sent', async () => {
    const notifier = { notifyTelegram: vi.fn(async () => ({ sent: true })) };
    const h = createNotifyTestHandlers({ guard: allow(), notifier, now: () => NOW });
    const res = await h.sendTelegramTest({}, context);
    expect(res.status).toBe(200);
    expect(parse(res)).toEqual({ success: true, sent: true, reason: null, status: null, at: NOW.toISOString() });
    const call = notifier.notifyTelegram.mock.calls[0][0];
    expect(call.source).toBe(TEST_SOURCE);
    expect(SOURCE_DISPLAY_NAMES[TEST_SOURCE]).toBe('a test notification');
    expect(call.severity).toBe('info');
    expect(call.message).toContain('by Saul');
    expect(call.message).not.toContain('@');
    expect(call.message).toContain('Telegram delivery works');
  });

  it('reports the notifier reason and Telegram status when nothing went', async () => {
    for (const result of [
      { sent: false, reason: 'cooldown' },
      { sent: false, reason: 'not_configured' },
      { sent: false, reason: 'telegram_error', status: 403 },
    ]) {
      const notifier = { notifyTelegram: vi.fn(async () => result) };
      const h = createNotifyTestHandlers({ guard: allow(), notifier, now: () => NOW });
      const body = parse(await h.sendTelegramTest({}, context));
      expect(body).toMatchObject({ success: true, sent: false, reason: result.reason, status: result.status ?? null });
    }
  });

  it('answers 500 when the notifier itself throws, which it is not supposed to', async () => {
    const notifier = {
      notifyTelegram: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const h = createNotifyTestHandlers({ guard: allow(), notifier, now: () => NOW });
    const res = await h.sendTelegramTest({}, context);
    expect(res.status).toBe(500);
    expect(parse(res).error).toMatch(/test message/);
  });
});
