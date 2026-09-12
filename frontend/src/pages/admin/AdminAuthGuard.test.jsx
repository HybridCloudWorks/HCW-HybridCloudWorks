/**
 * The three outcomes the guard used to collapse into one (#503).
 *
 * The owner opened /admin/integrations, was told "Access Denied —
 * spatino@hybridcloudworks.com is not authorized", and was offered "Bootstrap
 * My Admin Access". His `admins` record was fine; the token had expired.
 * Signing out and back in "fixed" a problem that was never authorization.
 *
 * So these tests are written against the distinction rather than the wording:
 * a rejected token must never produce a denial, and the bootstrap button must
 * appear only when the server says bootstrapping would actually succeed. They
 * drive the real `useAdminAuth` — mocking the hook would test the mock, and
 * the defect lived in the seam between the hook and this component.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import AdminAuthGuard from './AdminAuthGuard';
import { clearAdminStatusCache } from '@/hooks/useAdminAuth';

const authedFetch = vi.fn();
const postJSON = vi.fn();
const signIn = vi.fn();
const signOutUser = vi.fn();
const reauthenticateForApi = vi.fn();

let currentUser = { uid: 'oid-1', email: 'spatino@hybridcloudworks.com', displayName: 'Owner' };

vi.mock('@/lib/api', () => ({
  authedFetch: (...args) => authedFetch(...args),
  postJSON: (...args) => postJSON(...args),
}));

vi.mock('@/lib/entraAuth', () => ({
  onAuthStateChanged: (callback) => {
    callback(currentUser);
    return () => {};
  },
  signIn: (...args) => signIn(...args),
  signOutUser: (...args) => signOutUser(...args),
  reauthenticateForApi: (...args) => reauthenticateForApi(...args),
}));

/** What `authedFetch` resolves with on a 2xx: a Response-ish with .json(). */
const answers = (body) => authedFetch.mockResolvedValue({ json: async () => body });

/** What `authedFetch` throws on a non-2xx — an Error carrying the status. */
const fails = (status, message) =>
  authedFetch.mockImplementation(async () => {
    const err = new Error(message);
    err.status = status;
    throw err;
  });

const Portal = () => <div>Admin portal</div>;
const renderGuard = () =>
  render(
    <AdminAuthGuard>
      <Portal />
    </AdminAuthGuard>
  );

beforeEach(() => {
  vi.clearAllMocks();
  clearAdminStatusCache();
  window.sessionStorage.clear();
  currentUser = { uid: 'oid-1', email: 'spatino@hybridcloudworks.com', displayName: 'Owner' };
  // The auto-recovery redirect never resolves in a browser — the page
  // navigates away. Resolving is close enough and keeps the test finite.
  reauthenticateForApi.mockResolvedValue(null);
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe('a rejected or unobtainable token', () => {
  it('never renders Access Denied — it re-authenticates instead', async () => {
    fails(401, 'Authentication required');
    renderGuard();

    await waitFor(() => expect(reauthenticateForApi).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Access Denied')).toBeNull();
    expect(screen.queryByRole('button', { name: /bootstrap/i })).toBeNull();
  });

  it('re-authenticates at most once per tab, then says so honestly', async () => {
    // The state after the redirect has already come back and the token is
    // still rejected — a misconfigured audience, not an expired session. The
    // second attempt would be an infinite redirect loop.
    window.sessionStorage.setItem('hcw.admin.session-recovery-attempted', '1');
    fails(401, 'Authentication required');
    renderGuard();

    expect(await screen.findByText('Could not verify your access')).toBeTruthy();
    expect(reauthenticateForApi).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /sign in again/i })).toBeTruthy();
    expect(screen.queryByText('Access Denied')).toBeNull();
    expect(screen.queryByRole('button', { name: /bootstrap/i })).toBeNull();
  });

  it('a token that could not be acquired at all is unknown, not denied', async () => {
    window.sessionStorage.setItem('hcw.admin.session-recovery-attempted', '1');
    authedFetch.mockImplementation(async () => {
      const err = new Error('Not authenticated. Please sign in.');
      err.authRecovery = 'reauthenticate';
      throw err;
    });
    renderGuard();

    expect(await screen.findByText('Could not verify your access')).toBeTruthy();
    expect(screen.queryByText('Access Denied')).toBeNull();
  });
});

describe('a check that could not run for any other reason', () => {
  it('offers a retry and never redirects — a 500 is not an expired session', async () => {
    fails(500, 'Failed to get admin status');
    renderGuard();

    expect(await screen.findByText('Could not verify your access')).toBeTruthy();
    expect(reauthenticateForApi).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(screen.queryByText('Access Denied')).toBeNull();
  });

  it('does not cache the failure, so the retry actually re-asks', async () => {
    fails(503, 'Service unavailable');
    renderGuard();
    await screen.findByText('Could not verify your access');
    const callsAfterFirstCheck = authedFetch.mock.calls.length;

    answers({ isAdmin: true, role: 'super_admin', permissions: ['manage:admins'] });
    screen.getByRole('button', { name: /try again/i }).click();

    expect(await screen.findByText('Admin portal')).toBeTruthy();
    expect(authedFetch.mock.calls.length).toBeGreaterThan(callsAfterFirstCheck);
  });
});

describe('an answer from the registry', () => {
  it('renders the portal for an admin', async () => {
    answers({ isAdmin: true, role: 'super_admin', permissions: ['manage:admins'] });
    renderGuard();

    expect(await screen.findByText('Admin portal')).toBeTruthy();
    expect(reauthenticateForApi).not.toHaveBeenCalled();
  });

  it('denies a genuine non-admin, and offers no bootstrap when the server says it would fail', async () => {
    answers({ isAdmin: false, uid: 'oid-1', email: 'someone@example.com', canBootstrap: false });
    renderGuard();

    expect(await screen.findByText('Access Denied')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /bootstrap/i })).toBeNull();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeTruthy();
  });

  it('offers bootstrap only when the server says it would succeed', async () => {
    answers({ isAdmin: false, uid: 'oid-1', email: 'first@example.com', canBootstrap: true });
    renderGuard();

    expect(await screen.findByText('Access Denied')).toBeTruthy();
    expect(screen.getByRole('button', { name: /bootstrap my admin access/i })).toBeTruthy();
  });

  it('re-arms the one automatic recovery, so the next expiry is handled quietly too', async () => {
    window.sessionStorage.setItem('hcw.admin.session-recovery-attempted', '1');
    answers({ isAdmin: true, role: 'editor', permissions: [] });
    renderGuard();

    await screen.findByText('Admin portal');
    expect(window.sessionStorage.getItem('hcw.admin.session-recovery-attempted')).toBeNull();
  });
});

describe('no session at all', () => {
  it('asks the visitor to sign in rather than telling them they are unauthorized', async () => {
    currentUser = null;
    renderGuard();

    expect(await screen.findByText('Admin Access Required')).toBeTruthy();
    expect(screen.queryByText('Access Denied')).toBeNull();
    expect(authedFetch).not.toHaveBeenCalled();
  });
});
