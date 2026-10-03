/**
 * The Labs Hub's tabs, and where old addresses land (#577; Catalogue first
 * since ADR 0033 "Labs").
 *
 * This page already validated `?tab=` — it tested the requested id against
 * TABS before using it, which none of the other hubs did. What it had no answer
 * for was an id that USED to be a tab: `setup` fell through to Dashboard
 * silently. These are the same duties with that gap closed, plus the
 * catalogue the hub manages now: the labs themselves, not only the runner.
 */

export const LABS_PATH = '/admin/labs';

export const TABS = Object.freeze([
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'console', label: 'Console' },
  { id: 'agents', label: 'Agents' },
  { id: 'settings', label: 'Settings' },
]);

/**
 * Catalogue: what the hub is for is the labs, and "which labs exist and
 * where are they published" is the first question; "is the runner up" is
 * the Dashboard, one tab along.
 */
export const DEFAULT_TAB = 'catalogue';

const TAB_IDS = new Set(TABS.map((tab) => tab.id));

/**
 * `setup` is the id this page shipped with for its third tab. It split in two:
 * the provisioning steps are Settings, and the agents they produce are Agents.
 * A `?tab=setup` link was written to reach the steps, so it lands on Settings.
 */
export const MOVED_TABS = Object.freeze({
  setup: 'settings',
  provision: 'settings',
  install: 'settings',
  agent: 'agents',
  vps: 'agents',
  history: 'jobs',
  job: 'jobs',
  runs: 'jobs',
  queue: 'jobs',
  run: 'console',
  shell: 'console',
  labs: 'catalogue',
  lab: 'catalogue',
  overview: 'dashboard',
});

/** The tab to show for a `?tab=` value: its own, where it moved, or the default. */
export function resolveTab(requested) {
  // Own properties only: `?tab=constructor` must not read Object.prototype.
  const id = Object.prototype.hasOwnProperty.call(MOVED_TABS, requested ?? '')
    ? MOVED_TABS[requested]
    : requested;
  return TAB_IDS.has(id) ? id : DEFAULT_TAB;
}

export function tabHref(tab) {
  return `${LABS_PATH}?tab=${encodeURIComponent(tab)}`;
}
