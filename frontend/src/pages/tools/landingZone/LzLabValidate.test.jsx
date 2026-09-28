/**
 * "Validate on the lab" (#672). What must hold: the button is disabled with
 * one line, and no spinner, until the server says the lab is open, which by
 * default it does not (public submission switched off); a lab with no agent,
 * a full queue or an unreadable status reads the same way with its own line;
 * a build calling a module the runner image does not vendor is refused here
 * with the module named; when open, one click sends the build's files
 * unchanged and polls the job to its output; the server's refusals read in
 * its own words, and a refusal naming the door shuts the button; a changed
 * build drops the output; and the pre-rendered markup is the "checking"
 * line, which hydration adopts.
 *
 * Locked to this pane (ADR 0032 decision 6, revised 2026-09-28): the
 * Turnstile widget loads only once the lab is open and the build has a site
 * key, the button waits for its token, each submission carries one token and
 * asks for the next, and the lock's refusals read in the server's words.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';

import { LzLabValidate } from './LzLabValidate';
import {
  LINES,
  afterPoll,
  disabledReason,
  doorFromRefusal,
  failureLine,
  outcomeLine,
  preparePayload,
  statusLine,
  unresolvedLine,
} from './labValidateRules';
import { DEFAULT_STATE, decodeLz, emitFiles } from '@/lib/landingZone';
import { decodeTarPayload, parseTar } from '../../../../../vps-agent/lib/docker-runner.js';
import { clearPublicGetCache } from '@/lib/publicApi';

vi.mock('@/lib/functionsBase', () => ({
  requireFunctionsBase: () => 'https://api.test/api',
}));

const CLOSED = {
  configured: false,
  open: false,
  code: 'PUBLIC_SUBMISSION_CLOSED',
  reason: 'The lab is not taking public jobs yet: public submission is switched off.',
};
const OFFLINE = {
  configured: true,
  open: false,
  code: 'LAB_AGENT_OFFLINE',
  reason: 'The lab is not taking jobs yet: no lab agent is online to run them.',
};
const OPEN = { configured: true, open: true, code: null, reason: null, queued: 0 };

/** A small build the runner image can initialise: the platform with no landing zone. */
const NO_SPOKES = emitFiles(
  decodeLz(new URLSearchParams('lz=mg,policy,mgmt,hub,fw&corp=0&online=0'))
);
const DEFAULT_FILES = emitFiles(DEFAULT_STATE);

const refusal = (status, code, message) => Object.assign(new Error(message), { status, code });

function requestsFor({ door = OPEN, submit, jobs = [] } = {}) {
  const queue = [...jobs];
  return {
    status: vi.fn(async () => door),
    submit:
      submit ??
      vi.fn(async () => ({
        ok: true,
        jobId: 'job-1',
        type: 'terraform-validate',
        status: 'queued',
      })),
    job: vi.fn(async () => (queue.length > 1 ? queue.shift() : queue[0])),
  };
}

/**
 * Cloudflare's `turnstile` API, faked. A widget solves on render and again
 * on every reset, issuing turnstile-token-1, -2, … unless `solve` is false,
 * when the test drives the callbacks itself.
 */
function fakeTurnstile({ siteKey = 'site-key-test', solve = true, loadFails = false } = {}) {
  let issued = 0;
  const widgets = new Map();
  const nextToken = () => `turnstile-token-${(issued += 1)}`;
  const api = {
    render: vi.fn((element, options) => {
      const id = `widget-${widgets.size + 1}`;
      widgets.set(id, options);
      if (solve) options.callback(nextToken());
      return id;
    }),
    reset: vi.fn((id) => {
      if (solve) widgets.get(id)?.callback(nextToken());
    }),
    remove: vi.fn((id) => widgets.delete(id)),
  };
  const load = vi.fn(async () => (loadFails ? Promise.reject(new Error('blocked')) : api));
  return { siteKey, load, api, options: () => [...widgets.values()][0] };
}

