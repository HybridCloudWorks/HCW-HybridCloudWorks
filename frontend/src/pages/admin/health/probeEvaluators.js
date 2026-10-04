/**
 * The pure evaluators behind the snapshot and session probes (ADR 0033 §1
 * Platform, §8). Each takes the page's context — the ops-health snapshot, the
 * identity check, the Labs probes, the smoke-test runs — and returns one
 * result in lib/status.js's vocabulary. No request is made here; that is
 * probeRunners.js.
 */
import {
  evaluateIdentity,
  evaluateLabsProbe,
  evaluateUnauthenticatedProbe,
  verdictStatus,
} from './probes';
import { ago, plural, result, snapshotMissing, stamp } from './probeKit';

// ── Snapshot evaluators ──────────────────────────────────────────────────────

export function evaluateCosmos(ctx) {
  if (ctx?.ops?.loaded && ctx.snapshot) {
    return result('healthy', 'Cosmos DB answered the ten-query ops snapshot.', {
      checkedAt: ctx.snapshot.lastCheckedAt ?? ctx.snapshot.generatedAt ?? stamp(),
    });
  }
  return snapshotMissing(ctx);
}

export function evaluateRuntimeConfig(ctx) {
  const readiness = ctx?.snapshot?.readiness;
  if (!readiness) return snapshotMissing(ctx);
  const unresolved = Array.isArray(readiness.unresolvedSecrets) ? readiness.unresolvedSecrets : [];
  const checkedAt = readiness.lastCheckedAt ?? stamp();
  if (readiness.configGeneration === 'unset') {
    return result(
      'unavailable',
      'The runtime configuration stamp never reached this worker, so its app settings may be stale.',
      { checkedAt }
    );
  }
  if (unresolved.length > 0) {
    return result(
      'misconfigured',
      `${plural(unresolved.length, 'Key Vault reference')} did not resolve: ${unresolved.join(', ')}.`,
      {
        checkedAt,
        detail: `Generation ${readiness.configGeneration} by ${readiness.configWriter}.`,
      }
    );
  }
  return result(
    'healthy',
    `Configuration generation ${readiness.configGeneration ?? 'unknown'} (${readiness.configWriter ?? 'unknown writer'}); every Key Vault reference resolved.`,
    { checkedAt }
  );
}

/** The scheduler has written no run: idle, unless the watchdog says items are overdue. */
function idleSchedulerVerdict(overdue, when, checkedAt) {
  if (overdue > 0) {
    return result(
      'degraded',
      `${plural(overdue, 'scheduled item')} overdue and the scheduler has written no run.${when}`,
      { checkedAt }
    );
  }
  return result('unknown', `Idle: nothing was due since the last published run.${when}`, {
    checkedAt,
  });
}

/** The scheduler's last run, judged by its status and the watchdog's overdue count. */
function schedulerRunVerdict(ops, overdue, when, checkedAt) {
  const counts = `${ops.published ?? 0} published, ${ops.skipped ?? 0} skipped, ${ops.failed ?? 0} failed of ${ops.due ?? 0} due.`;
  if (ops.status === 'failed') {
    return result('unavailable', `The last run failed. ${counts}${when}`, { checkedAt });
  }
  if (ops.status === 'degraded' || overdue > 0) {
    const overdueNote = overdue > 0 ? `${plural(overdue, 'item')} overdue. ` : '';
    return result('degraded', `${overdueNote}${counts}${when}`, { checkedAt });
  }
  return result('healthy', `${counts}${when}`, { checkedAt });
}

export function evaluateScheduledPublishing(ctx) {
  const digest = ctx?.snapshot?.digest;
  if (!ctx?.snapshot?.readiness) return snapshotMissing(ctx);
  const ops = digest?.publishingOps;
  const watchdog = digest?.publishingWatchdog;
  const overdue = Number(watchdog?.overdueScheduledCount) || 0;
  const checkedAt = digest?.lastCheckedAt ?? ctx.snapshot.lastCheckedAt ?? stamp();
  const lastRun = ops?.lastRunAt || watchdog?.lastRunAt;
  const when = lastRun ? ` Last activity ${ago(lastRun) ?? 'at an unknown time'}.` : '';
  return ops
    ? schedulerRunVerdict(ops, overdue, when, checkedAt)
    : idleSchedulerVerdict(overdue, when, checkedAt);
}

const countProbe =
  (pick, { zero, some, badStatus = 'degraded' }) =>
  (ctx) => {
    const signals = ctx?.snapshot?.operationalSignals;
    if (!signals) return snapshotMissing(ctx);
    const count = Number(pick(signals)) || 0;
    const checkedAt = signals.lastCheckedAt ?? stamp();
    return count === 0
      ? result('healthy', zero, { checkedAt })
      : result(badStatus, some(count, signals), { checkedAt });
  };

export const evaluatePublishingFailures = countProbe((s) => s.publishFailureCount, {
  zero: 'No open publish-failure alerts.',
  some: (n) => `${plural(n, 'open publish-failure alert')}.`,
});

export const evaluateQueueSla = countProbe((s) => s.queueBreachCount, {
  zero: 'Nothing has waited in the review queue for more than 24 hours.',
  some: (n, s) =>
    `${plural(n, 'item')} waiting more than 24 hours; the oldest staged item is ${s.oldestStagedHours ?? 0} h old.`,
});

