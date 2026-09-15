/**
 * Publishing (#573): what the public speaking page shows, and the button that
 * changes it. The page reads the `speakerevents` snapshot, not the store, so
 * an edit here is invisible to visitors until "Publish snapshot" runs.
 *
 * The tab reads the public snapshot itself, while it is open, and compares it
 * with what a publish would write now: stored rows with `display === true`,
 * the server sanitizer's rule. The stored overrides are the page's read,
 * shared with the other tabs; a failure in either read is shown on its own
 * card and never blanks the other or the Publish button.
 *
 * `fetchPublicSnapshotItems` answers [] on any failure (its quiet-fallback
 * contract for the public pages), so an empty snapshot is reported as "no
 * events, or unreadable" rather than as a certain zero.
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import PublishSnapshotButton from '@/components/admin/PublishSnapshotButton';
import { ReadsStatus, RefreshButton } from './TabParts';
import { countPublishable } from './eventModel';
import { usePublicSnapshot } from './useSpeakingData';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function SnapshotCard({ snapshot }) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-2">
        <h3 className="font-semibold text-sm">Public snapshot</h3>
        <ReadsStatus reads={[snapshot]} label="the public snapshot" />
        {snapshot.loaded && (
          <p className="text-sm">
            {snapshot.data.length > 0
              ? `The public speaking page lists ${plural(snapshot.data.length, 'event')}.`
              : 'The public snapshot has no events, or could not be read.'}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          The public read is cached for up to ten minutes after a publish.
        </p>
      </CardContent>
    </Card>
  );
}

function StoredCard({ stored, snapshot }) {
  const { published, withheld } = countPublishable(stored.data);
  const canCompare = snapshot.loaded && stored.loaded && snapshot.data.length > 0;
  const differs = canCompare && snapshot.data.length !== published;
  const comparisonUnknown = snapshot.loaded && stored.loaded && snapshot.data.length === 0 && published > 0;
  return (
    <Card>
      <CardContent className="pt-5 space-y-2">
        <h3 className="font-semibold text-sm">A publish now</h3>
        <ReadsStatus reads={[stored]} label="stored events" />
        {stored.loaded && (
          <p className="text-sm">
            Would publish {plural(published, 'event')}; {plural(withheld, 'stored row')} not shown
            on site.
          </p>
        )}
        {differs && (
          <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
            The snapshot and the store differ — publish to bring the public page up to date.
          </p>
        )}
        {comparisonUnknown && (
          <p className="text-sm text-muted-foreground">
            The snapshot returned no rows, so this page cannot confirm whether it differs from
            stored events.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function PublishingTab({ data }) {
  const snapshot = usePublicSnapshot();
  return (
    <div className="space-y-6 pt-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <RefreshButton onClick={snapshot.refresh} busy={snapshot.pending}>
          Refresh status
        </RefreshButton>
        <PublishSnapshotButton />
      </div>
      <p className="text-sm text-muted-foreground">
        Publish snapshot writes the certifications and speaking events snapshots the public pages
        read, so visitors see changes without a site redeploy.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <SnapshotCard snapshot={snapshot} />
        <StoredCard stored={data.stored} snapshot={snapshot} />
      </div>
    </div>
  );
}
