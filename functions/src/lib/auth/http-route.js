/**
 * The single HTTP route registration helper.
 *
 * Every `app.http` registration in `src/functions/` goes through this. It
 * exists because CORS was correct, well tested, and wired into exactly one of
 * fifty-eight routes (TODO.md T-102) — the other fifty-seven registered
 * `app.http` directly and quietly opted out. A control that each call site must
 * remember to apply is a control that will be missing from route fifty-nine.
 *
 * What it guarantees, for every route, without the handler participating:
 *
 *  - **`OPTIONS` is registered.** A route that does not accept `OPTIONS` cannot
 *    answer a preflight, and the Functions host returns 404 before any handler
 *    runs. Every authenticated call carries `Authorization`, which forces a
 *    preflight, so this is not an edge case — it is every admin request.
 *  - **A disallowed origin is refused before the handler runs**, with the 403
 *    that `cors.js` DECISION 7 chose deliberately over silent browser-side
 *    failure.
 *  - **A preflight is answered without invoking the handler**, so no guard, no
 *    store read, and no rate-limit consumption happens on an `OPTIONS`.
 *  - **CORS headers are merged onto the handler's response**, including error
 *    responses. A 401 without `Access-Control-Allow-Origin` reaches the browser
 *    as an opaque network error, which is how an authorization message becomes
 *    an unexplained failure in the UI.
 *
 * Topology-independent, on purpose. The [REVIEW.md](REVIEW.md) §0.1 decision —
 * same-origin behind a Static Web App, or a separate API hostname — changes
 * configuration here, not code. Same-origin requests either carry no `Origin`
 * (allowed) or carry the site's own, which is already in the production
 * allowlist; a different SPA hostname is added through `CORS_ALLOWED_ORIGINS`.
 *
 * CORS IS NOT AN AUTHORIZATION CONTROL — it stops browsers, not curl. This
 * helper does not authorize anything, and no handler may treat having passed
 * through it as having been authorized. Guarding is still `requireRole`, and
 * the route-inventory test is what proves every route calls it.
 */

import { app } from '@azure/functions';
import { createCors } from './cors.js';

/**
 * Origins beyond the production allowlist, comma-separated.
 *
 * The escape hatch for a preview slot, a staging hostname, or a cross-origin
 * SPA host chosen by §0.1. Empty in the default deployment.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string[]}
 */
export function parseExtraOrigins(env = process.env) {
  return String(env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

let defaultCors = null;

function getDefaultCors() {
  if (!defaultCors) {
    defaultCors = createCors({ extraOrigins: parseExtraOrigins() });
  }
  return defaultCors;
}

/** Test seam: drop the memoised CORS evaluator so env changes take effect. */
export function resetHttpRouteCors() {
  defaultCors = null;
}

/**
 * Add `OPTIONS` to a method list without duplicating it or reordering.
 *
 * @param {string[]} methods
 * @returns {string[]}
 */
export function withPreflight(methods) {
  const list = Array.isArray(methods) && methods.length > 0 ? methods : ['GET'];
  return list.includes('OPTIONS') ? [...list] : [...list, 'OPTIONS'];
}

/**
 * Merge CORS headers onto a handler result.
 *
 * Handler headers win on collision: a handler that sets `Content-Type` or
 * `Cache-Control` means it, and CORS never needs to override either.
 *
 * @param {object|undefined} result
 * @param {Record<string, string>} corsHeaders
 * @returns {object}
 */
export function mergeCorsHeaders(result, corsHeaders) {
  if (!result || typeof result !== 'object') {
    return { status: 204, headers: { ...corsHeaders } };
  }
  return { ...result, headers: { ...corsHeaders, ...(result.headers || {}) } };
}

/**
 * Register an HTTP route with CORS and preflight handling applied.
 *
 * Signature-compatible with `app.http` so the call sites read the same.
 *
 * @param {string} name - Function name
 * @param {object} options - `app.http` options: methods, authLevel, route, handler
 * @param {object} [deps] - test seam; production uses the module-level CORS
 * @param {{ evaluate: Function }} [deps.cors]
 * @param {{ http: Function }} [deps.register]
 */
export function httpRoute(name, options, { cors, register = app } = {}) {
  const { handler, methods, ...rest } = options;

  register.http(name, {
    ...rest,
    methods: withPreflight(methods),
    handler: async (request, context) => {
      const evaluator = cors || getDefaultCors();
      const evaluation = evaluator.evaluate(request);

      // Disallowed origin (403) or preflight (204). Neither reaches the
      // handler: a preflight that ran the handler would consume rate limit and
      // hit the store for a request that carries no credentials.
      if (evaluation.response) return { ...evaluation.response };

      const result = await handler(request, context);
      return mergeCorsHeaders(result, evaluation.headers);
    },
  });
}