export const evaluateOrphanedImages = countProbe((s) => s.orphanedGeneratedImages, {
  zero: 'Every generated image belongs to a content document that exists.',
  some: (n) => `${plural(n, 'generated image')} point at content that no longer exists.`,
});

/** A snapshot block that may be absent on an older snapshot: unknown then, not missing. */
const blockMissing = (ctx, note) =>
  ctx?.snapshot?.readiness ? result('unknown', note) : snapshotMissing(ctx);

export function evaluateStorage(ctx) {
  const storage = ctx?.snapshot?.storage;
  if (!storage) return blockMissing(ctx, 'This snapshot carries no storage figures.');
  const floor = storage.bounded ? 'at least ' : '';
  return result(
    'healthy',
    `${floor}${plural(storage.generatedImages ?? 0, 'generated image row')} in Cosmos.`,
    {
      checkedAt: storage.lastCheckedAt ?? stamp(),
      detail: 'Blob byte counts are not read here: there is no cheap count route.',
    }
  );
}

export function evaluateLinkRot(ctx) {
  if (!ctx?.snapshot?.readiness) return snapshotMissing(ctx);
  const rot = ctx.snapshot.digest?.linkRot;
  if (!rot)
    return result('unknown', 'The weekly link check has not written a result to this digest yet.');
  const checkedAt = rot.lastRunAt ?? ctx.snapshot.digest?.lastCheckedAt ?? stamp();
  if ((rot.broken ?? 0) === 0) {
    return result(
      'healthy',
      `All ${rot.checked ?? 0} live links answered on the last weekly check.`,
      { checkedAt }
    );
  }
  const sample = (rot.sampleBroken ?? []).slice(0, 5).map((row) => `${row.url} (${row.status})`);
  return result('degraded', `${rot.broken} of ${rot.checked} live links are broken.`, {
    checkedAt,
    detail: sample.length ? sample.join('\n') : undefined,
  });
}

export function evaluateForge(ctx) {
  const forge = ctx?.snapshot?.forge;
  if (!forge) return blockMissing(ctx, 'This snapshot carries no forge statistics.');
  if (!forge.updatedAt) return result('unknown', 'The scheduled forge has never recorded a run.');
  return result(
    'healthy',
    `${plural(forge.forgedToday ?? 0, 'item')} forged on ${forge.todayDate ?? 'today'}; last activity ${ago(forge.updatedAt) ?? 'at an unknown time'}.`,
    {
      checkedAt: forge.lastCheckedAt ?? stamp(),
    }
  );
}

export function evaluateTelegramNotify(ctx) {
  const state = ctx?.snapshot?.telegramNotifyState;
  if (!state) return snapshotMissing(ctx);
  const sources = Object.entries(state)
    .filter(([key, value]) => key !== 'id' && key !== 'lastCheckedAt' && value?.lastNotifiedAt)
    .sort((a, b) => Date.parse(b[1].lastNotifiedAt) - Date.parse(a[1].lastNotifiedAt));
  const checkedAt = state.lastCheckedAt ?? stamp();
  if (sources.length === 0) {
    return result('unknown', 'No Telegram notice has been recorded as sent yet.', { checkedAt });
  }
  const [[source, { lastNotifiedAt }]] = sources;
  return result(
    'healthy',
    `Last notice ${ago(lastNotifiedAt) ?? 'at an unknown time'} (${source}); ${plural(sources.length, 'source')} have notified.`,
    {
      checkedAt,
    }
  );
}

// ── Session evaluators ───────────────────────────────────────────────────────

export function evaluateIdentitySession(ctx) {
  if (!ctx?.identity) return result('unknown', 'Reading the session…');
  const verdict = evaluateIdentity(ctx.identity.token, ctx.identity.admin);
  return result(verdictStatus(verdict.pass), verdict.reason);
}

export function evaluateRegistrySession(ctx) {
  if (!ctx?.identity) return result('unknown', 'Reading the session…');
  const { admin, adminError, adminHttp } = ctx.identity;
  if (!admin) return result('unavailable', adminError || 'getCurrentAdminStatus did not answer.');
  if (!admin.isAdmin)
    return result(
      'unavailable',
      `HTTP ${adminHttp}: the registry does not list this principal as an admin.`
    );
  if (admin.uidMatchesToken === false)
    return result('unavailable', 'The registry row is keyed on a different principal.');
  return result(
    'healthy',
    `HTTP ${adminHttp}: admin, role ${admin.role ?? 'unset'}, ${admin.active ? 'active' : 'inactive'}.`
  );
}

export function evaluateLabsSession(ctx) {
  const verdict = evaluateLabsProbe(ctx?.labs);
  return result(verdictStatus(verdict.pass), verdict.reason);
}

export function evaluateUnauthSession(ctx) {
  const verdict = evaluateUnauthenticatedProbe(ctx?.unauth);
  return result(verdictStatus(verdict.pass), verdict.reason);
}

/** A smoke test's last run in this session, or the idle line when it has not run. */
export const smokeEvaluator = (actionId, idle) => (ctx) => {
  const run = ctx?.smoke?.lastRuns?.[actionId];
  if (!run) return result('unknown', idle);
  return result(run.ok ? 'healthy' : 'unavailable', run.message, { checkedAt: run.at });
};
