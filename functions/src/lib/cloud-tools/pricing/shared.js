/**
 * Cross-provider pricing helpers.
 *
 * Ported from Site-Main `functions/cloud-tools-pricing.js` (commit 07f3123),
 * CommonJS → ESM, behaviour unchanged. The accompanying tests came across with
 * it, so drift shows up as a failure rather than as a wrong number on a page.
 *
 * The benchmark SKU/unit constants below are the only thing making the AWS,
 * Azure and GCP columns comparable to each other — each provider prices
 * serverless, NoSQL and messaging on a different meter, so all three converge
 * on a synthetic workload. Changing one of these strings without changing the
 * arithmetic that feeds it silently makes the comparison a lie.
 */

/**
 * Maps a caller-supplied region to each provider's equivalent.
 * A region absent from this table passes through unchanged.
 */
export const PROVIDER_REGION_MATRIX = Object.freeze({
  'us-east-1': { aws: 'us-east-1', azure: 'eastus', gcp: 'us-central1' },
  eastus: { aws: 'us-east-1', azure: 'eastus', gcp: 'us-central1' },
  'us-central1': { aws: 'us-east-1', azure: 'eastus', gcp: 'us-central1' },
  'us-west-2': { aws: 'us-west-2', azure: 'westus3', gcp: 'us-west1' },
  westus3: { aws: 'us-west-2', azure: 'westus3', gcp: 'us-west1' },
  westeurope: { aws: 'eu-west-1', azure: 'westeurope', gcp: 'europe-west1' },
  'europe-west1': { aws: 'eu-west-1', azure: 'westeurope', gcp: 'europe-west1' },
});

export const SERVERLESS_BENCHMARK_SKU = '1M requests + 400k GB-s benchmark';
export const SERVERLESS_BENCHMARK_UNIT = 'normalized request workload';
export const NOSQL_BENCHMARK_SKU = '1M transactional operations benchmark';
export const NOSQL_BENCHMARK_UNIT = 'million operations';
export const MESSAGING_BENCHMARK_SKU = '1M standard message operations benchmark';
export const MESSAGING_BENCHMARK_UNIT = 'million operations';
export const GCP_MESSAGING_BENCHMARK_BYTES = 1_000_000 * 1024;

/**
 * Translate a requested region into one provider's naming.
 *
 * @param {string} requestedRegion
 * @param {'aws'|'azure'|'gcp'} provider
 * @returns {string}
 */
export function resolveProviderRegion(requestedRegion, provider) {
  const mapped = PROVIDER_REGION_MATRIX[String(requestedRegion || '').trim()];
  return mapped?.[provider] || requestedRegion;
}

/**
 * Google's `{units, nanos}` money shape → a Number.
 * Numbers pass through; anything else is 0.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function moneyToNumber(value) {
  if (typeof value === 'number') return value;
  if (!value || typeof value !== 'object') return 0;
  return Number((Number(value.units || 0) + Number(value.nanos || 0) / 1_000_000_000).toFixed(8));
}

/**
 * Normalise the wildly different unit strings the three providers return into
 * the vocabulary the frontend renders.
 *
 * The ordering of these replacements matters — 'GB/Month' must be tried before
 * the bare '/Month' rule would mangle it — so this is transcribed in the
 * original order rather than tidied into a lookup table.
 *
 * @param {unknown} unit
 * @returns {string}
 */
export function normalizeUnit(unit) {
  return String(unit || '')
    .replace(/^1\s+/i, '')
    .replace('/Month', '-month')
    .replace('GB/Month', 'GB-month')
    .replace('GB-Mo', 'GB-month')
    .replace('GiBy.mo', 'GB-month')
    .replace('GiBy.h', 'GB-hour')
    .replace('1/Hour', 'hour')
    .replace('1 Hour', 'hour')
    .replace('1 GB', 'GB')
    .replace('10K', '10K operations')
    .replace(/^h$/i, 'hour')
    .replace('TiBy', 'TB')
    .replace('WriteRequestUnits', 'operations')
    .replace('ReadRequestUnits', 'operations')
    .replace('Requests', 'operations')
    .replace('Hours', 'hour')
    .replace('Hrs', 'hour')
    .trim();
}

/** Source strings that appear in the served pricing row. */
export const PRICING_SOURCE = Object.freeze({
  aws: 'aws-price-list-query-api',
  azure: 'azure-retail-prices-api',
  gcp: 'gcp-cloud-billing-catalog-api',
  baseline: 'baseline-fallback',
});
