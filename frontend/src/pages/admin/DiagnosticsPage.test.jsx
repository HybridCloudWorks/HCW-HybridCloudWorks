/**
 * The page's promise is negative: the token and the person are never shown.
 * So most of what is held here is absence — the raw token, `oid`, `sub` and
 * `email` never reach the DOM, the report, or the clipboard — alongside the
 * pass/fail lines #355 and #356 define.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import DiagnosticsPage, {
  LABS_PROBE_JOB,
  buildReport,
  decodeJwtPayload,
  evaluateLabsProbe,
  evaluateUnauthenticatedProbe,
  relativeExpiry,
  summarizeAdminStatus,
  summarizeToken,
} from './DiagnosticsPage';

const authedFetch = vi.fn();
const getJSON = vi.fn();
const postJSON = vi.fn();
const acquireApiToken = vi.fn();
const getEndpoint = vi.fn((name) => `https://api.example.test/api/${name}`);
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  authedFetch: (...args) => authedFetch(...args),
  getJSON: (...args) => getJSON(...args),
  postJSON: (...args) => postJSON(...args),
  getEndpoint: (...args) => getEndpoint(...args),
}));
vi.mock('@/lib/entraAuth', () => ({ acquireApiToken: (...args) => acquireApiToken(...args) }));
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

// ── A token that would be a disclosure if any of it leaked ───────────────────

const OID = 'a1b2c3d4-oid-of-the-person';
const EMAIL = 'owner@hcw.example';
const NOW_SECONDS = 1_800_000_000;

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const CLAIMS = {
  aud: 'api://api-app-id',
  iss: 'https://login.microsoftonline.com/tenant-1/v2.0',
  tid: 'tenant-1',
  oid: OID,
  sub: 'sub-pairwise-id',
  email: EMAIL,
  preferred_username: EMAIL,
  name: 'The Owner',
  roles: ['Admin'],
  exp: NOW_SECONDS + 3600,
  iat: NOW_SECONDS,
};
const TOKEN = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(CLAIMS)}.signature-bytes`;

const EXPECTATIONS = {
  expectedAudience: 'api://api-app-id',
  tenantId: 'tenant-1',
  adminAppRole: 'Admin',
  registryContainer: 'admins',
};

const ADMIN_STATUS = {
  isAdmin: true,
  uid: OID,
  email: EMAIL,
  role: 'super_admin',
  permissions: ['read:content', 'manage:admins'],
  active: true,
};

const jsonResponse = (status, body) => ({ status, ok: status < 400, json: async () => body });

/** Every string that must never appear on screen or in the report. */
const SECRETS = [TOKEN, OID, EMAIL, 'sub-pairwise-id', 'The Owner'];
const expectNoSecrets = (text) => {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
};

