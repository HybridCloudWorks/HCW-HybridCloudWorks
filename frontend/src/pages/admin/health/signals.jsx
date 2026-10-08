/**
 * What is true now — the estate reporting on itself.
 *
 * Everything here comes from one authenticated read of `getOpsHealthSnapshot`.
 * Nothing in this file asks a question; it renders answers the platform has
 * already written down, from timers and schedulers that ran without anyone
 * watching. That is the distinction the Health page is organised around, and
 * it is why the probes live in a different file: those need the admin's own
 * session and only exist while someone is pressing the button.
 *
 * The one action here is the alert workflow — acknowledge, resolve, reopen —
 * because an alert is a live signal you answer in place, not a check you run.
 */

import React from 'react';
import { Link } from 'react-router';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import useLinkedItem from '@/hooks/useLinkedItem';
import { LINK_PARAMS } from '@/lib/itemLinks';
import { AlertTriangle, CheckCircle2, Workflow } from 'lucide-react';

export const ALERT_FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
];

/**
 * A Cosmos timestamp is an ISO string; a migrated one may still be a
 * Firestore-shaped `{ toDate }` or `{ seconds }`. Until 2026-10-03 only the
 * first shape was read, so every time on this page said "Not available"
 * (ADR 0033 §1 Platform).
 */
export function formatTimestamp(value) {
  let date = null;
  if (typeof value?.toDate === 'function') date = value.toDate();
  else if (value && typeof value === 'object' && typeof value.seconds === 'number')
    date = new Date(value.seconds * 1000);
  else if (typeof value === 'string' || typeof value === 'number') date = new Date(value);
  if (!date || Number.isNaN(date.getTime())) return 'Not available';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/**
 * Every Overview card ends the same way (ADR 0033 §1 Platform): when the
 * block it shows was read, and where its probes, impacts and fixes live.
 */
export function CheckedFooter({ at, probeLabel }) {
  return (
    <p className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
      <span>Checked {formatTimestamp(at)}</span>
      <Link
        to="/admin/health?tab=checks"
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        {probeLabel ?? 'Impact, fixes and tests on Checks'}
      </Link>
    </p>
  );
}

/** The one word for the runtime-configuration readiness (ADR 0033). */
export function readinessStatus(readiness) {
  if (!readiness) return 'unknown';
  if (readiness.functionsConfigured) return 'healthy';
  if ((readiness.unresolvedSecrets?.length ?? 0) > 0) return 'misconfigured';
  return 'unavailable';
}

/** A count that is fine at zero and worth a look above it. */
const countStatus = (count, above = 'degraded') => ((Number(count) || 0) > 0 ? above : 'healthy');

export function getAlertActionLabel(action) {
  if (action === 'resolve') return 'Resolved';
  if (action === 'acknowledge') return 'Acknowledged';
  return 'Updated';
}

export function getAlertStatus(alert) {
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

export function PipelineReadinessCard({ readiness, digestForDisplay }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Pipeline Readiness</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span>Runtime config</span>
          <span className="flex items-center gap-2 text-right">
            {readiness.configGeneration ? (
              <span className="text-xs text-muted-foreground">
                {readiness.configGeneration} · {readiness.configWriter}
              </span>
            ) : null}
            <StatusBadge system={readinessStatus(readiness)} />
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Unresolved Key Vault references</span>
          <span className="flex items-center gap-2 text-right text-xs">
            {readiness.unresolvedSecrets?.length ? (
              <span className="font-mono text-muted-foreground">
                {readiness.unresolvedSecrets.join(', ')}
              </span>
            ) : null}
            <Badge variant={readiness.unresolvedSecrets?.length ? 'destructive' : 'secondary'}>
              {readiness.unresolvedSecrets?.length ?? 0}
            </Badge>
          </span>
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
        <CheckedFooter at={readiness.lastCheckedAt} />
      </CardContent>
    </Card>
  );
}

/** The six counters the publishing card shows, zero where a block is absent. */
export function publishingMetrics(publishingOps, publishingWatchdog) {
  return {
    due: publishingOps?.due || 0,
    published: publishingOps?.published || 0,
    skipped: publishingOps?.skipped || 0,
    failed: publishingOps?.failed || 0,
    overdue: publishingWatchdog?.overdueScheduledCount || 0,
    stagedTooLong: publishingWatchdog?.stagedTooLongCount || 0,
  };
}

export function PublishingOpsCard({ publishingOps, publishingWatchdog, digestForDisplay }) {
  const metrics = publishingMetrics(publishingOps, publishingWatchdog);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Workflow className="h-4 w-4 text-sky-500" /> Publishing Operations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {renderPublishingHint(publishingOps)}
        <div className="flex items-center justify-between gap-3">
          <span>Scheduler Status</span>
          <span className="flex items-center gap-2">
            {!publishingOps ? (
              <span className="text-xs text-muted-foreground">Idle (no due items)</span>
            ) : null}
            <StatusBadge system={publishingOps?.status ?? 'unknown'} />
          </span>
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
        <CheckedFooter at={digestForDisplay?.lastCheckedAt} />
      </CardContent>
    </Card>
  );
}

export function OperationalSignalsCard({ signals }) {
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
            <StatusBadge system={countStatus(signals.queueBreachCount)} size="xs" />
          </div>
          <div className="p-3 border rounded-lg">
            <p className="text-muted-foreground text-xs">Oldest Staged Age</p>
            <p className="text-xl font-bold">{formatHours(signals.oldestStagedHours)}</p>
            <StatusBadge
              system={(signals.oldestStagedHours || 0) > 72 ? 'degraded' : 'healthy'}
              size="xs"
            />
          </div>
          <div className="p-3 border rounded-lg">
            <p className="text-muted-foreground text-xs">Open Alert Age</p>
            <p className="text-xl font-bold">{formatHours(signals.openAlertAgeHours)}</p>
            <StatusBadge
              system={(signals.openAlertAgeHours || 0) > 24 ? 'degraded' : 'healthy'}
              size="xs"
            />
          </div>
          <div className="p-3 border rounded-lg">
            <p className="text-muted-foreground text-xs">Orphaned Images</p>
            <p className="text-xl font-bold">{signals.orphanedGeneratedImages || 0}</p>
            <StatusBadge system={countStatus(signals.orphanedGeneratedImages)} size="xs" />
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
        <CheckedFooter at={signals.lastCheckedAt} />
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
  // `?alert=<id>` (the dashboard's Decision Center) scrolls to this alert and rings it.
  const { ref, linkedProps, linkedClassName } = useLinkedItem(LINK_PARAMS.alert, alert.id);
  return (
    <div
      key={alert.id}
      ref={ref}
      {...linkedProps}
      className={`rounded-lg border p-3 ${linkedClassName}`}
    >
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

export function WorkflowAlertsCard({
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
