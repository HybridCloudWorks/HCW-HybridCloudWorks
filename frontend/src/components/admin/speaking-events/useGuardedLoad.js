/**
 * One race-safe read for the Speaking Events Hub (#573), hardened the way the
 * Newsletter Hub's were in #555 and the Health Hub's `useOpsSnapshot` is:
 *
 * - every read — the first, a refresh after a save or sync, a "Try again" —
 *   takes a generation number, and only the newest may set state, so a slow
 *   older answer never paints over a newer one;
 * - tearing the effect down (unmount, or `enabled` going false) supersedes the
 *   read in flight, so nothing lands on a page that has gone;
 * - a FAILED read empties the data rather than leaving the previous rows
 *   beside an error that says they could not be read.
 *
 * `refresh` never throws: it resolves true when its read landed and false when
 * it failed, was superseded, or was not allowed yet. The failure is `error`.
 *
 * `load` must be stable (module-level or memoised); `describeError` turns a
 * thrown error into the message the tab shows.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export default function useGuardedLoad(load, { enabled = true, empty, describeError }) {
  const [data, setData] = useState(empty);
  const [loaded, setLoaded] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);
  // True from the start: a read not yet begun is still "not loaded yet".
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const read = useCallback(
    async (mine) => {
      const current = () => mine === generation.current;
      let landed = false;
      try {
        const value = await load();
        if (current()) {
          setData(value);
          setLoaded(true);
          setLoadedAt(new Date());
          landed = true;
        }
      } catch (err) {
        if (current()) {
          setData(empty);
          setLoaded(false);
          setError(describeError(err));
        }
      } finally {
        if (current()) setPending(false);
      }
      return landed;
    },
    [load, empty, describeError]
  );

  const refresh = useCallback(() => {
    if (!enabled) return Promise.resolve(false);
    const mine = ++generation.current;
    setPending(true);
    setError('');
    return read(mine);
  }, [enabled, read]);

  useEffect(() => {
    if (!enabled) return undefined;
    read(++generation.current);
    return () => {
      generation.current += 1;
    };
  }, [enabled, read]);

  return {
    data,
    loaded,
    loadedAt,
    pending,
    // Rows already on screen stay there during a refresh rather than flashing
    // a spinner; loading is "nothing to show yet and a read under way".
    loading: pending && !loaded,
    error,
    refresh,
  };
}
