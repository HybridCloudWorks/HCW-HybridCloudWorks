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
 * Scheduled and sent issues leave both views for the Published calendar
 * (NewsletterCalendar). Nothing goes to subscribers until Approve is pressed
 * and confirmed, because it cannot be undone from here once Resend has it.
 * Approval sends the version the page is showing; if the issue changed since,
 * the server refuses it.
 *
 * The open issue is edited in IssueDetail (subject, preview text, note,
 * sections, AI intro and subjects, a test send to the owner). This file owns
 * the list, the selection and every request, so all of them share `run`: one
 * action at a time, the selection locked while it runs, and a 409 re-reads
 * the issue.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle, Loader2, PenTool, RefreshCw, X } from 'lucide-react';
import { getJSON, postJSON, sendJSON } from '@/lib/api';
import { runJob } from '@/lib/jobs';
import IssueDetail from './IssueDetail';
import { STATUS_LABELS, formatWhen } from './issueFormat';

export { formatWhen };

/** The server allows one test send per issue a minute (429 inside it). */
const TEST_COOLDOWN_MS = 60_000;

/** Which issues each view shows. Anything scheduled or sent is on the calendar. */
const IN_VIEW = {
  review: (row) => (row.status === 'draft' && !row.savedAt) || row.status === 'rejected',
  drafts: (row) => (row.status === 'draft' && Boolean(row.savedAt)) || row.status === 'sending',
};

/** What the server will delete: nothing that was approved. */
const DELETABLE = new Set(['draft', 'rejected']);

function Notice({ notice }) {
  if (!notice) return null;
  return (
    <p
      role={notice.ok ? 'status' : 'alert'}
      className={`text-sm flex items-start gap-2 ${notice.ok ? 'text-emerald-600' : 'text-destructive'}`}
    >
      {notice.ok ? (
        <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
      )}
      {notice.message}
    </p>
  );
}

