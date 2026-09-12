/**
 * The merged Health page: the observed half and the verified half, together.
 *
 * Most of what is held here is absence — the raw token, `oid`, `sub` and
 * `email` never reach the DOM, the report, or the clipboard. The pure halves
 * of the probes are tested in `health/probes.test.jsx`; this file is about
 * what the page does with them, and about the two halves being one page.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import HealthPage from './HealthPage';
import { LABS_PROBE_JOB } from './health/probes';

const authedFetch = vi.fn();
const getJSON = vi.fn();
const postJSON = vi.fn();
const acquireApiToken = vi.fn();
const getEndpoint = vi.fn((name) => `https://api.example.test/api/${name}`);
const runJob = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  authedFetch: (...args) => authedFetch(...args),
  getJSON: (...args) => getJSON(...args),
  postJSON: (...args) => postJSON(...args),
  getEndpoint: (...args) => getEndpoint(...args),
}));
vi.mock('@/lib/jobs', () => ({ runJob: (...args) => runJob(...args) }));
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
  // Since #515 a token that reaches this page necessarily carries both.
  scp: 'access_as_admin',
  ver: '2.0',
  azp: 'spa-client-id',
  exp: NOW_SECONDS + 3600,
  iat: NOW_SECONDS,
};
const TOKEN = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(CLAIMS)}.signature-bytes`;

const EXPECTATIONS = {
  requiredScope: 'access_as_admin',
  requiredTokenVersion: '2.0',
  labAgentAppRole: 'LabAgent',
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

/** The observed half's one read. */
const SNAPSHOT = {
  success: true,
  readiness: {
    functionsConfigured: true,
    publishedItems: 14,
    missingSlugCount: 2,
    rssSources: 11,
  },
  digest: {
    digestDate: '2026-04-12',
    totalQueued: 8,
    recentRssCount: 5,
    publishingOps: {
      status: 'degraded',
      due: 4,
      published: 3,
      skipped: 1,
      failed: 1,
      lastRunAt: { toDate: () => new Date('2026-04-12T10:00:00Z') },
    },
    publishingWatchdog: {
      overdueScheduledCount: 2,
      stagedTooLongCount: 1,
    },
  },
  alerts: [],
  operationalSignals: {
    queueBreachCount: 3,
    oldestStagedHours: 18,
    openAlertAgeHours: 6,
    publishFailureCount: 1,
    orphanedGeneratedImages: 2,
    lastSchedulerSuccessAt: { toDate: () => new Date('2026-04-12T09:00:00Z') },
  },
};

const jsonResponse = (status, body) => ({ status, ok: status < 400, json: async () => body });

/** Every string that must never appear on screen or in the report. */
const SECRETS = [TOKEN, OID, EMAIL, 'sub-pairwise-id', 'The Owner'];
const expectNoSecrets = (text) => {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
};

/**
 * The snapshot read shares `postJSON` with the Labs probe, so the probe's
 * call sequence is asserted on the lab calls rather than on every call the
 * page makes.
 */
const LAB_ROUTES = new Set(['getLabJob', 'cancelLabJob']);
const labCallNames = () =>
  postJSON.mock.calls.map(([name]) => name).filter((name) => LAB_ROUTES.has(name));

const snapshotAware = (impl) => async (name, body) => {
  if (name === 'getOpsHealthSnapshot') return SNAPSHOT;
  return impl(name, body);
};

