/**
 * The Delete Live Page flow: which record the confirm modal is asking about,
 * which one is in flight, the last failure, and the URLs deleted since the
 * list was loaded (so a deleted row leaves the screen without a refetch).
 * Out of LivePagesPage.jsx so the page is a composition root (PR #841).
 */
import { useState } from 'react';
import { postJSON } from '@/lib/api';
import { deletePayload, liveUrlKey } from './liveItems';

export function useLivePageDeletion() {
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingId, setDeletingId] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [locallyDeletedKeys, setLocallyDeletedKeys] = useState({});

  const handleDeleteLivePage = async () => {
    if (!deleteTarget) return;
    const normalizedUrl = liveUrlKey(deleteTarget);
    setDeleteError('');
    setDeletingId(deleteTarget.id);
    try {
      await postJSON('softDeleteLivePage', deletePayload(deleteTarget));
      if (normalizedUrl) {
        setLocallyDeletedKeys((prev) => ({ ...prev, [normalizedUrl]: true }));
      }
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete live page');
    } finally {
      setDeletingId('');
    }
  };

  return {
    deleteTarget,
    setDeleteTarget,
    deletingId,
    deleteError,
    locallyDeletedKeys,
    handleDeleteLivePage,
  };
}
