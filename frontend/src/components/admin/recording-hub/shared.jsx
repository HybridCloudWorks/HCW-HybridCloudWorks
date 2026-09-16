/**
 * The pieces more than one Recording Hub tab renders (#576).
 *
 * `HostLine` is why this file exists: it is the RSS.com record for one
 * transcript, and it now appears both under a transcript on **Transcripts**
 * and grouped by state on **Distribution**. One component, so the two cannot
 * describe the same record differently.
 */
import React from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { describeSkip, fmtDate, hostErrorMessage, hostState } from './recordingView';

/** Where a transcript came from, as a chip and a link when there is one. */
export function SourceChip({ item }) {
  if (item.sourceKind === 'article') {
    const publicPath =
      item.sourceProvider && item.sourceSlug
        ? `/${item.sourceProvider}/blog/${item.sourceSlug}`
        : null;
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <Badge variant="secondary">article</Badge>
        {item.sourceId && (
          <Link to={`/admin/editor?id=${encodeURIComponent(item.sourceId)}`} className="underline">
            {item.sourceTitle || item.sourceSlug || item.sourceId}
          </Link>
        )}
        {publicPath && (
          <a
            href={publicPath}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-slate-500 hover:underline"
            aria-label={`Open ${item.sourceTitle || item.sourceSlug} on the site`}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <Badge variant="secondary">{item.sourceKind || 'recording'}</Badge>
      <span className="text-slate-600 dark:text-slate-300">
        {item.sourceTitle || item.sourceId || 'Untitled recording'}
      </span>
    </span>
  );
}

export function StatusBadge({ status }) {
  if (status === 'published') return <Badge>published</Badge>;
  if (status === 'failed') return <Badge variant="destructive">failed</Badge>;
  return <Badge variant="outline">{status || 'draft'}</Badge>;
}

/** Approval queued publish-podcast-transcript (#437 slice 2); it says so until the job writes. */
function HostPending({ host }) {
  return (
    <p className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1">
      <Loader2 className="h-3 w-3 animate-spin" /> Host: publishing…
      {host.jobId ? ` (job ${host.jobId})` : ''}
    </p>
  );
}

function HostPublished({ host }) {
  return (
    <p className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
      <CheckCircle className="h-3 w-3" /> Host: Published to RSS.com
      {host.publishedAt ? ` (${fmtDate(host.publishedAt)})` : ''}
    </p>
  );
}

function HostError({ host, item, onRetry, retrying }) {
  return (
    <p className="text-xs text-red-700 dark:text-red-300 flex items-center gap-2 flex-wrap">
      <span>Host: {hostErrorMessage(host)}</span>
      <Button
        size="sm"
        variant="outline"
        className="h-6 text-xs px-2"
        onClick={() => onRetry(item)}
        disabled={retrying}
      >
        {retrying ? (
          <Loader2 className="h-3 w-3 animate-spin mr-1" />
        ) : (
          <RefreshCw className="h-3 w-3 mr-1" />
        )}
        Retry
      </Button>
    </p>
  );
}

function HostSkipped({ host }) {
  return <p className="text-xs text-slate-500">Host: skipped — {describeSkip(host)}</p>;
}

/** One renderer per state `hostState` names. `none` has none, and renders nothing. */
const HOST_LINES = Object.freeze({
  pending: HostPending,
  published: HostPublished,
  error: HostError,
  skipped: HostSkipped,
});

/**
 * The `host.rsscom` record as one line. Rendered only when the record exists,
 * so a transcript nothing has tried to publish shows no host line at all.
 *
 * The state is `hostState`'s, not a second `if` chain of its own: Distribution
 * groups by that function, and two orderings of the same four tests would
 * eventually disagree about one record. It also took this component from six
 * returns to one.
 */
export function HostLine({ item, onRetry, retrying }) {
  const Line = HOST_LINES[hostState(item)];
  return Line ? (
    <Line host={item.host.rsscom} item={item} onRetry={onRetry} retrying={retrying} />
  ) : null;
}

/**
 * Readable fallbacks for the skip codes `publish-transcript.js` records
 * (`HOST_SKIP`), used only when the record carries no `reason` sentence.
 */

export function TranscriptToggleIcon({ loading, expanded }) {
  if (loading) return <Loader2 className="h-3 w-3 animate-spin" />;
  if (expanded) return <ChevronDown className="h-3 w-3" />;
  return <ChevronRight className="h-3 w-3" />;
}
