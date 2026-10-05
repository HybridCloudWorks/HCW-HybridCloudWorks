/**
 * One program's readiness, as the API computes it (ADR 0033 §4): per
 * requirement, met or not, with the items that count, a weighted score and
 * the sentence that explains how it was computed. Read through the shared
 * guard so a program switched mid-read never shows another program's score.
 *
 * `period` is the API's `?period=` — a year (`2026`) or a range
 * (`2026-07-01..2027-06-30`) — or empty for no bound. `refreshKey` is any
 * value whose change should re-read: the Evidence tab passes the time its
 * list last landed, so a guide row never shows a count from before an add.
 */
import { useMemo } from 'react';
import useGuardedLoad from '@/components/admin/shared/useGuardedLoad';
import { loadReadiness } from './useAmbassadorData';

const describeError = (err) => `Could not compute readiness: ${err?.message}`;

export default function useReadiness(programId, period = '', { enabled = true, refreshKey } = {}) {
  const load = useMemo(() => {
    // Named here so a changed key makes a new loader, which is what re-arms the read.
    void refreshKey;
    return () => loadReadiness(programId, period);
  }, [programId, period, refreshKey]);
  return useGuardedLoad(load, {
    enabled: enabled && Boolean(programId),
    empty: null,
    describeError,
  });
}
