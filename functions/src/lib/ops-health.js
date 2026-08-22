/**
 * Ops-health RPCs — getOpsHealthSnapshot (the 10-query operations
 * aggregation, source buildOpsHealthSnapshot :6470-6597) and
 * updateWorkflowAlert (:5907-6037), acknowledge/resolve/reopen with the
 * audit row.
 *
 * Cosmos adaptations, each deliberate:
 *   - count() -> SELECT VALUE COUNT(1); where-in -> ARRAY_CONTAINS; the
 *     queue-breach cutoff compares c.fetchedAt < @cutoff as ISO strings
 *     (migrated timestamps are ISO; docs missing fetchedAt are excluded,
 *     matching the Firestore composite-index semantics).
 *   - "Latest digest ordered by document ID" survives directly: the digest
 *     id IS the YYYY-MM-DD date, and ORDER BY c.id works on every doc (the
 *     source comment records why ordering by the digestDate FIELD was a bug —
 *     most writers never set it and Firestore hid those docs).
 *   - Alerts/staged sort in memory on updatedAt (the missing-property
 *     ORDER BY trap, as everywhere in this port).
 *   - Orphan probes point-read content/{id} per generated image, exactly the
 *     source's exists() probe strategy, with the image fetch bounded.
 *   - workflow_alert 'reopen' writes explicit nulls (resolvedAt/By,
 *     resolutionNote), matching Firestore .update(null) semantics — patchDoc
 *     stores null; `undefined` deletion is NOT used here on purpose.
 */
import { randomUUID } from 'node:crypto';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function toHoursSince(value, nowMs) {
  const ts = toMillis(value);
  if (!ts) return null;
  return Math.max(0, Math.round(((nowMs - ts) / (1000 * 60 * 60)) * 10) / 10);
}

export function getWorkflowAlertStatus(alert = {}) {
  return alert.status || (alert.active === false ? 'resolved' : 'open');
}

/** Per-action update payload for a workflow_alert doc (source :5907). */
export function buildWorkflowAlertUpdates({
  action,
  nowIso,
  actor,
  normalizedResolutionNote,
  alertData,
}) {
  const updates = { updatedAt: nowIso, updatedBy: actor };
  if (action === 'acknowledge') {
    updates.acknowledgedAt = nowIso;
    updates.acknowledgedBy = actor;
    updates.status = 'acknowledged';
  } else if (action === 'resolve') {
    updates.active = false;
    updates.resolvedAt = nowIso;
    updates.resolvedBy = actor;
    updates.status = 'resolved';
    updates.resolutionNote = normalizedResolutionNote;
    // Cleared on resolve so the alert's next activation announces again
    // (lib/triggers/activation-notice.js).
    updates.activationNotifiedAt = null;
    if (!alertData?.acknowledgedAt) {
      updates.acknowledgedAt = nowIso;
      updates.acknowledgedBy = actor;
    }
  } else if (action === 'reopen') {
    updates.active = true;
    updates.status = 'open';
    updates.resolvedAt = null;
    updates.resolvedBy = null;
    updates.resolutionNote = null;
    // Reopen must announce: cleared in the same write that sets active.
    updates.activationNotifiedAt = null;
  }
  return updates;
}

