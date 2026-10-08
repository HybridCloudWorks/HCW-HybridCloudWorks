/**
 * Filter option lists for the review queue.
 *
 * Split out of QueuePage.jsx (T-412) so the page and the list can be
 * separate modules without one importing the other for two arrays. They are
 * ordered deliberately — see the comment on STATUS_FILTERS.
 */
// Filter ordering follows the article lifecycle. "Needs Review" is every
// status waiting on a reviewer — draft, ingested, inspected and in review
// (functions/src/lib/cms/content-status.js REVIEW_DECISION_STATUSES) — and is
// the default landing state. The individual exact-match chips below it let
// admins drill into one without bulk-rejecting items in another by accident.
export const STATUS_FILTERS = [
  { value: 'needs_review', label: 'Needs review (draft + ingested + inspected + in review)' },
  { value: 'ingested', label: '⤷ Ingested (raw, uninspected)' },
  { value: 'inspected', label: '⤷ Inspected (AI-processed)' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'in_review', label: 'In review' },
  { value: 'editing', label: 'Editing' },
  { value: 'approved', label: 'Approved' },
  { value: 'forge_ready', label: 'Forge ready (AI draft graded)' },
  { value: 'needs_rework', label: 'Needs rework' },
  { value: 'ready_to_publish', label: 'Staged (pre-live)' },
  { value: 'published_live', label: 'Live' },
  { value: 'rejected', label: 'Rejected' },
];

export const CONTENT_TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'blog', label: 'Blogs' },
  { value: 'coder_corner', label: 'Coder Corner' },
  { value: 'framework', label: 'Frameworks' },
  { value: 'architecture', label: 'Architecture' },
];
