/**
 * The Health Hub's verified half: the identity checks and the two Labs probes,
 * held above the tabs so the strip on Overview, the cards on Checks and the
 * report on Report all read the same run (#569).
 *
 * Moved unchanged out of HealthPage.jsx. The identity run guard is exactly as
 * it was: one run at a time, and a result from a run that was superseded (or
 * torn down by a route change) is discarded instead of being applied over a
 * newer one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { collectIdentity, messageOf, probeUnauthenticated, runLabsProbeSteps } from './probes';

const THREW = 'the probe threw before it could record a result';

/**
 * Run `probe`, store its result, and turn a throw from outside its own steps
 * into a failed result built by `failed`, so a probe never leaves a stuck
 * spinner with every button disabled.
 */
async function runProbe(probe, setResult, setBusy, failed) {
  setBusy(true);
  try {
    setResult(await probe());
  } catch (err) {
    setResult(failed(messageOf(err, THREW)));
  } finally {
    setBusy(false);
  }
}

export default function useHealthChecks(authReady) {
  const [identity, setIdentity] = useState(null);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [labs, setLabs] = useState(null);
  const [labsBusy, setLabsBusy] = useState(false);
  const [unauth, setUnauth] = useState(null);
  const [unauthBusy, setUnauthBusy] = useState(false);

  // One identity run at a time. The first run and a re-run go through the
  // same gate: a click while a run is in flight is ignored rather than
  // starting a second run whose result would race the first (last to resolve
  // would win). Each run carries a sequence number, so a result from a run
  // that was superseded — or torn down by a route change — is discarded
  // instead of being applied over a newer one.
  const identitySeq = useRef(0);
  const identityInFlight = useRef(false);

  const runIdentity = useCallback(async () => {
    if (identityInFlight.current) return;
    identityInFlight.current = true;
    identitySeq.current += 1;
    const seq = identitySeq.current;
    try {
      const result = await collectIdentity();
      if (seq === identitySeq.current) setIdentity(result);
    } finally {
      if (seq === identitySeq.current) identityInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!authReady) return undefined;
    runIdentity();
    return () => {
      // Supersede whatever is in flight: its result is dropped and the gate
      // reopens for the next mount.
      identitySeq.current += 1;
      identityInFlight.current = false;
    };
  }, [authReady, runIdentity]);

  const rerunIdentity = useCallback(async () => {
    if (identityInFlight.current) return;
    setIdentityBusy(true);
    try {
      await runIdentity();
    } finally {
      setIdentityBusy(false);
    }
  }, [runIdentity]);

  const runLabs = useCallback(
    () =>
      runProbe(runLabsProbeSteps, setLabs, setLabsBusy, (error) => ({
        enqueue: null,
        read: null,
        cancel: null,
        final: null,
        error,
      })),
    []
  );

  const runUnauth = useCallback(
    () =>
      runProbe(probeUnauthenticated, setUnauth, setUnauthBusy, (error) => ({
        httpStatus: null,
        error,
      })),
    []
  );

  return {
    identity,
    identityBusy,
    // The first run has no busy flag of its own — `identity === null` is that
    // state — so the button reads both.
    identityRunning: identityBusy || identity === null,
    rerunIdentity,
    labs,
    labsBusy,
    runLabs,
    unauth,
    unauthBusy,
    runUnauth,
  };
}
