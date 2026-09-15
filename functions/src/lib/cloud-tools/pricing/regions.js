/**
 * The regions the comparison page offers, and the names the services carry.
 *
 * This is the contract the frontend is built against (#613). The page shows
 * a region picker with exactly these three entries, and the cache document
 * the refresh writes is keyed by their `id` — so a region can be offered here
 * only if `refresh.js` also refreshes it, which it does by iterating this
 * list. One list, two consumers, no third copy.
 *
 * Each option's per-provider names are written out rather than looked up at
 * import time so a reader sees what `us-east-1` means to Azure and GCP
 * without opening shared.js. They MUST agree with `PROVIDER_REGION_MATRIX`
 * — `resolveProviderRegion` is what the row composer stamps into
 * `providerRegion`, and a disagreement here would make the header say one
 * region and every row another. regions.test.js asserts the agreement.
 */

import { PROVIDERS, BASELINE_COSTS } from './baseline.js';

/** @typedef {{id: string, label: string, aws: string, azure: string, gcp: string}} RegionOption */

/** @type {readonly RegionOption[]} */
export const REGION_OPTIONS = Object.freeze([
  Object.freeze({
    id: 'us-east-1',
    label: 'US East',
    aws: 'us-east-1',
    azure: 'eastus',
    gcp: 'us-central1',
  }),
  Object.freeze({
    id: 'us-west-2',
    label: 'US West',
    aws: 'us-west-2',
    azure: 'westus3',
    gcp: 'us-west1',
  }),
  Object.freeze({
    id: 'westeurope',
    label: 'Western Europe',
    aws: 'eu-west-1',
    azure: 'westeurope',
    gcp: 'europe-west1',
  }),
]);

export const DEFAULT_REGION = 'us-east-1';

/**
 * Human names per service, in the order BASELINE_COSTS lists them. Every
 * catalog service has one; regions.test.js fails if the two sets drift.
 */
export const SERVICE_LABELS = Object.freeze({
  'compute-vm': 'Virtual machines',
  'compute-serverless': 'Serverless functions',
  'storage-object': 'Object storage',
  'database-relational': 'Relational database',
  'database-nosql': 'NoSQL database',
  'containers-kubernetes': 'Managed Kubernetes',
  'integration-messaging': 'Messaging',
  'edge-cdn': 'CDN egress',
});

/**
 * Human names per provider, for prose that names one (the newsletter's price
 * changes). The comparison page renders its own column headers.
 */
export const PROVIDER_LABELS = Object.freeze({
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'Google Cloud',
});

/** The region option for an id, or null. Exact match — no trimming, no case folding. */
export function regionOption(id) {
  return REGION_OPTIONS.find((option) => option.id === id) ?? null;
}

/** The `id` + `label` projection the public read returns. */
export function publicRegionOptions() {
  return REGION_OPTIONS.map(({ id, label }) => ({ id, label }));
}

/** The Cosmos document id for one region's cache document. */
export function pricingDocId(regionId) {
  return `pricing:${regionId}`;
}

/**
 * The number of (service × provider) cells the comparison shows. The "not
 * refreshed yet" response reports every one of them unavailable, and this is
 * computed rather than written as 24 so the catalog growing is not a lie here.
 */
export const COMPARISON_CELLS = Object.keys(BASELINE_COSTS).length * PROVIDERS.length;
