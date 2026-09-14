/**
 * The Health Hub's one observed read: `getOpsHealthSnapshot`, shared by the
 * Overview and Alerts tabs.
 *
 * It lives at page level, above the tabs, so switching tabs never refetches.
 * And every read — the first, a refresh after a smoke action, a refresh after
 * answering an alert, a "Try again" — goes through one generation counter, as
 * the Newsletter Hub hardened it in #555 (and as the Integrations Hub's
 * `useSecretStatus` does):
 *
 * - a slow first load that resolves after a newer refresh is dropped instead
 *   of painting older numbers over newer ones (last to resolve would win);
 * - unmounting supersedes whatever is in flight, so nothing lands on a page
 *   that has gone;
 * - a FAILED read empties the snapshot rather than leaving the previous
 *   numbers beside an error. The error says the counts could not be read, and
 *   stale counts under it would claim otherwise.
 *
 * `refresh` never throws: it resolves true when its read landed, false when it
 * failed or was superseded, and the failure itself is in `error`. The action
 * that asked for the refresh did happen either way, so its caller reports the
 * action and leaves the snapshot's failure to the tabs that show the snapshot.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { postJSON } from '@/lib/api';

export const EMPTY_SNAPSHOT = Object.freeze({ readiness: null, digest: null, alerts: [] });

export default function useOpsSnapshot(authReady) {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [loaded, setLoaded] = useState(false);
  // True from the start: until auth is ready the first read has not begun,
  // and that is still "not loaded yet" rather than "nothing to show".
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);

  // State is only ever set after the await, and only by the newest read. The
  // first read's "pending, no error" is the initial state, so the effect below
  // starts it without a synchronous setState (react-hooks/set-state-in-effect).
  const read = useCallback(async (mine) => {
    try {
      const result = await postJSON('getOpsHealthSnapshot', {});
      if (mine !== generation.current) return false;
      setSnapshot(result || EMPTY_SNAPSHOT);
      setLoaded(true);
      return true;
    } catch (err) {
      if (mine !== generation.current) return false;
      setSnapshot(EMPTY_SNAPSHOT);
      setLoaded(false);
      setError(err?.message || 'Failed to load ops health snapshot.');
      return false;
    } finally {
      if (mine === generation.current) setPending(false);
    }
  }, []);

  const refresh = useCallback(() => {
    const mine = ++generation.current;
    setPending(true);
    setError('');
    return read(mine);
  }, [read]);

  useEffect(() => {
    if (!authReady) return undefined;
    read(++generation.current);
    return () => {
      // Supersede the read in flight: its result, success or failure, is dropped.
      generation.current += 1;
    };
  }, [authReady, read]);

  return {
    snapshot,
    loaded,
    // Loading is "no numbers yet and a read under way". A refresh over numbers
    // already on screen keeps them there rather than flashing a spinner.
    loading: pending && !loaded,
    error,
    refresh,
  };
}
