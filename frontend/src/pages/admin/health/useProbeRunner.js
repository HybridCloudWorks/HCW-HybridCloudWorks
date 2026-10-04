/**
 * Runs the probe registry and keeps its live results (ADR 0033 Platform).
 *
 * Live results persist to sessionStorage, so a reload keeps "Publer answered
 * 3 min ago" rather than forgetting every verdict the moment the tab reloads.
 * That is a per-viewer convenience: every read and write is wrapped, and a
 * browser without storage simply starts empty.
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
import { resolveProbe, safeProbes } from './probeRegistry';

export const PROBE_STORAGE_KEY = 'contentforge.health.probes.v1';

function readStored() {
  try {
    const raw = window.sessionStorage?.getItem(PROBE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStored(results) {
  try {
    window.sessionStorage?.setItem(PROBE_STORAGE_KEY, JSON.stringify(results));
  } catch {
    // Remembering is a convenience, never a requirement.
  }
}

/**
 * @param {ReadonlyArray<object>} probes the registry
 * @param {() => object} getContext the page's current probe context, read at run time
 */
/**
 * Run one probe against the page context. A live probe answers an outcome;
 * a snapshot probe refreshes the ops snapshot; a session probe runs its
 * action. A live probe that throws answers an `unavailable` outcome so the
 * card can say so; the other kinds answer nothing.
 */
async function executeProbe(probe, ctx) {
  try {
    if (probe.kind === 'live') return await probe.run(ctx);
    if (probe.kind === 'snapshot') await ctx.ops?.refresh?.();
    else if (probe.run) await probe.run(ctx);
  } catch (error) {
    if (probe.kind === 'live') {
      return {
        status: 'unavailable',
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

export default function useProbeRunner(probes, getContext) {
  const [results, setResults] = useState(readStored);
  const [running, setRunning] = useState(() => new Set());
  const [runningAll, setRunningAll] = useState(false);
  const inFlight = useRef(new Set());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    writeStored(results);
  }, [results]);

  const runOne = useCallback(
    async (probe) => {
      if (!probe || inFlight.current.has(probe.id)) return null;
      inFlight.current.add(probe.id);
      setRunning(new Set(inFlight.current));
      let outcome = null;
      try {
        outcome = await executeProbe(probe, getContext());
      } finally {
        inFlight.current.delete(probe.id);
        if (mounted.current) setRunning(new Set(inFlight.current));
      }
      if (outcome && mounted.current) {
        setResults((previous) => ({ ...previous, [probe.id]: outcome }));
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

  const resolve = useCallback((probe, ctx) => resolveProbe(probe, ctx, results), [results]);

  return { results, running, runningAll, runOne, runAll, resolve };
}
