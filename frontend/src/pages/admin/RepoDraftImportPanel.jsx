/**
 * "Import drafts from the repository" — on the Content Queue (owner request
 * 2026-09-28).
 *
 * Articles are drafted as files in `docs/content/` and reviewed on GitHub;
 * reading one on the site used to mean pasting it into the Publish-Ready
 * Builder. This panel lists the `blog-*.md` drafts on `main`
 * (GET cms/content/import-repo/candidates), lets the owner tick some, and
 * imports them (POST cms/content/import-repo). Each one lands In Review —
 * never published: publishing stays the review board's separate step.
 *
 * NOTHING IS TICKED BY DEFAULT, unlike the re-host panel, whose job is "all of
 * them". The directory also holds the earlier posts that were pasted in by
 * hand and are already live, and importing is the owner picking which drafts
 * to review, not a backfill. A draft already past review (approved, editing,
 * published) cannot be ticked: the API refuses to touch it, and a checkbox
 * that can only produce a refusal is a trap.
 *
 * The list is read when the panel opens, not when the queue mounts: it is a
 * GitHub API call, unauthenticated, and GitHub allows sixty of those an hour.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router';
import { FileInput, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { getJSON, postJSON } from '@/lib/api';
import { logAdminAction } from '@/lib/auditLog';

export const IMPORT_ROUTE = 'cms/content/import-repo';
export const CANDIDATES_ROUTE = 'cms/content/import-repo/candidates';
export const REPO_BLOB_BASE = 'https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/';

const reviewPath = (contentId) => `/admin/queue/${encodeURIComponent(contentId)}`;

/** Outcomes that leave a draft In Review on the site. */
const LANDED = new Set(['created', 'updated', 'unchanged']);

const STATUS_LABELS = {
  in_review: 'In Review',
  approved: 'Approved',
  approved_blog: 'Approved',
  editing: 'Editing',
  published: 'Published',
  rejected: 'Rejected',
  forge_ready: 'Staged',
};

/**
 * What the candidate row says about a file's state on the site.
 * @returns {{ label: string, tone: 'new'|'review'|'locked' }}
 */
export function describeCandidate(candidate = {}) {
  const { imported } = candidate;
  if (candidate.ambiguous) return { label: 'Imported twice — resolve by hand', tone: 'locked' };
  if (!imported) return { label: 'Not imported', tone: 'new' };
  if (imported.live) return { label: 'Live — re-import refused', tone: 'locked' };
  if (imported.contentStatus === 'in_review') {
    return { label: 'In Review — importing refreshes it', tone: 'review' };
  }
  const status = STATUS_LABELS[imported.contentStatus] || imported.contentStatus || 'Unknown';
  return { label: `${status} — re-import refused`, tone: 'locked' };
}

const OUTCOME_TEXT = {
  created: 'Imported — In Review',
  updated: 'Refreshed — In Review',
  unchanged: 'Unchanged — already In Review',
};

