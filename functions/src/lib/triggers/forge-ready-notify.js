/**
 * forge-ready-notify.js — the Telegram "a post is staged" notification
 * (T-606). When the forge lands a draft at forge_ready it arms
 * `forgeReadyNotifyTrigger` (lib/content/forge.js), and the content change
 * feed calls this: claim the rising edge, send one Telegram message with the
 * title, grade, format, the signed preview link and the /approve + /reject
 * command hints, then clear the flag.
 *
 * Retry semantics differ from ai-cover on purpose. ai-cover clears its flag
 * on failure because a failed generation should not silently re-bill later.
 * A notification is the opposite: an unsent message should fire when it can.
 * So on ANY not-sent outcome (Telegram unconfigured, cooldown, API error,
 * exception) this writes NOTHING — the flag stays armed and the claim stays
 * in place. Writing a "failed" marker here would itself re-fire the feed and
 * loop; leaving the claim makes the failure quiet for the claim-timeout
 * window (15 min), after which any later write to the document retries.
 * `notifyTelegram` uses `source: forge_ready:{id}` so the 15-minute notify
 * cooldown is per post, not global — a second post forged a minute later
 * still notifies. (Each id adds one small key to system/notify_state;
 * acceptable at blog cadence.)
 */
import { claimRisingEdge, releaseRisingEdgeClaim } from './rising-edge-claim.js';
import { readKey } from '../ai/router.js';
import { buildPreviewToken } from '../public-preview.js';
import { toPublicUrl } from '../cms/publish.js';

export const FORGE_READY_NOTIFY_CLAIM_FIELDS = Object.freeze({
  flagField: 'forgeReadyNotifyTrigger',
  claimField: 'forgeReadyNotifyRunId',
  claimedAtField: 'forgeReadyNotifyRunAt',
});

/** The message body, exported so the test pins what the owner actually reads. */
export function buildForgeReadyMessage(data, previewUrl) {
  const grade = data.forgeGrade || {};
  const lines = [];
  if (typeof grade.overall === 'number') {
    lines.push(
      `Grade: ${grade.overall}${typeof grade.threshold === 'number' ? ` (threshold ${grade.threshold})` : ''}`
    );
  }
  const format = data.format || data.forgeMeta?.formatKey;
  if (format) lines.push(`Format: ${format}`);
  const seoFindings = Array.isArray(grade.seo?.findings) ? grade.seo.findings : [];
  if (seoFindings.length) {
    lines.push(`SEO: ${seoFindings.length} advisory note(s) — details in the preview banner.`);
  }
  lines.push(
    previewUrl
      ? `Preview: ${previewUrl}`
      : 'Preview link unavailable until PREVIEW_SIGNING_SECRET is seeded.'
  );
  lines.push('');
  lines.push(`Approve and publish: /approve ${data.id}`);
  lines.push(`Reject: /reject ${data.id} [reason]`);
  return lines.join('\n');
}

/**
 * @param {object} deps
 * @param {{ readDoc: Function, patchDoc: Function, replaceDocIfMatch: Function }} deps.store
 * @param {{ notifyTelegram: Function }} deps.notifier
 */
export function createForgeReadyNotifier({
  store,
  notifier,
  env = process.env,
  now = () => new Date(),
  log = {},
}) {
  async function run(contentId, eventId) {
    const claim = await claimRisingEdge(store, 'content', contentId, {
      ...FORGE_READY_NOTIFY_CLAIM_FIELDS,
      eventId,
      now,
    });
    if (!claim.claim) return { ran: false, reason: claim.reason };
    const data = claim.data;

    try {
      const secret = readKey(env, 'PREVIEW_SIGNING_SECRET');
      const previewUrl = secret
        ? toPublicUrl(
            `/preview/${encodeURIComponent(contentId)}?t=${encodeURIComponent(
              buildPreviewToken(secret, contentId, { now: () => now().getTime() })
            )}`
          )
        : null;

      const result = await notifier.notifyTelegram({
        title: `Forge ready: ${data.Title || contentId}`,
        message: buildForgeReadyMessage(data, previewUrl),
        severity: 'info',
        source: `forge_ready:${contentId}`,
      });

      if (!result.sent) {
        // No write — see the header. The claim quiets retries for its window.
        log.warn?.(`[forge-ready-notify] ${contentId}: not sent (${result.reason})`);
        return { ran: false, reason: `not_sent:${result.reason}` };
      }

      await store.patchDoc('content', contentId, {
        ...releaseRisingEdgeClaim(FORGE_READY_NOTIFY_CLAIM_FIELDS),
        forgeReadyNotifyTrigger: false,
        forgeReadyNotifiedAt: now().toISOString(),
      });
      return { ran: true, reason: 'sent' };
    } catch (err) {
      log.error?.(`[forge-ready-notify] ${contentId}: ${err?.message || err}`);
      return { ran: false, reason: `error: ${err?.message || err}` };
    }
  }

  return { run };
}
