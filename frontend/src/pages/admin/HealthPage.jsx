/**
 * Health Hub (route `/admin/health`) — what is true now, and what can be
 * verified right now.
 *
 * This replaced two pages that answered halves of one question. Ops Health
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
 * Until #569 the merged page was one long scroll. It now has a tab per duty,
 * at the Newsletter Hub's standard (components/admin/HubTabs):
 *
 *   Overview  the strip, then one read of `getOpsHealthSnapshot`: readiness,
 *             publishing and operational signals. Reported, not asked for.
 *   Alerts    workflow alerts, filtered, with acknowledge / resolve / reopen.
 *             Its own tab because answering one is a live action.
 *   Checks    the pipeline smoke tests, token claims, the admin registry and
 *             the Labs probes — checks that run on demand and do real work.
 *   Report    the Markdown summary of those checks, and Copy report.
 *
 * Deep links are `?tab=`; an unknown or moved id lands where its content went
 * (health/tabs.js).
 *
 * The strip at the top of Overview is the one place the two halves meet: a
 * signal and a probe verdict beside each other, which is the whole reason they
 * are one hub.
 *
 * State two tabs read lives here, on the page, not in the tabs: the snapshot
 * feeds Overview and Alerts, and the identity and probe results feed the
 * strip, Checks and Report. So switching tabs never refetches or reruns a
 * probe, and a report copied from Report is the checks just run on Checks.
 * The header and tab bar always render; a snapshot that fails to load is an
 * error on the two tabs that show it, and Checks and Report carry on.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuthReady } from '@/hooks/useAuthReady';
import { postJSON } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import HubTabs from '@/components/admin/HubTabs';
import { TabError, TabLoading } from '@/components/admin/integrations/TabNotice';
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
import { TABS, resolveTab } from './health/tabs';
import useOpsSnapshot from './health/useOpsSnapshot';

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

const EMPTY_READINESS = {
  functionsConfigured: false,
  publishedItems: 0,
  missingSlugCount: 0,
  rssSources: 0,
};

const EMPTY_SIGNALS = {
  queueBreachCount: 0,
  oldestStagedHours: 0,
  openAlertAgeHours: 0,
  publishFailureCount: 0,
  orphanedGeneratedImages: 0,
  lastSchedulerSuccessAt: null,
};

function GlanceItem({ label, children }) {
  return (
    <span className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </span>
  );
}

function UnknownBadge() {
  return (
    <Badge variant="outline" className={VERDICT_TONE.UNKNOWN}>
      UNKNOWN
    </Badge>
  );
}

/**
 * The observed half and the verified half on one line.
 *
 * Deliberately mixed rather than grouped: "Functions URL Ready" next to
 * "Identity UNKNOWN" is the state where the estate looks fine and this
 * session cannot prove it can talk to it, and that pairing is invisible when
 * the two live on different tabs.
 *
 * The strip renders even when the snapshot has not arrived, because the two
 * verdicts do not depend on it. Its observed badges then say UNKNOWN: the
 * zeros a missing snapshot defaults to would read as "no open alerts".
 */
