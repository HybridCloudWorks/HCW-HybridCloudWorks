/**
 * The Integrations Hub's tabs, and where old addresses land (#570).
 *
 * Kept out of the page module so App.jsx can import the redirects without
 * pulling the lazily loaded page into the main bundle.
 */

export const INTEGRATIONS_PATH = '/admin/integrations';

export const TABS = Object.freeze([
  { id: 'overview', label: 'Overview' },
  { id: 'services', label: 'Services' },
  { id: 'keys', label: 'Keys' },
  { id: 'identity', label: 'Identity' },
]);

export const DEFAULT_TAB = 'overview';

const TAB_IDS = new Set(TABS.map((tab) => tab.id));

/**
 * Tab ids that moved or were never ids here, so a bookmark or a hand-typed
 * link lands where its content went rather than on a blank page.
 */
export const MOVED_TABS = Object.freeze({
  connections: 'overview',
  status: 'overview',
  'api-keys': 'keys',
  credentials: 'keys',
  secrets: 'keys',
  entra: 'identity',
});

/** The tab to show for a `?tab=` value: its own, where it moved, or Overview. */
export function resolveTab(requested) {
  const id = MOVED_TABS[requested] ?? requested;
  return TAB_IDS.has(id) ? id : DEFAULT_TAB;
}

export function tabHref(tab) {
  return `${INTEGRATIONS_PATH}?tab=${encodeURIComponent(tab)}`;
}

/**
 * The two pages this hub replaced. Each redirects to the tab holding what it
 * used to show: Connections was the live status of every service, and API Keys
 * was the credential list.
 */
export const LEGACY_ROUTES = Object.freeze([
  { path: 'connections', to: tabHref('overview') },
  { path: 'api-keys', to: tabHref('keys') },
]);
