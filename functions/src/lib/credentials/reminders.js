/**
 * Reminders for the credentials only the owner can renew (#1026), through the
 * existing Reminders feature: the same document (admin_config/reminders), the
 * same daily `sendReminders` timer (SEND_REMINDERS) and the same Telegram
 * notifier. Nothing here sends anything; it keeps rows on the sheet, and the
 * timer says them.
 *
 * ## Which credentials
 *
 * Every `hand` credential with a computable due date (status.js): a rule
 * (`lifetimeDays`) and a date it runs from. Today that is the issue's list:
 * the Anthropic key, the Telegram bot token, the two GitHub App private keys,
 * the Coder GitHub OAuth secret, the Static Web Apps deployment token's
 * 90-day reset and the two 730-day lab host certificates. One with a rule and
 * no date yet gets no reminder: a due date made up from nothing would fire on
 * the wrong day. The Credentials tab shows it as unknown and asks for the
 * date, and recording it is what creates the reminder.
 *
 * ## The rows: register-managed, by a reserved id
 *
 * A credential's reminder is the row `credential-<register id>`. The register
 * owns that row whole (title, due date, lead days, notes, link) and nothing
 * else on the sheet: every other row is the owner's and is passed through
 * untouched, in its place. A `credential-` row whose credential no longer has
 * a due date is removed; a new one is appended.
 *
 * Two fields the owner's sheet and the timer write are KEPT while the due
 * date stands: `done` (the owner marked it handled) and `notified` (the
 * timer's stamps, so a sync never makes a stage fire twice). When the due
 * date MOVES (a rotation was recorded, or the Keys tab wrote a new value),
 * the row starts fresh, `done: false` and no stamps: it is a new cycle, and
 * the old cycle's stamps would otherwise keep its "coming up" and "due"
 * messages from ever being said.
 *
 * The lead days are the credential's due-soon window, so the first Telegram
 * message comes the day its row turns amber on the tab.
 *
 * ## When it runs
 *
 *   - when a rotation is recorded on the Credentials tab (handlers.js);
 *   - when the owner presses Update reminders there;
 *   - at the start of every `sendReminders` run, before anything is said, so
 *     a Keys-tab rotation since the last run has already moved its row and
 *     no message is built from a stale date.
 *
 * ## Sharing the document
 *
 * Three writers now share admin_config/reminders: the sheet's save (a full
 * replace that keeps the timer's stamps, platform-settings.js), the timer's
 * stamps (ETag, re-read on 412), and this. This writes only when the merged
 * rows differ from the stored ones, under the document's ETag, re-reading and
 * re-merging when another writer got there first, so an owner's edit is never
 * lost to a sync and a sync is never lost to a stamp. The one race it cannot
 * win is the sheet saving a copy loaded before a sync: that save puts the old
 * credential rows back, and the next sync moves them again. Because the timer
 * syncs before it says anything, the message is never the stale one.
 *
 * A sheet that does not validate is left alone: the owner repairs it on
 * Platform Settings, and the sync tries again next time. So is one the
 * credential rows would push past MAX_REMINDERS.
 *
 * Telemetry carries counts only, the timer's rule.
 */

import { PRODUCTION_ORIGINS } from '../auth/cors.js';
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { dateOnly } from '../reminders/calendar.js';
import {
  MAX_NOTES_LENGTH,
  MAX_TITLE_LENGTH,
  REMINDERS_CONFIG_ID,
  RemindersValidationError,
  normalizeReminders,
  readStoredReminders,
} from '../reminders/settings.js';
import { CREDENTIAL_STORES } from './register.js';
import { readCredentialSources } from './sources.js';
import { buildRegisterView } from './status.js';

export const CREDENTIAL_REMINDER_PREFIX = 'credential-';

/** Where every credential reminder links: the tab that records the rotation. */
export const CREDENTIALS_TAB_URL = `${PRODUCTION_ORIGINS[0]}/admin/integrations?tab=credentials`;

/** Read → merge → write-if-unchanged attempts on the reminders document. */
export const SYNC_WRITE_ATTEMPTS = 4;

/** The sources a reminder's due date depends on; the sync waits while one is unreadable. */
export const REMINDER_SOURCES = Object.freeze(['secret-state', 'credential-register', 'reminders']);

const STORE_LABELS = new Map(CREDENTIAL_STORES.map((store) => [store.id, store.label]));

export const reminderIdFor = (credentialId) => `${CREDENTIAL_REMINDER_PREFIX}${credentialId}`;

