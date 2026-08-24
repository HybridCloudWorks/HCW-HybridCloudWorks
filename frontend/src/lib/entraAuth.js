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

/**
 * Initialisation failures that mean "there is no usable session here", not
 * "authentication is broken".
 *
 * `no_token_request_cache_error` is the one seen in the wild: MSAL found a
 * redirect response but no matching request in its cache. On a phone that
 * happens routinely — `loginPopup` opens a new tab rather than a popup, the
 * sign-in completes there, and the response arrives in a context whose cache
 * never held the original request. `interaction_in_progress` is the double-tap
 * equivalent. Neither warrants failing the page; both warrant clearing the
 * fragment and letting the user try again.
 */
const RECOVERABLE_INIT_ERRORS = new Set([
  'no_token_request_cache_error',
  'interaction_in_progress',
  'hash_does_not_contain_known_properties',
]);

/** Strip an auth response fragment without adding a history entry. */
function clearAuthFragment() {
  if (typeof window === 'undefined' || !window.location?.hash) return;
  if (!/[#&](code|error|state|id_token|access_token)=/.test(window.location.hash)) return;
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    // A browser that refuses replaceState is not worth failing sign-in over.
  }
}

/**
 * Redirect rather than popup on touch devices.
 *
 * MSAL's popup flow assumes a real popup window. Mobile browsers and in-app
 * webviews either block it or open a new TAB, and a new tab does not share the
 * request state the response is matched against — which surfaces as
 * no_token_request_cache_error back in the original tab, with a stale fragment
 * that reproduces on every reload. Redirect has none of that: one context, one
 * cache, one response.
 *
 * `pointer: coarse` is the signal because it describes the input device rather
 * than sniffing a user-agent string, so it does not rot as browsers change
 * their UA.
 */
/**
 * Redirect is the default. Popup is opt-in and, right now, nothing opts in.
 *
 * This used to return true only for `pointer: coarse`, on the theory that
 * popups fail on phones and work on desktops. The second half is not true here.
 *
 * Observed on Edge/Windows against www.hybridcloudworks.com on 2026-08-23:
 * `loginPopup()` opened a TOP-LEVEL WINDOW rather than a child popup. Entra
 * authenticated, the code came back to the redirect URI, and the opener sat
 * waiting on a window handle it no longer had. After #196 taught the root page
 * to consume the fragment, the token was written to localStorage — where the
 * opener could have read it — and the opener still waited, because nothing
 * tells `loginPopup()` that its promise has been settled elsewhere.
 *
 * That is not a bug to work around with cross-window messaging. The popup flow
 * has one failure mode that no amount of care on our side removes: the browser
 * decides what `window.open` produces, and if it produces a top-level window
 * the handshake is gone.
 *
 * Redirect has no handshake. One window navigates to Entra, comes back with the
 * code, `handleRedirectPromise()` consumes it, and MSAL returns the user to the
 * page they started from. The cost is losing in-page state across the
 * navigation, which for a sign-in on an admin route is nothing.
 */
function prefersRedirect() {
  return true;
}

/**
 * Idempotent: first caller initializes and drains any redirect response.
 *
 * A REJECTION IS NOT CACHED. `initPromise` memoises the in-flight
 * initialisation so concurrent callers share one MSAL init — but memoising a
 * *failure* means one bad redirect response poisons every later call for the
 * life of the page, and the only way out is a manual reload. `handleRedirectPromise`
 * rejects on things that genuinely recur on mobile: an interrupted redirect, a
 * consent error in the hash, `interaction_in_progress` from a double-tap. So a
 * failed attempt clears the memo and lets the next caller try again.
 */
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
      })
      .catch((error) => {
        initPromise = null;
        if (RECOVERABLE_INIT_ERRORS.has(error?.errorCode)) {
          // A stale or foreign auth fragment. Left in the address bar it
          // reproduces this error on every reload, which is what made the
          // failure feel permanent rather than transient — the user reloads,
          // the same hash is re-processed, the same error appears. Drop it and
          // resolve with no session so the sign-in button works on the retry.
          clearAuthFragment();
          return;
        }
        throw error;
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
/**
 * Subscribers, kept alongside MSAL's own event callbacks rather than instead of
 * them.
 *
 * MSAL announces LOGIN_SUCCESS and LOGOUT_SUCCESS itself, and those still drive
 * the callbacks below. But `clearCache()` — how signOutUser ends a session —
 * emits NO event: the EventType enum has logoutStart/Success/Failure/End and
 * nothing for a cache clear. Without this set, signing out would empty the cache
 * and leave every subscriber believing the user was still signed in, so the
 * guard would keep rendering the portal until something else forced a re-render.
 */
const authSubscribers = new Set();

/**
 * Call one subscriber without letting it break anything else.
 *
 * Used on every path, not only the fan-out. A subscriber that throws inside the
 * initialisation `.then()` lands in the `.catch()` below it, which calls the
 * same subscriber again with null, which throws again — and the second throw
 * has nowhere to go, so it surfaces as an unhandled rejection with a stack
 * pointing at MSAL rather than at the component that threw.
 */
function deliver(subscriber, user) {
  try {
    subscriber(user);
  } catch (error) {
    console.error('Auth subscriber threw:', error);
  }
}

function notifyAuthSubscribers(user) {
  // One bad subscriber must not stop the others learning about a sign-out.
  for (const subscriber of authSubscribers) deliver(subscriber, user);
}

export function onAuthStateChanged(callback) {
  const msal = getMsalInstance();
  let cancelled = false;

  // THE CALLBACK MUST FIRE EXACTLY ONCE, INCLUDING ON FAILURE.
  //
  // Consumers treat the first call as "auth has resolved" — useAdminAuth sets
  // authReady there, and AdminAuthGuard renders a spinner until it does. A
  // rejected initialisation with no catch means the callback never fires,
  // authReady stays false, and the admin page spins forever showing no error
  // and offering no sign-in button. That is what /admin did on 2026-08-23.
  //
  // On failure the user is reported as null, which is honest — MSAL could not
  // establish a session — and renders the sign-in card, which is the one thing
  // that can actually recover the situation.
  initializeAuth()
    .then(() => {
      if (!cancelled) deliver(callback, toUser(msal.getActiveAccount()));
    })
    .catch((error) => {
      console.error('[auth] MSAL initialisation failed; treating as signed out.', error);
      if (!cancelled) deliver(callback, null);
    });

  authSubscribers.add(callback);

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
    authSubscribers.delete(callback);
    if (callbackId) msal.removeEventCallback(callbackId);
  };
}

/**
 * Redirect flow. The popup branch below is retained but unreachable while
 * `prefersRedirect()` returns true — see the reasoning there. It is kept rather
 * than deleted because the choice is a deployment observation, not a law, and
 * the fallback chain it contains is the thing that would have to be rebuilt.
 */
export async function signIn() {
  await initializeAuth();
  const msal = getMsalInstance();

  if (prefersRedirect()) {
    await msal.loginRedirect(loginRequest);
    return null; // page navigates away
  }

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

/**
 * Sign out locally, the way Firebase did.
 *
 * This was `logoutPopup().catch(() => logoutRedirect())` and it had the same
 * defect as the sign-in popup, plus a worse failure shape: when the browser
 * makes a top-level window instead of a child popup the promise HANGS rather
 * than rejecting, so the `.catch()` never runs and the fallback never fires.
 * Sign-out silently did nothing. Seen on 2026-08-23 as a return to
 * `/admin?state=…"interactionType":"popup"` with the session still live.
 *
 * The behaviour being migrated from is the reason to prefer local. Site-Main's
 * `signOutSession()` is `signOut(getAuth(app))` — Firebase clears the
 * application's own session and returns immediately. It does not navigate, and
 * it does not end the Google SSO session either; the identity provider's cookie
 * survives and the next sign-in is quick. `clearCache()` is the same contract:
 * this app's session is gone, the Entra session is not.
 *
 * That is a deliberate limit, not an oversight. Ending the Entra session means
 * `logoutRedirect()`, which navigates the whole tab to Microsoft and back and
 * would sign the user out of every other Microsoft property in the browser —
 * strictly more than Firebase ever did, and more than a "Sign out" button on
 * one admin portal should do.
 *
 * Switching accounts still works because `loginRequest` asks for
 * `prompt: 'select_account'`; see msalConfig.js.
 */
export async function signOutUser() {
  await initializeAuth();
  const msal = getMsalInstance();
  const account = msal.getActiveAccount();

  await msal.clearCache(account ? { account } : undefined);
  msal.setActiveAccount(null);
  notifyAuthSubscribers(null);
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
