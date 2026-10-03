/**
 * One program's readiness, as the API computes it (ADR 0033 §4): per
 * requirement, met or not, with the items that count, a weighted score and
 * the sentence that explains how it was computed. Read through the shared
 * guard so a program switched mid-read never shows another program's score.
 *
 * `period` is the API's `?period=` — a year (`2026`) or a range
 * (`2026-07-01..2027-06-30`) — or empty for no bound.
 */
import { useMemo } from 'react';
import useGuardedLoad from '@/components/admin/shared/useGuardedLoad';
import { loadReadiness } from './useAmbassadorData';

const describeError = (err) => `Could not compute readiness: ${err?.message}`;

export default function useReadiness(programId, period = '', { enabled = true } = {}) {
  const load = useMemo(() => () => loadReadiness(programId, period), [programId, period]);
  return useGuardedLoad(load, {
    enabled: enabled && Boolean(programId),
    empty: null,
    describeError,
  });
}
