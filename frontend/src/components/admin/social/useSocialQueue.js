/**
 * What the Queue tab holds: Publer's own schedule and this hub's records of
 * it, read together, with the guarded deletes and the edit the tab offers.
 *
 * Split out of QueueTab (PR #841) so the tab is one return over a view table
 * — loading, error, or the two lists — and the state lives where it can be
 * exercised without rendering the cards.
 */
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import {
  deleteSocialPostDoc,
  listSocialPosts,
  publerCallFailed,
  publerDeletePost,
  publerListPosts,
  readPublerPosts,
} from './publerApi';

export default function useSocialQueue() {
  const { toast } = useToast();

  const [publerPosts, setPublerPosts] = useState([]);
  const [publerNotice, setPublerNotice] = useState('');
  const [localPosts, setLocalPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  // `{ kind: 'publer' | 'local', post }` while the confirm dialog is open.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [publerRes, snap] = await Promise.all([
        publerListPosts('scheduled').catch(publerCallFailed),
        listSocialPosts(),
      ]);
      const { posts, notice } = readPublerPosts(publerRes);
      setPublerPosts(posts);
      setPublerNotice(notice);
      setLocalPosts(Array.isArray(snap) ? snap : []);
    } catch (err) {
      // A failed read empties both lists rather than leaving rows beside an
      // error saying they could not be read (#555).
      setPublerPosts([]);
      setLocalPosts([]);
      setError(err?.message || 'Could not load the queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      load();
    });
  }, [load]);

  const refresh = () => {
    setLoading(true);
    load();
  };

  const handleDeletePubler = async (postId) => {
    // Ignore a second click while the first delete is unanswered rather than
    // sending it twice (#555).
    if (deletingId) return;
    setDeletingId(postId);
    try {
      await publerDeletePost(postId);
      setPublerPosts((prev) => prev.filter((p) => p.id !== postId));
      toast({ title: 'Post deleted from Publer' });
    } catch (err) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteLocal = async (docId) => {
    if (deletingId) return;
    setDeletingId(docId);
    try {
      await deleteSocialPostDoc(docId);
      setLocalPosts((prev) => prev.filter((p) => p.id !== docId));
      toast({ title: 'Post record removed' });
    } catch (err) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  const confirmDelete = () => {
    const pending = pendingDelete;
    setPendingDelete(null);
    if (!pending) return;
    if (pending.kind === 'publer') handleDeletePubler(pending.post.id);
    else handleDeleteLocal(pending.post.id);
  };

  /** Paint an edited record over its row and close the dialog. */
  const applyEdit = (updated) => {
    setLocalPosts((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
    setEditing(null);
  };

  return {
    publerPosts,
    publerNotice,
    localPosts,
    loading,
    error,
    deletingId,
    pendingDelete,
    setPendingDelete,
    editing,
    setEditing,
    refresh,
    confirmDelete,
    applyEdit,
  };
}