function AtAGlance({
  snapshotLoaded,
  readiness,
  openAlertCount,
  signals,
  identityVerdict,
  labsVerdict,
}) {
  return (
    <div
      role="group"
      aria-label="Health at a glance"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm"
    >
      <GlanceItem label="Functions URL">
        {snapshotLoaded ? (
          <Badge variant={readiness.functionsConfigured ? 'secondary' : 'destructive'}>
            {readiness.functionsConfigured ? 'Ready' : 'Missing'}
          </Badge>
        ) : (
          <UnknownBadge />
        )}
      </GlanceItem>
      <GlanceItem label="Open alerts">
        {snapshotLoaded ? (
          <Badge variant={openAlertCount > 0 ? 'destructive' : 'secondary'}>{openAlertCount}</Badge>
        ) : (
          <UnknownBadge />
        )}
      </GlanceItem>
      <GlanceItem label="Publish failures">
        {snapshotLoaded ? (
          <Badge variant={signals.publishFailureCount > 0 ? 'destructive' : 'secondary'}>
            {signals.publishFailureCount || 0}
          </Badge>
        ) : (
          <UnknownBadge />
        )}
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

/**
 * The snapshot's loading line or its error, or null once it has landed. The
 * two tabs that show the snapshot each render this in place of their cards,
 * so a refused read is said where the numbers would have been.
 */
function SnapshotNotice({ ops }) {
  if (ops.loading) return <TabLoading>Reading the ops-health snapshot…</TabLoading>;
  if (ops.error) return <TabError message={ops.error} onRetry={ops.refresh} />;
  return null;
}

function TabIntro({ children }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function OverviewTab({ ops, derived, identity, labs }) {
  return (
    <div className="space-y-4">
      <AtAGlance
        snapshotLoaded={ops.loaded}
        readiness={derived.readiness}
        openAlertCount={derived.openAlertCount}
        signals={derived.operationalSignals}
        identityVerdict={evaluateIdentity(identity?.token, identity?.admin)}
        labsVerdict={evaluateLabsProbe(labs)}
      />
      <TabIntro>
        One read of the ops-health snapshot. Written by timers and schedulers that ran without
        anyone watching — reported here, not asked for.
      </TabIntro>
      {ops.loaded ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PipelineReadinessCard
              readiness={derived.readiness}
              digestForDisplay={derived.digestForDisplay}
            />
            <PublishingOpsCard
              publishingOps={derived.publishingOps}
              publishingWatchdog={derived.publishingWatchdog}
              digestForDisplay={derived.digestForDisplay}
            />
          </div>
          <OperationalSignalsCard signals={derived.operationalSignals} />
        </>
      ) : (
        <SnapshotNotice ops={ops} />
      )}
    </div>
  );
}

function AlertsTab({ ops, derived, alerts }) {
  return (
    <div className="space-y-4">
      <TabIntro>
        Alerts the workflows raised. Acknowledging, resolving or reopening one writes to the alert
        and re-reads the snapshot.
      </TabIntro>
      {/* Above the card rather than in it: an action can succeed and its
          re-read fail, and then this line and the error below both stand. */}
      <div aria-live="polite">
        {alerts.message && <p className="text-sm text-emerald-600">{alerts.message}</p>}
        {alerts.error && <p className="text-sm text-red-600">{alerts.error}</p>}
      </div>
      {ops.loaded ? (
        <WorkflowAlertsCard
          alertFilter={alerts.filter}
          setAlertFilter={alerts.setFilter}
          filteredAlerts={derived.filteredAlerts}
          alertActionId={alerts.actionId}
          resolutionNotes={alerts.resolutionNotes}
          setResolutionNotes={alerts.setResolutionNotes}
          handleAlertAction={alerts.handleAction}
        />
      ) : (
        <SnapshotNotice ops={ops} />
      )}
    </div>
  );
}

function ChecksTab({ smoke, identity, identityRunning, rerunIdentity, probes }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <TabIntro>
          Checks that run in this signed-in session and do real work. Nothing here is true until you
          press the button that makes it true.
        </TabIntro>
        <ProbeButton busy={identityRunning} icon={RefreshCw} onClick={rerunIdentity}>
          Re-run identity checks
        </ProbeButton>
      </div>

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
        labs={probes.labs}
        labsBusy={probes.labsBusy}
        onLabs={probes.runLabs}
        unauth={probes.unauth}
        unauthBusy={probes.unauthBusy}
        onUnauth={probes.runUnauth}
      />
    </div>
  );
}

function ReportTab({ report, settling, copyReport }) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-lg">Report</CardTitle>
          <CardDescription>
            What Copy report puts on the clipboard: the checks on the Checks tab, as they stand.
            Claim names, booleans, statuses and job ids only.
          </CardDescription>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            size="sm"
            onClick={copyReport}
            disabled={settling}
            title={settling ? 'Checks still running' : 'Copy the Markdown report'}
          >
            <ClipboardCopy className="mr-2 h-3.5 w-3.5" /> Copy report
          </Button>
          {settling ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3 w-3 animate-spin" /> Checks still running — the report is not
              final
            </p>
          ) : null}
        </div>
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
  );
}

