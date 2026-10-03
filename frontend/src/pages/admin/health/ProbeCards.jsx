/**
 * The probe registry on screen (ADR 0033 Platform): one card per probe, in
 * hub groups, each saying the same five things — what it covers, how it is
 * doing (one StatusBadge word), when that was last true, what breaks if it is
 * not, and what to do — with a Test button where one exists and a link to
 * the page that holds the fix.
 */

import React from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import { ArrowUpRight, FlaskConical, Loader2 } from 'lucide-react';
import { formatTimestamp } from './signals';
import { probesByHub } from './probeRegistry';

export function ProbeCard({ probe, result, running, onRun }) {
  const checked = result?.checkedAt ? formatTimestamp(result.checkedAt) : null;
  return (
    <article
      className="flex h-full flex-col gap-2 rounded-lg border border-border p-3 text-sm"
      data-probe={probe.id}
      aria-label={probe.label}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold leading-tight">{probe.label}</h3>
          <p className="text-xs text-muted-foreground">{probe.covers}</p>
        </div>
        <StatusBadge system={result?.status ?? 'unknown'} size="xs" />
      </div>
      <p className="wrap-break-word text-xs" data-testid="probe-summary">
        {result?.summary ?? 'Not tested yet.'}
      </p>
      {result?.detail ? (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap wrap-break-word rounded border border-border/60 bg-muted/40 p-2 font-mono text-[11px]">
          {result.detail}
        </pre>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <dt>Checked</dt>
        <dd>{checked ?? 'Not yet'}</dd>
        <dt>Impact</dt>
        <dd>{probe.impact}</dd>
        <dt>Fix</dt>
        <dd>{probe.action}</dd>
      </dl>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {probe.run ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRun(probe)}
            disabled={running}
            aria-label={running ? `Testing ${probe.label}` : `Test ${probe.label}`}
          >
            {running ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <FlaskConical className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            )}
            {probe.kind === 'snapshot' ? 'Re-read' : 'Test'}
          </Button>
        ) : null}
        {probe.href ? (
          <Link
            to={probe.href.to}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            {probe.href.label} <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        ) : null}
        {!probe.safe && probe.costNote ? (
          <span className="text-[11px] text-muted-foreground">
            Not in Test all: {probe.costNote}
          </span>
        ) : null}
      </div>
    </article>
  );
}

/** Counts of each status across the registry, for the strip and the intro. */
export function summarizeProbes(probes, resolve) {
  const counts = { healthy: 0, degraded: 0, misconfigured: 0, unavailable: 0, unknown: 0 };
  for (const probe of probes) {
    const status = resolve(probe)?.status ?? 'unknown';
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

export default function ProbeGrid({ probes, resolve, running, runningAll, onRun, onRunAll }) {
  const groups = probesByHub(probes);
  const counts = summarizeProbes(probes, resolve);
  const safeCount = probes.filter((probe) => probe.safe).length;
  return (
    <section className="space-y-4" aria-label="Probe registry">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Every dependency, one word each</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {probes.length} probes across {groups.length} hubs. Test all runs the {safeCount} that
            spend nothing and write nothing, in parallel; the rest run from their own button and say
            why. Results stay in this browser tab across reloads.
          </p>
          <p className="flex flex-wrap gap-2 text-xs" aria-label="Probe status counts">
            {Object.entries(counts)
              .filter(([, n]) => n > 0)
              .map(([status, n]) => (
                <span key={status} className="inline-flex items-center gap-1">
                  <StatusBadge system={status} size="xs" /> {n}
                </span>
              ))}
          </p>
        </div>
        <Button size="sm" onClick={onRunAll} disabled={runningAll}>
          {runningAll ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <FlaskConical className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
          )}
          {runningAll ? 'Testing…' : 'Test all'}
        </Button>
      </div>
      {groups.map((group) => (
        <div key={group.id} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {group.label}
          </h3>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {group.probes.map((probe) => (
              <li key={probe.id}>
                <ProbeCard
                  probe={probe}
                  result={resolve(probe)}
                  running={running.has(probe.id)}
                  onRun={onRun}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
