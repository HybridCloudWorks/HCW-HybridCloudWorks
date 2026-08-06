/**
 * GCP pricing via the Cloud Billing Catalog API.
 *
 * Ported from Site-Main `functions/cloud-tools-pricing.js:145-154, 463-743`
 * (commit 07f3123). The SKU-matching logic is transcribed unchanged — those
 * regexes and multipliers are the comparison contract.
 *
 * Two things are deliberately different.
 *
 * ===========================================================================
 * 1. CREDENTIALS — Key Vault, not Application Default Credentials
 * ===========================================================================
 * The source used `new GoogleAuth({scopes})`, i.e. ADC, which resolves from a
 * GCE metadata server or a well-known file. Neither exists on Azure. A
 * service-account JSON is loaded from Key Vault instead and passed explicitly.
 *
 * The runtime Key Vault lookup is used rather than an app-setting Key Vault
 * reference, unlike the AWS keys: a service-account JSON is a ~2.3 KB
 * multi-line blob, and app settings are visible in the portal and in
 * `az webapp config appsettings list`.
 *
 * `getSecret` swallows errors and returns null (`key-vault.js:37-40`). That is
 * wrong for a credential — a misconfigured vault would look like "GCP has no
 * price for this service" and produce a silent baseline row. This module
 * THROWS when the secret is absent, so it is logged as the fault it is.
 *
 * ===========================================================================
 * 2. FILTER BEFORE ACCUMULATING
 * ===========================================================================
 * The source did `allSkus.push(...skus)` across up to 30 pages of 5,000 SKUs —
 * accumulating up to 150,000 SKU objects. It has to accumulate rather than
 * match per page, because several services need a PAIR of SKUs (vCPU + RAM)
 * that can straddle a page boundary.
 *
 * But every branch of the matcher requires `inRegion(sku)` first, so SKUs for
 * other regions can be dropped as each page arrives. Same semantics, a small
 * fraction of the retained objects. The 30-page cap is kept.
 */

import { GoogleAuth } from 'google-auth-library';

import { getSecret } from '../../key-vault.js';
import {
  GCP_MESSAGING_BENCHMARK_BYTES,
  MESSAGING_BENCHMARK_SKU,
  MESSAGING_BENCHMARK_UNIT,
  NOSQL_BENCHMARK_SKU,
  NOSQL_BENCHMARK_UNIT,
  SERVERLESS_BENCHMARK_SKU,
  SERVERLESS_BENCHMARK_UNIT,
  moneyToNumber,
  normalizeUnit,
  resolveProviderRegion,
} from './shared.js';

/** Key Vault secret holding the GCP service-account JSON. No underscores allowed. */
const GCP_CREDENTIAL_SECRET = 'GCP-SERVICE-ACCOUNT-JSON';

const BILLING_API = 'https://cloudbilling.googleapis.com/v1';
const MAX_SKU_PAGES = 30;

/** Cloud Billing display names per catalog service. */
export const GCP_SERVICE_NAMES = {
  'compute-vm': 'Compute Engine',
  'compute-serverless': 'Cloud Run Functions',
  'storage-object': 'Cloud Storage',
  'database-relational': 'Cloud SQL',
  'database-nosql': 'Cloud Firestore',
  'containers-kubernetes': 'Kubernetes Engine',
  'integration-messaging': 'Cloud Pub/Sub',
  'edge-cdn': 'Cloud CDN',
};

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

let cachedAuth = null;

/**
 * Build a GoogleAuth client from the Key Vault service-account JSON.
 * Memoised — the source constructed a client per call.
 */
export async function getGoogleAuth(deps = {}) {
  if (cachedAuth) return cachedAuth;

  const fetchSecret = deps.getSecret ?? getSecret;
  const raw = await fetchSecret(GCP_CREDENTIAL_SECRET);

  if (!raw) {
    // Deliberately a throw, not a null. A missing credential is a fault, and a
    // null here would be indistinguishable from "this service has no GCP
    // price" and would silently become a baseline row.
    throw new Error(
      `GCP pricing credential unavailable: Key Vault secret ${GCP_CREDENTIAL_SECRET} is missing or unreadable`
    );
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error(`GCP pricing credential malformed: ${GCP_CREDENTIAL_SECRET} is not valid JSON`);
  }

  cachedAuth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  return cachedAuth;
}

async function getGoogleAccessToken(deps = {}) {
  if (deps.accessToken) return deps.accessToken;

  const auth = await getGoogleAuth(deps);
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return typeof token === 'string' ? token : token?.token || null;
}

