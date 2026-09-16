/**
 * The Labs Hub's tabs, and where old addresses land (#577).
 *
 * This page already validated `?tab=` — it tested the requested id against
 * TABS before using it, which none of the other hubs did. What it had no answer
 * for was an id that USED to be a tab: `setup` fell through to Dashboard
 * silently. These are the same five duties with that gap closed.
 */

export const LABS_PATH = '/admin/labs';

export const TABS = Object.freeze([
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'console', label: 'Console' },
  { id: 'agents', label: 'Agents' },
  { id: 'settings', label: 'Settings' },
]);

/** Dashboard, which is what the page opened on and what answers "is it up". */
export const DEFAULT_TAB = 'dashboard';

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
  return `${LABS_PATH}?tab=${encodeURIComponent(tab)}`;
}
