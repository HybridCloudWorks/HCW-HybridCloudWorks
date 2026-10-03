/**
 * Per-row in-flight guard for a hub's writes (ADR 0033 §2: one `useWriteGuard`
 * under components/admin/shared/, moved from certifications/certWrites.js).
 *
 * `claim(id)` is false when a write to that row is already out, so a second
 * click on a toggle or a delete whose first write has not answered is ignored
 * rather than sent twice; `busyIds` is the set the cards disable their
 * buttons from; `release(id)` is called in the write's `finally`.
 */
import { useCallback, useRef, useState } from 'react';

export default function useWriteGuard() {
  const inFlight = useRef(new Set());
  const [busyIds, setBusyIds] = useState(() => new Set());

  const claim = useCallback((id) => {
    const free = !inFlight.current.has(id);
    if (free) {
      inFlight.current.add(id);
      setBusyIds(new Set(inFlight.current));
    }
    return free;
  }, []);
  const release = useCallback((id) => {
    inFlight.current.delete(id);
    setBusyIds(new Set(inFlight.current));
  }, []);
  return { busyIds, claim, release };
}
