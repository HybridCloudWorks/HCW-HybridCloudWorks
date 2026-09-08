/**
 * Health — what is true now, and what can be verified right now.
 *
 * This replaces two pages that answered halves of one question. Ops Health
 * rendered what the estate had already written down: scheduler counts, queue
 * ages, open alerts, all of it produced by timers that ran while nobody was
 * looking. Diagnostics ran checks that only exist while an admin is signed in
 * and pressing a button — the token in this session, the registry's opinion of
 * this principal, a real job submitted to the Labs queue and cancelled again.
 *
 * Neither was a page about "health" on its own. An operator with a broken
 * pipeline had to know which of the two would have the answer, and the honest
 * answer was usually "both, in that order": read the signals, then run a probe
 * to see whether the thing is broken now or merely was.
 *
 * So the split here is by what a line of the page can claim, not by which page
 * it used to live on:
 *
 * - **Observed** — one authenticated read of `getOpsHealthSnapshot`. Reported,
 *   not asked for. Alerts are here because answering one is a live action.
 * - **Verified** — checks that run on demand and write real data. The three
 *   pipeline smoke tests moved into this half, off the old Ops Health page,
 *   because a button that fetches every RSS feed is a check and not a metric.
 *
 * The strip at the top is the one place the two meet: a signal and a probe
 * verdict beside each other, which is the whole reason they are one page.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { postJSON } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Activity, ClipboardCopy, Loader2, RefreshCw } from 'lucide-react';

import {
  OperationalSignalsCard,
  PipelineReadinessCard,
  PublishingOpsCard,
  WorkflowAlertsCard,
  getAlertActionLabel,
  getAlertStatus,
} from './health/signals';
import {
  AdminRegistryCard,
  LabsProbeCard,
  ProbeButton,
  SmokeActionsCard,
  TokenClaimsCard,
  buildReport,
  collectIdentity,
  evaluateIdentity,
  evaluateLabsProbe,
  messageOf,
  probeUnauthenticated,
  runLabsProbeSteps,
  useSmokeActions,
} from './health/probes';

const VERDICT_TONE = {
  PASS: 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400',
  FAIL: 'border-rose-300 text-rose-700 dark:border-rose-700 dark:text-rose-400',
  UNKNOWN: 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400',
};

const verdictLabel = (pass) => {
  if (pass === true) return 'PASS';
  if (pass === false) return 'FAIL';
  return 'UNKNOWN';
};

function GlanceItem({ label, children }) {
  return (
    <span className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </span>
  );
}

/**
 * The observed half and the verified half on one line.
 *
 * Deliberately mixed rather than grouped: "Functions URL Ready" next to
 * "Identity UNKNOWN" is the state where the estate looks fine and this
 * session cannot prove it can talk to it, and that pairing is invisible when
 * the two live on different pages.
 */
function AtAGlance({ readiness, openAlertCount, signals, identityVerdict, labsVerdict }) {
  return (
    <div
      role="group"
      aria-label="Health at a glance"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm"
    >
      <GlanceItem label="Functions URL">
        <Badge variant={readiness.functionsConfigured ? 'secondary' : 'destructive'}>
          {readiness.functionsConfigured ? 'Ready' : 'Missing'}
        </Badge>
      </GlanceItem>
      <GlanceItem label="Open alerts">
        <Badge variant={openAlertCount > 0 ? 'destructive' : 'secondary'}>{openAlertCount}</Badge>
      </GlanceItem>
      <GlanceItem label="Publish failures">
        <Badge variant={signals.publishFailureCount > 0 ? 'destructive' : 'secondary'}>
          {signals.publishFailureCount || 0}
        </Badge>
      </GlanceItem>
      <GlanceItem label="Identity">
        <Badge variant="outline" className={VERDICT_TONE[verdictLabel(identityVerdict.pass)]}>
          {verdictLabel(identityVerdict.pass)}
        </Badge>
      </GlanceItem>
      <GlanceItem label="Labs probe">
        <Badge variant="outline" className={VERDICT_TONE[verdictLabel(labsVerdict.pass)]}>
          {verdictLabel(labsVerdict.pass)}
        </Badge>
      </GlanceItem>
    </div>
  );
}

