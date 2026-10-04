/**
 * The issues panel's state and actions as one hook (ADR 0030 §2a; split out
 * of NewsletterIssues.jsx in PR #841). It reads the list and the open issue,
 * keeps the selection inside the view, and hands every request in
 * issueActions.js the panel's current `ctx`. The component is left with what
 * it renders.
 */
import { useCallback, useEffect, useReducer } from 'react';
import { getJSON } from '@/lib/api';
import * as actions from './issueActions';
import { INITIAL_STATE, issuesReducer, rowsInView } from './issuesModel';

/**
 * @param {'review'|'drafts'} view
 * @returns the state (`rows`, `selectedId`, `detail`, `busy`, `notice`,
 *   `testReadyAt`), `select(id)`, and one function per action.
 */
export default function useNewsletterIssues(view) {
  const [state, dispatch] = useReducer(issuesReducer, INITIAL_STATE);
  const { issues, selectedId, detail, busy } = state;

  const fail = useCallback(
    (err) => dispatch({ type: 'notice', notice: { ok: false, message: err.message } }),
    []
  );

  const loadList = useCallback(async () => {
    const res = await getJSON('cms/newsletters');
    const list = res.issues || [];
    dispatch({ type: 'issues', issues: list });
    return list;
  }, []);

  const loadDetail = useCallback(async (id) => {
    dispatch({ type: 'detail', detail: await getJSON(`cms/newsletters/${id}`) });
  }, []);

  useEffect(() => {
    // Deferred, like the rest of the admin pages: the effect starts a fetch
    // and the state is set when it answers, not synchronously in the effect.
    queueMicrotask(() => {
      loadList().catch(fail);
    });
  }, [loadList, fail]);

  // Keep the selection inside this view: after a keep, an approval or a delete
  // the open issue leaves it, and the next one (if any) opens instead.
  useEffect(() => {
    if (busy) return;
    const ids = rowsInView(issues, view).map((row) => row.id);
    if (selectedId && ids.includes(selectedId)) return;
    queueMicrotask(() => dispatch({ type: 'reselect', id: ids[0] ?? null }));
  }, [issues, view, selectedId, busy]);

  useEffect(() => {
    if (!selectedId) return;
    queueMicrotask(() => {
      loadDetail(selectedId).catch(fail);
    });
  }, [selectedId, loadDetail, fail]);

  const ctx = { view, selectedId, etag: detail?.issue?.etag, dispatch, loadList, loadDetail };

  return {
    ...state,
    rows: rowsInView(issues, view),
    select: (id) => dispatch({ type: 'select', id }),
    refresh: () => actions.runAction(ctx, 'refresh', loadList),
    build: () => actions.buildIssue(ctx),
    keep: () => actions.keepIssue(ctx),
    remove: (row) => actions.deleteIssue(ctx, row),
    duplicate: () => actions.duplicateIssue(ctx),
    save: (patch) => actions.saveIssue(ctx, patch),
    regenerateIntro: () => actions.regenerateIntro(ctx),
    suggestSubjects: () => actions.suggestSubjects(ctx),
    sendTest: () => actions.sendTest(ctx),
    approve: () => actions.approveIssue(ctx),
    reject: () => actions.rejectIssue(ctx),
  };
}
