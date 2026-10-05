/**
 * Publishing — the public certifications snapshot the About page reads, when
 * it was last written, and what has changed in the collection since.
 *
 * The snapshot is this tab's own read (usePublicSnapshot), so it loads while
 * the tab is open and a failure here never blanks another tab. The diff also
 * needs the certification list; when that failed, the diff says so and the
 * snapshot half carries on.
 *
 * The button is Update Cert Catalog in the page header (CertificationsPage),
 * one click from every tab; it writes the certifications AND speaking-events
 * snapshots (one `publishSnapshot` call, shared with the Speaking Events
 * page). The page bumps `publishCount` when a publish lands and this tab
 * re-reads the snapshot past every cache.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TabError, TabLoading } from '@/components/admin/integrations/TabNotice';
import usePublicSnapshot from './usePublicSnapshot';
import { CertListNotice, TabIntro } from './shared';
import { diffSnapshot, issuerOf } from './certView';

function formatWhen(iso) {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function SnapshotSummary({ published }) {
  if (published.loading) return <TabLoading>Reading the public snapshot…</TabLoading>;
  if (published.error) {
    return <TabError message={published.error} onRetry={published.refresh} />;
  }
  if (published.snapshot === null) {
    return <p className="text-sm">No snapshot has been published yet.</p>;
  }
  const { generatedAt, items } = published.snapshot;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Last published</dt>
      <dd>{formatWhen(generatedAt)}</dd>
      <dt className="text-muted-foreground">Certifications on the About page</dt>
      <dd>{items.length}</dd>
    </dl>
  );
}

function ChangeList({ title, rows, describe }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title} ({rows.length})
      </p>
      <ul className="mt-1 space-y-0.5 text-sm">
        {rows.map((row) => (
          <li key={row.key}>{describe(row)}</li>
        ))}
      </ul>
    </div>
  );
}

function certLabel(cert) {
  return `${cert.name || cert.Name || '(untitled)'} · ${issuerOf(cert)}`;
}

function ChangesSince({ certs, snapshot }) {
  const diff = useMemo(
    () => diffSnapshot(certs.items, snapshot?.items || []),
    [certs.items, snapshot]
  );
  if (!certs.loaded) return <CertListNotice certs={certs} />;
  if (diff.total === 0) {
    return <p className="text-sm">The public snapshot matches the collection.</p>;
  }
  return (
    <div className="space-y-3" aria-label="Changes since the last publish">
      <ChangeList
        title="Not yet public"
        rows={diff.added.map((cert) => ({ key: cert._docId, cert }))}
        describe={({ cert }) => certLabel(cert)}
      />
      <ChangeList
        title="Changed"
        rows={diff.changed.map(({ cert, fields }) => ({ key: cert._docId, cert, fields }))}
        describe={({ cert, fields }) => `${certLabel(cert)} — ${fields.join(', ')}`}
      />
      <ChangeList
        title="Still public, now hidden or deleted"
        rows={diff.removed.map((item) => ({ key: item.id, cert: item }))}
        describe={({ cert }) => certLabel(cert)}
      />
    </div>
  );
}

/**
 * The comparison needs the snapshot. While it is being read that is a loading
 * line; when the read failed it says so and offers the retry here too, rather
 * than a generic "needs the snapshot". It is not a second `role="alert"`: the
 * summary card above already announces the failure once.
 */
function ChangesUnavailable({ published }) {
  if (published.loading) return <TabLoading>Reading the public snapshot…</TabLoading>;
  if (published.error) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <p className="min-w-0 flex-1 wrap-break-word">
          Can&apos;t compare until the public snapshot is read: {published.error}
        </p>
        <Button variant="outline" size="sm" onClick={published.refresh}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Try again
        </Button>
      </div>
    );
  }
  return <p className="text-sm text-muted-foreground">Needs the public snapshot.</p>;
}

export default function PublishingTab({ certs, publishCount = 0 }) {
  // Mounted after a publish this session: the first read is a fresh one.
  // A publish DURING this mount is a count change, answered by one refresh;
  // the count seen at mount is remembered so a remount does not read twice.
  const published = usePublicSnapshot({ fresh: publishCount > 0 });
  const { refresh } = published;
  const seenCount = useRef(publishCount);
  useEffect(() => {
    if (publishCount === seenCount.current) return;
    seenCount.current = publishCount;
    refresh();
  }, [publishCount, refresh]);
  return (
    <div className="space-y-4">
      <TabIntro>
        The About page reads a published snapshot, not the collection, and renders whichever is
        newer — this snapshot or the JSON baked into the last deploy — so a publish shows to
        visitors right away. Edits appear there after the next Update Cert Catalog (the button in
        the page header), or when the re-verify timer changes a cert.
      </TabIntro>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Public snapshot</CardTitle>
          <CardDescription>
            Update Cert Catalog also refreshes the speaking-events snapshot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SnapshotSummary published={published} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Changes since the last publish</CardTitle>
          <CardDescription>
            Shown certifications compared with the snapshot, field by public field.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {published.loaded ? (
            <ChangesSince certs={certs} snapshot={published.snapshot} />
          ) : (
            <ChangesUnavailable published={published} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