export default function NewsletterIssues({ view = 'review', settingsVersion = 0 }) {
  const [issues, setIssues] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  // Issue id -> when its next test send is allowed (ms). Held here, not in
  // IssueDetail, so the countdown survives a save that remounts the detail.
  const [testReadyAt, setTestReadyAt] = useState({});

  const loadList = useCallback(async () => {
    const res = await getJSON('cms/newsletters');
    setIssues(res.issues || []);
    return res.issues || [];
  }, []);

  const loadDetail = useCallback(async (id) => {
    setDetail(await getJSON(`cms/newsletters/${id}`));
  }, []);

  const rows = issues.filter(IN_VIEW[view] ?? IN_VIEW.review);

  useEffect(() => {
    // Deferred, like the rest of the admin pages: the effect starts a fetch
    // and the state is set when it answers, not synchronously in the effect.
    queueMicrotask(() => {
      loadList().catch((err) => setNotice({ ok: false, message: err.message }));
    });
  }, [loadList]);

  // Keep the selection inside this view: after a keep, an approval or a delete
  // the open issue leaves it, and the next one (if any) opens instead.
  useEffect(() => {
    if (busy) return;
    const ids = issues.filter(IN_VIEW[view] ?? IN_VIEW.review).map((row) => row.id);
    if (selectedId && ids.includes(selectedId)) return;
    queueMicrotask(() => {
      setSelectedId(ids[0] ?? null);
      if (!ids.length) setDetail(null);
    });
  }, [issues, view, selectedId, busy]);

  useEffect(() => {
    if (!selectedId) return;
    queueMicrotask(() => {
      loadDetail(selectedId).catch((err) => setNotice({ ok: false, message: err.message }));
    });
  }, [selectedId, loadDetail, settingsVersion]);

  const run = async (label, action) => {
    setBusy(label);
    setNotice(null);
    try {
      return await action();
    } catch (err) {
      setNotice({ ok: false, message: err.message });
      // Someone else changed this issue since it was loaded: show what is
      // stored now, so the next attempt is made against the current version.
      if (err?.status === 409 && selectedId) {
        await Promise.all([loadDetail(selectedId), loadList()]).catch(() => {});
      }
    } finally {
      setBusy('');
    }
  };

  const handleBuild = () =>
    run('build', async () => {
      const job = await runJob('build-newsletter-issue', { days: 7 });
      if (job.status !== 'succeeded') throw new Error(job.error || `Build ${job.status}`);
      const result = job.result || {};
      setNotice({ ok: result.success === true, message: result.message || 'No issue was built.' });
      await loadList();
      if (!result.issueId) return;
      // A new id is loaded by the selection effect; the SAME id (a same-day
      // rebuild) does not change the selection, so only then load it here.
      if (result.issueId === selectedId) {
        await loadDetail(result.issueId);
      } else {
        setSelectedId(result.issueId);
      }
    });

  const handleKeep = () =>
    run('keep', async () => {
      await postJSON(`cms/newsletters/${selectedId}/save`, { etag: detail?.issue?.etag });
      setNotice({ ok: true, message: 'Kept — it is on the Drafts tab.' });
      await loadList();
    });

  /** The card's red X: deletes at once, with the etag the list row carries. */
  const handleDelete = (row) =>
    run('delete', async () => {
      await sendJSON(`cms/newsletters/${row.id}`, 'DELETE', { etag: row.etag });
      if (row.id === selectedId) setDetail(null);
      setNotice({ ok: true, message: `Deleted ${row.id.replace('issue-', '')}.` });
      await loadList();
    });

  const handleSave = (patch) =>
    run('save', async () => {
      // The version this edit was made against; the server refuses a stale one.
      setDetail(
        await sendJSON(`cms/newsletters/${selectedId}`, 'PATCH', {
          ...patch,
          etag: detail?.issue?.etag,
        })
      );
      setNotice({ ok: true, message: 'Changes saved.' });
      await loadList();
    });

  const handleRegenerateIntro = () =>
    run('intro', async () => {
      setDetail(
        await postJSON(`cms/newsletters/${selectedId}/intro`, { etag: detail?.issue?.etag })
      );
      setNotice({ ok: true, message: 'Intro regenerated.' });
      await loadList();
    });

  /** Writes nothing; resolves to the suggestions, or undefined on failure. */
  const handleSuggestSubjects = () =>
    run('subjects', async () => {
      const res = await postJSON(`cms/newsletters/${selectedId}/subjects`, {});
      return res.subjects || [];
    });

  const handleSendTest = () => {
    const id = selectedId;
    return run('test', async () => {
      const res = await postJSON(`cms/newsletters/${id}/test`, { etag: detail?.issue?.etag });
      // Recording the send changed the issue's etag. Hold the new one, or the
      // next save, keep or approval would be refused as stale.
      if (res?.etag) {
        setDetail((current) =>
          current?.issue?.id === id
            ? { ...current, issue: { ...current.issue, etag: res.etag } }
            : current
        );
      }
      setTestReadyAt((current) => ({ ...current, [id]: Date.now() + TEST_COOLDOWN_MS }));
      setNotice({ ok: true, message: `Test sent to ${res?.sentTo}.` });
      // The list row carries the etag the red X deletes with.
      await loadList();
    });
  };

  /**
   * Re-read the issue after an approval that did not come back as a clean
   * success. A warning or a refusal can mean the server's state moved — to
   * `sending`, back to `draft`, or to `rejected` — and a page still showing the
   * old draft would keep offering an Approve the server will refuse.
   */
  const refreshAfterApproval = async (id) => {
    await Promise.all([loadDetail(id), loadList()]).catch(() => {});
  };

  const handleApprove = () => {
    const id = selectedId;
    const etag = detail?.issue?.etag;
    setBusy('approve');
    setNotice(null);
    return (async () => {
      try {
        // The version on screen: an issue edited since is refused, not sent.
        const res = await postJSON(`cms/newsletters/${id}/approve`, { etag });
        if (res?.warning) {
          setNotice({ ok: false, message: res.warning });
          await refreshAfterApproval(id);
          return;
        }
        setDetail(res);
        const when = res.issue?.scheduledAt
          ? `scheduled for ${formatWhen(res.issue.scheduledAt)}`
          : 'sent';
        setNotice({
          ok: true,
          message: `Approved — the newsletter is ${when}. It is on the Published tab.`,
        });
        await loadList();
      } catch (err) {
        setNotice({ ok: false, message: err.message });
        await refreshAfterApproval(id);
      } finally {
        setBusy('');
      }
    })();
  };

  const handleReject = () =>
    run('reject', async () => {
      setDetail(
        await postJSON(`cms/newsletters/${selectedId}/reject`, { etag: detail?.issue?.etag })
      );
      setNotice({ ok: true, message: 'Stuck send cleared.' });
      await loadList();
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{view === 'drafts' ? 'Drafts' : 'Weekly issues'}</h3>
        <div className="flex gap-2">
          {view === 'review' && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8"
              onClick={handleBuild}
              disabled={Boolean(busy)}
            >
              {busy === 'build' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PenTool className="h-3.5 w-3.5" />
              )}
              Build this week&apos;s issue
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-8"
            onClick={() => run('refresh', loadList)}
            disabled={Boolean(busy)}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      <Notice notice={notice} />

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {view === 'drafts'
            ? 'Nothing in Drafts. Keep an issue from the Newsletter tab and it appears here.'
            : "No issues to review. Build this week's issue to draft one from what was published."}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-3 pt-2" aria-label="Issues">
          {rows.map((row) => {
            const label = row.id.replace('issue-', '');
            return (
              <li key={row.id} className="relative">
                <button
                  type="button"
                  onClick={() => setSelectedId(row.id)}
                  // Not while an action runs: its late response would land on
                  // whichever issue had been selected in the meantime.
                  disabled={Boolean(busy)}
                  aria-pressed={row.id === selectedId}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${row.id === selectedId ? 'border-primary' : 'border-border'}`}
                >
                  <span className="block font-medium">{label}</span>
                  <Badge variant="secondary" className="mt-1 text-[10px]">
                    {STATUS_LABELS[row.status] || row.status}
                  </Badge>
                </button>
                {DELETABLE.has(row.status) && (
                  <button
                    type="button"
                    onClick={() => handleDelete(row)}
                    disabled={Boolean(busy)}
                    aria-label={`Delete ${label}`}
                    title="Delete"
                    className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white shadow hover:bg-red-700 disabled:opacity-50"
                  >
                    <X className="h-3 w-3" strokeWidth={3} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {detail?.issue && rows.some((row) => row.id === detail.issue.id) && (
        // Keyed on the issue and its last write, so the editable fields reset
        // to what the server holds whenever a different or updated issue loads.
        <IssueDetail
          key={`${detail.issue.id}:${detail.issue.updatedAt ?? ''}:${detail.issue.status}`}
          view={view}
          detail={detail}
          busy={busy}
          testReadyAt={testReadyAt[detail.issue.id]}
          onSave={handleSave}
          onKeep={handleKeep}
          onApprove={handleApprove}
          onReject={handleReject}
          onRegenerateIntro={handleRegenerateIntro}
          onSuggestSubjects={handleSuggestSubjects}
          onSendTest={handleSendTest}
        />
      )}
    </div>
  );
}
