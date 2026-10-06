/**
 * The daily reminder check: what it says, when it stamps, and what it
 * leaves alone (owner request 2026-10-06).
 */
import { describe, it, expect, vi } from 'vitest';
import { createReminderCheck, describeDistance, reminderMessage, REMINDER_SOURCE_PREFIX } from './reminders.js';
import { REMINDERS_CONFIG_ID } from '../reminders/settings.js';
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { formatTelegramText } from '../notify.js';

const NOW = new Date('2026-12-28T13:00:05.000Z');
const now = () => NOW;

const doc = (reminders) => ({
  id: REMINDERS_CONFIG_ID,
  configScope: ADMIN_CONFIG_PARTITION,
  updatedAt: '2026-10-06T20:00:00.000Z',
  _etag: '"abc"',
  reminders,
});

const store = (stored) => ({
  readDoc: vi.fn(async () => stored),
  upsertDoc: vi.fn(async (_c, d) => d),
});

const sending = () => ({ notifyTelegram: vi.fn(async () => ({ sent: true })) });

describe('wording', () => {
  it('describes the distance to the date in words', () => {
    expect(describeDistance(7)).toBe('in 7 days');
    expect(describeDistance(1)).toBe('tomorrow');
    expect(describeDistance(0)).toBe('today');
    expect(describeDistance(-1)).toBe('1 day overdue');
    expect(describeDistance(-9)).toBe('9 days overdue');
  });

  it('builds a message with the date, the notes, the link and where to mark it done', () => {
    const { title, message } = reminderMessage(
      {
        title: 'Cloudflare DNS token expires',
        dueDate: '2027-01-04',
        notes: 'Re-scope to the lab zone when the zone exists.',
        url: 'https://dash.cloudflare.com/profile/api-tokens',
      },
      'ahead',
      '2026-12-28'
    );
    expect(title).toBe('Coming up: Cloudflare DNS token expires');
    expect(message).toContain('Due 2027-01-04 (in 7 days).');
    expect(message).toContain('Re-scope to the lab zone');
    expect(message).toContain('https://dash.cloudflare.com/profile/api-tokens');
    expect(message).toContain('Platform Settings → Reminders');
  });

  it('is reported by the reminders sheet, not by its raw source key', () => {
    const text = formatTelegramText({
      title: 'T',
      message: 'M',
      severity: 'info',
      source: `${REMINDER_SOURCE_PREFIX}cf-token`,
    });
    expect(text).toContain('Reported by the reminders sheet.');
    expect(text).not.toContain('reminder:cf-token');
  });
});

describe('createReminderCheck', () => {
  it('does nothing when no document is stored, and reads it from the admin_config partition', async () => {
    const s = store(null);
    expect(await createReminderCheck({ store: s, notifier: sending(), now }).run()).toEqual({
      checked: 0,
      sent: 0,
    });
    expect(s.readDoc).toHaveBeenCalledWith('admin_config', REMINDERS_CONFIG_ID, ADMIN_CONFIG_PARTITION);
    expect(s.upsertDoc).not.toHaveBeenCalled();
  });

  it('says each reminder whose stage has come, one source per reminder, and stamps only those', async () => {
    const s = store(
      doc([
        { id: 'cf-token', title: 'Cloudflare DNS token expires', dueDate: '2027-01-04', leadDays: 7 },
        { id: 'far', title: 'Far away', dueDate: '2027-06-01' },
        { id: 'late', title: 'Already late', dueDate: '2026-12-20', leadDays: 3 },
        { id: 'done', title: 'Handled', dueDate: '2026-12-28', done: true },
      ])
    );
    const notifier = sending();
    const result = await createReminderCheck({ store: s, notifier, now }).run();
    expect(result).toMatchObject({ checked: 4, sent: 2 });
    expect(result.said).toEqual([
      { id: 'cf-token', stage: 'ahead' },
      { id: 'late', stage: 'overdue' },
    ]);
    expect(notifier.notifyTelegram.mock.calls.map(([call]) => [call.source, call.severity])).toEqual([
      [`${REMINDER_SOURCE_PREFIX}cf-token`, 'info'],
      [`${REMINDER_SOURCE_PREFIX}late`, 'critical'],
    ]);
    expect(notifier.notifyTelegram.mock.calls[0][0].title).toBe('Coming up: Cloudflare DNS token expires');

    expect(s.upsertDoc).toHaveBeenCalledTimes(1);
    const [container, written] = s.upsertDoc.mock.calls[0];
    expect(container).toBe('admin_config');
    // The document's own fields survive; only the stamps change.
    expect(written).toMatchObject({ id: REMINDERS_CONFIG_ID, configScope: ADMIN_CONFIG_PARTITION, _etag: '"abc"' });
    const byId = Object.fromEntries(written.reminders.map((r) => [r.id, r]));
    expect(byId['cf-token'].notified).toEqual({ ahead: NOW.toISOString() });
    expect(byId.late.notified).toEqual({ overdue: NOW.toISOString() });
    expect(byId.far.notified).toEqual({});
    expect(byId.done.notified).toEqual({});
  });

  it('does not stamp a reminder the notifier could not send, so it is tried again tomorrow', async () => {
    const s = store(doc([{ id: 'cf-token', title: 'T', dueDate: '2026-12-28' }]));
    const notifier = { notifyTelegram: vi.fn(async () => ({ sent: false, reason: 'not_configured' })) };
    const log = { warn: vi.fn(), log: vi.fn() };
    expect(await createReminderCheck({ store: s, notifier, now, log }).run()).toMatchObject({ checked: 1, sent: 0 });
    expect(s.upsertDoc).not.toHaveBeenCalled();
    expect(log.warn.mock.calls[0][0]).toContain('not_configured');

    const throwing = { notifyTelegram: vi.fn(async () => { throw new Error('telegram down'); }) };
    expect(await createReminderCheck({ store: store(doc([{ id: 'x', title: 'T', dueDate: '2026-12-28' }])), notifier: throwing, now, log }).run()).toMatchObject({ sent: 0 });
  });

  it('warns and says nothing when the stored document does not validate', async () => {
    const s = store(doc([{ id: 'bad', title: 'T', dueDate: '2026-02-30' }]));
    const notifier = sending();
    const log = { warn: vi.fn(), log: vi.fn() };
    expect(await createReminderCheck({ store: s, notifier, now, log }).run()).toEqual({ checked: 0, sent: 0, invalid: true });
    expect(notifier.notifyTelegram).not.toHaveBeenCalled();
    expect(log.warn.mock.calls[0][0]).toMatch(/do not validate/);
  });

  it('says nothing without a notifier', async () => {
    const s = store(doc([{ id: 'x', title: 'T', dueDate: '2026-12-28' }]));
    expect(await createReminderCheck({ store: s, now }).run()).toEqual({ checked: 1, sent: 0 });
    expect(s.upsertDoc).not.toHaveBeenCalled();
  });
});
