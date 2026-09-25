/**
 * Azure Resource Graph, read with the Function App's own managed identity
 * (#664; ADR 0032 decision 3).
 *
 * One REST call and no SDK. `@azure/arm-resourcegraph` would add a dependency
 * to say what a single `fetch` says: the same `DefaultAzureCredential` the
 * vault client uses (lib/secret-vault.js) mints a management-plane token, and
 * the query goes to
 *
 *   POST https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01
 *   { "subscriptions": ["<application subscription>"], "query": "<KQL>" }
 *   → { "totalRecords", "count", "data": [ { …one object per row… } ], "resultTruncated" }
 *
 * per https://learn.microsoft.com/rest/api/azureresourcegraph/resourcegraph/resources/resources
 * (retrieved 2026-09-25). `data` is an array of objects in this api-version,
 * so a row's columns are its keys.
 *
 * WHAT THE IDENTITY CAN SEE is the whole grant. Resource Graph returns only
 * the rows a caller has read access to, and the Function App's identity holds
 * Reader on `rg-lab-hybrid-prod-cus` alone (infra/lab-hybrid.tf) — so a query
 * that names nothing else still cannot see anything else, and there is no new
 * credential anywhere in this path.
 *
 * THE QUERY IS SCOPED TO THE APPLICATION SUBSCRIPTION, taken from
 * `FUNCTION_APP_RESOURCE_ID`, which Terraform always writes
 * (infra/functionapp.tf) and which the vault client already relies on. A
 * process without it — a local run, the route-inventory and api-contract
 * tests — has nothing to scope the read to, and `query()` refuses with
 * `ARG_UNSCOPED` BEFORE touching the credential. That matters in the tests,
 * which invoke every public handler: a `DefaultAzureCredential` probe from
 * inside a unit test is slow, and on a developer machine with `az login` it is
 * a live call.
 */

import { DefaultAzureCredential } from '@azure/identity';
import { fetchWithTimeout } from '../http/fetch-with-timeout.js';

export const RESOURCE_GRAPH_API_VERSION = '2021-03-01';
export const RESOURCE_GRAPH_URL = `https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=${RESOURCE_GRAPH_API_VERSION}`;
export const ARM_SCOPE = 'https://management.azure.com/.default';
/** Resource Graph normally answers in well under a second; this is the ceiling, not the expectation. */
export const RESOURCE_GRAPH_TIMEOUT_MS = 8_000;

/** The subscription segment of an ARM resource id, or null. */
export function subscriptionFromResourceId(resourceId) {
  const match = /^\/subscriptions\/([0-9a-f-]{36})\//i.exec(String(resourceId ?? '').trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * @param {object} [deps]
 * @param {Record<string, string|undefined>} [deps.env]
 * @param {Function} [deps.fetchImpl]
 * @param {{ getToken: Function }} [deps.credential] - test seam; production builds DefaultAzureCredential lazily
 */
export function createResourceGraphClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
  credential,
} = {}) {
  const subscription = subscriptionFromResourceId(env?.FUNCTION_APP_RESOURCE_ID);
  let cached = credential ?? null;
  const getCredential = () => (cached ??= new DefaultAzureCredential());

  return {
    /** The subscription every query is scoped to, or null when this process knows none. */
    subscription,

    /**
     * Run one KQL query and return its rows.
     *
     * @param {string} kql
     * @returns {Promise<object[]>}
     * @throws `{ code: 'ARG_UNSCOPED' }` when no subscription is known;
     *   `{ status }` when ARM answers anything but 200; the fetch error otherwise.
     */
    async query(kql) {
      if (!subscription) {
        throw Object.assign(
          new Error('Resource Graph read is not scoped: FUNCTION_APP_RESOURCE_ID is not set'),
          { code: 'ARG_UNSCOPED' }
        );
      }

      const token = await getCredential().getToken(ARM_SCOPE);
      if (!token?.token) throw new Error(`Could not acquire a token for ${ARM_SCOPE}`);

      const response = await fetchWithTimeout(fetchImpl, RESOURCE_GRAPH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ subscriptions: [subscription], query: String(kql) }),
        timeoutMs: RESOURCE_GRAPH_TIMEOUT_MS,
      });

      if (!response.ok) {
        throw Object.assign(new Error(`Resource Graph answered ${response.status}`), {
          status: response.status,
        });
      }

      const payload = await response.json();
      return Array.isArray(payload?.data) ? payload.data : [];
    },
  };
}
