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

/**
 * The CORS allowlist is built ONCE per worker process and then never
 * mentioned again — which is how a wrong allowlist becomes an afternoon.
 *
 * On 2026-08-22 `CORS_ALLOWED_ORIGINS` was set correctly in ARM, verified
 * byte-for-byte, and the app still refused the origin. Ruling that out took a
 * restart, a stop/start, two deploys and about twenty probes, because from
 * outside there is no difference between "the setting did not arrive", "the
 * setting arrived and was parsed wrong", and "the code never read it". One log
 * line at construction distinguishes all three.
 *
 * It is written once per process, at INFO, and names only origins — the same
 * information any browser preflight already reveals. It discloses nothing that
 * `Access-Control-Allow-Origin` does not, so it is safe in a way that logging
 * app settings generally is not.
 */
function getDefaultCors() {
  if (!defaultCors) {
    defaultCors = createCors({ extraOrigins: parseExtraOrigins() });
  }
  return defaultCors;
}

let allowlistLogged = false;

/**
 * Report the allowlist the worker actually built, once per process.
 *
 * This used `console.log`, from inside `getDefaultCors`, and produced nothing
 * — through two deploys and a lot of confusion. In the Node v4 model only
 * `context.log` reaches Application Insights: it arrives under the
 * `Function.<name>.User` category, forwarded by the host over the invocation
 * channel. Plain `console.log`, especially outside an invocation, has no such
 * route. So the line must be written from inside a request with the context in
 * hand, which is why it lives here rather than where the allowlist is built.
 *
 * It exists because T-513 is open: `CORS_ALLOWED_ORIGINS` is set on the app and
 * the app does not honour it, while `TELEGRAM_BOT_TOKEN` in the same worker
 * reads fine. Confirmed from outside on 2026-08-22 — the setting carries two
 * origins and only the one compiled into `PREVIEW_ORIGINS` answers 200. This
 * line separates the two remaining explanations: the value never reaches
 * `process.env`, or it reaches it and parses to empty.
 *
 * Origins only. `Access-Control-Allow-Origin` already returns the same
 * information to any browser that asks.
 */
function logAllowlistOnce(context) {
  if (allowlistLogged) return;
  allowlistLogged = true;
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  const extraOrigins = parseExtraOrigins();
  context?.log?.(
    `[cors] allowlist built: ${extraOrigins.length} extra origin(s) ` +
      `${JSON.stringify(extraOrigins)}; CORS_ALLOWED_ORIGINS is ` +
      `${raw === undefined ? 'UNSET in this process' : `${JSON.stringify(raw)} (${raw.length} chars)`}`
  );
}


/** Test seam: drop the memoised CORS evaluator so env changes take effect. */
export function resetHttpRouteCors() {
  defaultCors = null;
  allowlistLogged = false;
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
      // Only for the real, memoised evaluator — a test seam has nothing to say.
      if (!cors) logAllowlistOnce(context);
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

/**
 * Register ONE function that serves several methods on ONE route template.
 *
 * The Azure Functions host keys its route table on the **route template
 * alone** — not on template + method. Two functions that declare the same
 * `route` with different `methods` are a conflict: the host keeps one and
 * refuses to start the other with *"is in error: The route specified conflicts
 * with the route defined by function X"*. The losing verb then answers 404,
 * which reads as a missing endpoint rather than a registration defect.
 *
 * That is not a hypothetical. It shipped: seven `cms/*` templates were each
 * declared two or three times, eight functions never started, and the admin UI
 * lost list, patch and put across certifications, recordings, social posts,
 * settings, config and keyword-config (TODO.md T-510). Nothing caught it,
 * because every one of those registrations was individually correct.
 *
 * So: one template, one registration, and the method fan-out happens here.
 *
 *   httpRouteByMethod('cmsCertifications', {
 *     authLevel: 'anonymous',
 *     route: 'cms/certifications',
 *     handlers: {
 *       GET: (request, context) => handlers().listCertifications(request, context),
 *       POST: (request, context) => handlers().createCertification(request, context),
 *     },
 *   });
 *
 * Each verb keeps its own guard, exactly as it did when it was its own
 * function — this changes registration, not authorization. `OPTIONS` never
 * reaches the dispatcher: `httpRoute` adds it to the method list and the CORS
 * evaluator answers the preflight first.
 *
 * @param {string} name - Function name
 * @param {object} options - `httpRoute` options, but `handlers` replaces `handler`/`methods`
 * @param {Record<string, Function>} options.handlers - method (upper-case) → handler
 * @param {object} [deps] - test seam, forwarded to `httpRoute`
 */
export function httpRouteByMethod(name, { handlers, ...options }, deps) {
  const table = new Map(
    Object.entries(handlers || {}).map(([method, fn]) => [method.toUpperCase(), fn])
  );
  if (table.size === 0) throw new Error(`httpRouteByMethod('${name}') needs at least one handler`);

  const methods = [...table.keys()];

  return httpRoute(
    name,
    {
      ...options,
      methods,
      handler: (request, context) => {
        const fn = table.get(String(request.method || '').toUpperCase());
        // Unreachable through the host, which only routes the methods declared
        // above — but a direct call in a test, or a future edit that adds a
        // method to `methods` without adding a handler, lands here rather than
        // on `undefined is not a function`.
        if (!fn) {
          return {
            status: 405,
            headers: { 'Content-Type': 'application/json', Allow: methods.join(', ') },
            body: JSON.stringify({ error: 'Method not allowed' }),
          };
        }
        return fn(request, context);
      },
    },
    deps
  );
}
