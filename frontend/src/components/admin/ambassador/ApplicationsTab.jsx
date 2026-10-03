/**
 * Applications (ADR 0033 §4): every pursuit, filtered by status and program,
 * with Start application, and the workspace for the one selected. The
 * selection is the page's (so the Dashboard and Programs can open one).
 */
import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Plus } from 'lucide-react';
import EmptyState from '@/components/admin/shared/EmptyState';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import {
  APPLICATION_STATUSES,
  ambassadorStatusInfo,
  programById,
  todayIso,
} from './ambassadorModel';
import ApplicationWorkspace from './ApplicationWorkspace';
import { ReadsStatus, SelectField, allLanded, whenText } from './Parts';

function StartForm({ programs, onStart, starting }) {
  const [programId, setProgramId] = useState('');
  const enabled = programs.filter((p) => p.enabled !== false);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      aria-label="Start an application"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!programId) return;
        if (await onStart(programId)) setProgramId('');
      }}
    >
      <SelectField
        id="start-application-program"
        label="Program"
        value={programId}
        onChange={setProgramId}
        options={[
          { value: '', label: 'Choose a program…' },
          ...enabled.map((p) => ({ value: p.id, label: p.name })),
        ]}
        className="min-w-56"
      />
      <Button type="submit" size="sm" disabled={!programId || starting}>
        {starting ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="mr-1 h-3.5 w-3.5" />
        )}
        Start application
      </Button>
    </form>
  );
}

export default function ApplicationsTab({ hub, nav, selection }) {
  const { programs, applications, evidence } = hub;
  const reads = [programs, applications, evidence];
  const [status, setStatus] = useState('');
  const [programFilter, setProgramFilter] = useState('');
  const [starting, setStarting] = useState(false);
  const byId = useMemo(() => programById(programs.data), [programs.data]);
  const today = todayIso();

  const rows = useMemo(
    () =>
      applications.data.filter(
        (a) => (!status || a.status === status) && (!programFilter || a.programId === programFilter)
      ),
    [applications.data, status, programFilter]
  );
  const selected = applications.data.find((a) => a.id === selection.applicationId) || null;

  const start = async (programId) => {
    setStarting(true);
    const created = await hub.writes.createApplication({ programId });
    setStarting(false);
    if (created) nav.openApplication(created.id);
    return Boolean(created);
  };

  return (
    <div className="space-y-4 pt-4">
      <p className="text-sm text-muted-foreground">
        One application per pursuit. Open one to work its checklist, write responses, attach
        evidence and record the decision; everything here is private until you export it.
      </p>
      <ReadsStatus reads={reads} label="applications" />
      {allLanded(reads) && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <SelectField
                id="applications-status-filter"
                label="Status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: '', label: 'All statuses' },
                  ...APPLICATION_STATUSES.map((s) => ({
                    value: s,
                    label: ambassadorStatusInfo(s).label,
                  })),
                ]}
              />
              <SelectField
                id="applications-program-filter"
                label="Program"
                value={programFilter}
                onChange={setProgramFilter}
                options={[
                  { value: '', label: 'All programs' },
                  ...programs.data.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </div>
            <StartForm programs={programs.data} onStart={start} starting={starting} />
          </div>

          {selected && (
            <ApplicationWorkspace
              application={selected}
              program={byId.get(selected.programId) || null}
              evidence={evidence.data}
              hub={hub}
              onClose={() => nav.openApplication(null)}
            />
          )}

          {rows.length === 0 ? (
            <EmptyState
              compact
              variant={status || programFilter ? 'filtered' : 'empty'}
              title={
                status || programFilter
                  ? 'No applications match these filters.'
                  : 'No applications yet.'
              }
              description={
                status || programFilter
                  ? 'Clear a filter to see the rest.'
                  : 'Choose a program above, or start from a card on the Programs tab.'
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Program
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Deadline
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Evidence
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Updated
                    </th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((a) => (
                    <tr
                      key={a.id}
                      className={
                        a.id === selection.applicationId ? 'bg-primary/5' : 'hover:bg-muted/30'
                      }
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{byId.get(a.programId)?.name || a.title}</div>
                        {a.title && byId.get(a.programId) && (
                          <div className="text-xs text-muted-foreground">{a.title}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge size="xs" status={ambassadorStatusInfo(a.status)} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {whenText(a.submissionDeadline, today)}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums">
                        {(a.evidenceIds || []).length} attached
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {a.updatedAt?.slice(0, 10)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant={a.id === selection.applicationId ? 'default' : 'outline'}
                          onClick={() => nav.openApplication(a.id)}
                        >
                          {a.id === selection.applicationId ? 'Open' : 'Work on it'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
