/**
 * The Listen & Learn Hub's tabs, and where old addresses land (#574).
 *
 * Kept out of the page module so a link builder elsewhere can import the ids
 * without pulling the lazily loaded page into the main bundle.
 *
 * A tab is one entry here plus its panel in ListenAndLearnPage's `PANELS`.
 */

export const LISTEN_AND_LEARN_PATH = '/admin/listen-and-learn';

export const TABS = Object.freeze([
  { id: 'generate', label: 'Generate' },
  { id: 'review', label: 'Review' },
  { id: 'published', label: 'Published' },
  { id: 'settings', label: 'Settings' },
]);

/**
 * Generate, because that is what the one-scroll page opened on: the form was
 * the first thing below the header, so a bookmark with no `?tab=` should land
 * where its owner left off rather than on an empty Review.
 */
export const DEFAULT_TAB = 'generate';

const TAB_IDS = new Set(TABS.map((tab) => tab.id));

/**
 * Ids that were never tabs here but name what a tab now holds. This page had
 * no tabs before #574 — these are the section headings and the words someone
 * would reasonably type, so a hand-written link lands where the content went
 * instead of silently falling back to Generate.
 */
export const MOVED_TABS = Object.freeze({
  sets: 'review',
  'generated-sets': 'review',
  episodes: 'review',
  drafts: 'review',
  approve: 'review',
  live: 'published',
  voice: 'settings',
  speech: 'settings',
  sources: 'generate',
  grounding: 'generate',
});

/** The tab to show for a `?tab=` value: its own, where it moved, or Generate. */
export function resolveTab(requested) {
  // Own properties only: `?tab=constructor` must not read Object.prototype.
  const id = Object.prototype.hasOwnProperty.call(MOVED_TABS, requested ?? '')
    ? MOVED_TABS[requested]
    : requested;
  return TAB_IDS.has(id) ? id : DEFAULT_TAB;
}

export function tabHref(tab) {
  return `${LISTEN_AND_LEARN_PATH}?tab=${encodeURIComponent(tab)}`;
}
