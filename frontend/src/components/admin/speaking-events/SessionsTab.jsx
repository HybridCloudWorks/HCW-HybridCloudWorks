/**
 * Upcoming and Past (#573): one list of sessions each, split by date from the
 * rows the one-scroll page showed together. Upcoming is today or later
 * (soonest first, undated last) and is where sessions are enriched; Past is
 * what was delivered (newest first) with its slides and event links, still
 * editable so a recording or deck can be added afterwards.
 *
 * Both need Sessionize and the stored overrides, which the page holds. The
 * stored rows render as soon as the store has landed and Sessionize has
 * answered either way (ADR 0033, Spotlight slice): a Sessionize outage shows
 * its error above the list and every stored row below it as a manual entry,
 * where before the whole tab was the error and the manual entries vanished
 * with it. The list waits for Sessionize to SETTLE so a stored override is
 * never shown as a manual entry for the moment before its event arrives —
 * Enrich on that row would write a second record.
 *
 * Search and the status filter are the tab's own (ADR 0033 §4).
 */

import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Search } from 'lucide-react';
import EmptyState from '@/components/admin/shared/EmptyState';
import EventForm from './EventForm';
import { ManualEntriesTable, SectionHeading, SessionizeEventsTable } from './EventTables';
import { Dismissible, ReadsStatus, RefreshButton, refreshAll } from './TabParts';
import { SPEAKING_STATUSES, filterRows, speakingStatusInfo, splitByDate } from './eventModel';

const COPY = {
  upcoming: {
    label: 'upcoming sessions',
    empty: 'No upcoming sessions.',
    emptyHint:
      'New Sessionize events appear here after a refresh; add a Manual Entry on Sources for one Sessionize does not list.',
  },
  past: {
    label: 'past sessions',
    empty: 'No delivered sessions yet.',
    emptyHint: 'Sessions move here the day after their date.',
  },
};

/** True when both reads have said what they have to say, even if one failed. */
export const canListRows = (sessionize, stored) =>
  stored.loaded && !stored.error && (sessionize.loaded || Boolean(sessionize.error));

function Filters({ when, search, setSearch, status, setStatus }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex-1 min-w-48">
        <Label className="text-xs" htmlFor={`speaking-${when}-search`}>
          Search sessions
        </Label>
        <div className="relative mt-1">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            id={`speaking-${when}-search`}
            className="pl-8 h-8 text-xs"
            placeholder="Name, location, topic, audience…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div>
        <Label className="text-xs" htmlFor={`speaking-${when}-status`}>
          Status
        </Label>
        <select
          id={`speaking-${when}-status`}
          className="block h-8 w-40 text-xs mt-1 rounded-md border border-input bg-background px-2"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {SPEAKING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {speakingStatusInfo(s).label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function SessionLists({ when, rows, editor, filtered }) {
  const now = new Date();
  const sessionize = splitByDate(rows.mergedEvents, now)[when];
  const manual = splitByDate(rows.manualEntries, now)[when];
  const showLinks = when === 'past';
  if (sessionize.length === 0 && manual.length === 0) {
    return filtered ? (
      <EmptyState
        compact
        variant="filtered"
        title="No sessions match these filters."
        description="Clear the search or choose another status."
      />
    ) : (
      <EmptyState compact title={COPY[when].empty} description={COPY[when].emptyHint} />
    );
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
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const reads = [data.sessionize, data.stored];
  const busy = reads.some((read) => read.pending);
  const listable = canListRows(data.sessionize, data.stored);
  const filtered = Boolean(search.trim() || status);
  const rows = listable ? filterRows(data.rows, { search, status }) : data.rows;
  return (
    <div className="space-y-6 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Filters
          when={when}
          search={search}
          setSearch={setSearch}
          status={status}
          setStatus={setStatus}
        />
        <RefreshButton onClick={() => refreshAll(reads)} busy={busy} />
      </div>
      {editor.error && <Dismissible onDismiss={editor.clearError}>{editor.error}</Dismissible>}
      {editor.isOpen && <EventForm editor={editor} />}
      <ReadsStatus reads={reads} label={COPY[when].label} />
      {listable && <SessionLists when={when} rows={rows} editor={editor} filtered={filtered} />}
    </div>
  );
}

export function UpcomingTab(props) {
  return <SessionsTab when="upcoming" {...props} />;
}

export function PastTab(props) {
  return <SessionsTab when="past" {...props} />;
}