const renderControl = ({ turnstile = fakeTurnstile(), ...props } = {}) =>
  render(<LzLabValidate files={NO_SPOKES} pollDelay={() => 0} turnstile={turnstile} {...props} />);

const button = () => screen.getByTestId('lz-lab-validate');
const line = () => screen.getByTestId('lz-lab-line');
const hasSpinner = () => Boolean(screen.getByTestId('lz-lab').querySelector('.animate-spin'));

afterEach(() => {
  vi.unstubAllGlobals();
  clearPublicGetCache();
});

describe('closed until the server says open', () => {
  it('starts disabled on the checking line, with no spinner', () => {
    renderControl({ requests: { ...requestsFor(), status: vi.fn(() => new Promise(() => {})) } });
    expect(button()).toBeDisabled();
    expect(line().textContent).toBe(LINES.checking);
    expect(hasSpinner()).toBe(false);
  });

  it('shows the switched-off line by default and sends nothing', async () => {
    const requests = requestsFor({ door: CLOSED });
    renderControl({ requests });
    await waitFor(() => expect(line().textContent).toBe(CLOSED.reason));
    expect(line().dataset.door).toBe('PUBLIC_SUBMISSION_CLOSED');
    expect(button()).toBeDisabled();
    expect(hasSpinner()).toBe(false);
    fireEvent.click(button());
    expect(requests.submit).not.toHaveBeenCalled();
  });

  it('says no agent is online, in the server’s words', async () => {
    renderControl({ requests: requestsFor({ door: OFFLINE }) });
    await waitFor(() => expect(line().textContent).toBe(OFFLINE.reason));
    expect(button()).toBeDisabled();
  });

  it('stays closed when the status cannot be read', async () => {
    renderControl({
      requests: {
        ...requestsFor(),
        status: vi.fn(async () => Promise.reject(new Error('offline'))),
      },
    });
    await waitFor(() => expect(line().textContent).toBe(LINES.unreadable));
    expect(button()).toBeDisabled();
  });

  it('asks the real route on mount, and only asks', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => CLOSED }));
    vi.stubGlobal('fetch', fetchMock);
    render(<LzLabValidate files={NO_SPOKES} />);
    await waitFor(() => expect(line().textContent).toBe(CLOSED.reason));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [[url, init]] = fetchMock.mock.calls;
    expect(String(url)).toBe('https://api.test/api/public/labs/submit');
    expect(init.method).toBeUndefined();
  });

  it('is on the pre-rendered page as the checking line', () => {
    const html = renderToString(<LzLabValidate files={NO_SPOKES} requests={requestsFor()} />);
    expect(html).toContain(LINES.checking);
    expect(html).toContain('Validate on the lab');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('animate-spin');
  });
});

/** One spoke pinned to a release the image does not carry. */
const UNVENDORED = [
  {
    path: 'main.tf',
    content:
      'module "spoke" {\n  source  = "Azure/avm-res-network-virtualnetwork/azurerm"\n  version = "0.23.0"\n}\n',
  },
];

