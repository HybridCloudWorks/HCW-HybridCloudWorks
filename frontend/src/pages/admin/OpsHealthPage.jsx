import React, { useEffect, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { postJSON } from '@/lib/api';
import { runJob } from '@/lib/jobs';
import {
  FileText,
  Play,
  Wrench,
  Workflow,
  AlertTriangle,
  CheckCircle2,
  Info,
  ExternalLink,
} from 'lucide-react';

const ALERT_FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
];

const REPO_URL = 'https://github.com/saulpatinojr/Personal-Site_HCW';

const ROADMAP_CHECKS = [
  {
    id: 'cost-checkpoint',
    title: 'AI Audit Stage 7 cost checkpoint',
    status: 'Due now',
    variant: 'destructive',
    summary:
      'Pull the last 7 days of Vertex and Replicate billing and compare against the AI inventory projections.',
    docs: [
      { label: 'TODO', href: `${REPO_URL}/blob/main/TODO.md` },
      {
        label: 'AI inventory',
        href: `${REPO_URL}/blob/main/documentation/ai-integration-inventory.md`,
      },
    ],
  },
  {
    id: 'database-phase-a',
    title: 'Database model convergence',
    status: 'Phase B in progress',
    variant: 'outline',
    summary:
      'Shared hooks and public pages now resolve content first; legacy blogs paths remain only where the toggle or rollback path explicitly needs them.',
    docs: [
      {
        label: 'Roadmap',
        href: `${REPO_URL}/blob/main/documentation/database-model-roadmap.md`,
      },
      {
        label: 'Rollback',
        href: `${REPO_URL}/blob/main/documentation/database-rollback-checklist.md`,
      },
    ],
  },
  {
    id: 'scrape-gate',
    title: 'Scraping fallback rollout gate',
    status: 'Benchmark first',
    variant: 'secondary',
    summary: 'Run the difficult-URL benchmark before any Cloud Run headless deployment is scoped.',
    docs: [
      {
        label: 'Upgrade plan',
        href: `${REPO_URL}/blob/main/documentation/pipeline-scraping-upgrade.md`,
      },
      {
        label: 'AI deploy guide',
        href: `${REPO_URL}/blob/main/documentation/pipeline-ai-deployment.md`,
      },
    ],
  },
  {
    id: 'ux-surface',
    title: 'Admin roadmap UX',
    status: 'Planned',
    variant: 'secondary',
    summary:
      'Expose roadmap readiness and validation status in the admin portal so it is visible without opening TODOs.',
    docs: [
      { label: 'TODO', href: `${REPO_URL}/blob/main/TODO.md` },
      { label: 'Ops health', href: `${REPO_URL}/blob/main/src/pages/admin/OpsHealthPage.jsx` },
    ],
  },
];

