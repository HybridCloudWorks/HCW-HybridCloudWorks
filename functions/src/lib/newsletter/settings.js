/**
 * settings.js — the newsletter's owner-editable settings (ADR 0030 §2a).
 *
 * The shape of `admin_config/newsletter_settings`: its id and defaults. The
 * validator and the API that edits it are added with the admin routes, in
 * platform-settings.js, which is why only constants live here.
 *
 * Saving may be partial — an address can be saved before a reply-to exists —
 * but SENDING may not. `missingForSending` is the gate a send will check, so an
 * issue can never go out without the postal address CAN-SPAM requires or with
 * replies going to a domain that does not receive mail.
 */
import { SEND_DAYS } from './schedule.js';

export const NEWSLETTER_SETTINGS_CONFIG_ID = 'newsletter_settings';

export const DEFAULT_NEWSLETTER_SETTINGS = Object.freeze({
  postalAddress: '',
  replyTo: '',
  sendDay: 'tuesday',
  sendTime: '09:00',
  timeZone: 'America/Chicago',
});

export const MAX_POSTAL_ADDRESS_LENGTH = 300;

export { SEND_DAYS };

/** The settings a send needs that are not filled in, as readable names. */
export function missingForSending(settings) {
  const missing = [];
  if (!String(settings?.postalAddress ?? '').trim()) missing.push('postal address');
  if (!String(settings?.replyTo ?? '').trim()) missing.push('reply-to address');
  return missing;
}
