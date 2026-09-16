/**
 * Console — submit a job and watch it run (#577).
 *
 * Unchanged from the tab of the same name: the same job types, the same
 * payload hints, the same poll and the same cancel. What a job printed
 * yesterday is the Jobs tab's question now.
 */
import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { Ban, Loader2, Send, Terminal } from 'lucide-react';
import { postJSON } from '@/lib/api';
import { isTerminalJobStatus, jobPollDelay } from '@/lib/labsPolling';
import { StatusBadge } from './shared';
import { PAYLOAD_PLACEHOLDERS, formatDuration, formatTime } from './labsView';

function PollErrorNotice({ pollError }) {
  if (!pollError) return null;
  return (
    <p className="text-xs text-amber-600 dark:text-amber-400" role="status">
      Can&apos;t reach the status endpoint ({pollError}). The job is still running — retrying.
    </p>
  );
}

/** The one line of metadata above the output: id, status, agent, exit, cancel. */
function JobHeader({ activeJobId, activeJob, cancelling, onCancel }) {
  const exit = activeJob?.exitCode;
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <span className="font-mono text-muted-foreground">{activeJobId}</span>
      <StatusBadge status={activeJob?.status || 'queued'} />
      {activeJob?.agentId && <span className="text-muted-foreground">on {activeJob.agentId}</span>}
      {exit !== null && exit !== undefined && (
        <span className="font-mono text-muted-foreground">exit {exit}</span>
      )}
      {activeJob?.status === 'queued' && (
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
          disabled={cancelling}
          className="gap-1 ml-auto"
        >
          {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
          Cancel
        </Button>
      )}
    </div>
  );
}

/**
 * What the pane shows, split from the pane itself: Qlty counts the branches of
 * a header, a body and a footer together, and this component came back at 19.
 */
function JobOutputPane({ activeJobId, activeJob, cancelling, onCancel, pollError }) {
  const isTerminal = isTerminalJobStatus(activeJob?.status);
  if (!activeJobId) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Submit a job to watch it run.
      </p>
    );
  }
  return (
    <>
      <JobHeader
        activeJobId={activeJobId}
        activeJob={activeJob}
        cancelling={cancelling}
        onCancel={onCancel}
      />
      <PollErrorNotice pollError={pollError} />
      <pre className="bg-muted/60 border border-border rounded-md p-3 text-xs font-mono whitespace-pre-wrap break-words min-h-[200px] max-h-[400px] overflow-auto">
        {activeJob?.output ??
          (isTerminal ? '(no output)' : 'Waiting for the agent to pick this up…')}
      </pre>
      {isTerminal && (
        <p className="text-xs text-muted-foreground">
          Finished {formatTime(activeJob?.finishedAt)} · duration {formatDuration(activeJob || {})}
        </p>
      )}
    </>
  );
}

function ConsoleTab({ jobTypes }) {
  const { toast } = useToast();
  const [type, setType] = useState(jobTypes[0]?.type || 'shell-echo');
  const [payload, setPayload] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState(null);
  const [activeJob, setActiveJob] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  // Kept apart from `activeJob` on purpose — a failure to *read* the status is
  // not a status. See the poll below.
  const [pollError, setPollError] = useState(null);

  // Keep the selected type valid when the live job-type list arrives —
  // derived during render rather than synced via effect.
  const effectiveType =
    jobTypes.length && !jobTypes.some((jt) => jt.type === type) ? jobTypes[0].type : type;

  // Status/output for the submitted job — poll getLabJob until it reaches a
  // terminal state (replaces the per-job API polling request).
  //
  // Self-scheduling rather than an interval, so exactly one request is ever in
  // flight regardless of how slow the backend is.
  useEffect(() => {
    if (!activeJobId) return undefined;
    let cancelled = false;
    let timer = null;
    let consecutiveErrors = 0;

    const poll = async () => {
      try {
        const res = await postJSON('getLabJob', { jobId: activeJobId });
        if (cancelled) return;
        consecutiveErrors = 0;
        setPollError(null);
        const job = res?.job || null;
        setActiveJob(job);
        // `timeout` is a real status the agent can report, and omitting it here
        // meant a timed-out job was polled every five seconds for as long as
        // the console stayed open. (TODO.md T-308)
        if (!isTerminalJobStatus(job?.status)) timer = setTimeout(poll, jobPollDelay(0));
      } catch (err) {
        if (cancelled) return;
        consecutiveErrors += 1;
        // A transport failure is not a job outcome. Writing `status: 'failed'`
        // put a real status value on screen that nothing distinguished from an
        // actual failure, and returning without rescheduling stopped the poll
        // for good — so a job that went on to succeed was displayed as failed
        // permanently. The error is now separate state, and the poll keeps
        // going with backoff. (TODO.md T-308)
        setPollError(err.message);
        timer = setTimeout(poll, jobPollDelay(consecutiveErrors));
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeJobId]);

  const selectedSpec = jobTypes.find((jt) => jt.type === effectiveType);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await postJSON('enqueueLabJob', { type: effectiveType, payload });
      setActiveJob(null);
      setActiveJobId(res.jobId);
      toast({ title: 'Job queued', description: `${type} → ${res.jobId}` });
    } catch (err) {
      toast({ title: 'Submit failed', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!activeJobId) return;
    setCancelling(true);
    try {
      await postJSON('cancelLabJob', { jobId: activeJobId });
      toast({ title: 'Job cancelled' });
    } catch (err) {
      toast({ title: 'Cancel failed', description: err.message, variant: 'destructive' });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Submit form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submit a job</CardTitle>
          <CardDescription>
            Job types come from a server-side allowlist; the agent only ever runs fixed, sandboxed
            commands — the payload is mounted as a read-only file.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Job type</Label>
            <select
              value={effectiveType}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {jobTypes.map((jt) => (
                <option key={jt.type} value={jt.type}>
                  {jt.type}
                </option>
              ))}
            </select>
            {selectedSpec?.description && (
              <p className="text-xs text-muted-foreground mt-1">{selectedSpec.description}</p>
            )}
          </div>
          <div>
            <Label className="text-xs">Payload</Label>
            <Textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={10}
              placeholder={PAYLOAD_PLACEHOLDERS[effectiveType] || 'hello vps'}
              className="mt-1 font-mono text-xs"
            />
            {selectedSpec?.maxPayloadBytes && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Max {Math.round(selectedSpec.maxPayloadBytes / 1024)} KB
              </p>
            )}
          </div>
          <Button onClick={handleSubmit} disabled={submitting} className="gap-1.5">
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Submit job
          </Button>
        </CardContent>
      </Card>

      {/* Live job status + output */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            Job output
          </CardTitle>
          <CardDescription>
            Polled from the API — updates as the agent claims, runs, and finishes the job.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <JobOutputPane
            activeJobId={activeJobId}
            activeJob={activeJob}
            cancelling={cancelling}
            onCancel={handleCancel}
            pollError={pollError}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function LabsConsoleTab({ hub }) {
  return <ConsoleTab jobTypes={hub.jobTypes} />;
}
