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
let originalLocation;

beforeEach(() => {
  vi.clearAllMocks();
  replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  locationReplace = vi.fn();

  // THE DESCRIPTOR IS SAVED BECAUSE vi.restoreAllMocks() DOES NOT UNDO THIS.
  //
  // jsdom's `window.location` is not writable, so the only way to stub
  // `replace` is to redefine the property — and a redefinition is not a mock.
  // Leaving it in place leaked a crippled `location` into every later file in
  // the same worker, which surfaced as an unrelated route test failing in the
  // full run and passing on its own. Restore it explicitly, below.
  originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
  // EVERY FIELD NAMED, NOT SPREAD. jsdom's `Location` exposes `pathname` and
  // `search` as accessors on the prototype, so `{ ...window.location }` drops
  // them — and the code under test builds its replacement URL from exactly
  // those two. The fragment assertion would then be checking
  // `'undefinedundefined'` for a `code=` it could never contain, and passing
  // for the wrong reason.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: `https://example.test/auth/callback${FRAGMENT}`,
      origin: 'https://example.test',
      protocol: 'https:',
      host: 'example.test',
      hostname: 'example.test',
      port: '',
      pathname: '/auth/callback',
      search: '',
      hash: FRAGMENT,
      replace: locationReplace,
      assign: vi.fn(),
      reload: vi.fn(),
      toString: () => `https://example.test/auth/callback${FRAGMENT}`,
    },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
  vi.restoreAllMocks();
});

describe('a completed sign-in', () => {
  it('clears the fragment and sends the user to the admin portal', async () => {
    initializeAuth.mockResolvedValue(undefined);
    render(<AuthCallbackPage />);

    await waitFor(() => expect(locationReplace).toHaveBeenCalledWith('/admin'));
    expect(replaceState).toHaveBeenCalled();
  });

  // MSAL's `navigateToLoginRequestUrl` returns the user to whichever page
  // started sign-in — `/admin/queue`, say — as a client-side history
  // navigation, so this component's `.then()` still runs afterwards. Replacing
  // unconditionally would overwrite the destination they actually asked for.
  it('does not override the page MSAL already returned the user to', async () => {
    initializeAuth.mockImplementation(async () => {
      window.location.pathname = '/admin/queue';
      window.location.hash = '';
    });
    render(<AuthCallbackPage />);

    await waitFor(() => expect(initializeAuth).toHaveBeenCalled());
    expect(locationReplace).not.toHaveBeenCalled();
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

    // Assert what it IS, not only what it lacks: a URL of `undefinedundefined`
    // would satisfy "contains no code=" while proving nothing.
    expect(url).toBe('/auth/callback');
    expect(url).not.toContain('code=');
  });

  // MSAL's messages name the authority, the client id and the failure mode, and
  // this page is reachable by anyone with the URL. Same reasoning as the 401
  // descriptions in require-role.js (#517).
  it('does not put the MSAL error on the screen', async () => {
    render(<AuthCallbackPage />);

    expect(await screen.findByText(/could not be completed/i)).toBeTruthy();

    // Substring checks on the rendered text, not regexes. A bare host pattern
    // is unanchored by nature and CodeQL flags it as one — correctly, since the
    // same shape in non-test code would match `evil.com/login.microsoftonline.com`.
    const rendered = document.body.textContent ?? '';
    expect(rendered).not.toContain('endpoints_resolution_error');
    expect(rendered).not.toContain('login.microsoftonline.com');
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
