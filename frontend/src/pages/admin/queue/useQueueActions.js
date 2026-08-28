/**
 * Every mutating action the review queue can take, and the state that tracks
 * them.
 *
 * Extracted from QueuePage.jsx (TODO.md T-412). This is the page's riskiest
 * code — the bulk paths transition many documents one at a time and each
 * partial failure has to be attributed back to its own card — so isolating it
 * means it can be exercised without rendering four hundred lines of card
 * markup.
 *
 * Three shapes of state live here:
 *
 *  - per-item, keyed by content id: `actionLoading` and `actionError`, so one
 *    card can be spinning or showing a failure without touching its neighbours;
 *  - per-bulk-run: the two in-flight flags and the result banner;
 *  - the confirm-target state machine, which is what the modal reads. Every
 *    destructive path routes through it rather than acting on click.
 *
 * The bulk runs deliberately do not stop on the first failure. They collect
 * failures, remove only the documents that actually transitioned, and write
 * each failure back into `actionError` under its own id — so a run of 40 with
 * 3 failures leaves exactly those 3 on screen with a reason each.
 *
 * Items are mutated optimistically rather than refetched, which is why
 * `setItems` is a parameter.
 */
import { useCallback, useEffect, useState } from 'react';
import { postJSON } from '@/lib/api';
import { logAdminAction } from '@/lib/auditLog';
import { requestContentInspection } from '@/lib/contentWorkflow';
import { getPublishTargetForItem } from '@/lib/contentModel';

/** Mirrors FORGE_MAX_BATCH in functions/src/functions/forge-jobs.js — the
 * job rejects a larger batch, so a bigger selection is chunked here. */
export const FORGE_MAX_BATCH = 10;

/**
 * @param {object} params
 * @param {Array} params.items the queue items currently on screen
 * @param {Function} params.setItems optimistic updates land through this
 * @param {string} params.statusFilter which filter is showing — the rejected
 *   view keeps an item on screen after a permanent delete, the others do not
 * @param {string} params.contentTypeFilter only used to clear the selection
 */