/** Whether a sheet row is one the register manages. */
export const isCredentialReminder = (row) =>
  typeof row?.id === 'string' && row.id.startsWith(CREDENTIAL_REMINDER_PREFIX);

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The notes a credential's reminder carries: where, what uses it, how to rotate, and how to move it. */
function reminderNotes(credential) {
  const where = STORE_LABELS.get(credential.store) ?? credential.store;
  return clip(
    [
      `${credential.name}, in ${where}. Used by: ${credential.consumer}. Issued by ${credential.issuer}.`,
      credential.rotate ?? '',
      'Then record the rotation on Integrations → Credentials, which moves this reminder to the next due date. The credential register keeps this row: an edit made to it here is replaced at the next sync.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    MAX_NOTES_LENGTH
  );
}

/**
 * The rows the register wants on the sheet: one per hand-renewed credential
 * with a due date, from presented credentials (status.js presentCredential).
 */
export function wantedReminders(credentials) {
  return credentials
    .filter((credential) => credential.renewal === 'hand' && credential.expiresAt)
    .map((credential) => ({
      id: reminderIdFor(credential.id),
      title: clip(`Rotate ${credential.name}`, MAX_TITLE_LENGTH),
      dueDate: dateOnly(credential.expiresAt),
      leadDays: credential.dueSoonDays,
      notes: reminderNotes(credential),
      url: CREDENTIALS_TAB_URL,
      done: false,
      notified: {},
    }));
}

/**
 * The sheet's rows with the register's merged in (see the header): the
 * owner's rows untouched and in place, each credential row replaced in place
 * or removed, new ones appended. A credential row keeps `done` and
 * `notified` only while its due date is unchanged.
 */
export function mergeCredentialReminders(stored = [], wanted = []) {
  const wantedById = new Map(wanted.map((row) => [row.id, row]));
  const placed = new Set();
  const out = [];
  for (const row of stored) {
    if (!isCredentialReminder(row)) {
      out.push(row);
      continue;
    }
    const next = wantedById.get(row.id);
    if (!next || placed.has(row.id)) continue;
    placed.add(row.id);
    out.push(
      row.dueDate === next.dueDate ? { ...next, done: row.done === true, notified: row.notified ?? {} } : next
    );
  }
  for (const row of wanted) if (!placed.has(row.id)) out.push(row);
  return out;
}

const sameRows = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The merged rows, validated as the timer will read them: `{ rows }` or `{ invalid }`. */
function mergedRows(current, wanted) {
  try {
    const stored = readStoredReminders(current).reminders;
    const merged = normalizeReminders({ reminders: mergeCredentialReminders(stored, wanted) });
    return { stored, rows: merged.reminders };
  } catch (error) {
    if (error instanceof RemindersValidationError) return { invalid: error.message };
    throw error;
  }
}

/** Write the merged rows under the document's ETag; false when another writer got there first. */
async function writeRows(store, current, rows) {
  try {
    if (current) {
      await store.replaceDocIfMatch(
        'admin_config',
        { ...current, reminders: rows },
        { partitionKey: ADMIN_CONFIG_PARTITION }
      );
    } else {
      await store.createDoc('admin_config', {
        id: REMINDERS_CONFIG_ID,
        configScope: ADMIN_CONFIG_PARTITION,
        reminders: rows,
      });
    }
    return true;
  } catch (error) {
    if (error?.code === 412 || error?.code === 409) return false;
    throw error;
  }
}

/**
 * Bring the sheet's credential rows in line with the register. Resolves to
 * a summary, `{ synced, changed?, reminders?, reason? }`, with counts only;
 * throws only on a store error that is not a lost race.
 *
 * @param {object} deps
 * @param {{ readDoc: Function, createDoc: Function, replaceDocIfMatch: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {{ warn?: Function }} [deps.log]
 */
export async function syncCredentialReminders({
  store,
  now = () => new Date(),
  log = {},
  attempts = SYNC_WRITE_ATTEMPTS,
  sleep = defaultSleep,
}) {
  const { sources, unavailable } = await readCredentialSources(store);
  const blocked = unavailable.filter((id) => REMINDER_SOURCES.includes(id));
  if (blocked.length) {
    // A due date read without its source would remove a reminder that
    // should stay; waiting a day costs nothing the timer cannot repeat.
    log.warn?.(`[credentialReminders] ${blocked.length} source(s) could not be read; reminders left as they are`);
    return { synced: false, reason: 'unreadable' };
  }
  const wanted = wantedReminders(buildRegisterView(sources, now().getTime()).credentials);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(20 * 2 ** Math.min(attempt, 5) + Math.random() * 20);
    const current = await store.readDoc('admin_config', REMINDERS_CONFIG_ID, ADMIN_CONFIG_PARTITION);
    const merged = mergedRows(current, wanted);
    if (merged.invalid) {
      // Not the normalizer's sentence: it can quote a row's hand-chosen id,
      // and a hand-chosen id is content (timers/reminders.js).
      log.warn?.('[credentialReminders] the reminders sheet would not validate, or would pass its limit; left as it is');
      return { synced: false, reason: 'invalid' };
    }
    if (sameRows(merged.stored, merged.rows)) return { synced: true, changed: false, reminders: wanted.length };
    if (await writeRows(store, current, merged.rows)) {
      return { synced: true, changed: true, reminders: wanted.length };
    }
  }
  log.warn?.(`[credentialReminders] the reminders sheet kept changing; tried ${attempts} times`);
  return { synced: false, reason: 'conflict' };
}
