/**
 * NewsletterIssues — build, review, keep, delete and approve weekly issues
 * (ADR 0030 §2a). One panel, two tabs of the Mailing List page:
 *
 *   view="review"  (Newsletter tab) builds this week's issue and holds drafts
 *                  not yet kept. Each card has a red X that deletes it at once;
 *                  an issue worth sending is kept with "Keep in Drafts".
 *   view="drafts"  (Drafts tab) holds kept drafts, and is where one is
 *                  approved — the owner's layout of 2026-09-13.
 *
 * Scheduled, sent and failed issues leave both views for the Published tab
 * (NewsletterPublished). Nothing goes to subscribers until Approve is pressed
 * and confirmed, because it cannot be undone from here once Resend has it.
 * Approval sends the version the page is showing; if the issue changed since,
 * the server refuses it.
 *
 * The open issue is edited in IssueDetail (subject, preview text, note,
 * sections, AI intro and subjects, a test send to the owner). The list is
 * IssueList.jsx, the state and requests are useNewsletterIssues.js over
 * issuesModel.js and issueActions.js (PR #841); this file puts them together
 * and holds the one question it asks: the red X's confirmation.
 */
import React, { useState } from 'react';
import ConfirmModal from '@/components/admin/ConfirmModal';
import IssueDetail from './IssueDetail';
import { IssueList, IssuesHeader, Notice } from './IssueList';
import { formatWhen } from './issueFormat';
import { issueLabel } from './issuesModel';
import useNewsletterIssues from './useNewsletterIssues';

export { formatWhen };

/** The red X's question. Nothing is sent until it is answered (ADR 0033: destructive actions confirm). */
function DeleteConfirm({ row, onCancel, onConfirm }) {
  return (
    <ConfirmModal
      open={Boolean(row)}
      title={row ? `Delete ${issueLabel(row.id)}?` : ''}
      description="The issue is removed from this list. Nothing was sent, so nothing reaches subscribers."
      confirmLabel="Delete"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

/** The open issue, when it is one of this view's rows; else null. */
const openIssue = (detail, rows) =>
  detail?.issue && rows.some((row) => row.id === detail.issue.id) ? detail.issue : null;

/** `linkedIssueId` is the `?issue=` a link carried: that issue opens first when this view lists it. */
export default function NewsletterIssues({ view = 'review', linkedIssueId = null }) {
  const panel = useNewsletterIssues(view, linkedIssueId);
  const { rows, selectedId, detail, busy, notice, testReadyAt } = panel;
  // The row whose red X was pressed, until the dialog answers.
  const [pendingDelete, setPendingDelete] = useState(null);
  const confirmDelete = () => {
    const row = pendingDelete;
    setPendingDelete(null);
    panel.remove(row);
  };
  const open = openIssue(detail, rows);

  return (
    <div className="space-y-4">
      <IssuesHeader view={view} busy={busy} onBuild={panel.build} onRefresh={panel.refresh} />

      <Notice notice={notice} />

      <IssueList
        view={view}
        rows={rows}
        selectedId={selectedId}
        busy={busy}
        onSelect={panel.select}
        onDelete={setPendingDelete}
      />

      {open && (
        // Keyed on the issue and its last write, so the editable fields reset
        // to what the server holds whenever a different or updated issue loads.
        <IssueDetail
          key={`${open.id}:${open.updatedAt ?? ''}:${open.status}`}
          view={view}
          detail={detail}
          busy={busy}
          testReadyAt={testReadyAt[open.id]}
          onSave={panel.save}
          onKeep={panel.keep}
          onApprove={panel.approve}
          onReject={panel.reject}
          onRegenerateIntro={panel.regenerateIntro}
          onSuggestSubjects={panel.suggestSubjects}
          onSendTest={panel.sendTest}
          onDuplicate={panel.duplicate}
        />
      )}

      <DeleteConfirm
        row={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