function SectionHeading({ title, children }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export default function HealthPage() {
  const { authReady } = useAuthReady();
  const { toast } = useToast();

  // ── Observed ───────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [snapshot, setSnapshot] = useState({ readiness: null, digest: null, alerts: [] });
  const [alertActionId, setAlertActionId] = useState('');
  const [alertFilter, setAlertFilter] = useState('open');
  const [resolutionNotes, setResolutionNotes] = useState({});

  // ── Verified ───────────────────────────────────────────────────────────────
  const [identity, setIdentity] = useState(null);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [labs, setLabs] = useState(null);
  const [labsBusy, setLabsBusy] = useState(false);
  const [unauth, setUnauth] = useState(null);
  const [unauthBusy, setUnauthBusy] = useState(false);

  const refreshSnapshot = async () => {
    const latest = await postJSON('getOpsHealthSnapshot', {});
    setSnapshot(latest);
  };

  const smoke = useSmokeActions(refreshSnapshot);

  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;

    async function loadSnapshot() {
      setLoading(true);
      setLoadError('');
      try {
        const result = await postJSON('getOpsHealthSnapshot', {});
        if (!cancelled) setSnapshot(result);
      } catch (error) {
        if (!cancelled) setLoadError(error.message || 'Failed to load ops health snapshot.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  // One identity run at a time. The first run and a re-run go through the
  // same gate: a click while a run is in flight is ignored rather than
  // starting a second run whose result would race the first (last to resolve
  // would win). Each run carries a sequence number, so a result from a run
  // that was superseded — or torn down by a route change — is discarded
  // instead of being applied over a newer one.
  const identitySeq = useRef(0);
  const identityInFlight = useRef(false);

  const runIdentity = useCallback(async () => {
    if (identityInFlight.current) return false;
    identityInFlight.current = true;
    identitySeq.current += 1;
    const seq = identitySeq.current;
    try {
      const result = await collectIdentity();
      if (seq === identitySeq.current) setIdentity(result);
    } finally {
      if (seq === identitySeq.current) identityInFlight.current = false;
    }
    return true;
  }, []);

  useEffect(() => {
    if (!authReady) return undefined;
    runIdentity();
    return () => {
      // Supersede whatever is in flight: its result is dropped and the gate
      // reopens for the next mount.
      identitySeq.current += 1;
      identityInFlight.current = false;
    };
  }, [authReady, runIdentity]);

  const rerunIdentity = useCallback(async () => {
    if (identityInFlight.current) return;
    setIdentityBusy(true);
    try {
      await runIdentity();
    } finally {
      setIdentityBusy(false);
    }
  }, [runIdentity]);

  // The first run has no busy flag of its own — `identity === null` is that
  // state — so the button reads both.
  const identityRunning = identityBusy || identity === null;

  const runLabs = useCallback(async () => {
    setLabsBusy(true);
    try {
      setLabs(await runLabsProbeSteps());
    } catch (err) {
      // The steps record their own failures; this is a throw from outside
      // them. Shown in the panel as a failed probe, never left as a stuck
      // spinner with every button disabled.
      setLabs({
        enqueue: null,
        read: null,
        cancel: null,
        final: null,
        error: messageOf(err, 'the probe threw before it could record a result'),
      });
    } finally {
      setLabsBusy(false);
    }
  }, []);

  const runUnauth = useCallback(async () => {
    setUnauthBusy(true);
    try {
      setUnauth(await probeUnauthenticated());
    } catch (err) {
      setUnauth({
        httpStatus: null,
        error: messageOf(err, 'the probe threw before it could record a result'),
      });
    } finally {
      setUnauthBusy(false);
    }
  }, []);

  const handleAlertAction = async (alertId, action) => {
    smoke.setActionError('');
    smoke.setActionMessage('');
    setAlertActionId(`${alertId}:${action}`);
    try {
      const resolutionNote = resolutionNotes[alertId] || '';
      await postJSON('updateWorkflowAlert', { alertId, action, resolutionNote });
      await refreshSnapshot();
      if (action === 'resolve') {
        setResolutionNotes((prev) => ({ ...prev, [alertId]: '' }));
      }
      smoke.setActionMessage(`${getAlertActionLabel(action)} alert ${alertId}.`);
    } catch (error) {
      smoke.setActionError(error.message || `Failed to ${action} alert.`);
    } finally {
      setAlertActionId('');
    }
  };

  const readiness = snapshot.readiness || {
    functionsConfigured: false,
    publishedItems: 0,
    missingSlugCount: 0,
    rssSources: 0,
  };
  const digestForDisplay = snapshot.digest || null;
  const operationalSignals = snapshot.operationalSignals || {
    queueBreachCount: 0,
    oldestStagedHours: 0,
    openAlertAgeHours: 0,
    publishFailureCount: 0,
    orphanedGeneratedImages: 0,
    lastSchedulerSuccessAt: null,
  };
  const allAlerts = snapshot.alerts || [];
  const filteredAlerts = allAlerts.filter((row) => getAlertStatus(row) === alertFilter);
  const openAlertCount = allAlerts.filter((row) => getAlertStatus(row) === 'open').length;
  const publishingOps = digestForDisplay?.publishingOps || null;
  const publishingWatchdog = digestForDisplay?.publishingWatchdog || null;

  // Nothing may be copied while a check is in flight: a report taken mid-run
  // would say a token "could not be read" or a probe was "not run" for work
  // that is merely pending, and that is what would end up in the record.
  const settling = identity === null || identityBusy || labsBusy || unauthBusy;

  const report = buildReport({
    generatedAt: new Date().toISOString(),
    identityPending: identity === null,
    ...(identity || {}),
    labs,
    unauth,
  });

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report);
      toast({
        title: 'Report copied',
        description: 'Paste it wherever this run needs recording.',
      });
    } catch (err) {
      toast({
        title: 'Clipboard unavailable',
        description: messageOf(err, 'Select the report text below and copy it by hand.'),
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-slate-blue" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Activity className="h-6 w-6" /> Health
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            What the platform reports about itself, and the checks you can run against it from this
            session. The token behind those checks is decoded here and reduced to claim names; it is
            never displayed, and only the summary at the bottom is copied.
          </p>
          {loadError && <p className="mt-1 text-sm text-destructive">{loadError}</p>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <ProbeButton busy={identityRunning} icon={RefreshCw} onClick={rerunIdentity}>
              Re-run identity checks
            </ProbeButton>
            <Button
              size="sm"
              onClick={copyReport}
              disabled={settling}
              title={settling ? 'Checks still running' : 'Copy the Markdown report'}
            >
              <ClipboardCopy className="mr-2 h-3.5 w-3.5" /> Copy report
            </Button>
          </div>
          {settling ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3 w-3 animate-spin" /> Checks still running — the report is not
              final
            </p>
          ) : null}
        </div>
      </div>

      <AtAGlance
        readiness={readiness}
        openAlertCount={openAlertCount}
        signals={operationalSignals}
        identityVerdict={evaluateIdentity(identity?.token, identity?.admin)}
        labsVerdict={evaluateLabsProbe(labs)}
      />

      <section className="space-y-4">
        <SectionHeading title="What is true now">
          One read of the ops-health snapshot. Written by timers and schedulers that ran without
          anyone watching — reported here, not asked for.
        </SectionHeading>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PipelineReadinessCard readiness={readiness} digestForDisplay={digestForDisplay} />
          <PublishingOpsCard
            publishingOps={publishingOps}
            publishingWatchdog={publishingWatchdog}
            digestForDisplay={digestForDisplay}
          />
        </div>

        <OperationalSignalsCard signals={operationalSignals} />

        <WorkflowAlertsCard
          alertFilter={alertFilter}
          setAlertFilter={setAlertFilter}
          filteredAlerts={filteredAlerts}
          alertActionId={alertActionId}
          resolutionNotes={resolutionNotes}
          setResolutionNotes={setResolutionNotes}
          handleAlertAction={handleAlertAction}
        />
      </section>

      <section className="space-y-4">
        <SectionHeading title="What I can verify right now">
          Checks that run in this signed-in session and do real work. Nothing below is true until
          you press the button that makes it true.
        </SectionHeading>

        <SmokeActionsCard
          runningAction={smoke.runningAction}
          actionInfoOpen={smoke.actionInfoOpen}
          actionMessage={smoke.actionMessage}
          actionError={smoke.actionError}
          onRunAction={smoke.runAction}
          onToggleActionInfo={smoke.toggleActionInfo}
        />

        <TokenClaimsCard identity={identity} />
        <AdminRegistryCard identity={identity} />
        <LabsProbeCard
          labs={labs}
          labsBusy={labsBusy}
          onLabs={runLabs}
          unauth={unauth}
          unauthBusy={unauthBusy}
          onUnauth={runUnauth}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Report</CardTitle>
            <CardDescription>
              What Copy report puts on the clipboard. Claim names, booleans, statuses and job ids
              only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre
              className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/60 p-3 font-mono text-xs"
              aria-label="Diagnostics report"
            >
              {report}
            </pre>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
