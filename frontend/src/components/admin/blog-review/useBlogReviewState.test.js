/**
 * The reducer behind the blog review board's local state (ADR 0033, PR #841).
 */
import { describe, expect, it } from 'vitest';
import { blogReviewReducer, INITIAL_REVIEW_STATE } from './useBlogReviewState';

describe('blogReviewReducer', () => {
  it('merges a patch over the current state', () => {
    const next = blogReviewReducer(INITIAL_REVIEW_STATE, {
      type: 'patch',
      patch: { notes: 'fine', savingSchedule: true },
    });
    expect(next.notes).toBe('fine');
    expect(next.savingSchedule).toBe(true);
    expect(next.summaryExpanded).toBe(true);
  });

  it('toggles one boolean key', () => {
    const closed = blogReviewReducer(INITIAL_REVIEW_STATE, {
      type: 'toggle',
      key: 'summaryExpanded',
    });
    expect(closed.summaryExpanded).toBe(false);
    expect(
      blogReviewReducer(closed, { type: 'toggle', key: 'summaryExpanded' }).summaryExpanded
    ).toBe(true);
  });

  it('rewrites the review images through the update it is given', () => {
    const start = { ...INITIAL_REVIEW_STATE, reviewImages: [{ url: 'a' }, { url: 'b' }] };
    const next = blogReviewReducer(start, {
      type: 'updateImages',
      update: (images) => images.filter((image) => image.url !== 'a'),
    });
    expect(next.reviewImages).toEqual([{ url: 'b' }]);
  });

  it('ignores an action it does not know', () => {
    expect(blogReviewReducer(INITIAL_REVIEW_STATE, { type: 'nope' })).toBe(INITIAL_REVIEW_STATE);
  });
});
