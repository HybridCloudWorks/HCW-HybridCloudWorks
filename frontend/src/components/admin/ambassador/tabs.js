/**
 * The Ambassador hub's tabs (ADR 0033 §4), Settings last as the acceptance
 * criteria require. Kept out of the page module so a link elsewhere can
 * import `tabHref` without pulling the lazily loaded page into the bundle.
 */

export const AMBASSADOR_PATH = '/admin/ambassador';

export const TABS = Object.freeze([
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'programs', label: 'Programs' },
  { id: 'applications', label: 'Applications' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'settings', label: 'Settings' },
]);

export const DEFAULT_TAB = 'dashboard';

const TAB_IDS = new Set(TABS.map((tab) => tab.id));

/** Names a tab's content might be reached by, before anyone bookmarked a real id. */
export const MOVED_TABS = Object.freeze({
  overview: 'dashboard',
  home: 'dashboard',
  catalogue: 'programs',
  catalog: 'programs',
  program: 'programs',
  application: 'applications',
  apply: 'applications',
  readiness: 'applications',
  library: 'evidence',
  import: 'evidence',
  requirements: 'settings',
  reminders: 'settings',
});

/** The tab to show for a `?tab=` value: its own, where it moved, or Dashboard. */
export function resolveTab(requested) {
  // Own properties only: `?tab=constructor` must not read Object.prototype.
  const id = Object.prototype.hasOwnProperty.call(MOVED_TABS, requested ?? '')
    ? MOVED_TABS[requested]
    : requested;
  return TAB_IDS.has(id) ? id : DEFAULT_TAB;
}

export function tabHref(tab) {
  return `${AMBASSADOR_PATH}?tab=${encodeURIComponent(tab)}`;
}
