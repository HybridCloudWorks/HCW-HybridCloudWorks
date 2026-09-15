/**
 * Pricing a scenario on every provider (#613, Phase 2).
 *
 * NEVER SILENTLY ZERO. A service the scenario needs that has no price for a
 * provider makes that provider's total `null` and names the service under
 * `unavailable`. A zero would read as "free" and make the provider cheapest
 * for lacking a number, which is the opposite of what happened. A line whose
 * quantity × factor is zero needs no price, though: nothing is being
 * multiplied by it.
 */
import { extraById, normalizeExtras } from './extras';
import { effectiveQuantities, scenarioById } from './scenarios';
import { PROVIDER_IDS, SERVICE_IDS, line, serviceMeta } from './services';

/** The refresh writes 'live' or 'baseline'; anything else is read as live. */
const classifySource = (source) => (source === 'baseline' ? 'baseline' : 'live');

/** One row of the payload as a price cell, or null when it carries no usable price. */
function priceCell(row) {
  const unitPrice = Number(row?.pricePerUnit);
  if (!row?.provider || !Number.isFinite(unitPrice) || unitPrice < 0) return null;
  return { unitPrice, source: classifySource(row.source) };
}

/** A service's rows keyed by provider; the first usable row per provider wins. */
function cellsByProvider(rows) {
  const byProvider = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const cell = priceCell(row);
    if (cell && !byProvider[row.provider]) byProvider[row.provider] = cell;
  }
  return byProvider;
}

/**
 * `{ [serviceId]: { [provider]: { unitPrice, source } } }` from the payload's
 * services. A provider absent from a service's rows is absent here too.
 */
export function priceTable(pricing) {
  const table = {};
  for (const service of Array.isArray(pricing?.services) ? pricing.services : []) {
    if (service?.serviceId) table[service.serviceId] = cellsByProvider(service.rows);
  }
  return table;
}

/**
 * Price one provider's lines. A line that needs a price the provider lacks
 * lands in `unavailable`; one priced from the catalogue lands in `catalogue`.
 */
function priceLines(lines, prices, provider, unavailable, catalogue) {
  const priced = [];
  for (const item of lines) {
    const cell = prices[item.serviceId]?.[provider] ?? null;
    const multiplier = item.quantity * item.factor;
    if (!cell && multiplier !== 0) {
      unavailable.add(item.serviceId);
      priced.push({ ...item, unitPrice: null, cost: null, source: 'unavailable' });
      continue;
    }
    if (cell?.source === 'baseline' && multiplier !== 0) catalogue.add(item.serviceId);
    priced.push({
      ...item,
      unitPrice: cell ? cell.unitPrice : null,
      cost: cell ? multiplier * cell.unitPrice : 0,
      source: cell ? cell.source : 'unpriced',
    });
  }
  return priced;
}

const sumCosts = (lines) => lines.reduce((sum, item) => sum + (item.cost ?? 0), 0);

function computeProvider({ provider, quantities, prices, extras }) {
  const unavailable = new Set();
  const catalogue = new Set();
  const baseLines = SERVICE_IDS.filter((id) => quantities[id] > 0).map((id) =>
    line(id, quantities[id], 1, serviceMeta(id).label)
  );
  const base = priceLines(baseLines, prices, provider, unavailable, catalogue);
  const segments = extras.map((extraId) => {
    const extra = extraById(extraId);
    const lines = priceLines(
      extra.rule({ quantities, prices, provider }),
      prices,
      provider,
      unavailable,
      catalogue
    );
    return { extraId, label: extra.label, lines, cost: sumCosts(lines) };
  });
  const available = unavailable.size === 0;
  const total = available ? sumCosts(base) + sumCosts(segments) : null;
  return {
    provider,
    base: { total: available ? sumCosts(base) : null, lines: base },
    segments: available ? segments : segments.map((s) => ({ ...s, cost: null })),
    total,
    monthly: total,
    yearly: total === null ? null : total * 12,
    unavailable: SERVICE_IDS.filter((id) => unavailable.has(id)),
    catalogue: SERVICE_IDS.filter((id) => catalogue.has(id)),
    deltaFromCheapest: null,
  };
}

/** Marks each priced provider's distance from the lowest total; the cheapest ids. */
function rankProviders(providers) {
  const totals = providers.filter((p) => p.total !== null).map((p) => p.total);
  if (totals.length === 0) return [];
  const lowest = Math.min(...totals);
  for (const p of providers) {
    if (p.total !== null) p.deltaFromCheapest = lowest > 0 ? (p.total - lowest) / lowest : 0;
  }
  return providers.filter((p) => p.total === lowest).map((p) => p.provider);
}

/**
 * The scenario priced on every provider.
 *
 * @param {object} args
 * @param {object|null} args.pricing  the `pricing` object from the API
 * @param {string} [args.scenarioId]
 * @param {Record<string, number>} [args.quantities]  overrides on the scenario
 * @param {string[]} [args.extras]
 * @param {number|null} [args.egressGb]  overrides the CDN egress quantity
 * @returns {{ scenarioId: string, quantities: Record<string, number>, extras: string[],
 *   providers: object[], cheapest: string[] }}
 */
export function computeScenario({ pricing, scenarioId, quantities, extras, egressGb = null }) {
  const scenario = scenarioById(scenarioId);
  const effective = effectiveQuantities(scenario.id, quantities, egressGb);
  const chosen = normalizeExtras(extras);
  const prices = priceTable(pricing);
  const providers = PROVIDER_IDS.map((provider) =>
    computeProvider({ provider, quantities: effective, prices, extras: chosen })
  );
  return {
    scenarioId: scenario.id,
    quantities: effective,
    extras: chosen,
    providers,
    cheapest: rankProviders(providers),
  };
}
