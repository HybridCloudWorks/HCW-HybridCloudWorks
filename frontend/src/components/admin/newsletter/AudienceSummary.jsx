/**
 * The Audience tab's counts (#504): subscribed, unsubscribed and total, from
 * `GET cms/mailing-list/audience/summary`.
 *
 * The server pages the whole Newsletter segment for these, stops after a cap
 * and says `truncated` when it did, so the counts are then a lower bound. The
 * answer is cached on the server for ten minutes, which is what `cachedAt`
 * reports; a contact change made through the page clears that cache.
 */
import React from 'react';
import { Card } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { formatWhen } from './issueFormat';
import { formatCount } from './resendFormat';

function Tile({ label, value }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{formatCount(value)}</p>
    </Card>
  );
}

export default function AudienceSummary({ summary, error }) {
  if (error) {
    return (
      <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        {error}
      </p>
    );
  }
  if (!summary) return null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Subscribers" value={summary.subscribed} />
        <Tile label="Unsubscribed" value={summary.unsubscribed} />
        <Tile label="Total" value={summary.total} />
      </div>
      <p className="text-xs text-muted-foreground">
        {summary.cachedAt ? `As of ${formatWhen(summary.cachedAt)}.` : ''}
        {summary.truncated &&
          ' The list is larger than the server counts in one go, so these are a lower bound.'}
      </p>
    </div>
  );
}
