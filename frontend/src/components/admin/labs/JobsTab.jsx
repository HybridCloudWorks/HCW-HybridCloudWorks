/**
 * Jobs — every run this hub knows about, and what it printed (#577).
 *
 * New in #577. The job table was the bottom third of Dashboard with no way to
 * see a result: the columns stopped at the exit code, and the output existed
 * only for whichever job the Console had just submitted. A job that failed
 * yesterday could be seen to have failed and not why.
 *
 * Each row expands to its output. `job.output` is already on the snapshot — it
 * was simply never rendered outside the Console.
 */
import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { isTerminalJobStatus } from '@/lib/labsPolling';
import { StatusBadge } from './shared';
import { formatDuration, formatTime } from './labsView';
import { tabHref } from './tabs';

/** What a job's output pane says when there is nothing in it. */
function outputFor(job) {
  if (job.output) return job.output;
  return isTerminalJobStatus(job.status) ? '(no output)' : 'Still running — no output yet.';
}

function JobRow({ job, expanded, onToggle }) {
  return (
    <>
      <tr className="border-b border-border/50 last:border-0">
        <td className="px-2 py-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => onToggle(job.id)}
            aria-label={`${expanded ? 'Hide' : 'Show'} output for ${job.type}`}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </Button>
        </td>
        <td className="px-3 py-2 font-mono">{job.type}</td>
        <td className="px-3 py-2">
          <StatusBadge status={job.status} />
        </td>
        <td className="px-3 py-2 font-mono">{job.agentId || '—'}</td>
        <td className="px-3 py-2 whitespace-nowrap">{formatTime(job.createdAt)}</td>
        <td className="px-3 py-2">{formatDuration(job)}</td>
        <td className="px-3 py-2 font-mono">{job.exitCode ?? '—'}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/50">
          <td colSpan={7} className="px-3 pb-3">
            <pre className="bg-muted/60 border border-border rounded-md p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-80 overflow-auto">
              {outputFor(job)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

export default function JobsTab({ hub }) {
  const { jobs, error } = hub;
  const [openId, setOpenId] = useState(null);
  const toggle = (id) => setOpenId((current) => (current === id ? null : id));

  if (jobs.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        {error
          ? `Could not read the snapshot: ${error}`
          : 'No jobs yet. Submit a shell-echo smoke test from the Console tab.'}
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-destructive">Live subscription error: {error}</p>}
      <p className="text-xs text-muted-foreground">
        Every run the snapshot carries, newest first. Expand one to see what it printed; a new run
        starts on{' '}
        <a href={tabHref('console')} className="underline">
          the Console tab
        </a>
        .
      </p>
      <Card className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-2 py-2 font-medium sr-only">Output</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 font-medium">Created</th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium">Exit</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} expanded={openId === job.id} onToggle={toggle} />
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
