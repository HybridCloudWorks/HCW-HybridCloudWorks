/**
 * Sources (#573): where rows come from. Sessionize — when it was last read,
 * what a sync would change, and "Sync from Sessionize" — and manual entries,
 * the stored-only rows no Sessionize event matches, with "Manual Entry".
 *
 * The sync's rules and the manual entry form are the one-scroll page's,
 * unchanged. What is new is saying, before a sync, which events it would
 * create and which records it would fill in, so a Sessionize change shows up
 * here rather than only after the button is pressed.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2, Plus } from 'lucide-react';
import EventForm from './EventForm';
import { ManualEntriesTable, SectionHeading } from './EventTables';
import { Dismissible, ReadsStatus, RefreshButton, allLanded, refreshAll } from './TabParts';
import { syncDifferences } from './eventModel';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function SyncResult({ result, onDismiss }) {
  return (
    <Dismissible tone="success" onDismiss={onDismiss}>
      Sync complete — <strong>{result.created}</strong> new row
      {result.created !== 1 ? 's' : ''} created, <strong>{result.patched}</strong> existing row
      {result.patched !== 1 ? 's' : ''} filled in (empty fields only),{' '}
      <strong>{result.skipped}</strong> already complete.
    </Dismissible>
  );
}

function NameList({ title, events }) {
  if (events.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="mt-1 list-disc pl-5 text-sm">
        {events.map((se) => (
          <li key={se.id}>
            {se.name} <span className="text-xs text-muted-foreground">#{se.id}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SessionizeSource({ sessionize, stored }) {
  const { toCreate, toPatch } = syncDifferences(sessionize.data, stored.data);
  const readAt = sessionize.loadedAt ? sessionize.loadedAt.toLocaleTimeString() : null;
  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <SectionHeading>Sessionize</SectionHeading>
      <p className="text-sm text-muted-foreground">
        {plural(sessionize.data.length, 'event')} read live from Sessionize
        {readAt ? ` at ${readAt}` : ''}.
      </p>
      {toCreate.length === 0 && toPatch.length === 0 ? (
        <p className="text-sm">Stored records match Sessionize: a sync would change nothing.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            A sync would create {plural(toCreate.length, 'record')} and fill empty fields on{' '}
            {plural(toPatch.length, 'record')}.
          </p>
          <NameList title="New in Sessionize" events={toCreate} />
          <NameList title="Stored, with empty fields Sessionize can fill" events={toPatch} />
        </div>
      )}
    </section>
  );
}

function ManualSource({ rows, editor }) {
  return (
    <section>
      <SectionHeading>Manual Entries — Stored Only ({rows.manualEntries.length})</SectionHeading>
      {rows.manualEntries.length > 0 ? (
        <ManualEntriesTable rows={rows.manualEntries} editor={editor} />
      ) : (
        <p className="text-sm text-muted-foreground">
          No manual entries. Add one for a session Sessionize does not list.
        </p>
      )}
    </section>
  );
}

function SourcesToolbar({ reads, sync, stored, editor }) {
  const busy = reads.some((read) => read.pending);
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <RefreshButton onClick={() => refreshAll(reads)} busy={busy} disabled={sync.syncing} />
      <Button
        variant="outline"
        size="sm"
        onClick={sync.sync}
        disabled={busy || sync.syncing || stored.data.length === 0}
        title="Create stored records for any new Sessionize events — existing records are never touched"
      >
        {sync.syncing ? (
          <Loader2 className="h-4 w-4 animate-spin mr-1" />
        ) : (
          <Download className="h-4 w-4 mr-1" />
        )}
        Sync from Sessionize
      </Button>
      <Button size="sm" onClick={editor.openManual}>
        <Plus className="h-4 w-4 mr-1" />
        Manual Entry
      </Button>
    </div>
  );
}

export default function SourcesTab({ data, editor, sync }) {
  const { sessionize, stored } = data;
  const reads = [sessionize, stored];
  return (
    <div className="space-y-6 pt-4">
      <SourcesToolbar reads={reads} sync={sync} stored={stored} editor={editor} />
      {sync.error && <Dismissible onDismiss={sync.dismissError}>{sync.error}</Dismissible>}
      {sync.result && <SyncResult result={sync.result} onDismiss={sync.dismissResult} />}
      {editor.error && <Dismissible onDismiss={editor.clearError}>{editor.error}</Dismissible>}
      {editor.isOpen && <EventForm editor={editor} />}
      <ReadsStatus reads={reads} label="sources" />
      {allLanded(reads) && (
        <div className="space-y-8">
          <SessionizeSource sessionize={sessionize} stored={stored} />
          <ManualSource rows={data.rows} editor={editor} />
        </div>
      )}
    </div>
  );
}
