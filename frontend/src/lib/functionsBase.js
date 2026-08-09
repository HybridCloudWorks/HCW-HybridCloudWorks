/**
 * The single resolver for the Azure Functions API base URL.
 *
 * Every browser call to the backend — authenticated RPCs (lib/api.js), the
 * anonymous public reads (lib/publicApi.js), and one-off fetches in components
 * — must resolve its base through this module. Nothing else should read the
 * environment variable directly; a second copy of the resolution logic is how
 * the retired Google Cloud Functions base URL survived the Azure port in two
 * files that were still pointing at the decommissioned GCP host. A test in
 * functionsBase.test.js keeps that variable from coming back.
 *
 * The browser must never instantiate a Cosmos DB data-plane client or receive
 * a Cosmos access key (`.azure/api-surface.json` → `meta.constraint`). Public
 * projections and authenticated mutations are served through Azure Functions
 * only, which is why this base URL is the whole of the browser's backend
 * configuration.
 *
 * ## Configuring the base
 *
 * One variable, `VITE_AZURE_FUNCTIONS_URL`, covers both deployment topologies:
 *
 * - **Same-origin** (Static Web Apps linked backend, or a reverse proxy in
 *   front of both the SPA and the Function App):
 *   `VITE_AZURE_FUNCTIONS_URL=/api`
 * - **Cross-origin** (Function App on its own hostname):
 *   `VITE_AZURE_FUNCTIONS_URL=https://hcw-functions-prod.azurewebsites.net/api`
 *
 * The value must include the Functions host route prefix. That prefix is `api`
 * — `functions/host.json` does not override it — and every route in
 * `functions/src/functions/*.js` is registered relative to it, so
 * `route: 'public/content'` is served at `<host>/api/public/content`.
 *
 * There is deliberately no default and no fallback. An unset base throws
 * rather than issuing same-origin requests against the host serving the SPA,
 * where the SPA's history fallback would answer with `index.html` and the
 * failure would surface as an unrelated JSON parse error.
 */

const RAW_BASE = (import.meta.env.VITE_AZURE_FUNCTIONS_URL || '').trim();

/**
 * Resolve the configured API base, with trailing slashes removed so callers
 * can always join with a single '/'.
 *
 * @returns {string} The base URL, or an empty string when unconfigured.
 */
export function getFunctionsBase() {
  return RAW_BASE.replace(/\/+$/, '');
}

/**
 * Resolve the API base, throwing a diagnosable error when it is unset.
 *
 * @param {string} context - What the caller was trying to do, named in the
 *   error message (an RPC name, or a path such as `public/content`).
 * @returns {string} The base URL.
 * @throws {Error} When `VITE_AZURE_FUNCTIONS_URL` is unset or blank.
 */
/**
 * Resolve a stored media URL for use in an `<img src>`.
 *
 * The API persists uploaded-image URLs as site-relative paths
 * (`/api/public/media/{container}/{path}`) so that a topology change cannot
 * invalidate every image already written to Cosmos. That value is directly
 * usable in a same-origin deployment and meaningless in a cross-origin one,
 * which is what this bridges.
 *
 * Anything else — an absolute URL, a data URI, an empty value — is returned
 * untouched. Documents migrated from the source system hold absolute URLs, and
 * rewriting those would break them.
 *
 * @param {string} url
 * @returns {string}
 */
export function resolveMediaUrl(url) {
  const value = typeof url === 'string' ? url.trim() : '';
  if (!value.startsWith('/api/')) return value;

  const base = getFunctionsBase();
  // Relative base: the path already points at the right place.
  if (!/^https?:\/\//i.test(base)) return value;

  return `${new URL(base).origin}${value}`;
}

export function requireFunctionsBase(context) {
  const base = getFunctionsBase();
  if (!base) {
    throw new Error(
      `VITE_AZURE_FUNCTIONS_URL is not set, so ${context} cannot be called. ` +
        'Set it to "/api" for a same-origin deployment, or to the Function App ' +
        'origin followed by "/api" for a cross-origin one.'
    );
  }
  return base;
}
