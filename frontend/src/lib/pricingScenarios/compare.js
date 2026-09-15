/**
 * The same scenario in a second region (#613, Phase 3): for each provider,
 * the other region's total and how far it sits from the one on the page,
 * plus which provider is cheapest there. Pure — both inputs are
 * `computeScenario` results, so the arithmetic that priced the page prices
 * the comparison too, and the only thing added here is the subtraction.
 *
 * A provider unpriced in either region has `delta: null`: a missing number
 * is not a difference of zero.
 */

/**
 * @param {{ providers: object[] }|null} primary   the region on the page
 * @param {{ providers: object[], cheapest: string[] }|null} secondary  the compare region
 * @returns {{ providers: Record<string, { total: number|null, delta: number|null }>,
 *   cheapest: string[] }}
 */
export function compareRegions(primary, secondary) {
  const providers = {};
  for (const p of primary?.providers ?? []) {
    const other = (secondary?.providers ?? []).find((q) => q.provider === p.provider) ?? null;
    const total = other?.total ?? null;
    let delta = null;
    if (p.total !== null && total !== null) {
      delta = p.total > 0 ? (total - p.total) / p.total : 0;
    }
    providers[p.provider] = { total, delta };
  }
  return { providers, cheapest: Array.isArray(secondary?.cheapest) ? [...secondary.cheapest] : [] };
}