/** One line of the result list from one entry of the route's `results`. */
export function toResultLine(result = {}) {
  const name = String(result.path || '')
    .split('/')
    .at(-1);
  const landed = LANDED.has(result.outcome);
  return {
    path: result.path,
    title: result.title || name,
    contentId: landed ? result.contentId : null,
    landed,
    text: landed
      ? OUTCOME_TEXT[result.outcome]
      : `${result.outcome === 'failed' ? 'Failed' : 'Refused'}: ${result.error || result.code || 'no reason given'}`,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

/** The toast for a finished import. Says "In Review" and says nothing was published. */
export function summarizeImport(results = []) {
  const landed = results.filter((result) => LANDED.has(result.outcome));
  const notLanded = results.length - landed.length;
  if (landed.length === 0) {
    return {
      title: 'Nothing imported',
      description: `${notLanded} ${notLanded === 1 ? 'draft was' : 'drafts were'} refused or failed; see the list for why.`,
      variant: 'destructive',
    };
  }
  const noun = landed.length === 1 ? 'draft' : 'drafts';
  const tail = notLanded > 0 ? ` ${notLanded} refused or failed; see the list.` : '';
  return {
    title: `${landed.length} ${noun} In Review`,
    description: `Nothing was published.${tail}`,
  };
}

const TONE_CLASS = {
  new: 'border-border',
  review: 'border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300',
  locked: 'border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-300',
};

function CandidateRow({ candidate, checked, disabled, onToggle }) {
  const state = describeCandidate(candidate);
  const id = `repo-draft-${candidate.name}`;
  return (
    <li className="flex items-start gap-3 rounded-lg border p-2 text-sm hover:bg-muted/40">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(candidate.path)}
        disabled={disabled || !candidate.importable}
        aria-label={`Select ${candidate.name}`}
        className="mt-1 h-4 w-4 rounded border-border accent-primary"
      />
      {/* The label covers the name only: a link inside it would toggle the box. */}
      <label htmlFor={id} className="flex-1 min-w-0 cursor-pointer">
        <span className="block font-mono text-xs truncate">{candidate.name}</span>
        <span className="block text-xs text-muted-foreground">{candidate.path}</span>
      </label>
      <Badge variant="outline" className={`shrink-0 text-[10px] ${TONE_CLASS[state.tone]}`}>
        {state.label}
      </Badge>
      {candidate.imported?.contentId && (
        <Link
          to={reviewPath(candidate.imported.contentId)}
          className="text-xs underline shrink-0"
          aria-label={`Review ${candidate.name}`}
        >
          Review
        </Link>
      )}
      <a
        href={`${REPO_BLOB_BASE}${candidate.path}`}
        target="_blank"
        rel="noreferrer"
        className="text-xs underline shrink-0"
        aria-label={`View ${candidate.name} on GitHub`}
      >
        GitHub
      </a>
    </li>
  );
}

function ResultList({ lines }) {
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="Import results">
      {lines.map((line) => (
        <li key={line.path} className="rounded-lg border p-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{line.title}</span>
            <span
              className={line.landed ? 'text-green-700 dark:text-green-300' : 'text-destructive'}
            >
              {line.text}
            </span>
            {line.contentId && (
              <Link to={reviewPath(line.contentId)} className="text-xs underline">
                Open review
              </Link>
            )}
          </div>
          {line.warnings.map((warning) => (
            <p key={warning} className="text-xs text-muted-foreground">
              {warning}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}

/**
 * @param {{ onImported?: (response: object) => void }} props — called after an
 *   import in which at least one draft landed In Review, so the queue can
 *   switch to that filter and show them.
 */
export default function RepoDraftImportPanel({ onImported }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState([]);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getJSON(CANDIDATES_ROUTE);
      setCandidates(Array.isArray(res?.candidates) ? res.candidates : []);
      setSelected(new Set());
    } catch (err) {
      setError(`Could not list the drafts: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  const toggle = (path) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectedPaths = candidates
    .filter((candidate) => candidate.importable && selected.has(candidate.path))
    .map((candidate) => candidate.path);

  const runImport = async () => {
    if (inFlight.current || selectedPaths.length === 0) return;
    inFlight.current = true;
    setRunning(true);
    setError('');
    setLines([]);
    try {
      const res = await postJSON(IMPORT_ROUTE, { paths: selectedPaths });
      const results = Array.isArray(res?.results) ? res.results : [];
      setLines(results.map(toResultLine));
      toast(summarizeImport(results));
      await logAdminAction('repo_drafts_imported', {
        requested: selectedPaths.length,
        ...res?.counts,
      });
      await load();
      if (results.some((result) => LANDED.has(result.outcome))) onImported?.(res);
    } catch (err) {
      setError(`Import failed: ${err.message}`);
      toast({ title: 'Import failed', description: err.message, variant: 'destructive' });
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Drafts in the repository</p>
            <p className="text-xs text-muted-foreground">
              Articles written in docs/content on main. Importing puts each one In Review here;
              nothing is published.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleOpen}
            aria-expanded={open}
            className="shrink-0"
          >
            <FileInput className="h-4 w-4 mr-2" />
            Import drafts from the repository
          </Button>
        </div>

        {open && (
          <div className="space-y-3 border-t pt-3">
            {error && <p className="text-sm text-destructive">{error}</p>}
            {loading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Listing docs/content on GitHub…
              </p>
            )}
            {!loading && !error && candidates.length === 0 && (
              <p className="text-sm text-muted-foreground">No blog drafts in docs/content.</p>
            )}
            {!loading && candidates.length > 0 && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm">{candidates.length} drafts on main.</p>
                  <Button variant="ghost" size="sm" onClick={load} disabled={running}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                </div>
                <ul className="space-y-2">
                  {candidates.map((candidate) => (
                    <CandidateRow
                      key={candidate.path}
                      candidate={candidate}
                      checked={selected.has(candidate.path)}
                      disabled={running}
                      onToggle={toggle}
                    />
                  ))}
                </ul>
                <Button
                  size="sm"
                  onClick={runImport}
                  disabled={running || selectedPaths.length === 0}
                >
                  {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Import selected as In Review ({selectedPaths.length})
                </Button>
              </>
            )}
            <ResultList lines={lines} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
