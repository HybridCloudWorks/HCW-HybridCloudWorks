/**
 * MSAL (Microsoft Authentication Library) Configuration
 *
 * Replaces firebaseConfig.js. Uses Azure Entra ID for Single Sign-On.
 */

import { PublicClientApplication } from '@azure/msal-browser';

export const msalConfig = {
  auth: {
    clientId: import.meta.env.VITE_ENTRA_CLIENT_ID || '',
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_ENTRA_TENANT_ID || 'common'}`,
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage', // or "localStorage"
    storeAuthStateInCookie: false,
  },
};

// Add scopes here for id token to be used at MS Identity Platform endpoints.
export const loginRequest = {
  scopes: ['User.Read'],
};

// Singleton instance
export const msalInstance = new PublicClientApplication(msalConfig);

export async function initializeMsal() {
  await msalInstance.initialize();
}
