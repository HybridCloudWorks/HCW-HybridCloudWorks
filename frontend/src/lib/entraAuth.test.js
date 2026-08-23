/**
 * Tests for the MSAL session layer — specifically the failure paths.
 *
 * On 2026-08-23 /admin rendered a spinner forever on a phone. No error, no
 * sign-in button, nothing in the UI to act on; the only way out was a manual
 * reload, and that often failed too. The cause was two lines that both looked
 * fine:
 *
 *   1. `onAuthStateChanged` called `initializeAuth().then(...)` with no
 *      `.catch()`. Consumers treat the first callback as "auth resolved" —
 *      `useAdminAuth` sets `authReady` there and `AdminAuthGuard` spins until
 *      it does. A rejection meant the callback never fired at all.
 *   2. `initializeAuth` memoised `initPromise` including when it rejected, so
 *      one bad redirect response poisoned every later call for the life of the
 *      page.
 *
 * Neither is visible in a passing app. Both only appear when MSAL rejects, and
 * MSAL rejects for ordinary reasons on mobile: an interrupted redirect, a
 * consent error in the hash, `interaction_in_progress` from a double tap.
 *
 * These tests exist to fail if either is reintroduced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  handleRedirectPromise: vi.fn(),
  getActiveAccount: vi.fn(),
  getAllAccounts: vi.fn(),
  setActiveAccount: vi.fn(),
  addEventCallback: vi.fn(),
  removeEventCallback: vi.fn(),
  loginPopup: vi.fn(),
  loginRedirect: vi.fn(),
}));

vi.mock('@azure/msal-browser', () => ({
  PublicClientApplication: class {
    initialize = mocks.initialize;
    handleRedirectPromise = mocks.handleRedirectPromise;
    getActiveAccount = mocks.getActiveAccount;
    getAllAccounts = mocks.getAllAccounts;
    setActiveAccount = mocks.setActiveAccount;
    addEventCallback = mocks.addEventCallback;
    removeEventCallback = mocks.removeEventCallback;
    loginPopup = mocks.loginPopup;
    loginRedirect = mocks.loginRedirect;
  },
  InteractionRequiredAuthError: class extends Error {},
  EventType: {
    LOGIN_SUCCESS: 'msal:loginSuccess',
    ACQUIRE_TOKEN_SUCCESS: 'msal:acquireTokenSuccess',
    LOGOUT_SUCCESS: 'msal:logoutSuccess',
  },
}));

/** The module memoises MSAL state, so every test needs a clean copy. */
async function freshModule() {
  vi.resetModules();
  return import('./entraAuth.js');
}

const ACCOUNT = { localAccountId: 'oid-1', username: 'a@example.com', name: 'A' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.initialize.mockResolvedValue(undefined);
  mocks.handleRedirectPromise.mockResolvedValue(null);
  mocks.getActiveAccount.mockReturnValue(ACCOUNT);
  mocks.getAllAccounts.mockReturnValue([ACCOUNT]);
  mocks.addEventCallback.mockReturnValue('cb-id');
  mocks.loginPopup.mockResolvedValue({ account: ACCOUNT });
  mocks.loginRedirect.mockResolvedValue(undefined);
  setPointer('fine');
  setHash('');
});

