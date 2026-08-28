/**
 * notify.js — best-effort Telegram alerts with a per-source cooldown.
 *
 * Ported from Site-Main `lib/notify.js` (088f458). Never throws: scheduled
 * jobs and change-feed handlers must not fail because a notification could
 * not be sent. The bot token and chat id are Key Vault references on the app
 * (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`); an unresolved reference reads as
 * "not configured". Cooldown state lives in `system/notify_state`.
 */
import { readKey } from './ai/router.js';
import { fetchWithTimeout } from './http/fetch-with-timeout.js';

// Outbound deadline (T-712): Node's fetch has none, and these calls are
// reached from change-feed handlers where a hung socket holds the lease.
const TELEGRAM_TIMEOUT_MS = 15_000;

export const COOLDOWN_MS = 15 * 60 * 1000;
export const NOTIFY_STATE_ID = 'notify_state';

function severityPrefix(severity) {
  if (severity === 'critical') return '\u{1F534}';
  if (severity === 'warning') return '\u{1F7E1}';
  return 'ℹ️';
}

export const SOURCE_DISPLAY_NAMES = Object.freeze({
  rss: 'the RSS feed fetcher',
  rssFetcher: 'the RSS feed fetcher',
  publishScheduledContent: 'the scheduled publisher',
  monitorPublishingPipeline: 'the publishing pipeline monitor',
  checkLiveLinks: 'the live-link checker',
  sendTestNotification: 'a test notification',
  firecrawl: 'the web scraper (Firecrawl)',
  forgeScheduled: 'the scheduled forge pipeline',
  cleanupRejectedContent: 'the rejected-content cleanup job',
  cleanupSoftDeletedContent: 'the deleted-content cleanup job',
  workflow_alerts: 'the workflow alert monitor',
  seed: 'the content seeder',
});

export function formatTelegramText({ title, message, severity, source }) {
  // Dynamic prefixed sources — 'forge_ready:{contentId}' (per-post cooldown,
  // lib/triggers/forge-ready-notify.js) and 'job_failed:{type}' (per-job-type
  // cooldown, lib/job-failure-notify.js) — display as their prefix's name
  // rather than the raw key.
  const raw = String(source || '');
  let displayName = SOURCE_DISPLAY_NAMES[source] || source;
  if (!SOURCE_DISPLAY_NAMES[source]) {
    if (raw.startsWith('forge_ready:')) displayName = 'ContentForge';
    else if (raw.startsWith('job_failed:')) displayName = 'the job worker';
  }
  return `${severityPrefix(severity)} ${title}\n\n${message}\n\nReported by ${displayName}.`;
}

/**
 * @param {object} deps
 * @param {{ readDoc: Function, upsertDoc: Function }} deps.store
 * @param {Record<string,string|undefined>} [deps.env]
 * @param {typeof fetch} [deps.fetch]
 * @param {() => Date} [deps.now]
 */
export function createNotifier({
  store,
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
  log = {},
}) {
  async function notifyTelegram({ title, message, severity = 'info', source = 'system' }) {
    try {
      const token = readKey(env, 'TELEGRAM_BOT_TOKEN');
      const chatId = readKey(env, 'TELEGRAM_CHAT_ID');
      if (!token || !chatId) {
        log.warn?.('[notify] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not configured; skipping.');
        return { sent: false, reason: 'not_configured' };
      }
      const state = (await store.readDoc('system', NOTIFY_STATE_ID, NOTIFY_STATE_ID)) || {
        id: NOTIFY_STATE_ID,
      };
      const last = Date.parse(state[source]?.lastNotifiedAt || '') || 0;
      if (now().getTime() - last < COOLDOWN_MS) {
        log.log?.(`[notify] Cooldown active for source="${source}"; skipping Telegram send.`);
        return { sent: false, reason: 'cooldown' };
      }
      const response = await fetchWithTimeout(
        fetchImpl,
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: formatTelegramText({ title, message, severity, source }),
          }),
          timeoutMs: TELEGRAM_TIMEOUT_MS,
        }
      );
      if (!response.ok) {
        log.error?.(`[notify] Telegram API error ${response.status}`);
        return { sent: false, reason: 'telegram_error' };
      }
      await store.upsertDoc('system', {
        ...state,
        id: NOTIFY_STATE_ID,
        [source]: { lastNotifiedAt: now().toISOString() },
      });
      return { sent: true };
    } catch (err) {
      log.error?.(`[notify] notifyTelegram failed: ${err?.message || err}`);
      return { sent: false, reason: 'exception' };
    }
  }
  return { notifyTelegram };
}
