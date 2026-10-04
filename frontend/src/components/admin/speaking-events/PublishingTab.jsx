/**
 * Publishing (#573): what the public speaking page shows, and the button that
 * changes it. The page reads the `speakerevents` snapshot, not the store, so
 * an edit here is invisible to visitors until "Publish snapshot" runs.
 *
 * The tab reads the public snapshot itself, past every cache, while it is
 * open, and re-reads it the moment a publish lands (`onPublished`) — before
 * this it kept showing the copy from before the publish for up to thirty
 * seconds (ADR 0033, Spotlight slice). It compares the snapshot with what a
 * publish would write now: stored rows with `display === true`, plus a
 * tombstone for each Sessionize-backed row unticked, which is how the public
 * widget hides an event Sessionize still lists.
 *
 * The public pages render the NEWER of the build-time JSON and this snapshot,
 * so a publish takes effect before the next deploy.
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import PublishSnapshotButton from '@/components/admin/PublishSnapshotButton';
import { isTombstone } from '@/lib/speakingEvents';
import { ReadsStatus, RefreshButton } from './TabParts';
import { countPublishable } from './eventModel';
import { usePublicSnapshot } from './useSpeakingData';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function formatWhen(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function SnapshotCard({ snapshot }) {
  const { items } = snapshot.data;
  const shown = items.filter((item) => !isTombstone(item)).length;
  const hidden = items.length - shown;
  const when = formatWhen(snapshot.data.generatedAt);
  return (
    <Card>
      <CardContent className="pt-5 space-y-2">
        <h3 className="font-semibold text-sm">Public snapshot</h3>
        <ReadsStatus reads={[snapshot]} label="the public snapshot" />
        {snapshot.loaded && (
          <p className="text-sm">
            {items.length > 0
              ? `The public speaking page lists ${plural(shown, 'event')}${
                  hidden ? `, hiding ${plural(hidden, 'Sessionize event')}` : ''
                }.`
              : 'The public snapshot has no events, or could not be read.'}
          </p>
        )}
        {snapshot.loaded && when && (
          <p className="text-xs text-muted-foreground">Last published {when}.</p>
        )}
        {snapshot.loaded && snapshot.data.meta?.speakerId && (
          <p className="text-xs text-muted-foreground">
            The public widget reads Sessionize speaker <code>{snapshot.data.meta.speakerId}</code>{' '}
            from this snapshot.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StoredCard({ stored, snapshot }) {
  const { published, tombstones, withheld } = countPublishable(stored.data);
  const { items } = snapshot.data;
  const canCompare = snapshot.loaded && stored.loaded && items.length > 0;
  const differs = canCompare && items.length !== published + tombstones;
  const comparisonUnknown =
    snapshot.loaded && stored.loaded && items.length === 0 && published + tombstones > 0;
  return (
    <Card>
      <CardContent className="pt-5 space-y-2">
        <h3 className="font-semibold text-sm">A publish now</h3>
        <ReadsStatus reads={[stored]} label="stored events" />
        {stored.loaded && (
          <p className="text-sm">
            Would publish {plural(published, 'event')}
            {tombstones ? ` and hide ${plural(tombstones, 'Sessionize event')}` : ''};{' '}
            {plural(withheld, 'stored row')} not shown on site.
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
        <PublishSnapshotButton onPublished={snapshot.refresh} />
      </div>
      <p className="text-sm text-muted-foreground">
        Publish snapshot writes the certifications and speaking events snapshots the public pages
        read. The About page renders whichever is newer — this snapshot or the JSON baked into the
        last deploy — so a publish shows to visitors right away, without a redeploy.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <SnapshotCard snapshot={snapshot} />
        <StoredCard stored={data.stored} snapshot={snapshot} />
      </div>
    </div>
  );
}
