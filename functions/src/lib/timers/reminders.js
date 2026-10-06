/**
 * timers/reminders.js — `sendReminders`, daily at 13:00 UTC (08:00 Central).
 *
 * Reads the owner's reminders sheet (admin_config/reminders, written from
 * Platform Settings → Reminders; shape in lib/reminders/settings.js) and says
 * on Telegram, through the shared notifier, each reminder whose stage has
 * come: once within its lead days, once on the day, then weekly while it is
 * overdue, until it is marked done. Owner request 2026-10-06.
 *
 * A stage is stamped on the reminder only when the notifier reports the
 * message sent, so an unconfigured bot or a Telegram error means the same
 * reminder is tried again tomorrow rather than counted as said. The stamps
 * are written back with one upsert of the whole document; a save from the
 * sheet in the same second could overwrite them, and the cost of that race
 * is one repeated message, which is the right way round.
 *
 * Each reminder is its own notifier source (`reminder:<id>`), so the
 * notifier's fifteen-minute cooldown never lets one reminder silence another.
 */
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import {
  REMINDERS_CONFIG_ID,
  RemindersValidationError,
  dateOnly,
  daysUntil,
  readStoredReminders,
  stageDue,
} from '../reminders/settings.js';

export const REMINDER_SOURCE_PREFIX = 'reminder:';
const MAX_NOTES_IN_MESSAGE = 400;

const SEVERITY = Object.freeze({ ahead: 'info', due: 'warning', overdue: 'critical' });

/** "in 7 days" / "today" / "3 days overdue". */
export function describeDistance(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1) return `in ${days} days`;
  return days === -1 ? '1 day overdue' : `${-days} days overdue`;
}

/** The Telegram text for one reminder at one stage. */
export function reminderMessage(reminder, stage, today) {
  const days = daysUntil(reminder.dueDate, today);
  const lines = [`Due ${reminder.dueDate} (${describeDistance(days)}).`];
  if (reminder.notes) {
    const notes = reminder.notes.length > MAX_NOTES_IN_MESSAGE
      ? `${reminder.notes.slice(0, MAX_NOTES_IN_MESSAGE)}…`
      : reminder.notes;
    lines.push('', notes);
  }
  if (reminder.url) lines.push('', reminder.url);
  lines.push(
    '',
    stage === 'overdue'
      ? 'Said again weekly until it is marked done on Platform Settings → Reminders.'
      : 'Mark it done on Platform Settings → Reminders once it is handled.'
  );
  const prefix = stage === 'ahead' ? 'Coming up' : stage === 'due' ? 'Due today' : 'Overdue';
  return { title: `${prefix}: ${reminder.title}`, message: lines.join('\n') };
}

/**
 * @param {object} deps
 * @param {{ readDoc: Function, upsertDoc: Function }} deps.store
 * @param {{ notifyTelegram: Function }|null} [deps.notifier]
 * @param {() => Date} [deps.now]
 */
export function createReminderCheck({ store, notifier = null, now = () => new Date(), log = {} }) {
  async function run() {
    const at = now();
    const today = dateOnly(at);
    const doc = await store.readDoc('admin_config', REMINDERS_CONFIG_ID, ADMIN_CONFIG_PARTITION);
    if (!doc) return { checked: 0, sent: 0 };

    let value;
    try {
      value = readStoredReminders(doc);
    } catch (error) {
      if (!(error instanceof RemindersValidationError)) throw error;
      log.warn?.(`[sendReminders] stored reminders do not validate; nothing said: ${error.message}`);
      return { checked: 0, sent: 0, invalid: true };
    }

    if (!notifier?.notifyTelegram) {
      log.warn?.('[sendReminders] no notifier; nothing said.');
      return { checked: value.reminders.length, sent: 0 };
    }

    const sent = [];
    const reminders = [];
    for (const reminder of value.reminders) {
      const stage = stageDue(reminder, today, at.getTime());
      if (!stage) {
        reminders.push(reminder);
        continue;
      }
      const { title, message } = reminderMessage(reminder, stage, today);
      let result;
      try {
        result = await notifier.notifyTelegram({
          title,
          message,
          severity: SEVERITY[stage],
          source: `${REMINDER_SOURCE_PREFIX}${reminder.id}`,
        });
      } catch (error) {
        log.warn?.(`[sendReminders] ${reminder.id} ${stage}: notifier threw: ${error?.message || error}`);
        result = { sent: false };
      }
      if (result?.sent) {
        sent.push({ id: reminder.id, stage });
        reminders.push({ ...reminder, notified: { ...reminder.notified, [stage]: at.toISOString() } });
      } else {
        log.warn?.(`[sendReminders] ${reminder.id} ${stage}: not sent (${result?.reason || 'unknown'}); tried again tomorrow.`);
        reminders.push(reminder);
      }
    }

    if (sent.length > 0) {
      await store.upsertDoc('admin_config', { ...doc, reminders });
    }
    log.log?.(`[sendReminders] ${value.reminders.length} reminder(s) checked, ${sent.length} said`);
    return { checked: value.reminders.length, sent: sent.length, said: sent };
  }
  return { run };
}
