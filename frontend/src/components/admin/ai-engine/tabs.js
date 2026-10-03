/**
 * The AI Engine's tabs, and where old addresses land (ADR 0033).
 *
 * Kept out of the page module so a link builder elsewhere can import the ids
 * without pulling the lazily loaded page into the main bundle. A tab is one
 * entry here plus its panel in AIEnginePage's `PANELS`.
 *
 * `siteservices` was a placeholder tab whose state saved nothing; its
 * question ("which provider serves what") is answered by Routing, so the old
 * address lands there.
 */

export const AI_ENGINE_PATH = '/admin/ai-engine';

export const TABS = Object.freeze([
  { id: 'services', label: 'AI Services' },
  { id: 'routing', label: 'Routing' },
  { id: 'mcp', label: 'MCP Servers' },
  { id: 'playground', label: 'Playground' },
  { id: 'usage', label: 'Usage & Cost' },
]);

export const DEFAULT_TAB = 'services';

const TAB_IDS = new Set(TABS.map((tab) => tab.id));

/** Ids that are no longer tabs but name what a tab now holds. */
export const MOVED_TABS = Object.freeze({
  siteservices: 'routing',
  'site-services': 'routing',
  routes: 'routing',
  providers: 'services',
  features: 'services',
  'where-ai-is-used': 'services',
  servers: 'mcp',
  tools: 'mcp',
  cost: 'usage',
  'usage-cost': 'usage',
  spend: 'usage',
});

/** The tab to show for a `?tab=` value: its own, where it moved, or AI Services. */
export function resolveTab(requested) {
  // Own properties only: `?tab=constructor` must not read Object.prototype.
  const id = Object.prototype.hasOwnProperty.call(MOVED_TABS, requested ?? '')
    ? MOVED_TABS[requested]
    : requested;
  return TAB_IDS.has(id) ? id : DEFAULT_TAB;
}

export function tabHref(tab) {
  return `${AI_ENGINE_PATH}?tab=${encodeURIComponent(tab)}`;
}
