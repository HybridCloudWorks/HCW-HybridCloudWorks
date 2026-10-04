/**
 * "Forge Selected" (Blog Machine T-603): enqueue the checked documents in
 * ≤FORGE_MAX_BATCH chunks and let the pipeline run under the job budget —
 * fire-and-forget like the Forge-from-URL box, because a forge run takes
 * minutes and its results land back in the queue as forge_ready/editing.
 * The pipeline's own gates (title dedupe 409, empty-source refusal) decide
 * per document; nothing is filtered here beyond "still on screen".
 *
 * Split out of useQueueActions (PR #841): the chunking loop and the two
 * messages are pure over the API, so they live beside the hook rather than
 * inside it.
 */
import { postJSON } from '@/lib/api';

/** Mirrors FORGE_MAX_BATCH in functions/src/functions/forge-jobs.js — the
 * job rejects a larger batch, so a bigger selection is chunked here. */
export const FORGE_MAX_BATCH = 10;

/**
 * Enqueue `ids` in chunks. A chunk the job refuses is recorded, not thrown,
 * so one bad batch does not stop the rest.
 * @returns {{ jobIds: string[], failures: { count: number, message: string }[] }}
 */
export async function enqueueForgeBatches(ids) {
  const jobIds = [];
  const failures = [];
  for (let start = 0; start < ids.length; start += FORGE_MAX_BATCH) {
    const chunk = ids.slice(start, start + FORGE_MAX_BATCH);
    try {
      const accepted = await postJSON('enqueueJob', {
        type: 'forge-article',
        payload: { sourceContentIds: chunk },
      });
      if (!accepted?.ok || !accepted.jobId) {
        throw new Error(accepted?.error || 'Job was not accepted');
      }
      jobIds.push(accepted.jobId);
    } catch (err) {
      failures.push({ count: chunk.length, message: err?.message || 'Unknown error' });
    }
  }
  return { jobIds, failures };
}

const failedCount = (failures) => failures.reduce((n, f) => n + f.count, 0);

/** The banner for a run that queued at least one job. */
export function forgeQueuedMessage(total, jobIds, failures) {
  return `Forge queued for ${total - failedCount(failures)} item${total === 1 ? '' : 's'} (job${jobIds.length === 1 ? '' : 's'} ${jobIds.join(', ')}). Results land back here as forge_ready or editing — refresh in a few minutes.`;
}

/** The error for the chunks the job refused, with the first reason. */
export function forgeFailureMessage(failures) {
  return `${failedCount(failures)} item(s) failed to queue: ${failures[0].message}`;
}
