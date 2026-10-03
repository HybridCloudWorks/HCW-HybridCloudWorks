/**
 * The one way the admin moves content between statuses (ADR 0033 §2).
 *
 * Approve, reject, restore and recall were written three times — the queue,
 * the Frameworks and Coder Corner pages, the Blog review board — each with
 * its own loading map, its own error map and, until 2026-10-03, its own copy
 * of the `approved_blog` status the server did not know. This hook is the
 * single copy: canonical statuses, per-item loading and error state, and the
 * HTTP call. The pages decide what to do with a success (remove the card,
 * refetch, navigate); the hook decides how the transition is made.
 *
 * NO CLIENT AUDIT ROW. transitionContentStatus writes `audits`
 * (status_transition) and unpublishContentToInspected writes
 * `admin_audit_logs` on the server, with the actor the guard verified. The
 * `logAdminAction` calls the three copies made beside them wrote the same
 * action a second time under a client-supplied identity (ADR 0033 §1,
 * "three audit sinks, some actions logged twice"); they are not reproduced
 * here.
 *
 * `loading[id]` is the verb in flight ('approving' | 'rejecting' |
 * 'restoring' | 'recalling' | 'transitioning'), so a card can show which
 * button is working; `errors[id]` is the sentence to show under the card.
 */
import { useCallback, useState } from 'react';
import { postJSON } from '@/lib/api';
import { unpublishToInspected } from '@/lib/contentWorkflow';
import { getPublishTargetForItem } from '@/lib/contentModel';

export const TRANSITION_VERBS = Object.freeze({
  approved: 'approving',
  rejected: 'rejecting',
  inspected: 'restoring',
  archived: 'archiving',
});

const idOf = (itemOrId) => (typeof itemOrId === 'string' ? itemOrId : itemOrId?.id);

/**
 * @param {{ onTransitioned?: (contentId: string, result: object) => void }} [options]
 *   `onTransitioned` runs after every successful move, with the server's answer
 *   (`{ from, to, contentId }`), so a page can drop the card or refetch.
 */
export function useContentTransitions({ onTransitioned } = {}) {
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});

  const setLoadingFor = useCallback((contentId, verb) => {
    setLoading((prev) => ({ ...prev, [contentId]: verb }));
  }, []);
  const setErrorFor = useCallback((contentId, message) => {
    setErrors((prev) => ({ ...prev, [contentId]: message }));
  }, []);
  const clearError = useCallback((contentId) => {
    setErrors((prev) => ({ ...prev, [contentId]: null }));
  }, []);

  /**
   * Run one move. Resolves to the server's answer on success and to `null`
   * on failure — the failure is already on `errors[id]`, so a caller that
   * awaits this can branch on the result without a try/catch of its own.
   */
  const run = useCallback(
    async (contentId, verb, label, work) => {
      setErrorFor(contentId, null);
      setLoadingFor(contentId, verb);
      try {
        const result = await work();
        onTransitioned?.(contentId, result || {});
        return result || {};
      } catch (err) {
        console.error(`${label} error:`, err);
        setErrorFor(contentId, `${label} failed: ${err?.message || 'Unknown error'}`);
        return null;
      } finally {
        setLoadingFor(contentId, null);
      }
    },
    [onTransitioned, setErrorFor, setLoadingFor]
  );

  /**
   * Any edge in the state machine, by its canonical name. `publishTarget`
   * defaults to the item's own target when an item (not just an id) is passed.
   */
  const transition = useCallback(
    (itemOrId, newStatus, { reviewNotes = '', publishTarget, markLive, label } = {}) => {
      const contentId = idOf(itemOrId);
      const body = { contentId, newStatus, reviewNotes };
      // `undefined` means "the item's own target"; an explicit `null` means
      // none at all (restore does not re-target anything).
      let target = publishTarget;
      if (target === undefined) {
        target = typeof itemOrId === 'object' ? getPublishTargetForItem(itemOrId) : null;
      }
      if (target) body.publishTarget = target;
      if (markLive !== undefined) body.markLive = markLive;
      return run(
        contentId,
        TRANSITION_VERBS[newStatus] || 'transitioning',
        label || `${newStatus.replace(/_/g, ' ')}`,
        () => postJSON('transitionContentStatus', body)
      );
    },
    [run]
  );

  /** → approved: cleared for the editor and the publish stage. */
  const approve = useCallback(
    (itemOrId, { reviewNotes, publishTarget } = {}) =>
      transition(itemOrId, 'approved', {
        reviewNotes: reviewNotes ?? 'Approved for the publish stage',
        publishTarget,
        markLive: false,
        label: 'Approve',
      }),
    [transition]
  );

  /** → rejected: recoverable for the grace window, then purged. */
  const reject = useCallback(
    (itemOrId, { reviewNotes } = {}) =>
      transition(itemOrId, 'rejected', {
        reviewNotes: reviewNotes ?? 'Rejected',
        markLive: false,
        label: 'Reject',
      }),
    [transition]
  );

  /** rejected → inspected: back into the review queue; the server clears rejectedAt. */
  const restore = useCallback(
    (itemOrId, { reviewNotes } = {}) =>
      transition(itemOrId, 'inspected', {
        reviewNotes: reviewNotes ?? 'Restored from rejected',
        publishTarget: null,
        label: 'Restore',
      }),
    [transition]
  );

  /** published/approved → inspected through the publisher-only unpublish route. */
  const recall = useCallback(
    (itemOrId, { currentStatus = '', reviewNotes } = {}) => {
      const contentId = idOf(itemOrId);
      return run(contentId, 'recalling', 'Recall', () =>
        unpublishToInspected(
          contentId,
          currentStatus,
          reviewNotes ?? 'Returned to the review queue'
        )
      );
    },
    [run]
  );

  return { loading, errors, clearError, transition, approve, reject, restore, recall };
}
