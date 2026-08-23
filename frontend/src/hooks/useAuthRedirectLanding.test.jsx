/**
 * The site root completing a sign-in that lands on it.
 *
 * The bug: msalConfig sets redirectUri to the origin, and AdminAuthGuard — the
 * only caller of initializeAuth — is mounted only under /admin. A popup that
 * returned to `/#code=…` rendered the home page and sat there with the code
 * unconsumed.
 *
 * The assertions that matter are the negative ones. This hook runs on every
 * page of a public site, so it must do nothing at all for a visitor, and must
 * never let an admin sign-in failure reach them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const initializeAuth = vi.fn();
vi.mock('@/lib/entraAuth', () => ({ initializeAuth }));

const { useAuthRedirectLanding } = await import('./useAuthRedirectLanding.js');

function setUrl(pathname, hash = '', search = '') {
  window.history.replaceState(null, '', pathname + search + hash);
}

beforeEach(() => {
  vi.clearAllMocks();
  initializeAuth.mockResolvedValue(undefined);
  setUrl('/');
});

afterEach(() => vi.restoreAllMocks());

describe('a visitor who is not signing in', () => {
  it('does not load MSAL on a plain page view', () => {
    renderHook(() => useAuthRedirectLanding());
    expect(initializeAuth).not.toHaveBeenCalled();
  });

  it('ignores an ordinary anchor fragment', () => {
    // #contact must not be mistaken for an auth response.
    setUrl('/about', '#contact');
    renderHook(() => useAuthRedirectLanding());
    expect(initializeAuth).not.toHaveBeenCalled();
  });

  it('leaves a non-auth fragment in the URL', async () => {
    setUrl('/about', '#section-two');
    renderHook(() => useAuthRedirectLanding());
    await new Promise((r) => setTimeout(r, 10));
    expect(window.location.hash).toBe('#section-two');
  });
});

describe('a sign-in landing on the root', () => {
  it('completes the exchange when a code is present', async () => {
    setUrl('/', '#code=1.AUYA-example&state=abc');
    renderHook(() => useAuthRedirectLanding());
    await waitFor(() => expect(initializeAuth).toHaveBeenCalledTimes(1));
  });

  it('handles an implicit-flow token and an error response too', async () => {
    for (const hash of ['#id_token=x', '#access_token=x', '#error=access_denied']) {
      vi.clearAllMocks();
      setUrl('/', hash);
      renderHook(() => useAuthRedirectLanding());
      await waitFor(() => expect(initializeAuth).toHaveBeenCalledTimes(1));
    }
  });

  it('clears the spent fragment so a reload does not reprocess it', async () => {
    // Left in the address bar it is re-processed on every reload and reproduces
    // the original error, which is what made the earlier failure feel permanent.
    setUrl('/', '#code=1.AUYA-example&state=abc');
    renderHook(() => useAuthRedirectLanding());
    await waitFor(() => expect(window.location.hash).toBe(''));
  });

  it('preserves the query string when clearing the fragment', async () => {
    setUrl('/', '#code=abc', '?utm_source=x');
    renderHook(() => useAuthRedirectLanding());
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(window.location.search).toBe('?utm_source=x');
  });

  it('does not rethrow a failure into the public page', async () => {
    // A broken admin sign-in must not take the home page down for a visitor
    // who was never signing in.
    initializeAuth.mockRejectedValue(new Error('msal down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setUrl('/', '#code=abc');

    expect(() => renderHook(() => useAuthRedirectLanding())).not.toThrow();
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });
});
