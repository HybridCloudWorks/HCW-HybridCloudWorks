/**
 * The Labs snapshot poll (#577 moved this out of LabsPage.jsx).
 *
 * The poll and the staleness clock are separate functions, not two effects in
 * one hook: written together they gave the hook seven exits, and Qlty counts a
 * closure's branches into the function that holds it.
 */
import { useEffect, useState } from 'react';
import { postJSON } from '@/lib/api';
import { CLOCK_TICK_MS } from './labsView';

/** Every 15 s, against a postJSON timeout of 20 s — hence the in-flight guard. */
const SNAPSHOT_POLL_MS = 15000;

const EMPTY_SNAPSHOT = Object.freeze({ agents: [], jobs: [], jobTypes: [] });

/**
 * The staleness clock, deliberately independent of the fetch.
 *
 * `now` is only ever compared against each agent's `lastSeenAt`. Advancing it
 * inside the fetch's success path meant that during an outage — when no
 * snapshot arrives — it froze, `now - lastSeenAt` stopped growing, and every
 * agent stayed "connected" for exactly as long as nothing was reachable.
 * The clock has to keep running when the fetch does not; that is the only
 * condition under which it says anything. (TODO.md T-309)
 */
function useStalenessClock(enabled) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return undefined;
    const clock = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(clock);
  }, [enabled]);

  return now;
}

/**
 * The new snapshot, keeping the job-type allowlist when this one omits it: the
 * Console must still have something to submit if a later snapshot arrives
 * without the list.
 */
export function mergeSnapshot(prev, snap) {
  const jobTypes =
    Array.isArray(snap?.jobTypes) && snap.jobTypes.length ? snap.jobTypes : prev.jobTypes;
  return { agents: snap?.agents || [], jobs: snap?.jobs || [], jobTypes };
}

/**
 * Poll `getLabsSnapshot` until cancelled, and return the canceller for it.
 *
 * @param {{onSnapshot: (snap: object) => void, onError: (message: string) => void}} sinks
 * @returns {() => void} stops the poll and clears its interval
 */
function pollSnapshot({ onSnapshot, onError }) {
  let cancelled = false;
  let inFlight = false;

  const load = async () => {
    // postJSON allows 20 s against a 15 s interval, so ticks can overlap.
    // Without this a slow backend stacks requests and the responses land out
    // of order, rendering an older snapshot over a newer one.
    if (inFlight) return;
    inFlight = true;
    try {
      const snap = await postJSON('getLabsSnapshot', {});
      if (!cancelled) onSnapshot(snap);
    } catch (err) {
      if (!cancelled) onError(err.message);
    } finally {
      inFlight = false;
    }
  };

  load();
  const ticker = setInterval(load, SNAPSHOT_POLL_MS);
  return () => {
    cancelled = true;
    clearInterval(ticker);
  };
}

/**
 * Polling view of lab_agents + recent lab_jobs (admin read-only) — the
 * getLabsSnapshot RPC every 15s replaces the two legacy subscription streams,
 * and also supplies the server's job-type allowlist.
 */
export default function useLabsLive(enabled) {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [error, setError] = useState(null);
  const now = useStalenessClock(enabled);

  useEffect(() => {
    if (!enabled) return undefined;
    const onSnapshot = (snap) => {
      setError(null);
      setSnapshot((prev) => mergeSnapshot(prev, snap));
    };
    return pollSnapshot({ onSnapshot, onError: setError });
  }, [enabled]);

  return { ...snapshot, error, now };
}
