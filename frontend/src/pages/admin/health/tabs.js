/**
 * The Health Hub's tabs, and where old addresses land (#569).
 *
 * Kept out of the page module so App.jsx can import the ids without pulling
 * the lazily loaded page into the main bundle.
 *
 * A tab is one entry here plus its panel in HealthPage's `PANELS`; nothing
 * else keys on the list, so a new duty (the planned Code and Security tab) is
 * an addition rather than an edit.
 */

export const TABS = Object.freeze([
  { id: 'overview', label: 'Overview' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'checks', label: 'Checks' },
  { id: 'report', label: 'Report' },
]);

export const DEFAULT_TAB = 'overview';

const TAB_IDS = new Set(TABS.map((tab) => tab.id));

/**
 * Ids that were never tabs here but name what a tab now holds: the halves the
 * one-scroll page was split into ("observed", "verified"), the two pages it
 * replaced (Ops Health's signals, Diagnostics), and the button that used to
 * sit in the header. A bookmark or a hand-typed link lands where its content
 * went rather than on Overview by accident.
 */
export const MOVED_TABS = Object.freeze({
  signals: 'overview',
  observed: 'overview',
  status: 'overview',
  'workflow-alerts': 'alerts',
  probes: 'checks',
  verify: 'checks',
  verified: 'checks',
  diagnostics: 'checks',
  smoke: 'checks',
  copy: 'report',
});

/** The tab to show for a `?tab=` value: its own, where it moved, or Overview. */
export function resolveTab(requested) {
  // Own properties only: `?tab=constructor` must not read Object.prototype.
  const id = Object.hasOwn(MOVED_TABS, requested ?? '') ? MOVED_TABS[requested] : requested;
  return TAB_IDS.has(id) ? id : DEFAULT_TAB;
}