/** Drive the touch-vs-mouse decision without sniffing a user agent. */
function setPointer(kind) {
  window.matchMedia = vi.fn((query) => ({
    matches: query.includes('coarse') ? kind === 'coarse' : kind === 'fine',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function setHash(hash) {
  window.history.replaceState(null, '', window.location.pathname + hash);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('onAuthStateChanged — the callback must always fire', () => {
  it('fires with the active user on a normal initialisation', async () => {
    const { onAuthStateChanged } = await freshModule();
    const callback = vi.fn();

    onAuthStateChanged(callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));

    expect(callback.mock.calls[0][0]).toMatchObject({ uid: 'oid-1', email: 'a@example.com' });
  });

  it('fires with null when initialize() rejects — NOT never, which spins forever', async () => {
    mocks.initialize.mockRejectedValue(new Error('msal down'));
    const { onAuthStateChanged } = await freshModule();
    const callback = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    onAuthStateChanged(callback);

    // The whole bug: no catch meant this expectation never came true, and the
    // guard rendered a spinner with no way out.
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('fires with null when handleRedirectPromise() rejects', async () => {
    // The likelier of the two on mobile: an interrupted redirect, a consent
    // error in the hash, or interaction_in_progress from a double tap.
    mocks.handleRedirectPromise.mockRejectedValue(new Error('interaction_in_progress'));
    const { onAuthStateChanged } = await freshModule();
    const callback = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    onAuthStateChanged(callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(null));
  });

  it('does not fire after unsubscribe, even on the failure path', async () => {
    mocks.initialize.mockRejectedValue(new Error('msal down'));
    const { onAuthStateChanged } = await freshModule();
    const callback = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const unsubscribe = onAuthStateChanged(callback);
    unsubscribe();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('initializeAuth — a failure must not be memoised', () => {
  it('retries after a rejection instead of replaying it forever', async () => {
    mocks.initialize.mockRejectedValueOnce(new Error('transient'));
    const { initializeAuth } = await freshModule();

    await expect(initializeAuth()).rejects.toThrow('transient');

    // Caching the rejected promise meant one bad redirect poisoned the page
    // until a manual reload — and the reload frequently hit the same state.
    mocks.initialize.mockResolvedValue(undefined);
    await expect(initializeAuth()).resolves.toBeUndefined();
    expect(mocks.initialize).toHaveBeenCalledTimes(2);
  });

  it('still shares one in-flight initialisation between concurrent callers', async () => {
    // The memo has a real purpose; the fix must not throw it away. Two callers
    // during a successful init must not each drive MSAL.
    const { initializeAuth } = await freshModule();

    await Promise.all([initializeAuth(), initializeAuth(), initializeAuth()]);
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
  });

  it('adopts the first account when no active account is set', async () => {
    mocks.getActiveAccount.mockReturnValue(null);
    const { initializeAuth } = await freshModule();

    await initializeAuth();
    expect(mocks.setActiveAccount).toHaveBeenCalledWith(ACCOUNT);
  });

  it('adopts the account a redirect returns', async () => {
    const redirected = { localAccountId: 'oid-2', username: 'b@example.com' };
    mocks.handleRedirectPromise.mockResolvedValue({ account: redirected });
    const { initializeAuth } = await freshModule();

    await initializeAuth();
    expect(mocks.setActiveAccount).toHaveBeenCalledWith(redirected);
  });
});

describe('signIn — redirect is the only flow that cannot lose its handshake', () => {
  it('goes straight to redirect on a touch device', async () => {
    // loginPopup on mobile opens a new TAB, and a new tab does not share the
    // request state the response is matched against. The response then lands
    // back in the original tab as no_token_request_cache_error, with a stale
    // fragment that reproduces on every reload.
    setPointer('coarse');
    const { signIn } = await freshModule();

    await signIn();

    expect(mocks.loginRedirect).toHaveBeenCalledTimes(1);
    expect(mocks.loginPopup).not.toHaveBeenCalled();
  });

  it('uses redirect with a mouse too — popup is not reliable here either', async () => {
    // This asserted the opposite until 2026-08-23, on the theory that popups
    // fail on phones and work on desktops. Edge on Windows opened a TOP-LEVEL
    // window for loginPopup() against www.hybridcloudworks.com: Entra
    // authenticated, the code returned, and the opener waited forever on a
    // handle it no longer had. The browser decides what window.open produces,
    // and when it produces a top-level window there is no handshake left to
    // rescue. Redirect has no handshake to lose.
    setPointer('fine');
    const { signIn } = await freshModule();

    await signIn();

    expect(mocks.loginRedirect).toHaveBeenCalledTimes(1);
    expect(mocks.loginPopup).not.toHaveBeenCalled();
  });

  it('reaches redirect regardless of what the popup would have done', async () => {
    // The popup fallback chain is retained in signIn but unreachable. Kept
    // rather than deleted: the choice is a deployment observation, not a law,
    // and the fallback is the part that would have to be rebuilt.
    setPointer('fine');
    mocks.loginPopup.mockRejectedValue({ errorCode: 'popup_window_error' });
    const { signIn } = await freshModule();

    await signIn();
    expect(mocks.loginRedirect).toHaveBeenCalledTimes(1);
    expect(mocks.loginPopup).not.toHaveBeenCalled();
  });
});

describe('recoverable initialisation errors', () => {
  it('no_token_request_cache_error resolves instead of failing the page', async () => {
    // The error the owner actually hit. It means "this response has no matching
    // request here" — there is no session, but authentication is not broken,
    // and the sign-in button must still work.
    mocks.handleRedirectPromise.mockRejectedValue({
      errorCode: 'no_token_request_cache_error',
    });
    const { initializeAuth } = await freshModule();

    await expect(initializeAuth()).resolves.toBeUndefined();
  });

  it('clears the stale auth fragment, so a reload does not reproduce it', async () => {
    // Left in the address bar the fragment is re-processed on every reload and
    // the same error appears — which is what made this feel permanent.
    setHash('#code=abc&state=xyz');
    mocks.handleRedirectPromise.mockRejectedValue({
      errorCode: 'no_token_request_cache_error',
    });
    const { initializeAuth } = await freshModule();

    await initializeAuth();
    expect(window.location.hash).toBe('');
  });

  it('leaves a non-auth fragment alone', async () => {
    setHash('#section-two');
    mocks.handleRedirectPromise.mockRejectedValue({
      errorCode: 'no_token_request_cache_error',
    });
    const { initializeAuth } = await freshModule();

    await initializeAuth();
    expect(window.location.hash).toBe('#section-two');
  });

  it('interaction_in_progress is recoverable too — it is a double tap', async () => {
    mocks.handleRedirectPromise.mockRejectedValue({ errorCode: 'interaction_in_progress' });
    const { initializeAuth } = await freshModule();

    await expect(initializeAuth()).resolves.toBeUndefined();
  });

  it('an UNKNOWN error still rejects — recovery is a allowlist, not a catch-all', async () => {
    mocks.handleRedirectPromise.mockRejectedValue({
      errorCode: 'something_genuinely_broken',
      message: 'boom',
    });
    const { initializeAuth } = await freshModule();

    await expect(initializeAuth()).rejects.toMatchObject({
      errorCode: 'something_genuinely_broken',
    });
  });
});
