/**
 * Forge Studio's tabs, and where old addresses land (ADR 0033 §7 slice 2).
 *
 * The Studio was one configuration form until ADR 0033; it is now a
 * workspace that walks Start → Brief → Draft → Finish, with the Forge Studio
 * Queue (many URLs at once, owner request 2026-10-06) beside them and the
 * voice configuration kept whole under "Voice & profile". A bookmark to the old
 * page (no `?tab=`) opens on Start; the ids below name what the old form's
 * sections were called, so a link written from those words lands on the
 * configuration rather than on an empty workspace.
 */

export const FORGE_STUDIO_PATH = '/admin/forge-studio';

export const TABS = Object.freeze([
  { id: 'start', label: 'Start' },
  { id: 'brief', label: 'Brief' },
  { id: 'draft', label: 'Draft' },
  { id: 'finish', label: 'Finish' },
  { id: 'queue', label: 'Queue' },
  { id: 'voice', label: 'Voice & profile' },
]);

export const DEFAULT_TAB = 'start';

const TAB_IDS = new Set(TABS.map((tab) => tab.id));

/** Ids that are no longer tabs but name what a tab now holds. */
export const MOVED_TABS = Object.freeze({
  config: 'voice',
  configuration: 'voice',
  profile: 'voice',
  'voice-profile': 'voice',
  prompts: 'voice',
  calibration: 'voice',
  calibrate: 'voice',
  stats: 'voice',
  formats: 'voice',
  settings: 'voice',
  new: 'start',
  idea: 'start',
  template: 'start',
  import: 'start',
  url: 'start',
  workspace: 'draft',
  editor: 'draft',
  review: 'finish',
  publish: 'finish',
  next: 'finish',
});

/** The tab to show for a `?tab=` value: its own, where it moved, or Start. */
export function resolveTab(requested) {
  // Own properties only: `?tab=constructor` must not read Object.prototype.
  const id = Object.prototype.hasOwnProperty.call(MOVED_TABS, requested ?? '')
    ? MOVED_TABS[requested]
    : requested;
  return TAB_IDS.has(id) ? id : DEFAULT_TAB;
}

export function tabHref(tab) {
  return `${FORGE_STUDIO_PATH}?tab=${encodeURIComponent(tab)}`;
}