const IMAGES_PROBE_BOUND = 2000;

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function, patchDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createOpsHealthHandlers({
  guard,
  store,
  now = () => new Date(),
  uuid = randomUUID,
}) {
  const count = async (where, params = []) => {
    const rows = await store.queryDocs(
      'content',
      `SELECT VALUE COUNT(1) FROM c WHERE ${where}`,
      params
    );
    return Number(rows[0]) || 0;
  };

  /** Source buildOpsHealthSnapshot, query-for-query. */
  async function buildSnapshot() {
    const nowDate = now();
    const digestDate = nowDate.toISOString().slice(0, 10);
    const nowMs = nowDate.getTime();
    const breachCutoffIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();

    const needsReviewIn = { name: '@nrStatuses', value: ['draft', 'ingested', 'inspected'] };
    const stagedIn = { name: '@stagedStatuses', value: ['approved', 'published'] };

    const [
      publishedCount,
      publishedSlim,
      rssCount,
      queueBreachCount,
      stagedRows,
      digestDoc,
      latestDigestRows,
      alertRows,
      generatedImages,
      notifyState,
    ] = await Promise.all([
      count("c.contentStatus = 'published'"),
      store.queryDocs(
        'content',
        `SELECT TOP 200 c.id, c["slug"], c["Slug"] FROM c WHERE c.contentStatus = 'published'`,
        []
      ),
      count("c.source = 'rss'"),
      count('ARRAY_CONTAINS(@nrStatuses, c.contentStatus) AND c.fetchedAt < @cutoff', [
        needsReviewIn,
        { name: '@cutoff', value: breachCutoffIso },
      ]),
      store.queryDocs(
        'content',
        'SELECT TOP 50 c.id, c["contentStatus"], c["Live"], c["updatedAt"], c["reviewedAt"], c["fetchedAt"] FROM c WHERE ARRAY_CONTAINS(@stagedStatuses, c.contentStatus)',
        [stagedIn]
      ),
      store.readDoc('workflow_digests', digestDate, digestDate),
      // The digest id IS the date — ORDER BY c.id is exactly the source fix.
      store.queryDocs('workflow_digests', 'SELECT TOP 1 * FROM c ORDER BY c.id DESC', []),
      store.queryDocs('workflow_alerts', 'SELECT TOP 100 * FROM c', []),
      store.queryDocs(
        'generated_content_images',
        `SELECT TOP ${IMAGES_PROBE_BOUND} c.id, c["contentId"], c["sourceCollection"] FROM c`,
        []
      ),
      store.readDoc('system', 'notify_state', 'notify_state'),
    ]);

    const alerts = [...alertRows]
      .sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt))
      .slice(0, 20);

    const missingSlugCount = publishedSlim.filter((d) => !d.slug && !d.Slug).length;
    const readiness = {
      functionsConfigured: true,
      publishedItems: publishedCount,
      missingSlugCount,
      rssSources: rssCount,
    };

    const digestData = digestDoc || latestDigestRows[0] || null;

    const stagedHours = stagedRows
      .filter((item) => item.Live !== true)
      .map((item) => toHoursSince(item.updatedAt || item.reviewedAt || item.fetchedAt, nowMs))
      .filter((value) => value !== null);
    const openAlerts = alerts.filter((alert) => getWorkflowAlertStatus(alert) !== 'resolved');
    const openAlertHours = openAlerts
      .map((alert) => toHoursSince(alert.updatedAt || alert.firstSeenAt, nowMs))
      .filter((value) => value !== null);
    const publishFailureCount = alerts.filter(
      (alert) =>
        alert.alertType === 'scheduled_publish_failures' &&
        getWorkflowAlertStatus(alert) !== 'resolved'
    ).length;

    // Orphan detection: probe content existence per image (source strategy).
    const orphanProbes = await Promise.all(
      generatedImages.map(async (image) => {
        const contentId = String(image.contentId || '').trim();
        if (!contentId) return 1; // orphan: no contentId
        const ref = await store.readDoc('content', contentId, contentId);
        return ref ? 0 : 1;
      })
    );
    const orphanedGeneratedImages = orphanProbes.reduce((sum, v) => sum + v, 0);

    const operationalSignals = {
      queueBreachCount,
      oldestStagedHours: stagedHours.length > 0 ? Math.max(...stagedHours) : 0,
      openAlertAgeHours: openAlertHours.length > 0 ? Math.max(...openAlertHours) : 0,
      publishFailureCount,
      orphanedGeneratedImages,
      lastSchedulerSuccessAt:
        digestData?.publishingOps?.status === 'success'
          ? (digestData?.publishingOps?.lastRunAt ?? null)
          : null,
    };

    return {
      success: true,
      generatedAt: nowDate.toISOString(),
      readiness,
      digest: digestData,
      alerts,
      operationalSignals,
      telegramNotifyState: notifyState || {},
    };
  }

  return {
    /**
     * The snapshot itself, unguarded.
     *
     * `getOpsHealthSnapshot` is the HTTP face of this and checks a role first.
     * The Telegram bot (lib/telegram/bot.js) is not a user and carries no
     * token — it is authorized by the webhook secret and the chat id before it
     * ever gets here — so it needs the data without the role check. Exposing
     * the builder is the honest way to say that; the alternative is a fake
     * request object carrying a fake identity through requireRole.
     */
    buildSnapshot,

    /** POST /api/getOpsHealthSnapshot */
    async getOpsHealthSnapshot(request, context) {
      const auth = await guard.requireRole(request, 'viewer');
      if (auth.error) return auth.error;
      try {
        return json(200, await buildSnapshot());
      } catch (error) {
        context.error('getOpsHealthSnapshot failed:', error);
        return json(500, {
          error: 'Failed to generate operations health snapshot',
          message: error?.message || 'Unknown error',
        });
      }
    },

    /** POST|PATCH /api/updateWorkflowAlert — acknowledge/resolve/reopen. */
    async updateWorkflowAlert(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { alertId, action, resolutionNote = '' } = body;
        const normalizedResolutionNote = String(resolutionNote || '').trim();
        if (!alertId || !action) {
          return json(400, { error: 'alertId and action required' });
        }
        if (!['acknowledge', 'resolve', 'reopen'].includes(action)) {
          return json(400, {
            error: 'Invalid action',
            validActions: ['acknowledge', 'resolve', 'reopen'],
          });
        }
        if (action === 'resolve' && !normalizedResolutionNote) {
          return json(400, { error: 'resolutionNote is required when resolving an alert' });
        }

        const alertData = await store.readDoc('workflow_alerts', alertId, alertId);
        if (!alertData) {
          return json(404, { error: `workflow_alert ${alertId} not found` });
        }

        const { user } = auth;
        const nowIso = now().toISOString();
        const actor = user.email || user.preferred_username || user.oid || 'admin';
        const updates = buildWorkflowAlertUpdates({
          action,
          nowIso,
          actor,
          normalizedResolutionNote,
          alertData,
        });

        await store.patchDoc('workflow_alerts', alertId, updates);

        await store.upsertDoc('audits', {
          id: uuid(),
          timestamp: nowIso,
          action: `workflow_alert_${action}`,
          resourceType: 'workflow_alert',
          resourceId: alertId,
          resourceTitle: alertData?.alertType || 'workflow_alert',
          userId: user.oid ?? user.sub ?? actor,
          userName: user.name || null,
          userEmail: user.email || null,
          changes: {
            before: { active: alertData?.active ?? true, status: alertData?.status || 'open' },
            after: updates,
            changedFields: Object.keys(updates),
            notes: normalizedResolutionNote,
          },
          ipAddress: null, // see content-update.js — no trustworthy source yet
          userAgent: request.headers?.get?.('user-agent') || null,
          metadata: { authMethod: 'entra_bearer_token', alertType: alertData?.alertType || null },
          compliance: {
            dataClassification: 'internal',
            retentionMonths: 24,
            identityVerified: true,
          },
        });

        return json(200, { success: true, alertId, action });
      } catch (error) {
        context.error('updateWorkflowAlert failed:', error);
        return json(500, {
          error: 'Failed to update workflow alert',
          message: error?.message || 'Unknown error',
        });
      }
    },
  };
}
