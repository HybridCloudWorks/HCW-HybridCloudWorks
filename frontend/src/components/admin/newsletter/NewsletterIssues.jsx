/**
 * NewsletterIssues — build, review and edit weekly issues (ADR 0030 §2a).
 *
 * The flow on this panel is the owner's decision of 2026-09-13: an issue is
 * built as a draft and the email is shown exactly as it would send. Approving
 * and sending is a separate change; until it lands, this panel says so rather
 * than showing a button that does nothing.
 *
 * The preview is an iframe with an EMPTY sandbox: the email's HTML is rendered
 * but cannot run script, submit forms or navigate this page.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, CheckCircle, Loader2, PenTool, RefreshCw, XCircle } from 'lucide-react';
import { getJSON, postJSON, sendJSON } from '@/lib/api';
import { runJob } from '@/lib/jobs';

const STATUS_LABELS = {
  draft: 'Draft',
  sending: 'Sending',
  scheduled: 'Scheduled',
  sent: 'Sent',
  rejected: 'Rejected',
};

function formatWhen(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

/** "immediately", a formatted instant, or '' when there is no plan. */
function describePlan(plan) {
  if (!plan) return '';
  if (plan.sendNow) return 'immediately';
  return formatWhen(plan.scheduledAt);
}

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

function StatusWarnings({ issue }) {
  return (
    <>
      {issue.status === 'sending' && (
        <p role="alert" className="text-sm text-destructive">
          This issue was mid-send when something failed. Check Resend&apos;s Broadcasts list before
          doing anything: if it is there, it went out. Reject clears this state.
        </p>
      )}
      {issue.lastError && issue.status === 'draft' && (
        <p role="alert" className="text-sm text-destructive">
          The last approval was refused: {issue.lastError}
        </p>
      )}
      {issue.introError && (
        <p className="text-sm text-muted-foreground">
          The AI intro was not written ({issue.introError}). Add a note below if you want one.
        </p>
      )}
    </>
  );
}

/** What sending will need, said now, so settings are ready before approval exists. */
function SendReadiness({ detail }) {
  const planText = describePlan(detail.sendPlan);
  return (
    <div className="space-y-1 text-sm">
      {detail.readyToSend ? (
        <p>
          Settings are complete. Approving and sending arrive in the next update; an issue approved
          now would go out <strong>{planText}</strong>.
        </p>
      ) : (
        <p role="alert" className="text-destructive">
          Before this can be sent, add the {detail.missingSettings.join(' and ')} in Newsletter
          settings.
        </p>
      )}
    </div>
  );
}

function IssueDetail({ detail, busy, onSave, onReject }) {
  const { issue } = detail;
  const [subject, setSubject] = useState(issue.subject || '');
  const [customNote, setCustomNote] = useState(issue.customNote || '');
  const isDraft = issue.status === 'draft';
  const dirty = isDraft && (subject !== issue.subject || customNote !== (issue.customNote || ''));

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge>{STATUS_LABELS[issue.status] || issue.status}</Badge>
        <span className="text-muted-foreground">{issue.itemCount} item(s)</span>
        {issue.scheduledAt && <span>Sends {formatWhen(issue.scheduledAt)}</span>}
        {issue.sentAt && <span>Sent {formatWhen(issue.sentAt)}</span>}
      </div>

      <StatusWarnings issue={issue} />

      {isDraft && (
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="nl-subject">Subject</Label>
            <Input
              id="nl-subject"
              maxLength={120}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nl-note">Your note (optional, shown under the intro)</Label>
            <Textarea
              id="nl-note"
              rows={4}
              maxLength={2000}
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              placeholder="Announcements, events, anything the sections do not cover"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSave({ subject, customNote })}
              disabled={!dirty || Boolean(busy)}
            >
              {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save draft
            </Button>
          </div>
        </div>
      )}

      {(isDraft || issue.status === 'sending') && (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={onReject}
          disabled={Boolean(busy)}
        >
          <XCircle className="h-3.5 w-3.5" /> Reject
        </Button>
      )}

      {isDraft && (
        <div className="rounded-lg border p-3">
          <SendReadiness detail={detail} />
        </div>
      )}

      <iframe
        title="Email preview"
        sandbox=""
        srcDoc={detail.preview.html}
        className="w-full rounded-lg border bg-white"
        style={{ height: 720 }}
      />
    </Card>
  );
}

export default function NewsletterIssues({ settingsVersion = 0 }) {
  const [issues, setIssues] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);

  const loadList = useCallback(async () => {
    const res = await getJSON('cms/newsletters');
    setIssues(res.issues || []);
    return res.issues || [];
  }, []);

  const loadDetail = useCallback(async (id) => {
    setDetail(await getJSON(`cms/newsletters/${id}`));
  }, []);

  useEffect(() => {
    // Deferred, like the rest of the admin pages: the effect starts a fetch
    // and the state is set when it answers, not synchronously in the effect.
    queueMicrotask(() => {
      loadList()
        .then((list) => {
          const firstDraft = list.find((row) => row.status === 'draft') ?? list[0];
          if (firstDraft) setSelectedId(firstDraft.id);
        })
        .catch((err) => setNotice({ ok: false, message: err.message }));
    });
  }, [loadList]);

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
      await action();
    } catch (err) {
      setNotice({ ok: false, message: err.message });
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

  const handleSave = (patch) =>
    run('save', async () => {
      setDetail(await sendJSON(`cms/newsletters/${selectedId}`, 'PATCH', patch));
      setNotice({ ok: true, message: 'Draft saved.' });
      await loadList();
    });

  const handleReject = () =>
    run('reject', async () => {
      setDetail(await postJSON(`cms/newsletters/${selectedId}/reject`, {}));
      setNotice({ ok: true, message: 'Issue rejected.' });
      await loadList();
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Weekly issues</h3>
        <div className="flex gap-2">
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

      {issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No issues yet. Build this week&apos;s issue to draft one from what was published.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Issues">
          {issues.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => setSelectedId(row.id)}
                // Not while an action runs: its late response would land on
                // whichever issue had been selected in the meantime.
                disabled={Boolean(busy)}
                aria-pressed={row.id === selectedId}
                className={`rounded-lg border px-3 py-2 text-left text-sm ${row.id === selectedId ? 'border-primary' : 'border-border'}`}
              >
                <span className="block font-medium">{row.id.replace('issue-', '')}</span>
                <Badge variant="secondary" className="mt-1 text-[10px]">
                  {STATUS_LABELS[row.status] || row.status}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}

      {detail?.issue && (
        // Keyed on the issue and its last write, so the editable fields reset
        // to what the server holds whenever a different or updated issue loads.
        <IssueDetail
          key={`${detail.issue.id}:${detail.issue.updatedAt ?? ''}:${detail.issue.status}`}
          detail={detail}
          busy={busy}
          onSave={handleSave}
          onReject={handleReject}
        />
      )}
    </div>
  );
}
