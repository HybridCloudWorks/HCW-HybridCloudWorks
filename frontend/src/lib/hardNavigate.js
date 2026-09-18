/**
 * Leave the single-page app with a real browser navigation (#645).
 *
 * WHY A MODULE FOR ONE LINE. `window.location.replace` cannot be intercepted.
 * jsdom defines `replace` as a non-writable, non-configurable OWN property of
 * `Location`, so a spy is impossible and the only way to fake it is to redefine
 * `window.location` itself — which works only while THAT property is
 * configurable, and whether it is turns out to be a property of the test pool
 * rather than of the DOM: configurable under `forks`, not under `vmThreads`.
 * A test that reaches through the environment to reach the code is hostage to
 * how the environment was built. This module is the seam instead, and it does
 * not care which pool is running.
 *
 * The fabrication it replaces had already caused two bugs of its own, both
 * recorded in AuthCallbackPage.test.jsx before this existed: a spread that
 * dropped `pathname` and `search` because jsdom exposes them on the prototype,
 * and a redefinition left in place that leaked a crippled `location` into every
 * later file in the same worker.
 *
 * WHAT IT IS, not just what it is for: `replace` rather than `assign` because
 * the page being left must not be reachable with Back — after sign-in that page
 * is a callback URL carrying an authorization code. It is a full page load, not
 * a router navigation, so nothing of the old document survives it.
 */
export function hardReplace(url) {
  window.location.replace(url);
}