let cachedGoogleServices = null;

async function getGoogleServices(accessToken, deps = {}) {
  if (cachedGoogleServices) return cachedGoogleServices;

  const doFetch = deps.fetch ?? globalThis.fetch;
  const response = await doFetch(`${BILLING_API}/services?pageSize=5000`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Google services list returned ${response.status}`);

  const json = await response.json();
  cachedGoogleServices = Array.isArray(json.services) ? json.services : [];
  return cachedGoogleServices;
}

/** Drop memoised GCP state. Called by clearPricingCaches, and by tests. */
export function resetGoogleCaches() {
  cachedGoogleServices = null;
  cachedAuth = null;
}

// ---------------------------------------------------------------------------
// SKU matching — transcribed from the source
// ---------------------------------------------------------------------------

/**
 * Price from a tiered rate structure.
 * `firstNonZero` skips free tiers, which GCP expresses as a $0 first tier.
 */
export function getGoogleTieredRatePrice(pricingExpression, options = {}) {
  const rates = Array.isArray(pricingExpression?.tieredRates) ? pricingExpression.tieredRates : [];
  if (!rates.length) return 0;

  if (options.firstNonZero) {
    const nonZero = rates.find((rate) => moneyToNumber(rate?.unitPrice) > 0);
    if (nonZero) return moneyToNumber(nonZero.unitPrice);
  }
  return moneyToNumber(rates[0]?.unitPrice);
}

/** Is this SKU offered in the region we are pricing? */
export function inRegion(sku, providerRegion) {
  return (
    Array.isArray(sku.serviceRegions) &&
    (sku.serviceRegions.includes(providerRegion) || sku.serviceRegions.includes('global'))
  );
}

const rate = (sku) =>
  getGoogleTieredRatePrice(sku.pricingInfo?.[0]?.pricingExpression, { firstNonZero: true });

/**
 * @param {string} serviceId
 * @param {object[]} skus  already filtered to the region
 * @param {string} providerRegion
 * @returns {{sku: string, unit: string, pricePerUnit: number}|null}
 */
export function findGoogleSkuMatch(serviceId, skus, providerRegion) {
  const here = (sku) => inRegion(sku, providerRegion);
  const onDemand = (sku) => sku.category?.usageType === 'OnDemand';
  const describes = (re) => (sku) => re.test(sku.description || '');

  if (serviceId === 'compute-vm') {
    const core = skus.find((s) => here(s) && onDemand(s) && /^E2 Instance Core running in /i.test(s.description || ''));
    const memory = skus.find((s) => here(s) && onDemand(s) && /^E2 Instance Ram running in /i.test(s.description || ''));
    if (!core || !memory) return null;
    return {
      sku: 'E2-derived 4 vCPU / 16 GiB',
      unit: 'hour',
      pricePerUnit: 4 * rate(core) + 16 * rate(memory),
    };
  }

  if (serviceId === 'compute-serverless') {
    const cpu = skus.find(
      (s) => here(s) && onDemand(s) && /Cloud Run functions CPU \(Request-based billing\)/i.test(s.description || '')
    );
    const memory = skus.find(
      (s) => here(s) && onDemand(s) && /Cloud Run functions Memory \(Request-based billing\)/i.test(s.description || '')
    );
    if (!cpu || !memory) return null;
    return {
      sku: SERVERLESS_BENCHMARK_SKU,
      unit: SERVERLESS_BENCHMARK_UNIT,
      pricePerUnit: 200000 * rate(cpu) + 400000 * rate(memory),
    };
  }

  if (serviceId === 'storage-object') {
    const sku = skus.find(
      (s) =>
        here(s) &&
        /Standard Storage/i.test(s.description || '') &&
        /(Dual-region|Regional|Iowa|Belgium|Oregon)/i.test(s.description || '')
    );
    if (!sku) return null;
    return { sku: sku.description, unit: 'GB-month', pricePerUnit: rate(sku) };
  }

  if (serviceId === 'database-relational') {
    const cpu = skus.find((s) => here(s) && onDemand(s) && /Cloud SQL .* Regional - vCPU/i.test(s.description || ''));
    const memory = skus.find((s) => here(s) && onDemand(s) && /Cloud SQL .* Regional - RAM/i.test(s.description || ''));
    if (!cpu || !memory) return null;
    return {
      sku: 'Cloud SQL regional 2 vCPU / 8 GiB derived',
      unit: 'hour',
      pricePerUnit: 2 * rate(cpu) + 8 * rate(memory),
    };
  }

  if (serviceId === 'database-nosql') {
    const isCount = (s) => s.pricingInfo?.[0]?.pricingExpression?.usageUnit === 'count';
    const readSku = skus.find((s) => here(s) && /Cloud Firestore Read Ops/i.test(s.description || '') && isCount(s));
    const writeSku = skus.find((s) => here(s) && /Cloud Firestore Entity Writes/i.test(s.description || '') && isCount(s));
    if (!readSku || !writeSku) return null;
    return {
      sku: NOSQL_BENCHMARK_SKU,
      unit: NOSQL_BENCHMARK_UNIT,
      pricePerUnit: rate(readSku) * 500_000 + rate(writeSku) * 500_000,
    };
  }

  if (serviceId === 'containers-kubernetes') {
    const cpu = skus.find((s) => here(s) && onDemand(s) && /Autopilot Balanced Pod mCPU Requests/i.test(s.description || ''));
    const memory = skus.find((s) => here(s) && onDemand(s) && /Autopilot Balanced Pod Memory Requests/i.test(s.description || ''));
    if (!cpu || !memory) return null;
    return {
      sku: 'Autopilot balanced pod requests',
      unit: 'hour',
      // 4000 mCPU, i.e. 4 vCPU expressed in the milli-CPU meter.
      pricePerUnit: 4000 * rate(cpu) + 16 * rate(memory),
    };
  }

  if (serviceId === 'integration-messaging') {
    const sku = skus.find((s) => here(s) && describes(/Message Delivery Basic/i)(s));
    if (!sku) return null;
    const expression = sku.pricingInfo?.[0]?.pricingExpression;
    const unitPrice = getGoogleTieredRatePrice(expression, { firstNonZero: true });
    const usageUnit = normalizeUnit(expression?.usageUnit);
    return {
      sku: MESSAGING_BENCHMARK_SKU,
      unit: MESSAGING_BENCHMARK_UNIT,
      // Pub/Sub meters by volume, not by operation, so the benchmark converts.
      pricePerUnit:
        usageUnit === 'TB' ? unitPrice * (GCP_MESSAGING_BENCHMARK_BYTES / 1024 ** 4) : unitPrice,
    };
  }

  if (serviceId === 'edge-cdn') {
    const sku = skus.find(
      (s) => here(s) && /Networking Cloud CDN Traffic Cache Data Transfer/i.test(s.description || '')
    );
    if (!sku) return null;
    return {
      sku: sku.description,
      unit: 'GB egress',
      // Note: tieredRates[0] directly, NOT firstNonZero. Carried over as-is.
      pricePerUnit: moneyToNumber(sku.pricingInfo?.[0]?.pricingExpression?.tieredRates?.[0]?.unitPrice),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Resolve one service's GCP price.
 *
 * @returns {Promise<{sku: string, unit: string, pricePerUnit: number}|null>}
 */
export async function fetchGcpPrice(serviceId, requestedRegion, deps = {}) {
  const serviceName = GCP_SERVICE_NAMES[serviceId];
  if (!serviceName) return null;

  const providerRegion = resolveProviderRegion(requestedRegion, 'gcp');
  const doFetch = deps.fetch ?? globalThis.fetch;

  const accessToken = await getGoogleAccessToken(deps);
  const services = await getGoogleServices(accessToken, deps);
  const service = services.find((item) => item.displayName === serviceName);
  if (!service?.name) return null;

  // Accumulates across pages because several services need a PAIR of SKUs
  // (vCPU + RAM) that can straddle a page boundary — but only region-relevant
  // SKUs are retained, since every matcher branch requires inRegion first.
  const candidates = [];
  let pageToken = '';

  for (let page = 0; page < MAX_SKU_PAGES; page += 1) {
    const url = new URL(`${BILLING_API}/${service.name}/skus`);
    url.searchParams.set('pageSize', '5000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await doFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Google SKUs returned ${response.status}`);

    const json = await response.json();
    const skus = Array.isArray(json.skus) ? json.skus : [];
    for (const sku of skus) {
      if (inRegion(sku, providerRegion)) candidates.push(sku);
    }

    const match = findGoogleSkuMatch(serviceId, candidates, providerRegion);
    if (match) {
      return {
        sku: match.sku,
        unit: match.unit,
        pricePerUnit: Number(match.pricePerUnit.toFixed(6)),
      };
    }

    pageToken = json.nextPageToken || '';
    if (!pageToken) break;
  }

  return null;
}