beforeEach(() => {
  acquireApiToken.mockReset().mockResolvedValue(TOKEN);
  getJSON.mockReset().mockResolvedValue(EXPECTATIONS);
  authedFetch.mockReset().mockImplementation(async (name) => {
    if (name === 'getCurrentAdminStatus') return jsonResponse(200, ADMIN_STATUS);
    if (name === 'enqueueLabJob') {
      return jsonResponse(200, { jobId: 'job-123', type: 'shell-echo', status: 'queued' });
    }
    throw new Error(`unexpected authedFetch ${name}`);
  });
  postJSON.mockReset().mockImplementation(async (name, body) => {
    if (name === 'getLabJob') return { job: { id: body.jobId, status: postJSON.jobStatus } };
    if (name === 'cancelLabJob') {
      postJSON.jobStatus = 'cancelled';
      return { jobId: body.jobId, status: 'cancelled' };
    }
    throw new Error(`unexpected postJSON ${name}`);
  });
  postJSON.jobStatus = 'queued';
  toast.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

describe('decodeJwtPayload', () => {
  it('reads a base64url payload without verifying it', () => {
    expect(decodeJwtPayload(TOKEN)).toMatchObject({ aud: 'api://api-app-id', roles: ['Admin'] });
  });

  it('returns null for anything that is not a JWT', () => {
    expect(decodeJwtPayload('')).toBeNull();
    expect(decodeJwtPayload('not.a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.!!!.c')).toBeNull();
    expect(decodeJwtPayload(undefined)).toBeNull();
  });
});

describe('relativeExpiry', () => {
  it('reads forward and backward', () => {
    const now = NOW_SECONDS * 1000;
    expect(relativeExpiry(NOW_SECONDS + 45, now)).toEqual({ label: 'in 45 s', expired: false });
    expect(relativeExpiry(NOW_SECONDS + 1800, now)).toEqual({ label: 'in 30 min', expired: false });
    expect(relativeExpiry(NOW_SECONDS + 7200, now)).toEqual({ label: 'in 2.0 h', expired: false });
    expect(relativeExpiry(NOW_SECONDS - 120, now)).toEqual({ label: '2 min ago', expired: true });
    expect(relativeExpiry(undefined, now)).toEqual({ label: 'no exp claim', expired: null });
  });
});

describe('summarizeToken', () => {
  it('keeps claim names and the four checked values, and drops the person', () => {
    const summary = summarizeToken(CLAIMS, EXPECTATIONS, NOW_SECONDS * 1000);
    expect(summary.claimNames).toEqual(Object.keys(CLAIMS).sort());
    expect(summary).toMatchObject({
      aud: 'api://api-app-id',
      audienceMatches: true,
      roleNames: ['Admin'],
      hasAdminRole: true,
      tenantMatches: true,
      expiresLabel: 'in 1.0 h',
      expired: false,
    });
    expectNoSecrets(JSON.stringify(summary));
  });

  it('compares exactly, the way the verifier does', () => {
    const drifted = summarizeToken(
      { ...CLAIMS, aud: 'api-app-id', roles: ['admin'] },
      EXPECTATIONS
    );
    expect(drifted.audienceMatches).toBe(false);
    expect(drifted.hasAdminRole).toBe(false);
  });

  it('accepts an array aud the way the verifier does — membership, not a joined string', () => {
    // RFC 7519 allows `aud` to be an array; jsonwebtoken passes when any
    // element equals the expected audience. Joining and comparing would show
    // FAIL for a token the API had just accepted.
    const multi = summarizeToken(
      { ...CLAIMS, aud: ['api://api-app-id', 'api://another-app'] },
      EXPECTATIONS
    );
    expect(multi.audienceMatches).toBe(true);
    expect(multi.aud).toBe('api://api-app-id, api://another-app');

    const absent = summarizeToken({ ...CLAIMS, aud: ['api://another-app'] }, EXPECTATIONS);
    expect(absent.audienceMatches).toBe(false);
    expect(summarizeToken({ ...CLAIMS, aud: [] }, EXPECTATIONS).aud).toBeNull();
  });

  it('reports unknown rather than guessing when the API gave no expectations', () => {
    const summary = summarizeToken(CLAIMS, null);
    expect(summary.audienceMatches).toBeNull();
    expect(summary.hasAdminRole).toBeNull();
    expect(summary.tenantMatches).toBeNull();
    expect(summary.aud).toBe('api://api-app-id'); // the value is still shown
  });

  it('is null without a payload', () => {
    expect(summarizeToken(null, EXPECTATIONS)).toBeNull();
  });
});

describe('summarizeAdminStatus', () => {
  it('compares the uid to the token and keeps only the verdict', () => {
    const summary = summarizeAdminStatus(ADMIN_STATUS, OID);
    expect(summary).toEqual({
      isAdmin: true,
      role: 'super_admin',
      active: true,
      permissions: ['read:content', 'manage:admins'],
      uidPresent: true,
      uidMatchesToken: true,
      emailPresent: true,
    });
    expectNoSecrets(JSON.stringify(summary));
  });

  it('flags a registry keyed on a different principal', () => {
    expect(
      summarizeAdminStatus({ ...ADMIN_STATUS, uid: 'someone-else' }, OID).uidMatchesToken
    ).toBe(false);
    expect(summarizeAdminStatus({ isAdmin: false }, OID).uidMatchesToken).toBeNull();
  });
});

describe('evaluateLabsProbe', () => {
  const good = {
    enqueue: { httpStatus: 200, jobId: 'job-1', type: 'shell-echo', status: 'queued' },
    read: { found: true, status: 'queued' },
    cancel: { httpStatus: 200, status: 'cancelled' },
    final: { status: 'cancelled' },
  };

  it('passes on the documented response with a settled document', () => {
    expect(evaluateLabsProbe(good)).toEqual({
      pass: true,
      reason: 'documented no-op response; document cancelled',
    });
  });

  it('also passes when an agent claimed the job before the cancel — not a hang', () => {
    expect(
      evaluateLabsProbe({
        ...good,
        cancel: { error: 'Job is no longer queued' },
        final: { status: 'running' },
      }).pass
    ).toBe(true);
  });

  it('fails on a 500, a missing document, or a job left queued', () => {
    expect(evaluateLabsProbe({ ...good, enqueue: { httpStatus: 500, error: 'boom' } }).pass).toBe(
      false
    );
    expect(evaluateLabsProbe({ ...good, read: { found: false } }).pass).toBe(false);
    expect(evaluateLabsProbe({ ...good, final: { status: 'queued' } })).toEqual({
      pass: false,
      reason: 'lab_jobs/job-1 is still "queued"',
    });
  });

  it('is unknown before it has run', () => {
    expect(evaluateLabsProbe(null).pass).toBeNull();
  });

  it('reports a failed final read as its own failure, not as "still queued"', () => {
    // The read-back before the cancel said queued; the read after it failed.
    // Falling back to the earlier status would assert a state nobody observed.
    const verdict = evaluateLabsProbe({
      ...good,
      final: { status: null, error: 'getLabJob timed out after 20s' },
    });
    expect(verdict).toEqual({
      pass: false,
      reason:
        'final getLabJob read failed (getLabJob timed out after 20s) — lab_jobs/job-1 state unknown',
    });

    const report = buildReport({
      generatedAt: 'now',
      labs: { ...good, final: { status: null, error: 'getLabJob timed out after 20s' } },
    });
    expect(report).toContain(
      'lab_jobs/job-1 final status: read failed (getLabJob timed out after 20s) — state unknown'
    );
    expect(report).toContain('Authenticated no-op path: FAIL (final getLabJob read failed');
    expect(report).not.toContain('still "queued"');
  });
});

describe('evaluateUnauthenticatedProbe', () => {
  it('accepts only 401 and 403', () => {
    expect(evaluateUnauthenticatedProbe({ httpStatus: 401 }).pass).toBe(true);
    expect(evaluateUnauthenticatedProbe({ httpStatus: 403 }).pass).toBe(true);
    expect(evaluateUnauthenticatedProbe({ httpStatus: 200 }).pass).toBe(false);
    expect(evaluateUnauthenticatedProbe({ httpStatus: null, error: 'network' }).pass).toBe(false);
    expect(evaluateUnauthenticatedProbe(null).pass).toBeNull();
  });
});

describe('buildReport', () => {
  it('names claims, verdicts and job ids, and nothing that identifies the person', () => {
    const report = buildReport({
      generatedAt: '2026-09-07T00:00:00.000Z',
      token: summarizeToken(CLAIMS, EXPECTATIONS, NOW_SECONDS * 1000),
      expectations: EXPECTATIONS,
      admin: summarizeAdminStatus(ADMIN_STATUS, OID),
      adminHttp: 200,
      labs: {
        enqueue: { httpStatus: 200, jobId: 'job-1', type: 'shell-echo', status: 'queued' },
        read: { found: true, status: 'queued' },
        cancel: { httpStatus: 200, status: 'cancelled' },
        final: { status: 'cancelled' },
      },
      unauth: { httpStatus: 401 },
    });
    expect(report).toContain('### #355');
    expect(report).toContain(
      'Claims present (names only): aud, email, exp, iat, iss, name, oid, preferred_username, roles, sub, tid'
    );
    expect(report).toContain("`aud` equals the API's ENTRA_API_AUDIENCE: PASS");
    expect(report).toContain('App Role `Admin` present in `roles`: PASS');
    expect(report).toContain('Registry uid equals token oid: PASS');
    expect(report).toContain('- Result: PASS');
    expect(report).toContain('### #356');
    expect(report).toContain('jobId job-1');
    expect(report).toContain('Authenticated no-op path: PASS');
    expect(report).toContain('no Authorization header: PASS (HTTP 401)');
    expectNoSecrets(report);
  });

  it('marks the identity result FAIL when the registry disagrees with the token', () => {
    const report = buildReport({
      generatedAt: 'now',
      token: summarizeToken(CLAIMS, EXPECTATIONS),
      expectations: EXPECTATIONS,
      admin: summarizeAdminStatus({ isAdmin: false, uid: OID, email: EMAIL }, OID),
      adminHttp: 200,
    });
    expect(report).toContain('isAdmin false');
    expect(report).toContain('- Result: FAIL');
    expect(report).toContain(
      'Authenticated no-op path: UNKNOWN (NOT RUN — press "Run authenticated probe")'
    );
    expect(report).toContain(
      'no Authorization header: UNKNOWN (NOT RUN — press "Run unauthenticated probe")'
    );
    expectNoSecrets(report);
  });

  it('says the identity checks are still running rather than that the token failed', () => {
    // Before the first run settles, "could not be read" would be a lie about
    // work that has not happened yet — and it is what would be pasted on #355.
    const report = buildReport({ generatedAt: 'now', identityPending: true });
    expect(report).toContain('Identity checks: STILL RUNNING — this report is not final');
    expect(report).not.toContain('could not be read');
    expect(report).not.toContain('Result:');
    expect(report).toContain('NOT RUN — press "Run authenticated probe"');
    expect(report).toContain('NOT RUN — press "Run unauthenticated probe"');
  });

  it('is honest about what could not be read', () => {
    const report = buildReport({
      generatedAt: 'now',
      tokenError: 'Not authenticated. Please sign in.',
    });
    expect(report).toContain('Token: could not be read (Not authenticated. Please sign in.)');
    expect(report).toContain('getCurrentAdminStatus: not called');
    expect(report).toContain('- Result: UNKNOWN');
  });
});

// ── The page ──────────────────────────────────────────────────────────────────

describe('the page', () => {
  // The report <pre> repeats most of what the rows say, so wait on a verdict
  // line that appears exactly once rather than on a value.
  const identityLoaded = () =>
    waitFor(() => expect(screen.getByText('Caller is an admin per the registry')).toBeTruthy());
  const seen = (pattern) => expect(screen.getAllByText(pattern).length).toBeGreaterThan(0);

  it('runs the identity checks on load and shows names, verdicts, and no person', async () => {
    const { container } = render(<DiagnosticsPage />);
    await identityLoaded();

    expect(acquireApiToken).toHaveBeenCalledTimes(1);
    expect(getJSON).toHaveBeenCalledWith('getAuthExpectations');
    expect(authedFetch).toHaveBeenCalledWith('getCurrentAdminStatus', {
      method: 'GET',
      token: TOKEN,
    });

    seen(/aud, email, exp, iat, iss, name, oid, preferred_username, roles, sub, tid/);
    expect(screen.getAllByText('PASS').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText('FAIL')).toBeNull();
    expectNoSecrets(container.textContent);
  });

  it('decodes the very token it sends to getCurrentAdminStatus, from one refreshed acquisition', async () => {
    // authedFetch force-refreshes for getCurrentAdminStatus. If the panel
    // decoded a separately acquired (cached) token, a just-granted role could
    // read FAIL here while the API, on a fresh token, said isAdmin true.
    const STALE = `${b64url({ alg: 'RS256' })}.${b64url({ ...CLAIMS, roles: [] })}.sig`;
    acquireApiToken.mockReset().mockResolvedValueOnce(TOKEN).mockResolvedValue(STALE);
    render(<DiagnosticsPage />);
    await identityLoaded();

    // One acquisition for the whole identity run, with the refresh the API
    // call itself would have asked for.
    expect(acquireApiToken).toHaveBeenCalledTimes(1);
    expect(acquireApiToken).toHaveBeenCalledWith({ forceRefresh: true });
    // The bytes sent are the bytes decoded — handed to authedFetch as `token`,
    // which skips its own acquisition, so there is no second call at all.
    const [, init] = authedFetch.mock.calls.find(([name]) => name === 'getCurrentAdminStatus');
    expect(init.token).toBe(TOKEN);
    expect(init.token).not.toBe(STALE);
    expect(init.headers).toBeUndefined();
    // And the claims panel reflects that same token: Admin present.
    expect(screen.getAllByText('PASS').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText('FAIL')).toBeNull();
  });

  it('reports the API refusing the token as unknown, with the refusal shown', async () => {
    getJSON.mockRejectedValue(new Error('Authentication required'));
    authedFetch.mockRejectedValue(new Error('Invalid token'));
    const { container } = render(<DiagnosticsPage />);
    // While the first run settles a second role="status" ("Checks still
    // running") is on screen; getByRole throws on two, so this only passes once
    // the run has settled and the refusal note is the one left.
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Authentication required')
    );
    expect(screen.getAllByText('UNKNOWN').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Invalid token')).toBeTruthy();
    expectNoSecrets(container.textContent);
  });

  it('submits the probe as the Labs console would, reads it back, cancels it, and passes', async () => {
    render(<DiagnosticsPage />);
    await identityLoaded();

    fireEvent.click(screen.getByText('Run authenticated probe'));
    await waitFor(() => seen(/job-123/));

    expect(authedFetch).toHaveBeenCalledWith('enqueueLabJob', {
      method: 'POST',
      body: JSON.stringify(LABS_PROBE_JOB),
    });
    expect(LABS_PROBE_JOB).toEqual({ type: 'shell-echo', payload: '' });
    const labCalls = postJSON.mock.calls.map(([name]) => name);
    expect(labCalls).toEqual(['getLabJob', 'cancelLabJob', 'getLabJob']);
    expect(
      screen.getByText(/Authenticated no-op path — documented no-op response; document cancelled/)
    ).toBeTruthy();
  });

  it('shows a failed final read in the panel as unknown state, and fails the probe', async () => {
    let reads = 0;
    postJSON.mockImplementation(async (name, body) => {
      if (name === 'getLabJob') {
        reads += 1;
        if (reads === 2) throw new Error('getLabJob timed out after 20s');
        return { job: { id: body.jobId, status: 'queued' } };
      }
      if (name === 'cancelLabJob') return { jobId: body.jobId, status: 'cancelled' };
      throw new Error(`unexpected postJSON ${name}`);
    });
    render(<DiagnosticsPage />);
    await identityLoaded();

    fireEvent.click(screen.getByText('Run authenticated probe'));
    await waitFor(() => seen(/read failed \(getLabJob timed out after 20s\) — state unknown/));
    expect(screen.getByText('FAIL')).toBeTruthy();
    expect(screen.queryByText(/still "queued"/)).toBeNull();
  });

  it('shows a 500 from enqueue as a failure rather than a crash', async () => {
    authedFetch.mockImplementation(async (name) => {
      if (name === 'getCurrentAdminStatus') return jsonResponse(200, ADMIN_STATUS);
      throw new Error('enqueueLabJob failed with HTTP 500. Try again or check the logs.');
    });
    render(<DiagnosticsPage />);
    await identityLoaded();

    fireEvent.click(screen.getByText('Run authenticated probe'));
    await waitFor(() => seen(/HTTP 500/));
    expect(postJSON).not.toHaveBeenCalled();
    seen(/enqueueLabJob answered no status/);
  });

  it('sends the unauthenticated probe through plain fetch with no Authorization header', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(401, { ok: false, error: 'Authentication required' })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<DiagnosticsPage />);
    await identityLoaded();
    acquireApiToken.mockClear();

    fireEvent.click(screen.getByText('Run unauthenticated probe'));
    await waitFor(() =>
      expect(screen.getByText(/HTTP 401 · Authentication required/)).toBeTruthy()
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [[url, init]] = fetchMock.mock.calls;
    expect(url).toBe('https://api.example.test/api/enqueueLabJob');
    expect(init.method).toBe('POST');
    expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(init.body).toBe(JSON.stringify(LABS_PROBE_JOB));
    // No token was even acquired for this path.
    expect(acquireApiToken).not.toHaveBeenCalled();
    expect(screen.getByText(/Unauthenticated request refused — HTTP 401/)).toBeTruthy();
  });

  it('a probe that throws resets its busy flag, re-enables the buttons and shows the error', async () => {
    // A real seam, not a contrived one: an unset VITE_AZURE_FUNCTIONS_URL
    // makes getEndpoint throw before the request is even built.
    getEndpoint.mockImplementationOnce(() => {
      throw new Error('VITE_AZURE_FUNCTIONS_URL is not set, so enqueueLabJob cannot be called.');
    });
    vi.stubGlobal('fetch', vi.fn());
    render(<DiagnosticsPage />);
    await identityLoaded();
    const unauthButton = screen.getByText('Run unauthenticated probe').closest('button');
    const copy = screen.getByText('Copy report').closest('button');

    fireEvent.click(screen.getByText('Run unauthenticated probe'));
    await waitFor(() => seen(/VITE_AZURE_FUNCTIONS_URL is not set/));

    // Not stuck: the busy flag was cleared in finally, so both come back.
    expect(unauthButton.disabled).toBe(false);
    expect(copy.disabled).toBe(false);
    expect(screen.queryByText(/Checks still running/)).toBeNull();
    // Surfaced as a failed probe, and the report says the same.
    expect(screen.getByText('FAIL')).toBeTruthy();
    expect(screen.getByLabelText('Diagnostics report').textContent).toContain(
      'no Authorization header: FAIL (VITE_AZURE_FUNCTIONS_URL is not set'
    );
    // The button is usable again: the next run goes through.
    fireEvent.click(screen.getByText('Run unauthenticated probe'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it('a 200 on the unauthenticated probe is a FAIL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { jobId: 'leak' }))
    );
    render(<DiagnosticsPage />);
    await identityLoaded();
    fireEvent.click(screen.getByText('Run unauthenticated probe'));
    await waitFor(() =>
      expect(screen.getByText(/Unauthenticated request refused — HTTP 200/)).toBeTruthy()
    );
    expect(screen.getByText('FAIL')).toBeTruthy();
  });

  it('keeps Copy report disabled until the identity checks have settled', async () => {
    // Hold the token acquisition open so the first run cannot settle.
    let releaseToken;
    acquireApiToken.mockReturnValue(new Promise((resolve) => (releaseToken = resolve)));
    render(<DiagnosticsPage />);

    const copy = screen.getByText('Copy report').closest('button');
    expect(copy.disabled).toBe(true);
    expect(screen.getByText(/Checks still running/)).toBeTruthy();
    // The on-screen report says the same thing, so a manual select-and-copy
    // cannot produce a false "could not be read" either.
    expect(screen.getByLabelText('Diagnostics report').textContent).toContain('STILL RUNNING');
    expect(screen.getByLabelText('Diagnostics report').textContent).not.toContain(
      'could not be read'
    );

    releaseToken(TOKEN);
    await identityLoaded();
    expect(copy.disabled).toBe(false);
    expect(screen.queryByText(/Checks still running/)).toBeNull();
  });

  it('does not start a second identity run when Re-run is clicked during the first', async () => {
    // Hold the first run open. A second run started now would race it, and
    // whichever resolved last would win — so the click must be a no-op.
    let releaseToken;
    acquireApiToken.mockReturnValue(new Promise((resolve) => (releaseToken = resolve)));
    render(<DiagnosticsPage />);
    // The token is acquired after the dynamic entraAuth import resolves, so
    // the first call is a tick away from render.
    await waitFor(() => expect(acquireApiToken).toHaveBeenCalledTimes(1));

    const rerun = screen.getByText('Re-run identity checks').closest('button');
    expect(rerun.disabled).toBe(true);
    // Even if the disabled attribute were bypassed, the in-flight gate holds.
    fireEvent.click(screen.getByText('Re-run identity checks'));
    fireEvent.click(screen.getByText('Re-run identity checks'));
    expect(acquireApiToken).toHaveBeenCalledTimes(1);
    expect(getJSON).not.toHaveBeenCalled();

    releaseToken(TOKEN);
    await identityLoaded();
    expect(acquireApiToken).toHaveBeenCalledTimes(1);
    expect(rerun.disabled).toBe(false);

    // Once settled, a click does run again — exactly once — and is gated while it runs.
    fireEvent.click(screen.getByText('Re-run identity checks'));
    await waitFor(() => expect(acquireApiToken).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByText('Re-run identity checks'));
    expect(acquireApiToken).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(rerun.disabled).toBe(false));
  });

  it('disables Copy report again while a probe is in flight', async () => {
    let releaseEnqueue;
    authedFetch.mockImplementation(async (name) => {
      if (name === 'getCurrentAdminStatus') return jsonResponse(200, ADMIN_STATUS);
      return new Promise((resolve) => (releaseEnqueue = resolve));
    });
    render(<DiagnosticsPage />);
    await identityLoaded();
    const copy = screen.getByText('Copy report').closest('button');
    expect(copy.disabled).toBe(false);

    fireEvent.click(screen.getByText('Run authenticated probe'));
    await waitFor(() => expect(copy.disabled).toBe(true));
    expect(screen.getByText(/Checks still running/)).toBeTruthy();

    releaseEnqueue(jsonResponse(200, { jobId: 'job-123', type: 'shell-echo', status: 'queued' }));
    await waitFor(() => expect(copy.disabled).toBe(false));
    seen(/job-123/);
  });

  it('copies the report — the same summary, never the token', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<DiagnosticsPage />);
    await identityLoaded();

    fireEvent.click(screen.getByText('Copy report'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const [[copied]] = writeText.mock.calls;
    expect(copied).toContain('### #355');
    expect(copied).toContain('### #356');
    expect(copied).toContain('Registry uid equals token oid: PASS');
    expectNoSecrets(copied);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Report copied' }));
  });

  it('says so when the clipboard is unavailable, and leaves the report on screen', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    render(<DiagnosticsPage />);
    await identityLoaded();

    fireEvent.click(screen.getByText('Copy report'));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
    );
    expect(screen.getByLabelText('Diagnostics report').textContent).toContain('### #355');
  });
});