function formatTimestamp(value) {
  const date = value?.toDate?.() || null;
  if (!date) return 'Not available';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function getPublishingStatusBadgeVariant(status) {
  if (status === 'failed') return 'destructive';
  if (status === 'degraded') return 'outline';
  return 'secondary';
}

function getAlertActionLabel(action) {
  if (action === 'resolve') return 'Resolved';
  if (action === 'acknowledge') return 'Acknowledged';
  return 'Updated';
}

function getAlertStatus(alert) {
  return alert.status || (alert.active === false ? 'resolved' : 'open');
}

function getBadgeVariantByCount(count, positiveVariant) {
  if (count > 0) return positiveVariant;
  return 'secondary';
}

function getDigestDocLabel(digestDate) {
  if (!digestDate) return '';
  return ` (digest doc: ${digestDate})`;
}

function formatHours(value) {
  if (!value) return '0h';
  return `${value}h`;
}

function renderPublishingHint(publishingOps) {
  if (publishingOps) return null;
  return (
    <p className="text-xs text-muted-foreground pb-1">
      The scheduler runs every 15 minutes but only writes stats here when there is actual work to
      publish. Missing values means &quot;nothing was due since the last published run&quot; — see
      the Watchdog row below for live pipeline health.
    </p>
  );
}

const ACTION_CONFIG = {
  rss: {
    id: 'rss',
    title: 'RSS Fetch',
    subtitle: 'Pulls latest feed entries and creates new content candidates.',
    icon: Play,
    buttonLabel: 'Run Now',
    runningLabel: 'Fetching RSS...',
    details: 'Pulls the latest RSS feed entries and creates new content candidates for review.',
    // A platform job, not an RPC: the fetch takes minutes and Flex Consumption
    // cuts HTTP responses at 230 s (T-322). runJob enqueues and polls.
    runner: async () => {
      const job = await runJob('fetch-rss-feeds', {});
      if (job.status !== 'succeeded') {
        throw new Error(job.error || `RSS fetch ${job.status}`);
      }
      const r = job.result || {};
      const errors = r.errors?.length ? ` ${r.errors.length} feed(s) failed.` : '';
      return `RSS fetch complete: ${r.processed || 0} feeds, ${r.newContent || 0} new content drafts, ${r.duplicates || 0} duplicates skipped.${errors}`;
    },
  },
  inspect: {
    id: 'inspect',
    title: 'Batch Inspect',
    subtitle: 'Queues metadata inspection for recent ingested items.',
    icon: Wrench,
    buttonLabel: 'Run Now',
    runningLabel: 'Inspecting...',
    details:
      'Queues inspection for up to 10 ingested items so metadata is populated before review.',
    // A platform job (T-322): selects ingested documents and runs the inspector
    // on each — scrape, analyse, critique — instead of flagging them for a
    // trigger that does not exist on Azure yet (T-324).
    runner: async () => {
      const job = await runJob('batch-inspect', { limit: 10 });
      if (job.status !== 'succeeded') {
        throw new Error(job.error || `Inspection ${job.status}`);
      }
      const r = job.result || {};
      const rework = r.needsRework ? `, ${r.needsRework} need rework` : '';
      const failed = r.failed ? `, ${r.failed} failed` : '';
      return `Inspection complete: ${r.inspected || 0}/${r.total || 0} documents inspected${rework}${failed}.`;
    },
  },
  digest: {
    id: 'digest',
    title: 'Reviewer Digest',
    subtitle: 'Builds the reviewer summary from queued and recent RSS entries.',
    icon: FileText,
    buttonLabel: 'Run Now',
    runningLabel: 'Generating Digest...',
    details:
      'Generates digest metrics for reviewer operations. If Firestore reports index building, retry once the index status is Enabled.',
    runner: async () => {
      const result = await postJSON('generateReviewerDigestManual', {});
      return `Reviewer digest generated: ${result.totalQueued || 0} queued items, ${result.recentRssCount || 0} recent RSS entries.`;
    },
  },
};

function normalizeDigestError(message) {
  if (message.includes('FAILED_PRECONDITION') && message.toLowerCase().includes('index')) {
    return 'Reviewer digest index is still building in Firestore. Wait until status is Enabled, then retry S3.3.';
  }
  return message;
}

function ActionTile({ config, runningAction, actionInfoOpen, onRun, onToggleInfo }) {
  const Icon = config.icon;
  return (
    <div className="h-full rounded-lg border p-3 flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold">{config.title}</p>
        <p className="text-xs text-muted-foreground mt-1">{config.subtitle}</p>
      </div>
      {actionInfoOpen[config.id] && (
        <div className="rounded-md border border-slate-300/60 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
          {config.details}
        </div>
      )}
      <div className="mt-auto flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-1"
          onClick={() => onRun(config.id)}
          disabled={runningAction !== ''}
        >
          <Icon className="h-4 w-4" />
          {runningAction === config.id ? config.runningLabel : config.buttonLabel}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => onToggleInfo(config.id)}
          title="What this action does"
          aria-label={`Toggle ${config.title} explanation`}
        >
          <Info className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SmokeActionsCard({
  runningAction,
  actionInfoOpen,
  actionMessage,
  actionError,
  onRunAction,
  onToggleActionInfo,
}) {
  const actionList = [ACTION_CONFIG.rss, ACTION_CONFIG.inspect, ACTION_CONFIG.digest];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Workflow className="h-4 w-4 text-sky-500" /> Smoke Test Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {actionList.map((config) => (
            <ActionTile
              key={config.id}
              config={config}
              runningAction={runningAction}
              actionInfoOpen={actionInfoOpen}
              onRun={onRunAction}
              onToggleInfo={onToggleActionInfo}
            />
          ))}
        </div>
        {actionMessage && <p className="text-xs text-emerald-600">{actionMessage}</p>}
        {actionError && <p className="text-xs text-red-600">{actionError}</p>}
      </CardContent>
    </Card>
  );
}

function RoadmapReadinessCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Roadmap Readiness
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Current prep status for the next two roadmap tracks and the new admin UX surface.
        </p>
        <div className="space-y-3">
          {ROADMAP_CHECKS.map((item) => (
            <div key={item.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.summary}</p>
                </div>
                <Badge variant={item.variant}>{item.status}</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.docs.map((doc) => (
                  <a
                    key={doc.href}
                    href={doc.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-900/40 transition-colors"
                  >
                    {doc.label}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PipelineReadinessCard({ readiness, digestForDisplay }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Pipeline Readiness</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span>Functions URL</span>
          {readiness.functionsConfigured ? (
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Ready
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <AlertTriangle className="h-4 w-4" /> Missing
            </span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span>Published Entries</span>
          <Badge variant="outline">{readiness.publishedItems}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span>RSS-sourced Entries</span>
          <Badge variant="outline">{readiness.rssSources}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span>Missing Slug Signals</span>
          <Badge variant={readiness.missingSlugCount > 0 ? 'destructive' : 'secondary'}>
            {readiness.missingSlugCount}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span>Reviewer Digest</span>
          {digestForDisplay?.digestDate ? (
            <span className="text-xs text-right">
              <Badge variant="secondary">{digestForDisplay.digestDate}</Badge>
              <span className="block text-muted-foreground mt-0.5">
                {digestForDisplay.totalQueued ?? '—'} queued ·{' '}
                {digestForDisplay.recentRssCount ?? '—'} RSS
              </span>
            </span>
          ) : (
            <Badge variant="outline">Run digest action to generate</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PublishingOpsCard({ publishingOps, publishingWatchdog, digestForDisplay }) {
  const schedulerStatus = publishingOps?.status || 'Idle (no due items)';
  const schedulerVariant = getPublishingStatusBadgeVariant(publishingOps?.status);
  const metrics = {
    due: publishingOps?.due || 0,
    published: publishingOps?.published || 0,
    skipped: publishingOps?.skipped || 0,
    failed: publishingOps?.failed || 0,
    overdue: publishingWatchdog?.overdueScheduledCount || 0,
    stagedTooLong: publishingWatchdog?.stagedTooLongCount || 0,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Workflow className="h-4 w-4 text-sky-500" /> Publishing Operations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {renderPublishingHint(publishingOps)}
        <div className="flex items-center justify-between">
          <span>Scheduler Status</span>
          <Badge variant={schedulerVariant}>{schedulerStatus}</Badge>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 border rounded-lg">
            <p className="text-muted-foreground text-xs">Due</p>
            <p className="text-xl font-bold">{metrics.due}</p>
          </div>
          <div className="p-3 border rounded-lg">
            <p className="text-muted-foreground text-xs">Published</p>
            <p className="text-xl font-bold text-emerald-600">{metrics.published}</p>
          </div>
          <div className="p-3 border rounded-lg">
            <p className="text-muted-foreground text-xs">Skipped</p>
            <p className="text-xl font-bold text-amber-600">{metrics.skipped}</p>
          </div>
          <div className="p-3 border rounded-lg">
            <p className="text-muted-foreground text-xs">Failed</p>
            <p className="text-xl font-bold text-red-600">{metrics.failed}</p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span>Overdue Scheduled</span>
          <Badge variant={getBadgeVariantByCount(metrics.overdue, 'destructive')}>
            {metrics.overdue}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span>Staged Too Long</span>
          <Badge variant={getBadgeVariantByCount(metrics.stagedTooLong, 'outline')}>
            {metrics.stagedTooLong}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {/* publishingOps.lastRunAt only writes when there's real work; fall back to
              publishingWatchdog.lastRunAt (every 6h) as the live heartbeat. */}
          Last activity:{' '}
          {formatTimestamp(publishingOps?.lastRunAt || publishingWatchdog?.lastRunAt)}
          {getDigestDocLabel(digestForDisplay?.digestDate)}
        </p>
      </CardContent>
    </Card>
  );
}

function OperationalSignalsCard({ signals }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" /> Operational Signals
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 border rounded-lg">
            <p className="text-muted-foreground text-xs">Queue SLA Breaches</p>
            <p className="text-xl font-bold">{signals.queueBreachCount || 0}</p>
          </div>
          <div className="p-3 border rounded-lg">
            <p className="text-muted-foreground text-xs">Oldest Staged Age</p>
            <p className="text-xl font-bold">{formatHours(signals.oldestStagedHours)}</p>
          </div>
          <div className="p-3 border rounded-lg">
            <p className="text-muted-foreground text-xs">Open Alert Age</p>
            <p className="text-xl font-bold">{formatHours(signals.openAlertAgeHours)}</p>
          </div>
          <div className="p-3 border rounded-lg">
            <p className="text-muted-foreground text-xs">Orphaned Images</p>
            <p className="text-xl font-bold">{signals.orphanedGeneratedImages || 0}</p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span>Publish Failure Alerts</span>
          <Badge variant={getBadgeVariantByCount(signals.publishFailureCount || 0, 'destructive')}>
            {signals.publishFailureCount || 0}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span>Last Scheduler Success</span>
          <Badge variant="outline">{formatTimestamp(signals.lastSchedulerSuccessAt)}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function AlertRow({
  alert,
  alertActionId,
  resolutionNotes,
  setResolutionNotes,
  handleAlertAction,
}) {
  const status = getAlertStatus(alert);
  return (
    <div key={alert.id} className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{alert.alertType || 'workflow_alert'}</p>
          <p className="text-xs text-muted-foreground">
            {alert.source || 'unknown source'} ·{' '}
            {formatTimestamp(alert.updatedAt || alert.firstSeenAt)}
          </p>
        </div>
        <Badge variant={alert.severity === 'critical' ? 'destructive' : 'outline'}>
          {alert.severity || 'warning'}
        </Badge>
      </div>
      {status !== 'resolved' && (
        <div className="mt-3">
          <Input
            value={resolutionNotes[alert.id] || ''}
            onChange={(e) =>
              setResolutionNotes((prev) => ({ ...prev, [alert.id]: e.target.value }))
            }
            placeholder="Resolution note (required to resolve)"
          />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {status === 'open' && (
          <Button
            size="sm"
            variant="outline"
            disabled={alertActionId !== ''}
            onClick={() => handleAlertAction(alert.id, 'acknowledge')}
          >
            {alertActionId === `${alert.id}:acknowledge` ? 'Acknowledging...' : 'Acknowledge'}
          </Button>
        )}
        {status !== 'resolved' && (
          <Button
            size="sm"
            disabled={alertActionId !== ''}
            onClick={() => handleAlertAction(alert.id, 'resolve')}
          >
            {alertActionId === `${alert.id}:resolve` ? 'Resolving...' : 'Resolve'}
          </Button>
        )}
        {status === 'resolved' && (
          <Button
            size="sm"
            variant="outline"
            disabled={alertActionId !== ''}
            onClick={() => handleAlertAction(alert.id, 'reopen')}
          >
            {alertActionId === `${alert.id}:reopen` ? 'Reopening...' : 'Reopen'}
          </Button>
        )}
        <Badge variant="secondary">{status}</Badge>
      </div>
    </div>
  );
}

function WorkflowAlertsCard({
  alertFilter,
  setAlertFilter,
  filteredAlerts,
  alertActionId,
  resolutionNotes,
  setResolutionNotes,
  handleAlertAction,
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" /> Workflow Alerts
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-2">
          {ALERT_FILTERS.map((filter) => (
            <Button
              key={filter.value}
              size="sm"
              variant={alertFilter === filter.value ? 'default' : 'outline'}
              onClick={() => setAlertFilter(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        {filteredAlerts.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4" /> No alerts in this filter.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAlerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                alertActionId={alertActionId}
                resolutionNotes={resolutionNotes}
                setResolutionNotes={setResolutionNotes}
                handleAlertAction={handleAlertAction}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function OpsHealthPage() {
  const { authReady } = useAuthReady();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [snapshot, setSnapshot] = useState({ readiness: null, digest: null, alerts: [] });

  const [runningAction, setRunningAction] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionInfoOpen, setActionInfoOpen] = useState({
    rss: false,
    inspect: false,
    digest: false,
  });
  const [alertActionId, setAlertActionId] = useState('');
  const [alertFilter, setAlertFilter] = useState('open');
  const [resolutionNotes, setResolutionNotes] = useState({});

  const refreshSnapshot = async () => {
    const latest = await postJSON('getOpsHealthSnapshot', {});
    setSnapshot(latest);
  };

  useEffect(() => {
    if (!authReady) return;
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
  const filteredAlerts = (snapshot.alerts || []).filter(
    (row) => getAlertStatus(row) === alertFilter
  );
  const publishingOps = digestForDisplay?.publishingOps || null;
  const publishingWatchdog = digestForDisplay?.publishingWatchdog || null;

  const runAction = async (actionId) => {
    const config = ACTION_CONFIG[actionId];
    if (!config) return;
    setActionError('');
    setActionMessage('');
    setRunningAction(actionId);
    try {
      const nextMessage = await config.runner();
      await refreshSnapshot();
      setActionMessage(nextMessage);
    } catch (error) {
      const rawMessage = error.message || `Failed to run ${config.title}.`;
      setActionError(actionId === 'digest' ? normalizeDigestError(rawMessage) : rawMessage);
    } finally {
      setRunningAction('');
    }
  };

  const handleAlertAction = async (alertId, action) => {
    setActionError('');
    setActionMessage('');
    setAlertActionId(`${alertId}:${action}`);
    try {
      const resolutionNote = resolutionNotes[alertId] || '';
      await postJSON('updateWorkflowAlert', { alertId, action, resolutionNote });
      await refreshSnapshot();
      if (action === 'resolve') {
        setResolutionNotes((prev) => ({ ...prev, [alertId]: '' }));
      }
      setActionMessage(`${getAlertActionLabel(action)} alert ${alertId}.`);
    } catch (error) {
      setActionError(error.message || `Failed to ${action} alert.`);
    } finally {
      setAlertActionId('');
    }
  };

  const toggleActionInfo = (key) => {
    setActionInfoOpen((prev) => ({ ...prev, [key]: !prev[key] }));
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Operations Health</h1>
        <p className="text-muted-foreground">
          Behind-the-scenes controls and diagnostics for smoke testing and platform health.
        </p>
        {loadError && <p className="text-sm text-destructive mt-1">{loadError}</p>}
      </div>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SmokeActionsCard
          runningAction={runningAction}
          actionInfoOpen={actionInfoOpen}
          actionMessage={actionMessage}
          actionError={actionError}
          onRunAction={runAction}
          onToggleActionInfo={toggleActionInfo}
        />

        <PipelineReadinessCard readiness={readiness} digestForDisplay={digestForDisplay} />
      </section>

      <section className="grid grid-cols-1 gap-4">
        <RoadmapReadinessCard />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PublishingOpsCard
          publishingOps={publishingOps}
          publishingWatchdog={publishingWatchdog}
          digestForDisplay={digestForDisplay}
        />

        <OperationalSignalsCard signals={operationalSignals} />
      </section>

      <section className="grid grid-cols-1 gap-4">
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
    </div>
  );
}
