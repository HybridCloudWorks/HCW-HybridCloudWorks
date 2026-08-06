/**
 * Catalog baselines — the fallback prices used when a live lookup misses.
 *
 * Lifted from Site-Main `functions/cloud-tools.js:215-271` (commit 07f3123).
 * This is data plus a pure composer, with no HTTP, auth or Cosmos in it, so it
 * ports ahead of the eleven Cloud Tools handlers rather than waiting on them.
 *
 * ===========================================================================
 * THE UNIT-MISMATCH PROBLEM
 * ===========================================================================
 * A comparison row can mix live and fallback values — AWS resolves live while
 * Azure misses and falls back. When that happens the row must still be
 * comparing like with like, and for three of eight services it was not:
 *
 *   service              baseline unit                live unit
 *   edge-cdn             TB egress                    GB egress          FIXED
 *   compute-serverless   million invocations          normalized request workload
 *   database-nosql       hour                         million operations
 *
 * `edge-cdn` is fixed below: $85/TB is exactly $0.085/GB, so restating it in
 * the live unit is arithmetic with no judgement in it. Before the fix a mixed
 * row rendered AWS `0.085` beside Azure `81` and a reader would conclude Azure
 * was a thousand times dearer.
 *
 * The other two are NOT convertible and are deliberately left alone:
 *
 * - `compute-serverless` baseline is 2.65 per million invocations; the live
 *   benchmark is requests×1e6 + duration×400k, roughly 6.87 for AWS. Different
 *   workloads, not different units.
 * - `database-nosql` baseline is 0.311 per hour of provisioned capacity; the
 *   live benchmark is per million on-demand operations. Different meters.
 *
 * Picking replacement numbers for those is a pricing-catalog decision, not a
 * refactor. They are recorded in KNOWN_UNIT_MISMATCHES so the accompanying test
 * asserts exactly these two and fails if a third ever appears.
 */

/**
 * Services whose baseline unit does not match what the live path emits.
 * Every entry here is a known defect awaiting a catalog decision. Adding to
 * this set should be a deliberate act; the test enforces that.
 */
export const KNOWN_UNIT_MISMATCHES = Object.freeze(
  new Set(['compute-serverless', 'database-nosql'])
);

/** @type {Record<string, {unit: string, sku: string, aws: number, azure: number, gcp: number}>} */
export const BASELINE_COSTS = Object.freeze({
  'compute-vm': {
    unit: 'hour',
    sku: '4 vCPU / 16 GiB general purpose',
    aws: 0.192,
    azure: 0.201,
    gcp: 0.184,
  },
  'compute-serverless': {
    // MISMATCH: live emits 'normalized request workload'. See the header.
    unit: 'million invocations',
    sku: '1M requests + 400k GB-s normalized',
    aws: 2.65,
    azure: 2.9,
    gcp: 2.4,
  },
  'storage-object': {
    unit: 'GB-month',
    sku: 'Hot / standard tier',
    aws: 0.023,
    azure: 0.02,
    gcp: 0.02,
  },
  'database-relational': {
    unit: 'hour',
    sku: '2 vCore managed instance',
    aws: 0.504,
    azure: 0.486,
    gcp: 0.441,
  },
  'database-nosql': {
    // MISMATCH: live emits 'million operations'. See the header.
    unit: 'hour',
    sku: 'Provisioned baseline capacity',
    aws: 0.311,
    azure: 0.338,
    gcp: 0.289,
  },
  'containers-kubernetes': {
    unit: 'hour',
    sku: 'Control plane + baseline nodes',
    aws: 0.42,
    azure: 0.401,
    gcp: 0.389,
  },
  'integration-messaging': {
    unit: 'million operations',
    sku: 'Standard tier normalized',
    aws: 0.8,
    azure: 0.91,
    gcp: 0.73,
  },
  'edge-cdn': {
    // FIXED: was `unit: 'TB egress'` with 85 / 81 / 78. Identical prices,
    // restated in the unit all three live paths emit, so a mixed live/fallback
    // row is comparable. $85/TB === $0.085/GB.
    unit: 'GB egress',
    sku: 'North America edge delivery',
    aws: 0.085,
    azure: 0.081,
    gcp: 0.078,
  },
});

/** Providers, in the order they appear in a comparison row. */
export const PROVIDERS = Object.freeze(['aws', 'azure', 'gcp']);

/** Look up a baseline, or null when the service is not in the catalog. */
export function baselineFor(serviceId) {
  return BASELINE_COSTS[serviceId] ?? null;
}