beforeEach(() => {
  acquireApiToken.mockReset().mockResolvedValue(TOKEN);
  getJSON.mockReset().mockResolvedValue(EXPECTATIONS);
  runJob.mockReset();
  authedFetch.mockReset().mockImplementation(async (name) => {
    if (name === 'getCurrentAdminStatus') return jsonResponse(200, ADMIN_STATUS);
    if (name === 'enqueueLabJob') {
      return jsonResponse(200, { jobId: 'job-123', type: 'shell-echo', status: 'queued' });
    }
    throw new Error(`unexpected authedFetch ${name}`);
  });
  postJSON.mockReset().mockImplementation(
    snapshotAware(async (name, body) => {
      if (name === 'getLabJob') return { job: { id: body.jobId, status: postJSON.jobStatus } };
      if (name === 'cancelLabJob') {
        postJSON.jobStatus = 'cancelled';
        return { jobId: body.jobId, status: 'cancelled' };
      }
      throw new Error(`unexpected postJSON ${name}`);
    })
  );
  postJSON.jobStatus = 'queued';
  toast.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// The report <pre> repeats most of what the rows say, so wait on a verdict
// line that appears exactly once rather than on a value.
const identityLoaded = () =>
  waitFor(() => expect(screen.getByText('Caller is an admin per the registry')).toBeTruthy());
const seen = (pattern) => expect(screen.getAllByText(pattern).length).toBeGreaterThan(0);

/**
 * The verdict badge beside a given verdict line.
 *
 * `Verdict` renders `<Badge/>` and its sentence as siblings, and the strip at
 * the top of the page repeats every verdict as its own badge — so a page-wide
 * `getByText('FAIL')` matches twice. Scoping to the row asserts the badge is on
 * the check it is about, which is what the assertion always meant.
 *
 * The same sentence appears again inside the report `<pre>`, so the row is
 * picked by element: `Verdict` puts its sentence in a `<span>`.
 */
const verdictBadge = (pattern) => {
  const sentence = screen.getAllByText(pattern).find((el) => el.tagName === 'SPAN');
  expect(sentence, `no verdict row matched ${pattern}`).toBeTruthy();
  return within(sentence.closest('div'));
};

// ── The two halves are one page ──────────────────────────────────────────────

describe('the merge', () => {
  it('renders what the estate reports and what this session can prove, on one page', async () => {
    render(<HealthPage />);
    await identityLoaded();

    // Observed: written by a timer, read once, nobody asked.
    expect(screen.getByText('What is true now')).toBeTruthy();
    expect(screen.getByText('Queue SLA Breaches')).toBeTruthy();
    expect(screen.getByText('Publishing Operations')).toBeTruthy();
    expect(screen.getByText('Workflow Alerts')).toBeTruthy();

    // Verified: nothing here was true until a button made it true.
    expect(screen.getByText('What I can verify right now')).toBeTruthy();
    expect(screen.getByText('Token claims')).toBeTruthy();
    expect(screen.getByText('Admin registry')).toBeTruthy();
    expect(screen.getByText('Labs no-op probe')).toBeTruthy();
  });

  it('puts the pipeline smoke tests in the verified half, not among the metrics', async () => {
    // They fetch every RSS feed and write real documents. On the old Ops
    // Health page they sat among live counters and read as status.
    render(<HealthPage />);
    await identityLoaded();
    expect(screen.getByText('Pipeline Smoke Tests')).toBeTruthy();
    // By the tiles' own controls: "Reviewer Digest" now names two different
    // things on this page — the action here, and the readiness row above that
    // reports the digest the action wrote.
    expect(screen.getByLabelText('Toggle RSS Fetch explanation')).toBeTruthy();
    expect(screen.getByLabelText('Toggle Batch Inspect explanation')).toBeTruthy();
    expect(screen.getByLabelText('Toggle Reviewer Digest explanation')).toBeTruthy();
  });

  it('shows a live signal beside a probe verdict in the strip at the top', async () => {
    // The one place the two halves meet, and the reason they are one page:
    // "Functions URL Ready" next to "Identity UNKNOWN" is a real state, and
    // it is invisible when the two live on different pages.
    render(<HealthPage />);
    await identityLoaded();

    const glance = screen.getByRole('group', { name: 'Health at a glance' });
    // An observed signal…
    expect(glance.textContent).toContain('Functions URL');
    expect(glance.textContent).toContain('Ready');
    expect(glance.textContent).toContain('Open alerts');
    // …and a verified one, in the same strip.
    expect(glance.textContent).toContain('Identity');
    expect(glance.textContent).toContain('PASS');
    expect(glance.textContent).toContain('Labs probe');
    expect(glance.textContent).toContain('UNKNOWN');
  });

  it('renders readiness and publishing metrics from the backend snapshot', async () => {
    render(<HealthPage />);

    expect(await screen.findByText('Health')).toBeInTheDocument();
    await waitFor(() => expect(postJSON).toHaveBeenCalledWith('getOpsHealthSnapshot', {}));

    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('degraded')).toBeInTheDocument();
    expect(screen.getByText('Queue SLA Breaches')).toBeInTheDocument();
    expect(screen.getByText('18h')).toBeInTheDocument();
    expect(screen.getByText('No alerts in this filter.')).toBeInTheDocument();
  });
});

// ── The probes ────────────────────────────────────────────────────────────────

describe('the page', () => {
  it('runs the identity checks on load and shows names, verdicts, and no person', async () => {
    const { container } = render(<HealthPage />);
    await identityLoaded();

    expect(acquireApiToken).toHaveBeenCalledTimes(1);
    expect(getJSON).toHaveBeenCalledWith('getAuthExpectations', { token: TOKEN });
    expect(authedFetch).toHaveBeenCalledWith('getCurrentAdminStatus', {
      method: 'GET',
      token: TOKEN,
    });

    seen(
      /aud, azp, email, exp, iat, iss, name, oid, preferred_username, roles, scp, sub, tid, ver/
    );
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
    render(<HealthPage />);
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
    // The expectations call rides the same acquisition — the run is ONE token,
    // not one per call.
    expect(getJSON).toHaveBeenCalledTimes(1);
    expect(getJSON).toHaveBeenCalledWith('getAuthExpectations', { token: TOKEN });
    // And the claims panel reflects that same token: Admin present.
    expect(screen.getAllByText('PASS').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText('FAIL')).toBeNull();
  });

  it('names a 200 with no JSON body from the status route instead of rendering a blank', async () => {
    authedFetch.mockImplementation(async (name) => {
      if (name === 'getCurrentAdminStatus') {
        return {
          status: 200,
          ok: true,
          json: async () => {
            throw new SyntaxError('Unexpected end of JSON input');
          },
        };
      }
      throw new Error(`unexpected authedFetch ${name}`);
    });
    render(<HealthPage />);
    await waitFor(() => seen(/status route answered 200 with no JSON body/));
    // Not an "isAdmin false" and not an empty paragraph — an explicit finding,
    // on the panel and in the report.
    expect(screen.queryByText('Caller is an admin per the registry')).toBeNull();
    expect(screen.getByLabelText('Diagnostics report').textContent).toContain(
      '- getCurrentAdminStatus: status route answered 200 with no JSON body'
    );
    expect(screen.getByLabelText('Diagnostics report').textContent).toContain(
      '- Result: UNKNOWN (token or registry not read)'
    );
  });

  it('reports the API refusing the token as unknown, with the refusal shown', async () => {
    getJSON.mockRejectedValue(new Error('Authentication required'));
    authedFetch.mockRejectedValue(new Error('Invalid token'));
    const { container } = render(<HealthPage />);
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
    render(<HealthPage />);
    await identityLoaded();

    fireEvent.click(screen.getByText('Run authenticated probe'));
    await waitFor(() => seen(/job-123/));

    expect(authedFetch).toHaveBeenCalledWith('enqueueLabJob', {
      method: 'POST',
      body: JSON.stringify(LABS_PROBE_JOB),
    });
    expect(LABS_PROBE_JOB).toEqual({ type: 'shell-echo', payload: '' });
    expect(labCallNames()).toEqual(['getLabJob', 'cancelLabJob', 'getLabJob']);
    expect(
      screen.getByText(/Authenticated no-op path — documented no-op response; document cancelled/)
    ).toBeTruthy();
  });

  it('shows a failed final read in the panel as unknown state, and fails the probe', async () => {
    let reads = 0;
    postJSON.mockImplementation(
      snapshotAware(async (name, body) => {
        if (name === 'getLabJob') {
          reads += 1;
          if (reads === 2) throw new Error('getLabJob timed out after 20s');
          return { job: { id: body.jobId, status: 'queued' } };
        }
        if (name === 'cancelLabJob') return { jobId: body.jobId, status: 'cancelled' };
        throw new Error(`unexpected postJSON ${name}`);
      })
    );
    render(<HealthPage />);
    await identityLoaded();

    fireEvent.click(screen.getByText('Run authenticated probe'));
    await waitFor(() => seen(/read failed \(getLabJob timed out after 20s\) — state unknown/));
    expect(verdictBadge(/Authenticated no-op path/).getByText('FAIL')).toBeTruthy();
    expect(screen.queryByText(/still "queued"/)).toBeNull();
  });

  it('shows a 500 from enqueue as a failure rather than a crash', async () => {
    authedFetch.mockImplementation(async (name) => {
      if (name === 'getCurrentAdminStatus') return jsonResponse(200, ADMIN_STATUS);
      throw new Error('enqueueLabJob failed with HTTP 500. Try again or check the logs.');
    });
    render(<HealthPage />);
    await identityLoaded();

    fireEvent.click(screen.getByText('Run authenticated probe'));
    await waitFor(() => seen(/HTTP 500/));
    // The enqueue threw, so no lab route was reached. The snapshot read shares
    // this mock and is not part of the claim.
    expect(labCallNames()).toEqual([]);
    seen(/enqueueLabJob answered no status/);
  });

  it('sends the unauthenticated probe through plain fetch with no Authorization header', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(401, { ok: false, error: 'Authentication required' })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<HealthPage />);
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
    render(<HealthPage />);
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
    expect(verdictBadge(/Unauthenticated request refused/).getByText('FAIL')).toBeTruthy();
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
    render(<HealthPage />);
    await identityLoaded();
    fireEvent.click(screen.getByText('Run unauthenticated probe'));
    await waitFor(() =>
      expect(screen.getByText(/Unauthenticated request refused — HTTP 200/)).toBeTruthy()
    );
    expect(verdictBadge(/Unauthenticated request refused/).getByText('FAIL')).toBeTruthy();
  });

  it('keeps Copy report disabled until the identity checks have settled', async () => {
    // Hold the token acquisition open so the first run cannot settle.
    let releaseToken;
    acquireApiToken.mockReturnValue(new Promise((resolve) => (releaseToken = resolve)));
    render(<HealthPage />);
    // The snapshot resolves first; the page renders once it has.
    const copy = await screen.findByText('Copy report');
    const copyButton = copy.closest('button');

    expect(copyButton.disabled).toBe(true);
    expect(screen.getByText(/Checks still running/)).toBeTruthy();
    // The on-screen report says the same thing, so a manual select-and-copy
    // cannot produce a false "could not be read" either.
    expect(screen.getByLabelText('Diagnostics report').textContent).toContain('STILL RUNNING');
    expect(screen.getByLabelText('Diagnostics report').textContent).not.toContain(
      'could not be read'
    );

    releaseToken(TOKEN);
    await identityLoaded();
    expect(copyButton.disabled).toBe(false);
    expect(screen.queryByText(/Checks still running/)).toBeNull();
  });

  it('does not start a second identity run when Re-run is clicked during the first', async () => {
    // Hold the first run open. A second run started now would race it, and
    // whichever resolved last would win — so the click must be a no-op.
    let releaseToken;
    acquireApiToken.mockReturnValue(new Promise((resolve) => (releaseToken = resolve)));
    render(<HealthPage />);
    // The token is acquired after the dynamic entraAuth import resolves, so
    // the first call is a tick away from render.
    await waitFor(() => expect(acquireApiToken).toHaveBeenCalledTimes(1));

    const rerun = (await screen.findByText('Re-run identity checks')).closest('button');
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
    render(<HealthPage />);
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

  it('copies the report — the same summary, never the token, naming no ticket', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<HealthPage />);
    await identityLoaded();

    fireEvent.click(screen.getByText('Copy report'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const [[copied]] = writeText.mock.calls;
    expect(copied).toContain('### Identity — token claims and admin registry');
    expect(copied).toContain('### Labs no-op probe');
    expect(copied).toContain('Registry uid equals token oid: PASS');
    // #355 and #356 closed on 2026-09-07 by this page's first run. The report
    // is a repeatable check now, and names no ticket.
    expect(copied).not.toMatch(/#3\d\d/);
    expectNoSecrets(copied);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Report copied' }));
  });

  it('says so when the clipboard is unavailable, and leaves the report on screen', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    render(<HealthPage />);
    await identityLoaded();

    fireEvent.click(screen.getByText('Copy report'));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
    );
    expect(screen.getByLabelText('Diagnostics report').textContent).toContain('### Identity');
  });
});
