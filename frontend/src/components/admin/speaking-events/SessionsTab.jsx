/**
 * Upcoming and Past (#573): one list of sessions each, split by date from the
 * rows the one-scroll page showed together. Upcoming is today or later
 * (soonest first, undated last) and is where sessions are enriched; Past is
 * what was delivered (newest first) with its slides and event links, still
 * editable so a recording or deck can be added afterwards.
 *
 * Both need Sessionize and the stored overrides, which the page holds. Until
 * both have landed this tab shows their loading or error state instead of a
 * half-merged list: an override that has not loaded would show its event as
 * "API only", and Enrich there would write a second record for it.
 */

import React from 'react';
import EventForm from './EventForm';
import { ManualEntriesTable, SectionHeading, SessionizeEventsTable } from './EventTables';
import { Dismissible, ReadsStatus, RefreshButton, allLanded, refreshAll } from './TabParts';
import { splitByDate } from './eventModel';

const COPY = {
  upcoming: {
    label: 'upcoming sessions',
    empty: 'No upcoming sessions. New Sessionize events appear here after a refresh.',
  },
  past: {
    label: 'past sessions',
    empty: 'No delivered sessions yet.',
  },
};

function SessionLists({ when, rows, editor }) {
  const now = new Date();
  const sessionize = splitByDate(rows.mergedEvents, now)[when];
  const manual = splitByDate(rows.manualEntries, now)[when];
  const showLinks = when === 'past';
  if (sessionize.length === 0 && manual.length === 0) {
    return <p className="text-sm text-muted-foreground">{COPY[when].empty}</p>;
  }
  return (
    <div className="space-y-8">
      {sessionize.length > 0 && (
        <section>
          <SectionHeading>From Sessionize ({sessionize.length})</SectionHeading>
          <SessionizeEventsTable rows={sessionize} editor={editor} showLinks={showLinks} />
        </section>
      )}
      {manual.length > 0 && (
        <section>
          <SectionHeading>Manual entries ({manual.length})</SectionHeading>
          <ManualEntriesTable rows={manual} editor={editor} showLinks={showLinks} />
        </section>
      )}
    </div>
  );
}

function SessionsTab({ when, data, editor }) {
  const reads = [data.sessionize, data.stored];
  const busy = reads.some((read) => read.pending);
  return (
    <div className="space-y-6 pt-4">
      <div className="flex flex-wrap justify-end gap-2">
        <RefreshButton onClick={() => refreshAll(reads)} busy={busy} />
      </div>
      {editor.error && <Dismissible onDismiss={editor.clearError}>{editor.error}</Dismissible>}
      {editor.isOpen && <EventForm editor={editor} />}
      <ReadsStatus reads={reads} label={COPY[when].label} />
      {allLanded(reads) && <SessionLists when={when} rows={data.rows} editor={editor} />}
    </div>
  );
}

export function UpcomingTab(props) {
  return <SessionsTab when="upcoming" {...props} />;
}

export function PastTab(props) {
  return <SessionsTab when="past" {...props} />;
}
