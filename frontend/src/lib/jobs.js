/**
 * Client side of the platform job pattern (T-322).
 *
 * Handlers that used to make the browser wait past Flex Consumption's 230 s
 * cap now answer 202 with a job id; this helper turns that back into one
 * awaited call for the page: enqueue, then poll `getJob` with the same
 * backoff the Labs console uses, until the job reaches a terminal state.
 *
 * Usage:
 *   const job = await runJob('refresh-tool-service-cache', { region }, { onUpdate });
 *   job.status === 'succeeded' ? job.result : job.error
 */
import { postJSON } from '@/lib/api';
import { isTerminalJobStatus, jobPollDelay } from '@/lib/labsPolling';

export const DEFAULT_MAX_WAIT_MS = 15 * 60 * 1000;

const abortError = () => new DOMException('Aborted', 'AbortError');

const defaultSleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(t);
      reject(abortError());
    });
  });

function waitExceeded(jobId, lastJob, maxWaitMs) {
  const err = new Error(
    `Job ${jobId} is still ${lastJob.status} after ${Math.round(maxWaitMs / 1000)} s`
  );
  err.code = 'JOB_WAIT_EXCEEDED';
  err.job = lastJob;
  return err;
}

/** One `getJob` round trip; returns the job or null on a transient failure. */
async function pollOnce(get, jobId) {
  try {
    const res = await get({ jobId });
    if (!res?.ok || !res.job) throw new Error(res?.error || 'Bad getJob response');
    return res.job;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return null;
  }
}

async function pollUntilTerminal(get, jobId, { onUpdate, signal, maxWaitMs, sleep, now }) {
  const startedAt = now();
  let consecutiveErrors = 0;
  let lastJob = { id: jobId, status: 'queued' };
  for (;;) {
    if (signal?.aborted) throw abortError();
    if (now() - startedAt > maxWaitMs) throw waitExceeded(jobId, lastJob, maxWaitMs);
    await sleep(jobPollDelay(consecutiveErrors), signal);
    const job = await pollOnce(get, jobId);
    if (!job) {
      consecutiveErrors += 1;
      continue;
    }
    consecutiveErrors = 0;
    lastJob = job;
    onUpdate?.(job);
    if (isTerminalJobStatus(job.status)) return job;
  }
}

/**
 * @param {string} type
 * @param {object} [payload]
 * @param {object} [options]
 * @param {(job: object) => void} [options.onUpdate] - every poll result
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.maxWaitMs] - give up waiting (the job keeps running server-side)
 * @param {{ enqueue?: Function, get?: Function }} [options.fetchers] - test seam
 * @param {(ms: number, signal?: AbortSignal) => Promise<void>} [options.sleep] - test seam
 * @param {() => number} [options.now] - test seam
 * @returns {Promise<object>} the terminal job document
 */
export async function runJob(type, payload = {}, options = {}) {
  const {
    onUpdate,
    signal,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
    fetchers = {},
    sleep = defaultSleep,
    now = () => Date.now(),
  } = options;
  const enqueue = fetchers.enqueue || ((body) => postJSON('enqueueJob', body));
  const get = fetchers.get || ((body) => postJSON('getJob', body));

  const accepted = await enqueue({ type, payload });
  if (!accepted?.ok || !accepted.jobId) {
    throw new Error(accepted?.error || 'Job was not accepted');
  }
  return pollUntilTerminal(get, accepted.jobId, { onUpdate, signal, maxWaitMs, sleep, now });
}