/**
 * Each tab's panel, by id. With TABS in health/tabs.js this is the whole of
 * adding a tab: every panel receives the same page state and takes what it
 * needs.
 */
const PANELS = {
  overview: OverviewTab,
  alerts: AlertsTab,
  checks: ChecksTab,
  report: ReportTab,
};

export default function HealthPage() {
  const { authReady } = useAuthReady();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveTab(searchParams.get('tab'));

  const setTab = (id) => {
    if (id === activeTab) return;
    setSearchParams({ tab: id });
  };

  // ── Observed ───────────────────────────────────────────────────────────────
  const ops = useOpsSnapshot(authReady);
  const [alertActionId, setAlertActionId] = useState('');
  const [alertFilter, setAlertFilter] = useState('open');
  const [resolutionNotes, setResolutionNotes] = useState({});
  // The Alerts tab's own outcome line. It used to be written into the smoke
  // actions' message, which rendered on a card an operator answering an alert
  // was no longer looking at.
  const [alertMessage, setAlertMessage] = useState('');
  const [alertError, setAlertError] = useState('');

  // ── Verified ───────────────────────────────────────────────────────────────
  const [identity, setIdentity] = useState(null);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [labs, setLabs] = useState(null);
  const [labsBusy, setLabsBusy] = useState(false);
  const [unauth, setUnauth] = useState(null);
  const [unauthBusy, setUnauthBusy] = useState(false);

  // A smoke action writes what the snapshot reads, so it re-reads it — through
  // the same generation guard as every other read.
  const smoke = useSmokeActions(ops.refresh);

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
    setAlertError('');
    setAlertMessage('');
    setAlertActionId(`${alertId}:${action}`);
    try {
      const resolutionNote = resolutionNotes[alertId] || '';
      await postJSON('updateWorkflowAlert', { alertId, action, resolutionNote });
      if (action === 'resolve') {
        setResolutionNotes((prev) => ({ ...prev, [alertId]: '' }));
      }
      setAlertMessage(`${getAlertActionLabel(action)} alert ${alertId}.`);
      // The write landed whatever the re-read does; a failed re-read is the
      // snapshot's error, shown on this tab beneath the message.
      await ops.refresh();
    } catch (error) {
      setAlertError(error.message || `Failed to ${action} alert.`);
    } finally {
      setAlertActionId('');
    }
  };

  const { snapshot } = ops;
  const readiness = snapshot.readiness || EMPTY_READINESS;
  const digestForDisplay = snapshot.digest || null;
  const allAlerts = snapshot.alerts || [];
  const derived = {
    readiness,
    digestForDisplay,
    operationalSignals: snapshot.operationalSignals || EMPTY_SIGNALS,
    filteredAlerts: allAlerts.filter((row) => getAlertStatus(row) === alertFilter),
    openAlertCount: allAlerts.filter((row) => getAlertStatus(row) === 'open').length,
    publishingOps: digestForDisplay?.publishingOps || null,
    publishingWatchdog: digestForDisplay?.publishingWatchdog || null,
  };

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

  const ActivePanel = PANELS[activeTab];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Activity className="h-6 w-6" /> Health Hub
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          What the platform reports about itself, and the checks you can run against it from this
          session. The token behind those checks is decoded here and reduced to claim names; it is
          never displayed, and only the summary on the Report tab is copied.
        </p>
      </div>

      <HubTabs
        tabs={TABS}
        active={activeTab}
        onSelect={setTab}
        idPrefix="health"
        label="Health Hub"
      >
        <ActivePanel
          ops={ops}
          derived={derived}
          alerts={{
            filter: alertFilter,
            setFilter: setAlertFilter,
            actionId: alertActionId,
            resolutionNotes,
            setResolutionNotes,
            handleAction: handleAlertAction,
            message: alertMessage,
            error: alertError,
          }}
          smoke={smoke}
          identity={identity}
          identityRunning={identityRunning}
          rerunIdentity={rerunIdentity}
          labs={labs}
          probes={{ labs, labsBusy, runLabs, unauth, unauthBusy, runUnauth }}
          report={report}
          settling={settling}
          copyReport={copyReport}
        />
      </HubTabs>
    </div>
  );
}
