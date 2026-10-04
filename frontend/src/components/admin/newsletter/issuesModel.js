/**
 * The issues panel's pure rules and its state as one reducer (ADR 0030 §2a;
 * split out of NewsletterIssues.jsx in PR #841): which issues each tab
 * shows, what may be deleted, and how each action moves the panel's state.
 * No React and no fetch.
 */

/** The server allows one test send per issue a minute (429 inside it). */
export const TEST_COOLDOWN_MS = 60_000;

/** Which issues each view shows. Anything scheduled or sent is on the calendar. */
export const IN_VIEW = {
  review: (row) => (row.status === 'draft' && !row.savedAt) || row.status === 'rejected',
  drafts: (row) => (row.status === 'draft' && Boolean(row.savedAt)) || row.status === 'sending',
};

/** The rows a view lists; an unknown view reads as the review tab. */
export const rowsInView = (issues, view) => issues.filter(IN_VIEW[view] ?? IN_VIEW.review);

/** What the server will delete: nothing that was approved. */
export const DELETABLE = new Set(['draft', 'rejected']);

/** `issue-2026-09-14` reads as `2026-09-14` on a card and in a notice. */
export const issueLabel = (id) => id.replace('issue-', '');

export const INITIAL_STATE = Object.freeze({
  issues: [],
  selectedId: null,
  detail: null,
  /** The label of the action running, or '' between actions. */
  busy: '',
  notice: null,
  /** Issue id -> when its next test send is allowed (ms). */
  testReadyAt: {},
});

const withEtag = (detail, etag) => ({ ...detail, issue: { ...detail.issue, etag } });

/** How each action moves the state; an unknown action leaves it alone. */
const TRANSITIONS = {
  issues: (state, { issues }) => ({ ...state, issues }),
  select: (state, { id }) => ({ ...state, selectedId: id }),
  /** The selection kept inside the view: the first row, or nothing open when the view is empty. */
  reselect: (state, { id }) => ({
    ...state,
    selectedId: id,
    detail: id === null ? null : state.detail,
  }),
  detail: (state, { detail }) => ({ ...state, detail }),
  busy: (state, { label }) => ({ ...state, busy: label }),
  notice: (state, { notice }) => ({ ...state, notice }),
  /** A test send changed the issue's etag; hold the new one while that issue is still open. */
  etag: (state, { id, etag }) =>
    state.detail?.issue?.id === id ? { ...state, detail: withEtag(state.detail, etag) } : state,
  testSent: (state, { id, readyAt }) => ({
    ...state,
    testReadyAt: { ...state.testReadyAt, [id]: readyAt },
  }),
};

export function issuesReducer(state, action) {
  const apply = TRANSITIONS[action.type];
  return apply ? apply(state, action) : state;
}
