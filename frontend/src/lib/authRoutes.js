/**
 * Route paths the authentication flow depends on (#520).
 *
 * WHY ITS OWN MODULE, HOLDING ONE STRING.
 *
 * `msalConfig.js` needs this to build `redirectUri`, and `App.jsx` needs it to
 * declare the route Entra will redirect to. Those two must agree exactly or
 * sign-in breaks — Entra sends the browser to `redirectUri`, and if the router
 * does not declare that path the SPA serves its 404 with the authorization code
 * still in the fragment and nothing to consume it.
 *
 * They could not share the constant while it lived in `msalConfig.js`, because
 * that module statically imports `@azure/msal-browser`: importing it from
 * `App.jsx` would pull 236 kB of MSAL into the graph of every public route, the
 * exact regression `msal-not-on-public-routes.test.js` exists to prevent. So
 * `App.jsx` repeated the path as a literal, and a shared constant that only one
 * side actually used is worse than no constant at all — it reads as a guarantee
 * and is not one.
 *
 * This module imports nothing. Both sides can have it, and the agreement is
 * structural rather than asserted.
 */

/** Where Entra returns the browser after an interactive sign-in. */
export const AUTH_REDIRECT_PATH = '/auth/callback';
