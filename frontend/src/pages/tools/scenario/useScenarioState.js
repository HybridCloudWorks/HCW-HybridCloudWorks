/**
 * The scenario state lives in the query string, beside Phase 1's `?region=`
 * (#613, Phase 2). There is no React state for it at all: every control
 * writes the URL and reads itself back from it, which is what makes a
 * comparison a link someone can send, and what lets the pre-rendered page
 * (no query string) and the first client render agree on the defaults.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { decodeScenario, encodeScenario, isScenarioParam } from '@/lib/pricingScenarios';

/**
 * @returns {[state: {scenarioId: string, extras: string[], quantities: Record<string, number>},
 *   update: (patch: object, options?: { replace?: boolean }) => void]}
 */
export function useScenarioState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => decodeScenario(searchParams), [searchParams]);

  const update = useCallback(
    (patch, { replace = false } = {}) => {
      const next = { ...decodeScenario(searchParams), ...patch };
      const params = new URLSearchParams(searchParams);
      // Drop every key this module owns and write the new set; anything else
      // (the region) rides along untouched.
      for (const key of Array.from(params.keys())) if (isScenarioParam(key)) params.delete(key);
      for (const [key, value] of Object.entries(encodeScenario(next))) params.set(key, value);
      setSearchParams(params, { replace });
    },
    [searchParams, setSearchParams]
  );

  return [state, update];
}
