/**
 * The Certifications Hub's tabs, and where old addresses land (#572).
 *
 * Kept out of the page module so a link builder elsewhere can import the ids
 * without pulling the lazily loaded page into the main bundle.
 *
 * A tab is one entry here plus its panel in CertificationsPage's `PANELS`.
 */

export const CERTIFICATIONS_PATH = '/admin/certifications';

export const TABS = Object.freeze([
  { id: 'catalog', label: 'Catalog' },
  { id: 'featured', label: 'Featured' },
  { id: 'renewals', label: 'Renewals' },
  { id: 'publishing', label: 'Publishing' },
  { id: 'settings', label: 'Settings' },
]);

export const DEFAULT_TAB = 'catalog';

const TAB_IDS = new Set(TABS.map((tab) => tab.id));

/**
 * Ids that were never tabs here but name what a tab now holds: the one-scroll
 * page's view toggle (all / featured / expiring / hidden) and the header's
 * Publish snapshot button. A bookmark or a hand-typed link lands where its
 * content went rather than on Catalog by accident.
 */
export const MOVED_TABS = Object.freeze({
  all: 'catalog',
  list: 'catalog',
  expiring: 'renewals',
  expired: 'renewals',
  renewal: 'renewals',
  hidden: 'settings',
  snapshot: 'publishing',
  publish: 'publishing',
});

/** The tab to show for a `?tab=` value: its own, where it moved, or Catalog. */
export function resolveTab(requested) {
  // Own properties only: `?tab=constructor` must not read Object.prototype.
  const id = Object.prototype.hasOwnProperty.call(MOVED_TABS, requested ?? '')
    ? MOVED_TABS[requested]
    : requested;
  return TAB_IDS.has(id) ? id : DEFAULT_TAB;
}

export function tabHref(tab) {
  return `${CERTIFICATIONS_PATH}?tab=${encodeURIComponent(tab)}`;
}
