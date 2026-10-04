/**
 * Every request the issues panel makes (ADR 0030 §2a; split out of
 * NewsletterIssues.jsx in PR #841). Each takes the panel's `ctx`:
 *
 *   { view, selectedId, etag, dispatch, loadList, loadDetail }
 *
 * and all but approval share `runAction`: one action at a time, the
 * selection locked while it runs, and a 409 re-reads the issue. Nothing goes
 * to subscribers until `approveIssue`, which cannot be undone from here once
 * Resend has it.
 */
import { postJSON, sendJSON } from '@/lib/api';
import { runJob } from '@/lib/jobs';
import { formatWhen } from './issueFormat';
import { TEST_COOLDOWN_MS, issueLabel } from './issuesModel';

const notify = (dispatch, ok, message) => dispatch({ type: 'notice', notice: { ok, message } });

/** Re-read the open issue and the list; a failure here is not news on its own. */
const reload = (ctx, id) => Promise.all([ctx.loadDetail(id), ctx.loadList()]).catch(() => {});

/**
 * `busy` is the label while `action` runs and the notice is cleared first; a
 * failure becomes the notice. Someone else changing the issue since it was
 * loaded (409) re-reads it, so the next attempt is made against the current
 * version. Resolves to what `action` resolves to, or undefined on failure.
 */
export async function runAction(ctx, label, action) {
  const { dispatch } = ctx;
  dispatch({ type: 'busy', label });
  dispatch({ type: 'notice', notice: null });
  try {
    return await action();
  } catch (err) {
    notify(dispatch, false, err.message);
    if (err?.status === 409 && ctx.selectedId) await reload(ctx, ctx.selectedId);
  } finally {
    dispatch({ type: 'busy', label: '' });
  }
}

export const buildIssue = (ctx) =>
  runAction(ctx, 'build', async () => {
    // No days: the window saved in Newsletter settings → Content applies (#557).
    const job = await runJob('build-newsletter-issue', {});
    if (job.status !== 'succeeded') throw new Error(job.error || `Build ${job.status}`);
    const result = job.result || {};
    notify(ctx.dispatch, result.success === true, result.message || 'No issue was built.');
    await ctx.loadList();
    if (!result.issueId) return;
    // A new id is loaded by the selection effect; the SAME id (a same-day
    // rebuild) does not change the selection, so only then load it here.
    if (result.issueId === ctx.selectedId) await ctx.loadDetail(result.issueId);
    else ctx.dispatch({ type: 'select', id: result.issueId });
  });

export const keepIssue = (ctx) =>
  runAction(ctx, 'keep', async () => {
    await postJSON(`cms/newsletters/${ctx.selectedId}/save`, { etag: ctx.etag });
    notify(ctx.dispatch, true, 'Kept — it is on the Drafts tab.');
    await ctx.loadList();
  });

/** The card's red X, once confirmed: deletes with the etag the list row carries. */
export const deleteIssue = (ctx, row) =>
  runAction(ctx, 'delete', async () => {
    await sendJSON(`cms/newsletters/${row.id}`, 'DELETE', { etag: row.etag });
    if (row.id === ctx.selectedId) ctx.dispatch({ type: 'detail', detail: null });
    notify(ctx.dispatch, true, `Deleted ${issueLabel(row.id)}.`);
    await ctx.loadList();
  });

/** A new kept draft with this issue's content (ADR 0033); it opens on Drafts. */
export const duplicateIssue = (ctx) =>
  runAction(ctx, 'duplicate', async () => {
    const res = await postJSON(`cms/newsletters/${ctx.selectedId}/duplicate`, {});
    notify(ctx.dispatch, true, `Duplicated as ${res.issue.id} — it is on the Drafts tab.`);
    await ctx.loadList();
    if (ctx.view === 'drafts') ctx.dispatch({ type: 'select', id: res.issue.id });
  });

/** A write that answers with the stored issue: show it, say so, refresh the list. */
const writeDetail = (ctx, label, request, message) =>
  runAction(ctx, label, async () => {
    ctx.dispatch({ type: 'detail', detail: await request() });
    notify(ctx.dispatch, true, message);
    await ctx.loadList();
  });

/** The version this edit was made against travels with it; the server refuses a stale one. */
export const saveIssue = (ctx, patch) =>
  writeDetail(
    ctx,
    'save',
    () => sendJSON(`cms/newsletters/${ctx.selectedId}`, 'PATCH', { ...patch, etag: ctx.etag }),
    'Changes saved.'
  );

export const regenerateIntro = (ctx) =>
  writeDetail(
    ctx,
    'intro',
    () => postJSON(`cms/newsletters/${ctx.selectedId}/intro`, { etag: ctx.etag }),
    'Intro regenerated.'
  );

export const rejectIssue = (ctx) =>
  writeDetail(
    ctx,
    'reject',
    () => postJSON(`cms/newsletters/${ctx.selectedId}/reject`, { etag: ctx.etag }),
    'Stuck send cleared.'
  );

/** Writes nothing; resolves to the suggestions, or undefined on failure. */
export const suggestSubjects = (ctx) =>
  runAction(ctx, 'subjects', async () => {
    const res = await postJSON(`cms/newsletters/${ctx.selectedId}/subjects`, {});
    return res.subjects || [];
  });

/** An unusable template sends the test in the built-in design; say so. */
const templateFallbackNote = (res) =>
  res?.templateProblem?.message
    ? ` It used the built-in design because your template could not be used: ${res.templateProblem.message}`
    : '';

export const sendTest = (ctx) => {
  const id = ctx.selectedId;
  return runAction(ctx, 'test', async () => {
    const res = await postJSON(`cms/newsletters/${id}/test`, { etag: ctx.etag });
    // Recording the send changed the issue's etag. Hold the new one, or the
    // next save, keep or approval would be refused as stale.
    if (res?.etag) ctx.dispatch({ type: 'etag', id, etag: res.etag });
    ctx.dispatch({ type: 'testSent', id, readyAt: Date.now() + TEST_COOLDOWN_MS });
    notify(ctx.dispatch, true, `Test sent to ${res?.sentTo}.${templateFallbackNote(res)}`);
    // The list row carries the etag the red X deletes with.
    await ctx.loadList();
  });
};

const approvedWhen = (res) =>
  res.issue?.scheduledAt ? `scheduled for ${formatWhen(res.issue.scheduledAt)}` : 'sent';

/**
 * Approval is not `runAction`: a warning or a refusal can mean the server's
 * state moved — to `sending`, back to `draft`, or to `rejected` — and a page
 * still showing the old draft would keep offering an Approve the server will
 * refuse. So both re-read the issue, not only a 409.
 */
export async function approveIssue(ctx) {
  const { dispatch, selectedId: id, etag } = ctx;
  dispatch({ type: 'busy', label: 'approve' });
  dispatch({ type: 'notice', notice: null });
  try {
    // The version on screen: an issue edited since is refused, not sent.
    const res = await postJSON(`cms/newsletters/${id}/approve`, { etag });
    if (res?.warning) {
      notify(dispatch, false, res.warning);
      await reload(ctx, id);
      return;
    }
    dispatch({ type: 'detail', detail: res });
    notify(
      dispatch,
      true,
      `Approved — the newsletter is ${approvedWhen(res)}. It is on the Published tab.`
    );
    await ctx.loadList();
  } catch (err) {
    notify(dispatch, false, err.message);
    await reload(ctx, id);
  } finally {
    dispatch({ type: 'busy', label: '' });
  }
}
