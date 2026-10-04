/**
 * The Draft tab's panels around the document (ADR 0033 §7 slice 2): the
 * one shown before it exists, the toolbar over it, the job line while the
 * forge runs and the banner when the version moved elsewhere.
 */
import React from 'react';
import { Flame, Loader2, RefreshCw, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import { START_MODES } from './brief';
import { gradeVerdict } from './draftModel';
import { describeJob } from './useForgeSession';

const spinnerOr = (busy, Icon, className) =>
  busy ? <Loader2 className={`${className} animate-spin`} /> : <Icon className={className} />;

function GradeLine({ doc }) {
  const grade = doc?.forgeGrade;
  const threshold = doc?.forgeMeta?.threshold ?? doc?.forgeGrade?.threshold;
  if (typeof grade?.overall !== 'number') {
    return <span className="text-xs text-muted-foreground">Not graded yet</span>;
  }
  return (
    <span className="text-xs">
      Grade <span className="font-mono font-semibold">{grade.overall}</span>
      {typeof threshold === 'number' && (
        <span className="text-muted-foreground">
          {' '}
          / threshold {threshold}
          {gradeVerdict(grade.overall, threshold)}
        </span>
      )}
      {grade.note && <span className="ml-1 text-muted-foreground">({grade.note})</span>}
    </span>
  );
}

/** The job's status in plain words; the spinner while the forge is at work. */
export function JobStatus({ job, running }) {
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm"
      role="status"
    >
      {running && <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />}
      <span>{describeJob(job)}</span>
    </div>
  );
}

export function ConflictBanner({ onReload }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/30"
    >
      <span>
        This draft changed elsewhere since you opened it. Your text is kept here; reload to see the
        latest, then re-apply what you need.
      </span>
      <Button size="sm" variant="outline" onClick={onReload}>
        Reload the latest
      </Button>
    </div>
  );
}

// ── before the document exists ──────────────────────────────────────────────

export function GeneratePanel({ session, template, onBrief }) {
  const { brief, title, busy, job } = session;
  const mode = START_MODES.find((m) => m.id === brief.mode);
  const generating = busy === 'generate';
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title || 'Untitled'}</CardTitle>
        <CardDescription>
          {mode?.label}
          {template ? ` · ${template.label}` : ''} · publishes to {brief.targetChannel} · kind{' '}
          <span className="font-mono">{brief.kind}</span> · origin{' '}
          <span className="font-mono">{brief.ideaOrigin}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {brief.objective && <p className="text-sm">{brief.objective}</p>}
        <p className="text-xs text-muted-foreground">
          Generate creates the document on the Drafts page first (status Drafting), saves the brief,
          kind and idea origin on it, then runs the forge: it writes, scrubs, grades and stages the
          draft as forge_ready above the publish threshold, otherwise editing.
        </p>
        {job && <JobStatus job={job} running={generating} />}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => session.generate({ templateLabel: template?.label })}
            disabled={Boolean(busy)}
            className="gap-1"
          >
            {spinnerOr(generating, Flame, 'h-4 w-4')}
            Generate the first draft
          </Button>
          <Button
            variant="outline"
            onClick={() => session.saveAsDraft({ templateLabel: template?.label })}
            disabled={Boolean(busy)}
            className="gap-1"
          >
            {spinnerOr(busy === 'create', Save, 'h-4 w-4')}
            Save the brief as a draft (no AI)
          </Button>
          <Button variant="ghost" onClick={onBrief}>
            Edit the brief
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── over the document ───────────────────────────────────────────────────────

/** The badges a document carries, each shown when the field is set. */
const DOC_BADGES = Object.freeze([
  { field: 'format', prefix: 'format' },
  { field: 'kind', prefix: 'kind' },
  { field: 'ideaOrigin', prefix: 'origin' },
]);

export function DraftToolbar({ session, template }) {
  const { doc, busy, loading, dirty, contentId } = session;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatusBadge content={doc} />
      <GradeLine doc={doc} />
      {DOC_BADGES.filter((badge) => doc[badge.field]).map((badge) => (
        <Badge key={badge.field} variant="outline">
          {badge.prefix}: {doc[badge.field]}
        </Badge>
      ))}
      <span className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={Boolean(busy) || loading}
          onClick={() => session.loadDoc(contentId)}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Reload
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={Boolean(busy)}
          onClick={() => session.generate({ templateLabel: template?.label })}
          title="Runs the forge again against this document; the body is rewritten and a version is kept."
        >
          {spinnerOr(busy === 'generate', Flame, 'h-3.5 w-3.5')}
          Regenerate
        </Button>
        <Button
          size="sm"
          className="gap-1"
          disabled={busy === 'save' || !dirty}
          onClick={() => session.save()}
        >
          {spinnerOr(busy === 'save', Save, 'h-3.5 w-3.5')}
          Save
        </Button>
      </span>
    </div>
  );
}
