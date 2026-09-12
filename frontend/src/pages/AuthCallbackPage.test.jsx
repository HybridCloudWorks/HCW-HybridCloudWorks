/**
 * The callback page's two jobs when things go wrong (#520).
 *
 * It succeeds by navigating away, so there is little to assert on the happy
 * path. The failure path is where it earns its tests: an authorization code
 * must not survive in the address bar, and MSAL's own error text must not reach
 * the screen.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import AuthCallbackPage from './AuthCallbackPage';

const initializeAuth = vi.fn();
vi.mock('@/lib/entraAuth', () => ({ initializeAuth: (...a) => initializeAuth(...a) }));

const FRAGMENT = '#code=1.AUYA-secret-authorization-code&state=abc';

let replaceState;
let locationReplace;

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = FRAGMENT;
  replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  locationReplace = vi.fn();
  // jsdom's location is not writable; only the one method is needed.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, hash: FRAGMENT, replace: locationReplace },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a completed sign-in', () => {
  it('clears the fragment and sends the user to the admin portal', async () => {
    initializeAuth.mockResolvedValue(undefined);
    render(<AuthCallbackPage />);

    await waitFor(() => expect(locationReplace).toHaveBeenCalledWith('/admin'));
    expect(replaceState).toHaveBeenCalled();
  });
});

describe('a failed sign-in', () => {
  beforeEach(() => {
    initializeAuth.mockRejectedValue(
      new Error('endpoints_resolution_error: authority https://login.microsoftonline.com/…')
    );
  });

  // A fragment left in the address bar is re-processed on every reload, so the
  // same failure reproduces forever and reads as permanent — and it is an
  // authorization code sitting in history and in whatever the user pastes when
  // they ask what went wrong.
  it('still clears the fragment, so the failure does not reproduce on reload', async () => {
    render(<AuthCallbackPage />);

    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    const [, , url] = replaceState.mock.calls.at(-1);
    expect(url).not.toContain('code=');
  });

  // MSAL's messages name the authority, the client id and the failure mode, and
  // this page is reachable by anyone with the URL. Same reasoning as the 401
  // descriptions in require-role.js (#517).
  it('does not put the MSAL error on the screen', async () => {
    render(<AuthCallbackPage />);

    expect(await screen.findByText(/could not be completed/i)).toBeTruthy();
    expect(screen.queryByText(/endpoints_resolution_error/)).toBeNull();
    expect(screen.queryByText(/login\.microsoftonline\.com/)).toBeNull();
  });

  it('logs the detail for whoever is actually debugging', async () => {
    render(<AuthCallbackPage />);

    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(console.error.mock.calls.at(-1).join(' ')).toContain('endpoints_resolution_error');
  });

  it('offers a way out rather than a dead end', async () => {
    render(<AuthCallbackPage />);

    const link = await screen.findByRole('link', { name: /admin portal/i });
    expect(link.getAttribute('href')).toBe('/admin');
  });
});
