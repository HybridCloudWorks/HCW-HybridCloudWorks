/**
 * Programs (ADR 0033 §4): the catalogue as cards — provider, window state,
 * one line of what the program is — with Details (eligibility, criteria,
 * requirements, recommended activities, the application link, and this
 * program's readiness) and Start application. Editing the catalogue is the
 * Settings tab's job; this tab reads it.
 */
import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ExternalLink, Loader2, Play } from 'lucide-react';
import EmptyState from '@/components/admin/shared/EmptyState';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import { TabLoading } from '@/components/admin/integrations/TabNotice';
import { PURSUING_STATUSES, sourceLabel, todayIso, windowState } from './ambassadorModel';
import { ReadinessPanel, ReadsStatus, allLanded } from './Parts';
import useReadiness from './useReadiness';

const WINDOW_BADGE = {
  open: { id: 'open', label: 'Window open', tone: 'ok', help: 'Applications are being taken now.' },
  closed: {
    id: 'closed',
    label: 'Window closed',
    tone: 'off',
    help: 'Outside the application dates.',
  },
  rolling: {
    id: 'rolling',
    label: 'Rolling',
    tone: 'muted',
    help: 'No fixed window; nominations or applications any time.',
  },
};

function Bullets({ title, items }) {
  if (!items?.length) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function ProgramDetails({ program, onClose, onStart, starting, pursuing }) {
  const readiness = useReadiness(program?.id, '', { enabled: Boolean(program) });
  if (!program) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{program.name}</DialogTitle>
          <DialogDescription>
            {program.provider} · {program.category}
            {program.renewalCadence ? ` · renews ${program.renewalCadence}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm">{program.description}</p>
          {program.applicationUrl && (
            <a
              href={program.applicationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm underline"
            >
              Program page <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {program.applicationWindow?.note && (
            <p className="text-xs text-muted-foreground">
              Window: {program.applicationWindow.opens || '—'} to{' '}
              {program.applicationWindow.closes || '—'} · {program.applicationWindow.note}
            </p>
          )}
          {program.expirationRule && (
            <p className="text-xs text-muted-foreground">Expiry: {program.expirationRule}</p>
          )}
          <Bullets title="Eligibility" items={program.eligibility} />
          <Bullets title="Criteria" items={program.criteria} />
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Requirements
            </h4>
            <ul className="mt-1 space-y-1 text-sm">
              {(program.requirements || []).map((req) => (
                <li key={req.id}>
                  <span className="font-medium">{req.label}</span> — at least {req.minCount} from{' '}
                  {req.evidenceTypes.map(sourceLabel).join(', ') || 'any source'} (weight{' '}
                  {req.weight})
                  {req.description && (
                    <p className="text-xs text-muted-foreground">{req.description}</p>
                  )}
                </li>
              ))}
              {(program.requirements || []).length === 0 && (
                <li className="text-muted-foreground">
                  No requirements set. Add them on Settings.
                </li>
              )}
            </ul>
          </div>
          <Bullets title="Recommended activities" items={program.recommendedActivities} />
          <div className="rounded-md border border-border p-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Readiness from your evidence
            </h4>
            {readiness.loading && <TabLoading>Computing readiness…</TabLoading>}
            {readiness.error && <p className="text-sm text-destructive">{readiness.error}</p>}
            {readiness.loaded && <ReadinessPanel readiness={readiness.data} />}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button
              onClick={() => onStart(program.id)}
              disabled={starting || program.enabled === false}
            >
              {starting ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-1 h-4 w-4" />
              )}
              {pursuing ? 'Start another application' : 'Start application'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ProgramsTab({ hub, nav }) {
  const { programs, applications } = hub;
  const reads = [programs, applications];
  const [detailsId, setDetailsId] = useState(null);
  const [starting, setStarting] = useState(null);
  const today = todayIso();

  const pursuedPrograms = useMemo(
    () =>
      new Set(
        applications.data
          .filter((a) => PURSUING_STATUSES.includes(a.status))
          .map((a) => a.programId)
      ),
    [applications.data]
  );
  const ordered = useMemo(
    () =>
      [...programs.data].sort((a, b) => Number(b.enabled !== false) - Number(a.enabled !== false)),
    [programs.data]
  );

  const start = async (programId) => {
    setStarting(programId);
    const created = await hub.writes.createApplication({ programId });
    setStarting(null);
    if (created) {
      setDetailsId(null);
      nav.openApplication(created.id);
    }
  };

  const details = ordered.find((p) => p.id === detailsId) || null;

  return (
    <div className="space-y-4 pt-4">
      <p className="text-sm text-muted-foreground">
        The programs worth pursuing, seeded with seven and edited on Settings. Every requirement is
        a starting point until you match it to the program&apos;s current published rules.
      </p>
      <ReadsStatus reads={reads} label="programs" />
      {allLanded(reads) &&
        (ordered.length === 0 ? (
          <EmptyState
            title="No programs in the catalogue."
            description="Add one on the Settings tab."
            action={
              <Button size="sm" onClick={() => nav.setTab('settings')}>
                Open Settings
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ordered.map((program) => {
              const disabled = program.enabled === false;
              return (
                <Card
                  key={program.id}
                  className={disabled ? 'opacity-60' : ''}
                  data-testid="program-card"
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-start justify-between gap-2 text-base">
                      <span>{program.name}</span>
                      <StatusBadge
                        size="xs"
                        status={
                          disabled
                            ? {
                                id: 'disabled',
                                label: 'Disabled',
                                tone: 'off',
                                help: 'Hidden from new applications; re-enable on Settings.',
                              }
                            : WINDOW_BADGE[windowState(program, today)]
                        }
                      />
                    </CardTitle>
                    <CardDescription>
                      {program.provider} · {program.category}
                      {pursuedPrograms.has(program.id) && ' · in progress'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="line-clamp-3 text-sm">{program.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {(program.requirements || []).length} requirement
                      {(program.requirements || []).length === 1 ? '' : 's'}
                      {program.applicationWindow?.note
                        ? ` · ${program.applicationWindow.note}`
                        : ''}
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setDetailsId(program.id)}>
                        Details
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => start(program.id)}
                        disabled={disabled || starting === program.id}
                      >
                        {starting === program.id ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="mr-1 h-3.5 w-3.5" />
                        )}
                        Start application
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ))}
      <ProgramDetails
        program={details}
        onClose={() => setDetailsId(null)}
        onStart={start}
        starting={Boolean(starting)}
        pursuing={details ? pursuedPrograms.has(details.id) : false}
      />
    </div>
  );
}
