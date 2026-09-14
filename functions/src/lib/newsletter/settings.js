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
import { MAX_ITEMS_PER_SECTION, SECTIONS } from './sections.js';

export const NEWSLETTER_SETTINGS_CONFIG_ID = 'newsletter_settings';

/**
 * ## Content (#557)
 *
 * What feeds each issue, read by the builder (issue.js) for both the Build
 * button and the Monday timer: which registered sections, in what order, how
 * many items each, how many days back, and whether and how the AI intro is
 * written. A document saved before these fields existed normalizes to the
 * defaults below, which are exactly what the builder did before: every
 * section in registry order, MAX_ITEMS_PER_SECTION each, seven days, an intro.
 */
export const MIN_WINDOW_DAYS = 1;
export const MAX_WINDOW_DAYS = 31;
export const DEFAULT_WINDOW_DAYS = 7;

export const MIN_SECTION_ITEMS = 1;
export const MAX_SECTION_ITEMS = 20;

/** The intro tones the owner may choose, each with the sentence the drafter is given. */
export const INTRO_TONES = Object.freeze({
  professional: 'Tone: professional and measured, like a trusted colleague briefing a team.',
  friendly: 'Tone: warm and friendly, like writing to people you know, without being casual about the facts.',
  concise: 'Tone: concise and direct; keep every sentence short and cut anything that is not news.',
  enthusiastic: 'Tone: upbeat and enthusiastic about what is new, without hype or exaggeration.',
});
export const INTRO_TONE_IDS = Object.freeze(Object.keys(INTRO_TONES));
export const DEFAULT_INTRO_TONE = 'professional';

/** Every registered section, enabled, in registry order, at the builder's own limit. */
export const defaultSectionSettings = () =>
  SECTIONS.map((section) => ({ id: section.id, enabled: true, maxItems: MAX_ITEMS_PER_SECTION }));

export const DEFAULT_NEWSLETTER_SETTINGS = Object.freeze({
  postalAddress: '',
  replyTo: '',
  sendDay: 'tuesday',
  sendTime: '09:00',
  timeZone: 'America/Chicago',
  sections: Object.freeze(defaultSectionSettings().map((entry) => Object.freeze(entry))),
  windowDays: DEFAULT_WINDOW_DAYS,
  introEnabled: true,
  introTone: DEFAULT_INTRO_TONE,
});

/** A fresh, mutable copy of the defaults: the frozen section rows are not shared. */
export const newsletterSettingsDefaults = () => ({
  ...DEFAULT_NEWSLETTER_SETTINGS,
  sections: defaultSectionSettings(),
});

/** What the Content form may choose from, served beside the value. */
export const newsletterContentOptions = () => ({
  sections: SECTIONS.map((section) => ({ id: section.id, title: section.title })),
  introTones: [...INTRO_TONE_IDS],
  windowDays: { min: MIN_WINDOW_DAYS, max: MAX_WINDOW_DAYS },
  maxItems: { min: MIN_SECTION_ITEMS, max: MAX_SECTION_ITEMS },
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
