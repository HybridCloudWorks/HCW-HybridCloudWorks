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
import { describeSkip, fmtDate, hostErrorMessage } from './recordingView';

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

/**
 * The `host.rsscom` record as one line. Rendered only when the record exists,
 * so a transcript nothing has tried to publish shows no host line at all.
 */
export function HostLine({ item, onRetry, retrying }) {
  const host = item.host?.rsscom;
  if (!host || typeof host !== 'object') return null;
  if (host.pending) {
    // Approval queued the publish-podcast-transcript job (#437 slice 2);
    // the record says so until the job writes its outcome.
    return (
      <p className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Host: publishing…
        {host.jobId ? ` (job ${host.jobId})` : ''}
      </p>
    );
  }
  if (host.episodeId) {
    return (
      <p className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
        <CheckCircle className="h-3 w-3" /> Host: Published to RSS.com
        {host.publishedAt ? ` (${fmtDate(host.publishedAt)})` : ''}
      </p>
    );
  }
  if (host.error) {
    const message = hostErrorMessage(host);
    return (
      <p className="text-xs text-red-700 dark:text-red-300 flex items-center gap-2 flex-wrap">
        <span>Host: {message}</span>
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
  if (host.skipped) {
    return <p className="text-xs text-slate-500">Host: skipped — {describeSkip(host)}</p>;
  }
  return null;
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
