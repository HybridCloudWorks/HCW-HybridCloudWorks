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
 * ORDERING IS LOAD-BEARING. Two notes:
 *
 * 1. The `'1 Hour'` / `'1 GB'` literals are hoisted ABOVE the `/^1\s+/` strip.
 *    In the source they came after it, which made them unreachable: the strip
 *    had already turned '1 Hour' into 'Hour', so the literal could never match
 *    and the function returned a capitalised 'Hour'. '1/Hour' has no
 *    whitespace, so its rule did fire — which is presumably why the asymmetry
 *    went unnoticed.
 *
 *    This is currently a latent bug rather than a live one: all eight Azure
 *    service configs set `unit` explicitly, so the
 *    `config.unit || normalizeUnit(item.unitOfMeasure)` fallback is unreachable
 *    for every service that exists today. It was fixed precisely BECAUSE that
 *    makes it a no-op now — the accompanying test pins every unit string the
 *    current providers actually emit as byte-identical across this change.
 *    Azure's `unitOfMeasure` really is formatted '1 Hour', '1 GB/Month', '10K',
 *    so the first service added without an explicit unit would have hit it.
 *
 * 2. '/Month' before 'GB/Month' means the latter never matches either, but both
 *    produce 'GB-month' so it is harmless. Left as-is rather than tidied —
 *    there is no behaviour to gain and the transcription stays diffable against
 *    the source.
 *
 * @param {unknown} unit
 * @returns {string}
 */
export function normalizeUnit(unit) {
  return String(unit || '')
    .replace('1/Hour', 'hour')
    .replace('1 Hour', 'hour')
    .replace('1 GB', 'GB')
    .replace(/^1\s+/i, '')
    .replace('/Month', '-month')
    .replace('GB/Month', 'GB-month')
    .replace('GB-Mo', 'GB-month')
    .replace('GiBy.mo', 'GB-month')
    .replace('GiBy.h', 'GB-hour')
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
