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
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPublicSnapshot } from '@/lib/publicApi';
import { COLLECTION } from './certView';

export default function usePublicSnapshot() {
  // undefined: not read yet; null: no snapshot has ever been published.
  const [snapshot, setSnapshot] = useState(undefined);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const read = useCallback(async (mine, fresh) => {
    const current = () => mine === generation.current;
    try {
      const result = await fetchPublicSnapshot(COLLECTION, { fresh });
      if (!current()) return false;
      setSnapshot(result);
      setPending(false);
      return true;
    } catch (err) {
      if (!current()) return false;
      setSnapshot(undefined);
      setPending(false);
      setError(err?.message || 'Failed to read the public certifications snapshot.');
      return false;
    }
  }, []);

  const refresh = useCallback(() => {
    const mine = ++generation.current;
    setPending(true);
    setError('');
    return read(mine, true);
  }, [read]);

  useEffect(() => {
    read(++generation.current, false);
    return () => {
      generation.current += 1;
    };
  }, [read]);

  return {
    snapshot,
    loaded: snapshot !== undefined,
    loading: pending && snapshot === undefined,
    refreshing: pending,
    error,
    refresh,
  };
}
