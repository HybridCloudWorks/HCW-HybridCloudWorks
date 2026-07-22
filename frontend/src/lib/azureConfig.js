/**
 * Azure backend routing configuration for browser code.
 *
 * The browser must not instantiate a Cosmos DB data-plane client or receive a Cosmos access key.
 * Public projections and authenticated mutations are served through Azure Functions.
 */

/**
 * Get the Azure Functions base URL for API calls.
 *
 * @returns {string} Configured Functions base URL, or an empty string when unset.
 */
export function getAzureFunctionsUrl() {
  return import.meta.env.VITE_AZURE_FUNCTIONS_URL || '';
}

/**
 * Check whether the frontend is configured to use the Azure backend.
 *
 * @returns {boolean} True when Azure is the selected backend provider.
 */
export function isAzureBackend() {
  return import.meta.env.VITE_BACKEND_PROVIDER === 'azure';
}
