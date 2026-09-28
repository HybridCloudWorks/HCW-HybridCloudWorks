/**
 * The Labs snapshot poll (#577 moved this out of LabsPage.jsx).
 *
 * The poll and the staleness clock are separate functions, not two effects in
 * one hook: written together they gave the hook seven exits, and Qlty counts a
 * closure's branches into the function that holds it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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
 * Poll `getLabsSnapshot` until cancelled.
 *
 * @param {{onSnapshot: (snap: object) => void, onError: (message: string) => void}} sinks
 * @returns {{refresh: () => void, cancel: () => void}} `refresh` reads once
 *   now, or once more after the read in flight when there is one; `cancel`
 *   stops the poll and clears its interval
 */
function pollSnapshot({ onSnapshot, onError }) {
  let cancelled = false;
  let inFlight = false;
  let readAgain = false;

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
    if (readAgain && !cancelled) {
      readAgain = false;
      load();
    }
  };

  // A refresh follows a write. Dropped behind the in-flight guard, the read
  // that answered it would be one sent before the write, so a removed agent's
  // card would come back after its toast and stay until the next tick.
  const refresh = () => {
    if (inFlight) readAgain = true;
    else load();
  };

  load();
  const ticker = setInterval(load, SNAPSHOT_POLL_MS);
  return {
    refresh,
    cancel: () => {
      cancelled = true;
      clearInterval(ticker);
    },
  };
}

/**
 * Polling view of lab_agents + recent lab_jobs — the getLabsSnapshot RPC
 * every 15s replaces the two legacy subscription streams, and also supplies
 * the server's job-type allowlist.
 *
 * `refresh` reads the snapshot now instead of at the next tick. The Agents
 * tab calls it after a registry write (#740), so a newly registered agent's
 * card, a deactivated one's badge, or a removed one's absence, appears when
 * the toast does. A refresh during a read in flight is a second read after
 * it, never dropped: that read began before the write it would miss.
 */
export default function useLabsLive(enabled) {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [error, setError] = useState(null);
  const now = useStalenessClock(enabled);
  const reload = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const onSnapshot = (snap) => {
      setError(null);
      setSnapshot((prev) => mergeSnapshot(prev, snap));
    };
    const poll = pollSnapshot({ onSnapshot, onError: setError });
    reload.current = poll.refresh;
    return () => {
      reload.current = null;
      poll.cancel();
    };
  }, [enabled]);

  const refresh = useCallback(() => reload.current?.(), []);

  return { ...snapshot, error, now, refresh };
}
