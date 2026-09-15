/**
 * The scenario as a query string (#613, Phase 2), so a comparison is a link:
 * `?scenario=three-tier-web&extras=backup,dr-warm-standby,commit-1y&egress=1000&q.compute-vm=2190`.
 * Defaults are left out so the canonical URL for the default scenario is bare,
 * and `?region=` belongs to the page, not to this module.
 *
 * `?compare=` (Phase 3) is the second region the results are set against. It
 * is scenario state — it travels with the scenario, and an article embed can
 * carry it — so it is encoded here, but its VALUE is only shape-checked:
 * the list of regions comes from the API, so membership (and "not the region
 * already shown") is the page's check, made once the list has arrived.
 */
import { normalizeExtras } from './extras';
import { DEFAULT_SCENARIO_ID, isScenarioId, scenarioById, scenarioQuantities } from './scenarios';
import { SERVICE_IDS, isQuantity } from './services';

const QUANTITY_PREFIX = 'q.';

/** What a region id looks like: `us-east-1`, `westeurope`. Refuses anything that could not be one. */
const REGION_ID = /^[a-z][a-z0-9-]{1,31}$/;

export function isRegionId(value) {
  return typeof value === 'string' && REGION_ID.test(value);
}

/** The CDN quantity is the egress slider, so it travels as `egress=` rather than `q.edge-cdn=`. */
const keyFor = (serviceId) =>
  serviceId === 'edge-cdn' ? 'egress' : `${QUANTITY_PREFIX}${serviceId}`;

/** The query keys this module owns. */
export function isScenarioParam(key) {
  return (
    key === 'scenario' ||
    key === 'extras' ||
    key === 'egress' ||
    key === 'compare' ||
    key.startsWith(QUANTITY_PREFIX)
  );
}

/**
 * Scenario state as query entries: `scenario=` only when not the default,
 * `extras=` only when any, `egress=` for a CDN override, `q.<service>=` for
 * any other quantity that differs from the scenario's own, and `compare=`
 * when a second region is set.
 *
 * @returns {Record<string, string>}
 */
export function encodeScenario(state) {
  const scenario = scenarioById(state?.scenarioId);
  const defaults = scenarioQuantities(scenario.id);
  const out = {};
  if (scenario.id !== DEFAULT_SCENARIO_ID) out.scenario = scenario.id;
  const extras = normalizeExtras(state?.extras);
  if (extras.length) out.extras = extras.join(',');
  for (const id of SERVICE_IDS) {
    const value = state?.quantities?.[id];
    if (isQuantity(value) && Number(value) !== defaults[id])
      out[keyFor(id)] = String(Number(value));
  }
  if (isRegionId(state?.compare)) out.compare = state.compare;
  return out;
}

/** One parameter from a URLSearchParams or a plain object; null when absent. */
function readParam(searchParams, key) {
  if (!searchParams) return null;
  if (typeof searchParams.get === 'function') return searchParams.get(key);
  return Object.prototype.hasOwnProperty.call(searchParams, key) ? searchParams[key] : null;
}

/**
 * The inverse of `encodeScenario`, tolerant of anything a hand-edited URL can
 * carry: an unknown scenario falls back to the default, unknown extras are
 * dropped, a quantity that is not a finite non-negative number is ignored,
 * and a `compare=` that is not shaped like a region id is null.
 * `quantities` holds only the overrides that survived, never the defaults.
 *
 * @param {URLSearchParams|Record<string,string>|null} searchParams
 * @returns {{ scenarioId: string, extras: string[], quantities: Record<string, number>,
 *   compare: string|null }}
 */
export function decodeScenario(searchParams) {
  const get = (key) => readParam(searchParams, key);
  const scenarioId = isScenarioId(get('scenario')) ? get('scenario') : DEFAULT_SCENARIO_ID;
  const extras = normalizeExtras(String(get('extras') ?? '').split(','));
  const defaults = scenarioQuantities(scenarioId);
  const quantities = {};
  for (const id of SERVICE_IDS) {
    const raw = get(keyFor(id));
    if (raw !== null && raw !== undefined && isQuantity(raw) && Number(raw) !== defaults[id]) {
      quantities[id] = Number(raw);
    }
  }
  const compare = isRegionId(get('compare')) ? get('compare') : null;
  return { scenarioId, extras, quantities, compare };
}
