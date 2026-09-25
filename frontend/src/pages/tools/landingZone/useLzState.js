/**
 * The build lives in the query string (#668, epic #657), the way the pricing
 * scenario does in scenario/useScenarioState.js. There is no React state for
 * it: every control writes the URL through `encodeLz` and reads itself back
 * through `decodeLz`, which is what makes a landing zone a link someone can
 * put in an article, and what lets the pre-rendered page (no query string)
 * and the first client render agree on the default build.
 *
 * Unlike the scenario hook this one takes a whole next state rather than a
 * patch, because the state module's `addComponent`, `removeWithDependents`
 * and `setOption` already return the full, normalised result: dependencies
 * pulled in, counts kept in step, the spoke range moved off the hub.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { decodeLz, encodeLz, isLzParam } from '@/lib/landingZone';

/**
 * @returns {[state: { selected: string[], options: object, warnings: object[] },
 *   write: (next: object, options?: { replace?: boolean }) => void]}
 */
export function useLzState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => decodeLz(searchParams), [searchParams]);

  const write = useCallback(
    (next, { replace = false } = {}) => {
      const params = new URLSearchParams(searchParams);
      // Drop every key this module owns and write the new set; anything else
      // rides along untouched.
      for (const key of Array.from(params.keys())) if (isLzParam(key)) params.delete(key);
      for (const [key, value] of Object.entries(encodeLz(next))) params.set(key, value);
      setSearchParams(params, { replace });
    },
    [searchParams, setSearchParams]
  );

  return [state, write];
}