describe('what the runner image can resolve', () => {
  // The builder's full default build: every component, the identity, corp
  // and online spokes among them. Until the image vendored the spokes'
  // avm-res-network-virtualnetwork 0.22.2 (2026-09-27), this was refused.
  it('accepts the full default build, spokes included, and sends it on a click', async () => {
    const requests = requestsFor({
      jobs: [{ id: 'job-1', status: 'succeeded', exitCode: 0, output: 'Success!' }],
    });
    renderControl({ files: DEFAULT_FILES, requests });
    await waitFor(() => expect(button()).toBeEnabled());
    expect(line().textContent).toBe(LINES.ready);

    fireEvent.click(button());
    await screen.findByTestId('lz-lab-output');
    // Sent, so under the 64 KB payload cap as well as fully vendored.
    expect(requests.submit).toHaveBeenCalledTimes(1);
    const [[sent]] = requests.submit.mock.calls;
    const unpacked = parseTar(decodeTarPayload(sent.payload)).map((e) => e.path);
    expect(unpacked).toEqual(DEFAULT_FILES.map((f) => f.path));
  });

  it('still refuses a build calling a version the image does not vendor, naming it', async () => {
    const requests = requestsFor();
    renderControl({ files: UNVENDORED, requests });
    await waitFor(() =>
      expect(line().textContent).toContain('avm-res-network-virtualnetwork 0.23.0')
    );
    expect(button()).toBeDisabled();
    expect(requests.submit).not.toHaveBeenCalled();
  });

  it('lists what the lab does with each module', async () => {
    render(<LzLabValidate files={DEFAULT_FILES} requests={requestsFor()} />);
    const rows = screen.getByTestId('lz-lab-modules').querySelectorAll('li');
    const text = Array.from(rows).map((li) => [li.dataset.vendored, li.textContent]);
    expect(text).toContainEqual([
      'true',
      'module "alz" (Azure/avm-ptn-alz/azurerm 0.21.0) → the vendored copy avm-ptn-alz@0.21.0',
    ]);
    expect(text).toContainEqual([
      'true',
      'module "spoke_identity" (Azure/avm-res-network-virtualnetwork/azurerm 0.22.2) → the vendored copy avm-res-network-virtualnetwork@0.22.2',
    ]);
    expect(text.every(([vendored]) => vendored === 'true')).toBe(true);
  });

  it('names what the image has for a module it cannot resolve', async () => {
    render(<LzLabValidate files={UNVENDORED} requests={requestsFor()} />);
    const rows = screen.getByTestId('lz-lab-modules').querySelectorAll('li');
    expect(Array.from(rows).map((li) => [li.dataset.vendored, li.textContent])).toEqual([
      [
        'false',
        'module "spoke" (Azure/avm-res-network-virtualnetwork/azurerm 0.23.0) → not vendored (the image has 0.15.0, 0.22.2)',
      ],
    ]);
  });

  it('refuses an empty build with its own line', async () => {
    renderControl({ files: emitFiles({ selected: [] }), requests: requestsFor() });
    await waitFor(() => expect(line().textContent).toBe(LINES.empty));
    expect(screen.queryByTestId('lz-lab-modules')).toBeNull();
  });
});

