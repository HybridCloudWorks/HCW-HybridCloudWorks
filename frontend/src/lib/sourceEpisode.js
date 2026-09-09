/**
 * Queue one source-grounded Listen & Learn episode and wait for it (#433).
 *
 * The same job as a guide run — `generate-listen-and-learn`, polled through
 * `runJob` exactly as `generateEpisodes` in listenAndLearn.js — but enqueued
 * through its own route rather than the generic `enqueueJob`, because the
 * route validates the URL list before the job exists: an over-cap list or a
 * YouTube URL typed as a page comes back as a 400 with the server's sentence,
 * which the form shows at once, instead of a failed job the page would poll
 * for. `runJob`'s `fetchers.enqueue` seam is what makes the swap one line.
 */
import { postJSON } from '@/lib/api';
import { runJob } from '@/lib/jobs';

export const SOURCE_EPISODE_ROUTE = 'cms/listen-and-learn/source-episode';
export const SOURCE_EPISODE_JOB_TYPE = 'generate-listen-and-learn';

/**
 * @param {object} params
 * @param {string} params.platform
 * @param {string} params.examCode
 * @param {string} params.title the episode's title; the server derives its id from it
 * @param {Array<{ kind: 'page'|'video', url: string, title?: string }>} params.sources
 * @param {string} [params.certTitle]
 * @param {string} [params.certSlug]
 * @param {(job: object) => void} [params.onUpdate]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<object>} the terminal job document
 */
export async function generateSourceEpisode({
  platform,
  examCode,
  title,
  sources,
  certTitle,
  certSlug,
  onUpdate,
  signal,
} = {}) {
  return runJob(
    SOURCE_EPISODE_JOB_TYPE,
    {
      platform,
      examCode,
      title,
      sources,
      ...(certTitle ? { certTitle } : {}),
      ...(certSlug ? { certSlug } : {}),
    },
    {
      fetchers: { enqueue: ({ payload }) => postJSON(SOURCE_EPISODE_ROUTE, payload) },
      onUpdate,
      signal,
      // One episode, but the same 25-minute server ceiling as a guide run —
      // reading twenty pages and a video is slower than a chat turn.
      maxWaitMs: 26 * 60 * 1000,
    }
  );
}
