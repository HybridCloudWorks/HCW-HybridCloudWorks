/**
 * publishing-watchdog.js — `monitorPublishingPipeline`, every 6 hours.
 *
 * Ported from Site-Main index.js (088f458). Two stall signals: scheduled
 * content whose `scheduledPublishDate` passed more than 45 minutes ago and
 * is still not live, and content marked `published` that has sat non-live
 * for more than 6 hours with no schedule. Counts land in the day's digest;
 * any hit raises a `workflow_alerts` document keyed to the hour.
 */
import { digestDateOf, mergeDigest, raiseAlert, toMillis } from './workflow-records.js';

const STALE_SCHEDULED_MS = 45 * 60 * 1000;
const STAGED_TOO_LONG_MS = 6 * 60 * 60 * 1000;

export function createPublishingWatchdog({ store, now = () => new Date(), log = {} }) {
  async function run() {
    const at = now();
    const staleThreshold = new Date(at.getTime() - STALE_SCHEDULED_MS).toISOString();
    const stagedThresholdMs = at.getTime() - STAGED_TOO_LONG_MS;

    const overdue = await store.queryDocs(
      'content',
      'SELECT TOP 100 c.id FROM c WHERE c.Live = false AND IS_DEFINED(c.scheduledPublishDate) AND c.scheduledPublishDate != null AND c.scheduledPublishDate <= @threshold',
      [{ name: '@threshold', value: staleThreshold }]
    );
    const nonLive = await store.queryDocs(
      'content',
      'SELECT TOP 250 c.id, c.contentStatus, c.scheduledPublishDate, c.publishedAt, c.reviewedAt, c.updatedAt FROM c WHERE c.Live = false',
      []
    );
    const stagedTooLong = (nonLive || []).filter((data) => {
      if (data.contentStatus !== 'published') return false;
      if (data.scheduledPublishDate) return false;
      const tsMs = toMillis(data.publishedAt || data.reviewedAt || data.updatedAt || null);
      return tsMs > 0 && tsMs <= stagedThresholdMs;
    });

    const overdueCount = (overdue || []).length;
    await mergeDigest(store, digestDateOf(at), {
      publishingWatchdog: {
        lastRunAt: at.toISOString(),
        overdueScheduledCount: overdueCount,
        stagedTooLongCount: stagedTooLong.length,
      },
    });

    if (overdueCount > 0 || stagedTooLong.length > 0) {
      await raiseAlert(
        store,
        `publishing-watchdog-${at.toISOString().slice(0, 13)}`,
        {
          alertType: 'publishing_pipeline_stalled_items',
          severity: overdueCount > 0 ? 'critical' : 'warning',
          overdueScheduledCount: overdueCount,
          stagedTooLongCount: stagedTooLong.length,
          sampleOverdueIds: (overdue || []).slice(0, 10).map((d) => d.id),
          sampleStagedIds: stagedTooLong.slice(0, 10).map((d) => d.id),
          source: 'monitorPublishingPipeline',
        },
        now
      );
      log.warn?.(
        `[monitorPublishingPipeline] Alerts raised: overdueScheduled=${overdueCount}, stagedTooLong=${stagedTooLong.length}`
      );
    } else {
      log.log?.('[monitorPublishingPipeline] Pipeline healthy: no stalled content detected');
    }
    return { overdueScheduledCount: overdueCount, stagedTooLongCount: stagedTooLong.length };
  }
  return { run };
}