describe('when the lab is open', () => {
  it('sends the files unchanged on a click, polls the job and shows the output', async () => {
    const requests = requestsFor({
      jobs: [
        { id: 'job-1', status: 'queued' },
        { id: 'job-1', status: 'running' },
        {
          id: 'job-1',
          status: 'succeeded',
          exitCode: 0,
          output: '== terraform validate\nSuccess! The configuration is valid.\n',
        },
      ],
    });
    renderControl({ requests });
    await waitFor(() => expect(button()).toBeEnabled());
    expect(line().textContent).toBe(LINES.ready);
    expect(requests.submit).not.toHaveBeenCalled();

    fireEvent.click(button());
    const output = await screen.findByTestId('lz-lab-output');
    expect(output.dataset.status).toBe('succeeded');
    expect(output.textContent).toContain('terraform validate passed on the lab (exit 0).');
    expect(output.textContent).toContain('Success! The configuration is valid.');

    expect(requests.submit).toHaveBeenCalledTimes(1);
    const [[sent]] = requests.submit.mock.calls;
    expect(sent.type).toBe('terraform-validate');
    expect(sent.payloadEncoding).toBe('tar');
    expect(sent.turnstileToken).toBe('turnstile-token-1');
    const unpacked = parseTar(decodeTarPayload(sent.payload)).map((e) => ({
      path: e.path,
      content: new TextDecoder().decode(e.data),
    }));
    expect(unpacked).toEqual(NO_SPOKES.map(({ path, content }) => ({ path, content })));
    expect(requests.job).toHaveBeenCalledWith('job-1');
    expect(requests.job).toHaveBeenCalledTimes(3);
    expect(button()).toBeEnabled();
  });

  it('says a failed validation failed, with the output', async () => {
    const requests = requestsFor({
      jobs: [{ id: 'job-1', status: 'failed', exitCode: 1, output: 'Error: Unsupported argument' }],
    });
    renderControl({ requests });
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(button());
    const output = await screen.findByTestId('lz-lab-output');
    expect(output.dataset.status).toBe('failed');
    expect(output.textContent).toContain('failed on the lab (exit 1)');
    expect(output.textContent).toContain('Error: Unsupported argument');
  });

  it('shows the per-visitor limit in the server’s words and sends no second request', async () => {
    const message =
      'Validation on the lab is limited to 2 an hour for each visitor. Try again in an hour.';
    const requests = requestsFor({
      submit: vi.fn(async () => Promise.reject(refusal(429, 'LAB_RATE_LIMITED', message))),
    });
    renderControl({ requests });
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(button());
    const alert = await screen.findByTestId('lz-lab-error');
    expect(alert.textContent).toBe(message);
    expect(alert.dataset.status).toBe('429');
    expect(requests.job).not.toHaveBeenCalled();
  });

  it('shuts the button when a refusal names the door', async () => {
    const requests = requestsFor({
      submit: vi.fn(async () => Promise.reject(refusal(503, 'LAB_AGENT_OFFLINE', OFFLINE.reason))),
    });
    renderControl({ requests });
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(button());
    await screen.findByTestId('lz-lab-error');
    expect(line().textContent).toBe(OFFLINE.reason);
    expect(button()).toBeDisabled();
  });

  it('stops asking at the deadline and says the job may still run', async () => {
    let clock = 0;
    const requests = requestsFor({ jobs: [{ id: 'job-1', status: 'queued' }] });
    requests.job.mockImplementation(async () => {
      clock += 60_000;
      return { id: 'job-1', status: 'queued' };
    });
    renderControl({ requests, now: () => clock, deadlineMs: 120_000 });
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(button());
    const stalled = await screen.findByTestId('lz-lab-stalled');
    expect(stalled.textContent).toBe(LINES.stalled);
    expect(requests.job).toHaveBeenCalledTimes(2);
  });

  it('drops the output when the build changes', async () => {
    const requests = requestsFor({
      jobs: [{ id: 'job-1', status: 'succeeded', exitCode: 0, output: 'ok' }],
    });
    const turnstile = fakeTurnstile();
    const { rerender } = renderControl({ requests, turnstile });
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(button());
    await screen.findByTestId('lz-lab-output');
    const fewer = emitFiles(decodeLz(new URLSearchParams('lz=mg&corp=0&online=0')));
    rerender(
      <LzLabValidate files={fewer} requests={requests} pollDelay={() => 0} turnstile={turnstile} />
    );
    expect(screen.queryByTestId('lz-lab-output')).toBeNull();
  });
});

