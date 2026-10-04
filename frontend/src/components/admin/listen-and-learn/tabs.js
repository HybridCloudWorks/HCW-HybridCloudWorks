/**
 * The Listen & Learn Hub's tabs, and where old addresses land (#574, ADR
 * 0033 §4).
 *
 * Kept out of the page module so a link builder elsewhere can import the ids
 * without pulling the lazily loaded page into the main bundle.
 *
 * A tab is one entry here plus its panel in ListenAndLearnPage's `PANELS`.
 */

export const LISTEN_AND_LEARN_PATH = '/admin/listen-and-learn';

export const TABS = Object.freeze([
  { id: 'library', label: 'Library' },
  { id: 'generate', label: 'Generate' },
  { id: 'review', label: 'Review' },
  { id: 'settings', label: 'Settings' },
]);

/**
 * Library, because that is what the hub is now: the books and courses, each
 * opening to its chapters, where everything from rename to regenerate lives.
 * Generate is one way to add to it, not the front door.
 */
export const DEFAULT_TAB = 'library';

const TAB_IDS = new Set(TABS.map((tab) => tab.id));

/**
 * Ids that were tabs or section headings here before and name what a tab now
 * holds, so a hand-written or bookmarked link lands where the content went
 * instead of silently falling back to the Library. `published` was a tab
 * until ADR 0033 §4 folded it into the Library, where a book's chapters show
 * their status.
 */
export const MOVED_TABS = Object.freeze({
  published: 'library',
  sets: 'library',
  'generated-sets': 'library',
  books: 'library',
  episodes: 'library',
  chapters: 'library',
  live: 'library',
  drafts: 'review',
  approve: 'review',
  voice: 'settings',
  speech: 'settings',
  sources: 'generate',
  grounding: 'generate',
});

/** The tab to show for a `?tab=` value: its own, where it moved, or the Library. */
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
