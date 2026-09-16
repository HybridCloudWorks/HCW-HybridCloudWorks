/**
 * Watching one submitted job until it stops moving (#577 moved this out of the
 * Console tab's body).
 *
 * Qlty counts a closure's branches into the function that holds it, so the poll
 * written inline was the Console's complexity — 19, with six exits. The poll is
 * a module-level function here and the hook holds state and nothing else, which
 * is the shape useCertifications documents.
 */
import { useEffect, useState } from 'react';
import { postJSON } from '@/lib/api';
import { isTerminalJobStatus, jobPollDelay } from '@/lib/labsPolling';

const EMPTY = Object.freeze({ jobId: null, job: null, pollError: null });

/**
 * Poll `getLabJob` until the job reaches a terminal state, and return the
 * canceller for it.
 *
 * Self-scheduling rather than an interval, so exactly one request is ever in
 * flight regardless of how slow the backend is.
 *
 * @param {string} jobId the job to follow
 * @param {(patch: {job?: object|null, pollError?: string}) => void} onUpdate
 * @returns {() => void} stops the poll and cancels any pending timer
 */
export function watchJob(jobId, onUpdate) {
  let cancelled = false;
  let timer = null;
  let consecutiveErrors = 0;

  const step = async () => {
    try {
      const res = await postJSON('getLabJob', { jobId });
      if (cancelled) return;
      consecutiveErrors = 0;
      const job = res?.job || null;
      onUpdate({ job });
      // `timeout` is a real status the agent can report, and omitting it here
      // meant a timed-out job was polled every five seconds for as long as the
      // console stayed open. (TODO.md T-308)
      if (!isTerminalJobStatus(job?.status)) timer = setTimeout(step, jobPollDelay(0));
    } catch (err) {
      if (cancelled) return;
      consecutiveErrors += 1;
      // A transport failure is not a job outcome. Putting a real status value
      // on screen gave the operator something nothing distinguished from an
      // actual failure, and returning without rescheduling stopped the poll for
      // good — so a job that went on to succeed was displayed as failed
      // permanently. The error is separate state, and the poll keeps going with
      // backoff. (TODO.md T-308)
      onUpdate({ pollError: err.message });
      timer = setTimeout(step, jobPollDelay(consecutiveErrors));
    }
  };

  step();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

/**
 * Fold one poll update into the bag, dropping anything left from a previous
 * job: an error arriving first for a newly submitted id must not be shown
 * beside the job before it.
 */
export function applyUpdate(prev, jobId, patch) {
  const carried = prev.jobId === jobId ? prev.job : null;
  return { jobId, job: patch.job ?? carried, pollError: patch.pollError ?? null };
}

/**
 * The status and output of the job the Console last submitted.
 *
 * `pollError` is deliberately not part of `job`: a failure to *read* the status
 * is not a status, and conflating the two is the defect above.
 */
export default function useJobWatch(jobId) {
  const [result, setResult] = useState(EMPTY);

  useEffect(() => {
    if (!jobId) return undefined;
    const onUpdate = (patch) => setResult((prev) => applyUpdate(prev, jobId, patch));
    return watchJob(jobId, onUpdate);
  }, [jobId]);

  // Keyed by the job it describes, so a newly submitted id shows an empty pane
  // rather than the previous job's output while the first response is still in
  // flight. That is why this is one bag and not two useState calls.
  return result.jobId === jobId ? result : EMPTY;
}
