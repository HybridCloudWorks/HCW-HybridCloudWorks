/**
 * The Drafts page's list (GET cms/drafts): loaded once auth is ready, again
 * on Refresh and after an import, and kept in step with each write the page
 * makes so a save does not need a reload to show.
 */
import { useCallback, useEffect, useState } from 'react';
import { getJSON } from '@/lib/api';
import { DRAFTS_ROUTE } from './draftForm';

async function readDrafts() {
  const result = await getJSON(DRAFTS_ROUTE);
  return Array.isArray(result?.drafts) ? result.drafts : [];
}

/** The list row for a draft view the API answered: the view without its fields. */
export const toRow = (draft) => {
  const { fields: _fields, ...row } = draft;
  return row;
};

export function useDraftList(authReady) {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /** The list's answer into state; `isCurrent` drops an answer for an unmounted page. */
  const applyList = useCallback(async (isCurrent = () => true) => {
    try {
      const rows = await readDrafts();
      if (!isCurrent()) return;
      setDrafts(rows);
      setError(null);
    } catch (err) {
      if (isCurrent()) setError(err.message || 'Failed to load drafts.');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  /** Refresh: the spinner, then the list. */
  const reload = useCallback(() => {
    setLoading(true);
    return applyList();
  }, [applyList]);

  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;
    (async () => {
      await applyList(() => !cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, applyList]);

  /** Put a draft view the API just answered at the top of the list. */
  const upsert = useCallback((draft) => {
    setDrafts((rows) => [toRow(draft), ...rows.filter((row) => row.id !== draft.id)]);
  }, []);

  const remove = useCallback((id) => {
    setDrafts((rows) => rows.filter((row) => row.id !== id));
  }, []);

  return { drafts, loading, error, reload, upsert, remove };
}
