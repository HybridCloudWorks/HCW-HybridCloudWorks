/**
 * MSAL configuration — values only, no instance and no window access at
 * module scope (the singleton lives in entraAuth.js so importing this file
 * stays safe in tests and SSR-ish tooling).
 *
 * Env (see Variables.md / Review.md §4):
 *   VITE_ENTRA_CLIENT_ID  — the SPA app registration's client id
 *   VITE_ENTRA_TENANT_ID  — directory (tenant) id
 *   VITE_ENTRA_API_SCOPE  — the API scope to request for backend calls,
 *     e.g. "api://<api-app-id>/access_as_admin". This is what makes the
 *     token's audience match ENTRA_API_AUDIENCE on the Functions side —
 *     a Graph scope like User.Read produces a token the backend rejects.
 */

export const msalConfig = {
  auth: {
    clientId: import.meta.env.VITE_ENTRA_CLIENT_ID || '',
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_ENTRA_TENANT_ID || 'common'}`,
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