describe('locked to this pane: the Turnstile check', () => {
  const TURNSTILE_UNCONFIGURED = {
    configured: false,
    open: false,
    code: 'TURNSTILE_NOT_CONFIGURED',
    reason:
      'The lab is not taking public jobs yet: its browser check (Cloudflare Turnstile) is not configured.',
  };

  it('loads nothing from Cloudflare while the lab is closed', async () => {
    const turnstile = fakeTurnstile();
    renderControl({ requests: requestsFor({ door: CLOSED }), turnstile });
    await waitFor(() => expect(line().textContent).toBe(CLOSED.reason));
    expect(turnstile.load).not.toHaveBeenCalled();
    expect(screen.queryByTestId('lz-lab-turnstile')).toBeNull();
  });

  it('says the server has no Turnstile secret, in its words, and loads nothing', async () => {
    const turnstile = fakeTurnstile();
    renderControl({ requests: requestsFor({ door: TURNSTILE_UNCONFIGURED }), turnstile });
    await waitFor(() => expect(line().textContent).toBe(TURNSTILE_UNCONFIGURED.reason));
    expect(line().dataset.door).toBe('TURNSTILE_NOT_CONFIGURED');
    expect(button()).toBeDisabled();
    expect(turnstile.load).not.toHaveBeenCalled();
  });

  it('keeps the button disabled on a build with no site key, and says so', async () => {
    const turnstile = fakeTurnstile({ siteKey: '' });
    const requests = requestsFor();
    renderControl({ requests, turnstile });
    await waitFor(() => expect(line().textContent).toBe(LINES.noSiteKey));
    expect(button()).toBeDisabled();
    expect(turnstile.load).not.toHaveBeenCalled();
    fireEvent.click(button());
    expect(requests.submit).not.toHaveBeenCalled();
  });

  it('renders the widget once the lab is open, for the lab-validate action, seen only when needed', async () => {
    const turnstile = fakeTurnstile();
    renderControl({ requests: requestsFor(), turnstile });
    await waitFor(() => expect(button()).toBeEnabled());
    expect(turnstile.load).toHaveBeenCalledTimes(1);
    expect(turnstile.api.render).toHaveBeenCalledTimes(1);
    const [[element, options]] = turnstile.api.render.mock.calls;
    expect(element).toBe(screen.getByTestId('lz-lab-turnstile'));
    expect(options).toMatchObject({
      sitekey: 'site-key-test',
      action: 'lab-validate',
      appearance: 'interaction-only',
    });
  });

  it('waits for the token before the button can be pressed', async () => {
    const turnstile = fakeTurnstile({ solve: false });
    renderControl({ requests: requestsFor(), turnstile });
    // The line reads "checking" from the moment the door opens, before the
    // script has loaded, so wait for the widget itself before solving it.
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(1));
    expect(line().textContent).toBe(LINES.browserCheck);
    expect(button()).toBeDisabled();
    expect(hasSpinner()).toBe(false);
    act(() => turnstile.options().callback('token-late'));
    await waitFor(() => expect(button()).toBeEnabled());
    expect(line().textContent).toBe(LINES.ready);
  });

  it('says when Cloudflare wants the visitor, and when the check failed', async () => {
    const turnstile = fakeTurnstile({ solve: false });
    renderControl({ requests: requestsFor(), turnstile });
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
    act(() => turnstile.options()['before-interactive-callback']());
    expect(line().textContent).toBe(LINES.browserInteractive);
    act(() => turnstile.options()['error-callback']('300010'));
    expect(line().textContent).toBe(LINES.browserError);
    expect(button()).toBeDisabled();
  });

  it('says the check could not run when Cloudflare’s script does not load', async () => {
    renderControl({ requests: requestsFor(), turnstile: fakeTurnstile({ loadFails: true }) });
    await waitFor(() => expect(line().textContent).toBe(LINES.browserError));
    expect(button()).toBeDisabled();
  });

  it('spends one token per submission and asks for the next', async () => {
    const turnstile = fakeTurnstile();
    const requests = requestsFor({
      jobs: [{ id: 'job-1', status: 'succeeded', exitCode: 0, output: 'ok' }],
    });
    renderControl({ requests, turnstile });
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(button());
    await screen.findByTestId('lz-lab-output');
    expect(turnstile.api.reset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(button());
    await waitFor(() => expect(requests.submit).toHaveBeenCalledTimes(2));
    const tokens = requests.submit.mock.calls.map(([sent]) => sent.turnstileToken);
    expect(tokens).toEqual(['turnstile-token-1', 'turnstile-token-2']);
  });

  it('shows the lock’s refusal in the server’s words and renews the check', async () => {
    const message =
      "Cloudflare's browser check did not pass, or its token had expired or was already used, so the lab did not take the job. Try again.";
    const turnstile = fakeTurnstile();
    const requests = requestsFor({
      submit: vi.fn(async () => Promise.reject(refusal(403, 'TURNSTILE_FAILED', message))),
    });
    renderControl({ requests, turnstile });
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(button());
    const alert = await screen.findByTestId('lz-lab-error');
    expect(alert.textContent).toBe(message);
    expect(alert.dataset.status).toBe('403');
    expect(turnstile.api.reset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(button()).toBeEnabled());
  });

  it('shuts the door and removes the widget when the server says Turnstile is not configured', async () => {
    const turnstile = fakeTurnstile();
    const requests = requestsFor({
      submit: vi.fn(async () =>
        Promise.reject(refusal(503, 'TURNSTILE_NOT_CONFIGURED', TURNSTILE_UNCONFIGURED.reason))
      ),
    });
    renderControl({ requests, turnstile });
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(button());
    await screen.findByTestId('lz-lab-error');
    expect(line().textContent).toBe(TURNSTILE_UNCONFIGURED.reason);
    expect(button()).toBeDisabled();
    expect(turnstile.api.remove).toHaveBeenCalledWith('widget-1');
    expect(screen.queryByTestId('lz-lab-turnstile')).toBeNull();
  });

  it('removes the widget when the control goes away', async () => {
    const turnstile = fakeTurnstile();
    const { unmount } = renderControl({ requests: requestsFor(), turnstile });
    await waitFor(() => expect(button()).toBeEnabled());
    unmount();
    expect(turnstile.api.remove).toHaveBeenCalledWith('widget-1');
  });
});

