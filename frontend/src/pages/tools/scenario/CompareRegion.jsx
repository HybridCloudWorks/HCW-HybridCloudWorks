/**
 * "Compare with" (#613, Phase 3): the same scenario priced in a second region,
 * beside the one on the page. The choice lives in `?compare=` with the rest
 * of the scenario state, so a two-region comparison is a link too.
 *
 * WHICH IDS ARE ALLOWED. share.js accepts anything shaped like a region id;
 * this module is where the id meets the list the API sent. A `compare=` that
 * is not in that list, or is the region already shown, is treated as none:
 * the select shows "None", nothing is fetched, and the next change rewrites
 * the URL without it. So a stale or hand-typed id can never start a request
 * for a region the server would refuse.
 *
 * GENERATION-GUARDED. `usePublicData` drops a fetch whose key has moved on,
 * and keeps the previous region's payload on screen while the next loads —
 * so the hook also checks `data.region` against the region it wants before
 * computing anything, and reports "loading" until they agree.
 */
import { useMemo } from 'react';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchCloudPricing } from '@/lib/publicApi';
import { compareRegions, computeScenario } from '@/lib/pricingScenarios';
import { NATIVE_SELECT_CLASS } from './styles';

/** The compare id if it names a region the API listed other than the current one; else null. */
export function validCompareRegion({ compare, region, regions }) {
  if (!compare || compare === region) return null;
  return (regions ?? []).some((r) => r.id === compare) ? compare : null;
}

/**
 * @param {object} args
 * @param {string|null} args.compare  from the URL
 * @param {string} args.region  the page's region
 * @param {Array<{id: string, label: string}>} args.regions  from the API
 * @param {object|null} args.result  the page's computeScenario result
 * @param {string} args.scenarioId
 * @param {Record<string, number>} args.quantities
 * @param {string[]} args.extras
 * @returns {null | { label: string, status: 'loading' } | { label: string, status: 'error', error: Error }
 *   | { label: string, status: 'ready', providers: object, cheapest: string[] }}
 */
export function useCompareRegion({
  compare,
  region,
  regions,
  result,
  scenarioId,
  quantities,
  extras,
}) {
  const wanted = validCompareRegion({ compare, region, regions });
  const { data, loading, error } = usePublicData(
    () => fetchCloudPricing(wanted),
    wanted ? `cloud-pricing:${wanted}` : ''
  );
  const label = (regions ?? []).find((r) => r.id === wanted)?.label ?? wanted;

  return useMemo(() => {
    if (!wanted || !result) return null;
    if (error) return { label, status: 'error', error };
    if (loading || !data || data.region !== wanted) return { label, status: 'loading' };
    const secondary = computeScenario({ pricing: data, scenarioId, quantities, extras });
    return { label, status: 'ready', ...compareRegions(result, secondary) };
  }, [wanted, result, error, loading, data, label, scenarioId, quantities, extras]);
}

/** The native select, like every control on the card: "None" plus every region but the current one. */
export function CompareSelect({ compare, region, regions, onChange }) {
  const options = (regions ?? []).filter((r) => r.id !== region);
  if (options.length === 0) return null;
  const value = validCompareRegion({ compare, region, regions }) ?? '';
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="scenario-compare" className="text-sm font-medium">
        Compare with
      </label>
      <select
        id="scenario-compare"
        value={value}
        onChange={(event) => onChange(event.target.value || null)}
        className={`${NATIVE_SELECT_CLASS} h-9`}
      >
        <option value="">None</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
