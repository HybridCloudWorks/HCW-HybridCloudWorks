/**
 * NewsletterMetrics — how one published issue did, from Resend (#504).
 *
 * Shown above the email on the Published tab. Three cases:
 *
 *   scheduled               a line saying metrics come once it sends
 *   sent, with broadcastId  tiles, the top links, and who opened or clicked
 *   anything else           nothing: an issue Resend never had has no numbers
 *
 * Metrics are asked for by `issue_id`, so the server reads the issue and uses
 * the broadcast it recorded rather than trusting an id from the page. Resend
 * refreshes these numbers about every 15 minutes, so a Refresh button re-reads
 * rather than the page polling.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { getJSON } from '@/lib/api';
import RecipientsViewer from './RecipientsViewer';
import { describeResendError, formatCount, formatRate } from './resendFormat';

export const TOP_LINKS = 10;

/** The tiles, from the metrics `totals` the API projects. */
export function metricTiles(totals = {}) {
  const { delivered } = totals;
  return [
    { label: 'Delivered', value: delivered },
    {
      label: 'Opened (unique)',
      value: totals.unique_opened,
      rate: formatRate(totals.unique_opened, delivered, totals.open_rate),
      rateLabel: 'open rate',
    },
    {
      label: 'Clicked (unique)',
      value: totals.unique_clicked,
      rate: formatRate(totals.unique_clicked, delivered, totals.click_rate),
      rateLabel: 'click rate',
    },
    { label: 'Bounced', value: totals.bounced },
    { label: 'Unsubscribed', value: totals.unsubscribed },
    { label: 'Complaints', value: totals.complained },
  ];
}

function Tiles({ totals }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {metricTiles(totals).map((tile) => (
        <div key={tile.label} className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">{tile.label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{formatCount(tile.value)}</dd>
          {tile.rate && (
            <dd className="text-xs text-muted-foreground">
              {tile.rate} {tile.rateLabel}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

function TopLinks({ links }) {
  if (!links.length) return null;
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-medium">Top links</h4>
      <ol className="divide-y divide-border rounded-lg border border-border text-sm">
        {links.slice(0, TOP_LINKS).map((link, index) => (
          <li
            key={`${link.url}-${index}`}
            className="flex flex-wrap justify-between gap-2 px-3 py-2"
          >
            <span className="break-all">{link.url}</span>
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {formatCount(link.clicks)} clicks, {formatCount(link.unique_clicks)} unique
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function useIssueMetrics(issueId, broadcastId) {
  const [state, setState] = useState({ loading: true, error: '', totals: null, links: [] });

  const load = useCallback(async () => {
    setState((previous) => ({ ...previous, loading: true, error: '' }));
    // Settled apart, so a failed link list does not hide the tiles or the reverse.
    const [metrics, clicked] = await Promise.allSettled([
      getJSON(`cms/mailing-list/metrics?issue_id=${encodeURIComponent(issueId)}`),
      getJSON(
        `cms/mailing-list/broadcasts/${encodeURIComponent(broadcastId)}/clicked-links?limit=${TOP_LINKS}`
      ),
    ]);
    const failure = [metrics, clicked].find((result) => result.status === 'rejected');
    setState({
      loading: false,
      error: failure ? describeResendError(failure.reason) : '',
      totals: metrics.status === 'fulfilled' ? metrics.value.totals || {} : null,
      links: clicked.status === 'fulfilled' ? clicked.value.links || [] : [],
    });
  }, [issueId, broadcastId]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  return { ...state, reload: load };
}

function SentMetrics({ issue }) {
  const metrics = useIssueMetrics(issue.id, issue.broadcastId);
  return (
    <section aria-label="Metrics" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Resend refreshes these numbers about every 15 minutes.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={metrics.reload}
          disabled={metrics.loading}
        >
          {metrics.loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>
      {metrics.error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {metrics.error}
        </p>
      )}
      {metrics.totals && <Tiles totals={metrics.totals} />}
      <TopLinks links={metrics.links} />
      <RecipientsViewer broadcastId={issue.broadcastId} />
    </section>
  );
}

export default function NewsletterMetrics({ issue }) {
  if (!issue) return null;
  if (issue.status === 'scheduled') {
    return <p className="text-sm text-muted-foreground">Metrics appear after it sends.</p>;
  }
  if (issue.status !== 'sent' || !issue.broadcastId) return null;
  return <SentMetrics key={issue.id} issue={issue} />;
}