describe('the words', () => {
  it('puts the door first, then the site key, then the build, then the browser check', () => {
    const resolution = { ok: false, unresolved: [{ module: 'm', constraint: '1.0.0' }] };
    const resolved = { ok: true, unresolved: [] };
    const open = { phase: 'known', ...OPEN };
    const ready = { siteKey: 'k', check: 'ready' };
    expect(
      disabledReason({
        door: { phase: 'known', ...CLOSED },
        hasTerraform: false,
        resolution,
        ...ready,
      })
    ).toBe(CLOSED.reason);
    expect(
      disabledReason({ door: open, hasTerraform: false, resolution, siteKey: '', check: 'idle' })
    ).toBe(LINES.noSiteKey);
    expect(
      disabledReason({ door: open, hasTerraform: true, resolution, siteKey: 'k', check: 'loading' })
    ).toBe(unresolvedLine(resolution.unresolved));
    expect(
      disabledReason({
        door: { phase: 'known', open: false },
        hasTerraform: true,
        resolution,
        ...ready,
      })
    ).toBe(LINES.closedFallback);
    expect(
      disabledReason({ door: open, hasTerraform: true, resolution: resolved, ...ready })
    ).toBeNull();
    expect(
      disabledReason({
        door: open,
        hasTerraform: true,
        resolution: resolved,
        siteKey: 'k',
        check: 'spent',
      })
    ).toBeNull();
    for (const [check, expected] of [
      ['idle', LINES.browserCheck],
      ['loading', LINES.browserCheck],
      ['interactive', LINES.browserInteractive],
      ['error', LINES.browserError],
    ]) {
      expect(
        disabledReason({
          door: open,
          hasTerraform: true,
          resolution: resolved,
          siteKey: 'k',
          check,
        })
      ).toBe(expected);
    }
  });

  it('reads a poll: a 404 or 503 ends the run, a transport failure backs off, the deadline stalls', () => {
    const clock = { errors: 2, elapsed: 0, deadlineMs: 1000 };
    const gone = refusal(404, 'JOB_NOT_FOUND', 'Job not found');
    expect(afterPoll({ error: gone }, clock)).toEqual({
      update: { phase: 'error', error: gone },
      stop: true,
      errors: 2,
    });
    expect(afterPoll({ error: new Error('reset') }, clock)).toEqual({
      update: null,
      stop: false,
      errors: 3,
    });
    expect(afterPoll({ job: { status: 'running' } }, clock)).toEqual({
      update: { job: { status: 'running' } },
      stop: false,
      errors: 0,
    });
    expect(afterPoll({ job: { status: 'queued' } }, { ...clock, elapsed: 1000 })).toEqual({
      update: { phase: 'stalled', job: { status: 'queued' } },
      stop: true,
      errors: 2,
    });
    expect(afterPoll({ error: new Error('reset') }, { ...clock, elapsed: 1000 }).update).toEqual({
      phase: 'stalled',
    });
  });

  it('shuts the door only for a 503 that names it', () => {
    expect(doorFromRefusal(refusal(503, 'LAB_QUEUE_FULL', 'full'))).toEqual({
      phase: 'known',
      open: false,
      code: 'LAB_QUEUE_FULL',
      reason: 'full',
    });
    expect(doorFromRefusal(refusal(503, 'LAB_PAUSED_FOR_TODAY', 'paused'))).toBeNull();
    expect(doorFromRefusal(refusal(429, 'LAB_RATE_LIMITED', 'slow down'))).toBeNull();
    expect(doorFromRefusal(new Error('network'))).toBeNull();
  });

  it('refuses, before sending, a payload over the 64 KB the lab takes', async () => {
    // Random bytes as base64 barely compress, so 120 KB of it stays over the
    // cap. getRandomValues fills at most 64 KiB a call, so two calls.
    const random = () => Buffer.from(crypto.getRandomValues(new Uint8Array(45_000)));
    const noise = Buffer.concat([random(), random()]).toString('base64');
    const { error, body } = await preparePayload([{ path: 'main.tf', content: noise }]);
    expect(body).toBeUndefined();
    expect(error.status).toBe(413);
    expect(error.message).toMatch(/bytes as a lab payload, and the lab takes at most 65,536\.$/);
    const small = await preparePayload(NO_SPOKES);
    expect(small.body.payloadEncoding).toBe('tar');
  });

  it('says where a run is while it is in flight', () => {
    expect(statusLine(null, { phase: 'submitting' })).toBe(LINES.submitting);
    expect(statusLine(null, { phase: 'polling', job: { status: 'queued' } })).toBe(LINES.queued);
    expect(statusLine(null, { phase: 'polling', job: { status: 'running' } })).toBe(LINES.running);
    expect(statusLine('closed', { phase: 'done' })).toBe('closed');
    expect(statusLine(null, null)).toBe(LINES.ready);
  });

  it('has a sentence for every terminal status', () => {
    expect(outcomeLine({ status: 'timeout' })).toContain('ran out of time');
    expect(outcomeLine({ status: 'cancelled' })).toContain('cancelled');
    expect(outcomeLine({ status: 'odd' })).toBe('The job ended as odd.');
  });

  it('keeps the server’s sentence for its refusals and names anything else', () => {
    expect(failureLine(refusal(503, 'LAB_QUEUE_FULL', 'full'))).toBe('full');
    expect(failureLine(refusal(413, 'PAYLOAD_TOO_LARGE', 'too big'))).toBe('too big');
    for (const code of ['ORIGIN_NOT_ALLOWED', 'TURNSTILE_REQUIRED', 'TURNSTILE_FAILED']) {
      expect(failureLine(refusal(403, code, `lock: ${code}`))).toBe(`lock: ${code}`);
    }
    expect(failureLine(refusal(403, 'FORBIDDEN', 'Forbidden'))).toBe(
      'The job could not be sent to the lab: Forbidden'
    );
    expect(failureLine(refusal(404, 'JOB_NOT_FOUND', 'x'))).toContain('no longer has this job');
    expect(failureLine(new Error('socket hang up'))).toBe(
      'The job could not be sent to the lab: socket hang up'
    );
  });
});
