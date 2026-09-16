/**
 * The Labs snapshot poll (#577 moved this out of LabsPage.jsx).
 */
import { useEffect, useState } from 'react';
import { postJSON } from '@/lib/api';
import { CLOCK_TICK_MS } from './labsView';

/**
 * Polling view of lab_agents + recent lab_jobs (admin read-only) — the
 * getLabsSnapshot RPC every 15s replaces the two legacy subscription streams,
 * and also supplies the server's job-type allowlist.
 */
export default function useLabsLive(enabled) {
  const [agents, setAgents] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [jobTypes, setJobTypes] = useState([]);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  // The staleness clock, deliberately independent of the fetch.
  //
  // `now` is only ever compared against each agent's `lastSeenAt`. Advancing it
  // inside the fetch's success path meant that during an outage — when no
  // snapshot arrives — it froze, `now - lastSeenAt` stopped growing, and every
  // agent stayed "connected" for exactly as long as nothing was reachable.
  // The clock has to keep running when the fetch does not; that is the only
  // condition under which it says anything. (TODO.md T-309)
  useEffect(() => {
    if (!enabled) return undefined;
    const clock = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(clock);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
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
        if (cancelled) return;
        setError(null);
        setAgents(snap?.agents || []);
        setJobs(snap?.jobs || []);
        if (Array.isArray(snap?.jobTypes) && snap.jobTypes.length) setJobTypes(snap.jobTypes);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        inFlight = false;
      }
    };

    load();
    const ticker = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(ticker);
    };
  }, [enabled]);

  return { agents, jobs, jobTypes, error, now };
}
