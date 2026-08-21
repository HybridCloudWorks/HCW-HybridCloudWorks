/**
 * activation-notice.js — "has this activation been announced?" for the
 * workflow-alert notifier. Ported from Site-Main `lib/triggers/activation-notice.js`
 * (088f458): the alert is stamped `activationNotifiedAt` after the send
 * succeeds; resolve and reopen null the stamp (ops-health.js
 * buildWorkflowAlertUpdates) so the next activation announces again.
 * Stamp-after-send on purpose: a repeated message is noise, a swallowed alert
 * is the failure this exists to prevent. Pure.
 */
export const ACTIVATION_NOTIFIED_FIELD = 'activationNotifiedAt';

export const NOTICE_REASONS = Object.freeze({
  SEND: 'activation_unannounced',
  DOCUMENT_MISSING: 'document_missing',
  NOT_ACTIVE: 'not_active',
  ALREADY_NOTIFIED: 'already_notified',
});

/** @returns {{ send: boolean, reason: string }} */
export function evaluateActivationNotice(data) {
  if (!data) return { send: false, reason: NOTICE_REASONS.DOCUMENT_MISSING };
  if (data.active !== true) return { send: false, reason: NOTICE_REASONS.NOT_ACTIVE };
  if (data[ACTIVATION_NOTIFIED_FIELD])
    return { send: false, reason: NOTICE_REASONS.ALREADY_NOTIFIED };
  return { send: true, reason: NOTICE_REASONS.SEND };
}
