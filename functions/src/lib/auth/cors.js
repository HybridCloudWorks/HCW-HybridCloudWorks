/**
 * CORS for the Cloud Tools / admin API.
 *
 * ===========================================================================
 * DECISION 7 — CORS lives in code, and the platform `cors` block is removed
 * ===========================================================================
 * Two allowlists is the actual hazard: they drift, and when a request fails you
 * cannot tell which one rejected it. Picking in-code, for three reasons:
 *
 *   1. The platform setting can only allowlist-or-omit. Site-Main's applyCors
 *      (`cloud-tools.js:355-376`) returns 403 on a disallowed origin, turning
 *      an invisible browser-side failure into a server-side signal you can
 *      alert on. Preserve that.
 *   2. The platform list is exact-match and cannot express a localhost port
 *      pattern. The Terraform hardcodes 5173 and 4173 — NARROWER than current
 *      behaviour, so a developer on any other port silently breaks.
 *   3. In-code is testable in the same suite as the authorization rules.
 *
 * `support_credentials = true` must also go from the Terraform: it makes the
 * platform intercept OPTIONS preflights itself, so an in-code preflight would
 * never run. It is wrong on its own merits too — this is a bearer-token API,
 * not a cookie API.
 *
 * LOCALHOST DOES NOT SURVIVE TO PRODUCTION. Site-Main includes it
 * unconditionally (`cloud-tools.js:51-53`) and that is a defect not to port:
 * `http://localhost:5173` in a production allowlist means any page running on
 * a victim's machine — a malicious local dev server, a compromised
 * `npm postinstall`, a rogue Electron app — can make cross-origin calls to
 * production carrying the victim's token. Gated on NODE_ENV here; the
 * production Function App already sets NODE_ENV=production, and a local
 * Functions host does not, so nothing is lost.
 *
 * CORS IS NOT AN AUTHORIZATION CONTROL. It stops browsers, not curl. Every
 * role check and rate limit must hold with no Origin header at all — which is
 * why a missing Origin is allowed through here rather than rejected. Do not
 * "harden" that into requiring the header: it would break non-browser clients
 * and buy nothing.
 */

/** Production origins. */
const PRODUCTION_ORIGINS = ['https://hybridcloudworks.com', 'https://www.hybridcloudworks.com'];

/**
 * The Static Web App's own hostname — TEMPORARY, for Migration_Plan §6 step 2.
 *
 * REMOVE IT when DNS moves (§6 step 5) and the preview host stops serving
 * anyone. It is a real origin that can reach the API, so leaving it behind is
 * leaving a door open for no reason.
 *
 * It is compiled in rather than supplied through `CORS_ALLOWED_ORIGINS`, which
 * is what §6 step 2 was originally going to use. On 2026-08-22 that setting was
 * applied correctly — verified in ARM byte-for-byte, 51 characters, single key
 * — and the running app still refused the origin, through a restart, a
 * stop/start, three deploys and about twenty probes. `parseExtraOrigins()` and
 * `createCors()` return `true` for that exact value locally, so the code is not
 * the problem, and `TELEGRAM_BOT_TOKEN` reaching the same worker proves app
 * settings do arrive. It is unexplained, and it is TODO.md T-513.
 *
 * Two reasons this is the better home regardless of how T-513 resolves:
 *
 *   1. An allowlist is a security control. In code it is reviewed, diffed and
 *      covered by the tests below. As an app setting it can be changed by
 *      anyone with Contributor, silently, with no test and no reviewer.
 *   2. Deploys are the one propagation path that is demonstrably reliable here
 *      — the function count moved 84 → 96 → 97 across three of them, while the
 *      same app ignored a setting written four different ways.
 */
const PREVIEW_ORIGINS = ['https://calm-ground-0d0e6a010.7.azurestaticapps.net'];

/**
 * Methods advertised in a preflight response.
 *
 * This was `GET, POST, OPTIONS`, written before the migration added the REST
 * surface. Fourteen registered routes use PUT, PATCH or DELETE; a browser that
 * preflights one of those reads this header, does not find its method, and
 * refuses to send the request — the call never reaches the guard, so nothing
 * server-side ever logs it (TODO.md T-102).
 */
const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

/** Dev-only origins, any port. Never active when NODE_ENV=production. */
const LOCALHOST_PATTERN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;

/**
 * @param {{ environment?: string, extraOrigins?: string[] }} [options]
 */
export function createCors({ environment = process.env.NODE_ENV, extraOrigins = [] } = {}) {
  const isProduction = environment === 'production';
  const allowlist = new Set([...PRODUCTION_ORIGINS, ...PREVIEW_ORIGINS, ...extraOrigins]);

  const isAllowed = (origin) => {
    if (allowlist.has(origin)) return true;
    if (!isProduction && LOCALHOST_PATTERN.test(origin)) return true;
    return false;
  };

  return {
    isAllowed,

    /**
     * Evaluate CORS for a request.
     *
     * @returns {{ allowed: boolean, headers: object, preflight: boolean, response?: object }}
     *   `response` is set when the caller should return immediately — either a
     *   403 for a disallowed origin, or a 204 for a preflight.
     */
    evaluate(request) {
      const origin = request?.headers?.get?.('origin');
      const method = String(request?.method || 'GET').toUpperCase();

      // No Origin: a non-browser client. Allowed — authorization is what
      // protects the endpoint, not CORS.
      if (!origin) return { allowed: true, headers: {}, preflight: false };

      if (!isAllowed(origin)) {
        return {
          allowed: false,
          headers: {},
          preflight: false,
          response: {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ok: false, error: 'Origin not allowed' }),
          },
        };
      }

      const headers = {
        'Access-Control-Allow-Origin': origin,
        // Origin is now part of the cache key — without this a shared cache can
        // serve one origin's allow header to another.
        Vary: 'Origin',
        'Access-Control-Allow-Methods': ALLOW_METHODS,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '3600',
      };

      if (method === 'OPTIONS') {
        return { allowed: true, headers, preflight: true, response: { status: 204, headers } };
      }

      return { allowed: true, headers, preflight: false };
    },
  };
}
