/**
 * Runs the probe registry and keeps this tab's live results (ADR 0033
 * Platform).
 *
 * Until #1011 the live results persisted to sessionStorage, which was the
 * only memory the hub had: sign out, open a new tab, or let the session
 * lapse, and every verdict was gone. Now each result is handed to `onResult`
 * the moment it lands, and the page records it on the server
 * (useStoredResults.js), where every later visit reads it back. This hook
 * holds only what this tab has run, in memory, so a result shows before the
 * server has stamped its copy.
 *
 * Test all refreshes the snapshot once, then runs every `safe` probe in
 * parallel — the live ones by their own `run`, the session ones by their
 * page action — with a per-probe busy flag. Probes that write data or spend
 * quota (`safe: false`) are left to their own buttons, and the grid says so.
 *
 * One run per probe at a time: a click while a probe is in flight is ignored,
 * and a result from a run superseded by unmount is dropped.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyFailure } from '@/lib/status';
import { resolveProbe, safeProbes } from './probeRegistry';

/**
 * Run one probe against the page context. A live probe answers an outcome;
 * a snapshot probe refreshes the ops snapshot; a session probe runs its
 * action. A live probe that throws answers a failed outcome — critical or
 * offline by what it threw (lib/status.js) — so the card can say so; the
 * other kinds answer nothing, because their result is the page state their
 * action changed.
 */
async function executeProbe(probe, ctx) {
  try {
    if (probe.kind === 'live') return await probe.run(ctx);
    if (probe.kind === 'snapshot') await ctx.ops?.refresh?.();
    else if (probe.run) await probe.run(ctx);
  } catch (error) {
    if (probe.kind === 'live') {
      return {
        status: classifyFailure(error),
        summary: error?.message || 'The probe threw before it could record a result.',
        checkedAt: new Date().toISOString(),
      };
    }
  }
  return null;
}

/** Every non-snapshot probe, with the session probes that share one action run once. */
function probesToRunAll(probes) {
  const seenActions = new Set();
  return safeProbes(probes).filter((probe) => {
    if (probe.kind === 'snapshot') return false;
    if (probe.kind !== 'session') return true;
    const key = probe.run?.toString();
    const seen = seenActions.has(key);
    seenActions.add(key);
    return !seen;
  });
}

/**
 * @param {ReadonlyArray<object>} probes the registry
 * @param {() => object} getContext the page's current probe context, read at run time
 * @param {object} [options]
 * @param {(probe: object, outcome: object, durationMs: number) => void} [options.onResult]
 *   told of every live result as it lands, to record it on the server
 */
export default function useProbeRunner(probes, getContext, { onResult } = {}) {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(() => new Set());
  const [runningAll, setRunningAll] = useState(false);
  const inFlight = useRef(new Set());
  const mounted = useRef(true);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runOne = useCallback(
    async (probe) => {
      if (!probe || inFlight.current.has(probe.id)) return null;
      inFlight.current.add(probe.id);
      setRunning(new Set(inFlight.current));
      const startedAt = Date.now();
      let outcome = null;
      try {
        outcome = await executeProbe(probe, getContext());
      } finally {
        inFlight.current.delete(probe.id);
        if (mounted.current) setRunning(new Set(inFlight.current));
      }
      if (outcome && mounted.current) {
        setResults((previous) => ({ ...previous, [probe.id]: outcome }));
        onResultRef.current?.(probe, outcome, Date.now() - startedAt);
      }
      return outcome;
    },
    [getContext]
  );

  const runAll = useCallback(async () => {
    if (runningAll) return;
    setRunningAll(true);
    try {
      const ctx = getContext();
      // One snapshot refresh serves every snapshot probe.
      await ctx.ops?.refresh?.();
      await Promise.allSettled(probesToRunAll(probes).map((probe) => runOne(probe)));
    } finally {
      if (mounted.current) setRunningAll(false);
    }
  }, [getContext, probes, runOne, runningAll]);

  /**
   * One probe's result as the page shows it: the newest of this tab's own
   * result and the stored one, judged against its freshness window at `now`.
   */
  const resolve = useCallback(
    (probe, ctx, stored = {}, now = Date.now()) => resolveProbe(probe, ctx, results, stored, now),
    [results]
  );

  return { results, running, runningAll, runOne, runAll, resolve };
}
