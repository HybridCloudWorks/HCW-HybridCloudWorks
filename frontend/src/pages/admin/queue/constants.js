/**
 * Filter option lists for the review queue.
 *
 * Split out of QueuePage.jsx (TODO.md T-412) so the page and the list can be
 * separate modules without one importing the other for two arrays. They are
 * ordered deliberately — see the comment on STATUS_FILTERS.
 */
// Filter ordering follows the article lifecycle. "Needs Review" is the
// union of Ingested + Inspected and is the default landing state. The
// individual exact-match chips below it let admins drill into one or the
// other without bulk-rejecting items in the *other* state by accident.
export const STATUS_FILTERS = [
  { value: 'needs_review', label: 'Needs Review (Ingested + Inspected)' },
  { value: 'ingested', label: '⤷ Ingested (raw, uninspected)' },
  { value: 'inspected', label: '⤷ Inspected (AI-processed)' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'editing', label: 'Editing' },
  { value: 'approved_blog', label: 'Approved' },
  { value: 'ready_to_publish', label: 'Staged (Pre-Live)' },
  { value: 'published_live', label: 'Published (Live)' },
  { value: 'rejected', label: 'Rejected' },
];

export const CONTENT_TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'blog', label: 'Blogs' },
  { value: 'coder_corner', label: 'Coder Corner' },
  { value: 'framework', label: 'Frameworks' },
  { value: 'architecture', label: 'Architecture' },
];
