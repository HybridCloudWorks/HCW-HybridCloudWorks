/**
 * The Publishing tab's own read: the public certifications snapshot, exactly
 * as anonymous visitors get it (`GET public/snapshots/certifications`).
 *
 * Mounted only while Publishing is open, so a failure here never touches the
 * other tabs, and the same generation guard as useCertifications: a slow read
 * cannot overwrite a newer one, unmounting supersedes the read in flight, and
 * a failed read clears the snapshot rather than leaving the old one beside
 * its error. `refresh` always asks past every cache (after a publish, the
 * cached copy is the one that is now wrong) and never throws.
 *
 * The read is a module-level function over the hook's state bag, with one exit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchPublicSnapshot } from '@/lib/publicApi';
import { COLLECTION } from './certView';

/** Read as generation `mine`; paints only if still current. True when a snapshot landed. */
async function readSnapshot(state, mine, fresh) {
  let outcome;
  try {
    outcome = { result: await fetchPublicSnapshot(COLLECTION, { fresh }) };
  } catch (err) {
    outcome = { err };
  }
  const current = mine === state.generation.current;
  if (current) {
    state.setPending(false);
    if ('result' in outcome) {
      state.setSnapshot(outcome.result);
    } else {
      state.setSnapshot(undefined);
      state.setError(outcome.err?.message || 'Failed to read the public certifications snapshot.');
    }
  }
  return current && 'result' in outcome;
}

function refreshSnapshot(state) {
  const mine = ++state.generation.current;
  state.setPending(true);
  state.setError('');
  return readSnapshot(state, mine, true);
}

/** The first read on mount; its cleanup supersedes whatever is in flight. */
function startSnapshot(state) {
  readSnapshot(state, ++state.generation.current, false);
  return () => {
    state.generation.current += 1;
  };
}

export default function usePublicSnapshot() {
  // undefined: not read yet; null: no snapshot has ever been published.
  const [snapshot, setSnapshot] = useState(undefined);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const state = useMemo(() => ({ setSnapshot, setPending, setError, generation }), []);

  useEffect(() => startSnapshot(state), [state]);
  const refresh = useCallback(() => refreshSnapshot(state), [state]);

  return {
    snapshot,
    loaded: snapshot !== undefined,
    loading: pending && snapshot === undefined,
    refreshing: pending,
    error,
    refresh,
  };
}