export function useQueueActions({ items, setItems, statusFilter, contentTypeFilter }) {
  const [actionLoading, setActionLoading] = useState({});
  const [actionError, setActionError] = useState({});
  const [bulkDeletingRejected, setBulkDeletingRejected] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState(null);
  const [bulkDeleteMessage, setBulkDeleteMessage] = useState(null);
  // { type: 'reject'|'bulkDelete'|'bulkReject'|'restore'|'deleteRejected', id?: string, ids?: string[] }
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkRejecting, setBulkRejecting] = useState(false);

  // Changing filter changes which items are on screen, so a selection made
  // against the old set would bulk-act on items the admin can no longer see.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [statusFilter, contentTypeFilter]);

  const toggleSelected = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Header select-all over the ids currently on screen: everything visible
  // selected → clear, anything unselected → select all visible. Operates on
  // the caller-supplied visible ids rather than `items` so a sorted or
  // paged view selects exactly what the admin is looking at.
  const toggleSelectAll = useCallback((visibleIds) => {
    setSelectedIds((prev) => {
      const ids = (visibleIds || []).filter(Boolean);
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  }, []);

  const [forgingSelected, setForgingSelected] = useState(false);
  const [forgeMessage, setForgeMessage] = useState(null);
  const [forgeError, setForgeError] = useState(null);

  /**
   * "Forge Selected" (Blog Machine T-603): enqueue the checked documents in
   * ≤FORGE_MAX_BATCH chunks and let the pipeline run under the job budget —
   * fire-and-forget like the Forge-from-URL box, because a forge run takes
   * minutes and its results land back in this queue as forge_ready/editing.
   * The pipeline's own gates (title dedupe 409, empty-source refusal) decide
   * per document; nothing is filtered here beyond "still on screen".
   */
  const handleForgeSelected = async () => {
    const ids = Array.from(selectedIds).filter((id) => items.some((it) => it.id === id));
    if (ids.length === 0) return;
    setForgingSelected(true);
    setForgeError(null);
    setForgeMessage(null);
    const jobIds = [];
    const failures = [];
    try {
      for (let start = 0; start < ids.length; start += FORGE_MAX_BATCH) {
        const chunk = ids.slice(start, start + FORGE_MAX_BATCH);
        try {
          const accepted = await postJSON('enqueueJob', {
            type: 'forge-article',
            payload: { sourceContentIds: chunk },
          });
          if (!accepted?.ok || !accepted.jobId) {
            throw new Error(accepted?.error || 'Job was not accepted');
          }
          jobIds.push(accepted.jobId);
        } catch (err) {
          failures.push({ count: chunk.length, message: err?.message || 'Unknown error' });
        }
      }
      if (jobIds.length) {
        await logAdminAction('content_forge_enqueued', { count: ids.length, jobIds });
        setSelectedIds(new Set());
        setForgeMessage(
          `Forge queued for ${ids.length - failures.reduce((n, f) => n + f.count, 0)} item${ids.length === 1 ? '' : 's'} (job${jobIds.length === 1 ? '' : 's'} ${jobIds.join(', ')}). Results land back here as forge_ready or editing — refresh in a few minutes.`
        );
      }
      if (failures.length) {
        setForgeError(
          `${failures.reduce((n, f) => n + f.count, 0)} item(s) failed to queue: ${failures[0].message}`
        );
      }
    } finally {
      setForgingSelected(false);
    }
  };

  const handleBulkReject = () => {
    const ids = Array.from(selectedIds).filter((id) => items.some((it) => it.id === id));
    if (ids.length < 2) return;
    setConfirmTarget({ type: 'bulkReject', ids });
  };

  const doBulkReject = async (ids) => {
    setBulkRejecting(true);
    setBulkDeleteError(null);
    setBulkDeleteMessage(null);
    let successCount = 0;
    const failures = [];
    try {
      for (const contentId of ids) {
        try {
          await postJSON('transitionContentStatus', {
            contentId,
            newStatus: 'rejected',
            markLive: false,
            reviewNotes: 'Bulk rejected from queue',
          });
          await logAdminAction('content_rejected', { contentId, bulk: true });
          successCount += 1;
        } catch (err) {
          console.error('Bulk reject error for', contentId, err);
          failures.push({ id: contentId, message: err?.message || 'Unknown error' });
        }
      }
      const failedIds = new Set(failures.map((f) => f.id));
      const successSet = new Set(ids.filter((id) => !failedIds.has(id)));
      setItems((prev) => prev.filter((item) => !successSet.has(item.id)));
      setSelectedIds(new Set());
      if (failures.length) {
        setActionError((prev) => {
          const next = { ...prev };
          for (const f of failures) next[f.id] = `Reject failed: ${f.message}`;
          return next;
        });
      }
      setBulkDeleteMessage(
        `Rejected ${successCount} item${successCount === 1 ? '' : 's'}.${
          failures.length
            ? ` ${failures.length} failed — see red error under each remaining card.`
            : ''
        }`
      );
    } finally {
      setBulkRejecting(false);
    }
  };

  const handleApprove = async (item) => {
    const contentId = item.id;
    const publishTarget = getPublishTargetForItem(item);

    setActionError((prev) => ({ ...prev, [contentId]: null }));
    setActionLoading((prev) => ({ ...prev, [contentId]: 'approving' }));
    try {
      const newStatus = 'approved_blog';

      await postJSON('transitionContentStatus', {
        contentId,
        newStatus,
        publishTarget,
        markLive: false,
        reviewNotes: `Approved in queue for ${publishTarget} publish stage`,
      });

      await logAdminAction('content_approved', { contentId, publishTarget, newStatus });
      setItems((prev) => prev.filter((item) => item.id !== contentId));
    } catch (err) {
      console.error('Approve error:', err);
      setActionError((prev) => ({ ...prev, [contentId]: `Approve failed: ${err.message}` }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [contentId]: null }));
    }
  };

  const handleReject = (contentId) => {
    setConfirmTarget({ type: 'reject', id: contentId });
  };

  const doReject = async (contentId) => {
    setActionError((prev) => ({ ...prev, [contentId]: null }));
    setActionLoading((prev) => ({ ...prev, [contentId]: 'rejecting' }));
    try {
      await postJSON('transitionContentStatus', {
        contentId,
        newStatus: 'rejected',
        markLive: false,
        reviewNotes: 'Rejected from queue',
      });
      await logAdminAction('content_rejected', { contentId });
      setItems((prev) => prev.filter((item) => item.id !== contentId));
    } catch (err) {
      console.error('Reject error:', err);
      setActionError((prev) => ({ ...prev, [contentId]: `Reject failed: ${err.message}` }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [contentId]: null }));
    }
  };

  const handleDeleteRejectedNow = () => {
    if (statusFilter !== 'rejected') {
      setBulkDeleteError('Switch the filter to Rejected to bulk delete those items.');
      return;
    }
    setConfirmTarget({ type: 'bulkDelete' });
  };

  const doBulkDelete = async () => {
    setBulkDeleteError(null);
    setBulkDeleteMessage(null);
    setBulkDeletingRejected(true);
    try {
      let deletedCount = 0;
      let hasMore = false;

      do {
        const result = await postJSON('deleteRejectedContent', { limit: 100 });
        deletedCount += result.deletedCount || 0;
        hasMore = result.hasMore === true && (result.deletedCount || 0) > 0;
      } while (hasMore);

      await logAdminAction('bulk_delete_rejected', { deletedCount, mode: 'soft' });
      setItems([]);
      setBulkDeleteMessage(`Soft-deleted ${deletedCount} rejected items. Recoverable for 7 days.`);
    } catch (err) {
      console.error('Delete rejected error:', err);
      setBulkDeleteError(`Delete rejected failed: ${err.message}`);
    } finally {
      setBulkDeletingRejected(false);
    }
  };

  const handleRestore = (contentId) => {
    setConfirmTarget({ type: 'restore', id: contentId });
  };

  const handlePermanentDelete = (contentId) => {
    setConfirmTarget({ type: 'deleteRejected', id: contentId });
  };

  const doRestore = async (contentId) => {
    setActionError((prev) => ({ ...prev, [contentId]: null }));
    setActionLoading((prev) => ({ ...prev, [contentId]: 'restoring' }));
    try {
      await postJSON('transitionContentStatus', {
        contentId,
        newStatus: 'inspected',
        reviewNotes: 'Restored from rejected status',
      });
      setItems((prev) => prev.filter((item) => item.id !== contentId));
    } catch (err) {
      console.error('Restore error:', err);
      setActionError((prev) => ({ ...prev, [contentId]: `Restore failed: ${err.message}` }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [contentId]: null }));
    }
  };

  const doPermanentDelete = async (contentId) => {
    setActionError((prev) => ({ ...prev, [contentId]: null }));
    setActionLoading((prev) => ({ ...prev, [contentId]: 'deleting' }));
    try {
      await postJSON('deleteContentItem', { contentId });
      await logAdminAction('content_deleted_from_rejected_queue', { contentId });
      setItems((prev) => prev.filter((item) => item.id !== contentId));
    } catch (err) {
      console.error('Permanent delete error:', err);
      setActionError((prev) => ({
        ...prev,
        [contentId]: `Permanent delete failed: ${err.message}`,
      }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [contentId]: null }));
    }
  };

  /**
   * Run whatever the confirm modal was opened for.
   *
   * Deliberately NOT memoized. It was `useCallback(..., [confirmTarget])`,
   * which is wrong in a way that only shows up under load: every `do*` below is
   * a fresh closure each render over the current `items` and `selectedIds`, so
   * pinning this to `confirmTarget` captures the versions from whichever render
   * last changed the target and acts on the state as it was then. Memoizing
   * bought nothing either — the dependencies change every render regardless.
   */
  const handleConfirm = async () => {
    const target = confirmTarget;
    setConfirmTarget(null);
    if (!target) return;
    if (target.type === 'reject') await doReject(target.id);
    else if (target.type === 'bulkDelete') await doBulkDelete();
    else if (target.type === 'bulkReject') await doBulkReject(target.ids || []);
    else if (target.type === 'restore') await doRestore(target.id);
    else if (target.type === 'deleteRejected') await doPermanentDelete(target.id);
  };

  const handleReinspect = async (contentId) => {
    setActionError((prev) => ({ ...prev, [contentId]: null }));
    setActionLoading((prev) => ({ ...prev, [contentId]: 'inspecting' }));
    try {
      await requestContentInspection(contentId);
      setItems((prev) => prev.filter((item) => item.id !== contentId));
    } catch (err) {
      console.error('Reinspect error:', err);
      setActionError((prev) => ({ ...prev, [contentId]: `Reinspect failed: ${err.message}` }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [contentId]: null }));
    }
  };

  const handleGenerateHero = async (contentId) => {
    setActionError((prev) => ({ ...prev, [contentId]: null }));
    setActionLoading((prev) => ({ ...prev, [contentId]: 'generatingHero' }));
    try {
      const result = await postJSON('generateReviewHeroImage', { contentId });
      if (!result?.success) {
        throw new Error(result?.error || 'Image generation failed');
      }
      setItems((prev) =>
        prev.map((item) =>
          item.id === contentId
            ? {
                ...item,
                altCoverImage: result.imageUrl,
                __regenAt: Date.now(),
              }
            : item
        )
      );
    } catch (err) {
      console.error('Generate hero error:', err);
      setActionError((prev) => ({
        ...prev,
        [contentId]: `Image generation failed: ${err.message}`,
      }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [contentId]: null }));
    }
  };

  return {
    actionLoading,
    actionError,
    bulkDeletingRejected,
    bulkDeleteError,
    bulkDeleteMessage,
    bulkRejecting,
    confirmTarget,
    setConfirmTarget,
    selectedIds,
    toggleSelected,
    toggleSelectAll,
    forgingSelected,
    forgeMessage,
    forgeError,
    handleForgeSelected,
    handleApprove,
    handleBulkReject,
    handleConfirm,
    handleDeleteRejectedNow,
    handleGenerateHero,
    handlePermanentDelete,
    handleReinspect,
    handleReject,
    handleRestore,
  };
}
