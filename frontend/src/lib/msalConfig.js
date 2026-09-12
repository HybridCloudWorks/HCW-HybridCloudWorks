/**
 * MSAL configuration — values only, no instance and no window access at
 * module scope (the singleton lives in entraAuth.js so importing this file
 * stays safe in tests and SSR-ish tooling).
 *
 * Env (see TODO.md):
 *   VITE_ENTRA_CLIENT_ID  — the SPA app registration's client id
 *   VITE_ENTRA_TENANT_ID  — directory (tenant) id
 *   VITE_ENTRA_API_SCOPE  — the API scope to request for backend calls,
 *     e.g. "api://<api-app-id>/access_as_admin". This is what makes the
 *     token's audience match ENTRA_API_AUDIENCE on the Functions side —
 *     a Graph scope like User.Read produces a token the backend rejects.
 */

/**
 * The authority when the tenant is missing — a GUID that is never a real
 * tenant, so MSAL fails loudly at authority resolution (#516).
 *
 * This used to be `common`, which was worse than it looks. `common` was never a
 * path to backend access: the API pins one tenant by issuer, so nothing from
 * another directory could ever have been authorized. What it produced was a SPA
 * that accepted a sign-in from ANY tenant or a personal Microsoft account,
 * stored that identity in localStorage, rendered signed-in UI, and then 401'd on
 * every call — a confusing partial success in place of an unambiguous failure.
 *
 * A throw here would be the obvious alternative and is the wrong shape: this
 * module is imported at module scope by `entraAuth.js` and transitively by
 * several test files that do not mock it, and it would turn a build-time
 * configuration problem into a runtime crash on a path that already has a
 * working failure mode. `initializeAuth()` does not list the resulting error in
 * RECOVERABLE_INIT_ERRORS, so it rethrows, `onAuthStateChanged` reports null,
 * and the sign-in card renders. That is the honest outcome.
 *
 * `vite.config.js` refuses to build a DEPLOY bundle that would need this, so in
 * production it is unreachable by construction.
 */
const NO_TENANT_CONFIGURED = '00000000-0000-0000-0000-000000000000';

export const msalConfig = {
  auth: {
    clientId: import.meta.env.VITE_ENTRA_CLIENT_ID || '',
    authority: `https://login.microsoftonline.com/${
      import.meta.env.VITE_ENTRA_TENANT_ID || NO_TENANT_CONFIGURED
    }`,
    redirectUri: typeof window !== 'undefined' ? window.location.origin : '/',
  },
  cache: {
    // localStorage so redirect flows survive the round-trip in strict
    // browsers — the old Firebase guard had a whole error path for state
    // lost in sessionStorage.
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false,
  },
};

/** The scope the backend audience-checks. Empty until the env var is set. */
export const API_SCOPE = import.meta.env.VITE_ENTRA_API_SCOPE || '';

/** Interactive sign-in request: identity claims + the API scope. */
export const loginRequest = {
  scopes: ['openid', 'profile', 'email', ...(API_SCOPE ? [API_SCOPE] : [])],
  // Sign-out is local (entraAuth.js signOutUser calls clearCache), matching what
  // Firebase's signOut did: this application's session ends, the identity
  // provider's does not. Without this the next sign-in would silently reuse the
  // surviving Entra session and there would be no way to change account from the
  // portal at all. Firebase's Google popup showed the chooser by default, so
  // this is the behaviour being migrated from, not a new prompt.
  prompt: 'select_account',
};

/** Silent token request for backend calls — the API scope only. */
export const apiTokenRequest = {
  scopes: API_SCOPE ? [API_SCOPE] : ['openid'],
};
