/**
 * Entra ID auth core — the MSAL replacement for firebase/auth.
 *
 * One instance, one initialize, and three jobs:
 *   - session state: getCurrentUser / onAuthStateChanged (MSAL events)
 *   - interactive sign-in/out (popup with redirect fallback — Entra
 *     Conditional Access owns MFA, so the Firebase MFA/reCAPTCHA machinery
 *     has no equivalent here on purpose)
 *   - API tokens: acquireApiToken() returns an access token whose audience
 *     is the backend's ENTRA_API_AUDIENCE (via VITE_ENTRA_API_SCOPE) —
 *     silent first, interactive only when MSAL says it must be.
 *
 * The user shape mirrors what the Firebase code exposed (uid/email/
 * displayName) so consumers don't churn: uid is the Entra object id, which
 * is exactly what the backend's admins/{oid} registry keys on.
 */
import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  EventType,
} from '@azure/msal-browser';
import { msalConfig, loginRequest, apiTokenRequest } from '@/lib/msalConfig';

let instance = null;
let initPromise = null;

export function getMsalInstance() {
  if (!instance) {
    instance = new PublicClientApplication(msalConfig);
  }
  return instance;
}

/** Idempotent: first caller initializes and drains any redirect response. */
export function initializeAuth() {
  if (!initPromise) {
    const msal = getMsalInstance();
    initPromise = msal
      .initialize()
      .then(() => msal.handleRedirectPromise())
      .then((result) => {
        if (result?.account) {
          msal.setActiveAccount(result.account);
        } else if (!msal.getActiveAccount() && msal.getAllAccounts().length > 0) {
          msal.setActiveAccount(msal.getAllAccounts()[0]);
        }
      });
  }
  return initPromise;
}

const toUser = (account) =>
  account
    ? {
        uid: account.localAccountId, // Entra oid — the admins/{oid} key
        email: account.username || null,
        displayName: account.name || null,
        account,
      }
    : null;

export async function getCurrentUser() {
  await initializeAuth();
  return toUser(getMsalInstance().getActiveAccount());
}

/**
 * Subscribe to sign-in/out state. Fires once with the current user after
 * initialization (mirroring onAuthStateChanged), then on every change.
 * Returns an unsubscribe function.
 */
export function onAuthStateChanged(callback) {
  const msal = getMsalInstance();
  let cancelled = false;

  initializeAuth().then(() => {
    if (!cancelled) callback(toUser(msal.getActiveAccount()));
  });

  const callbackId = msal.addEventCallback((event) => {
    if (
      event.eventType === EventType.LOGIN_SUCCESS ||
      event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS
    ) {
      if (event.payload?.account) {
        msal.setActiveAccount(event.payload.account);
        callback(toUser(event.payload.account));
      }
    }
    if (event.eventType === EventType.LOGOUT_SUCCESS) {
      callback(null);
    }
  });

  return () => {
    cancelled = true;
    if (callbackId) msal.removeEventCallback(callbackId);
  };
}

/** Popup first; redirect when the popup is blocked or fails to open. */
export async function signIn() {
  await initializeAuth();
  const msal = getMsalInstance();
  try {
    const result = await msal.loginPopup(loginRequest);
    if (result?.account) msal.setActiveAccount(result.account);
    return toUser(result?.account);
  } catch (err) {
    const code = err?.errorCode || '';
    if (
      code === 'popup_window_error' ||
      code === 'empty_window_error' ||
      code === 'user_cancelled'
    ) {
      await msal.loginRedirect(loginRequest);
      return null; // page navigates away
    }
    throw err;
  }
}

export async function signOutUser() {
  await initializeAuth();
  const msal = getMsalInstance();
  const account = msal.getActiveAccount();
  await msal.logoutPopup({ account }).catch(() => msal.logoutRedirect({ account }));
}

/**
 * Access token for the backend API. Silent from cache, interactive redirect
 * only when MSAL requires it. Throws 'Not authenticated. Please sign in.'
 * with no active account — the exact message authedFetch used to throw, so
 * caller error handling is unchanged.
 */
export async function acquireApiToken({ forceRefresh = false } = {}) {
  await initializeAuth();
  const msal = getMsalInstance();
  const account = msal.getActiveAccount();
  if (!account) {
    throw new Error('Not authenticated. Please sign in.');
  }
  try {
    const result = await msal.acquireTokenSilent({ ...apiTokenRequest, account, forceRefresh });
    return result.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      await msal.acquireTokenRedirect({ ...apiTokenRequest, account });
      // Unreachable: the redirect navigates away.
      throw new Error('Redirecting to sign-in.');
    }
    throw err;
  }
}
