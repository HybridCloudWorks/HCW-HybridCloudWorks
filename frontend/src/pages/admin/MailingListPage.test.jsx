/**
 * A refused Resend key must never render as a connection.
 *
 * `connectionProbe` answers HTTP 200 for every outcome, carrying the real result
 * in an envelope. `postJSON` is `return res.json()`, so a 401 arrives as a
 * RESOLVED promise. This page once called `setResult({ ok: true, … })`
 * unconditionally after the same kind of call, and rendered a rejected Klaviyo
 * key in green with a tick (#430). The header dot came from the same call and
 * inherited the same lie.
 *
 * These tests drive the envelope through the real page rather than through the
 * helper, because the helper was never the part that was wrong — the wiring was.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import MailingListPage from './MailingListPage';

const postJSON = vi.fn();
const runJob = vi.fn();
let searchParams = 'tab=settings';

const getJSON = vi.fn();

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
  getJSON: (...args) => getJSON(...args),
  sendJSON: vi.fn(),
}));
vi.mock('@/lib/jobs', () => ({ runJob: (...args) => runJob(...args) }));
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));
vi.mock('react-router', () => ({
  useSearchParams: () => [new URLSearchParams(searchParams), vi.fn()],
}));

/** The probe's envelope, HTTP 200 whatever Resend said. */
const envelope = (ok, status, data, error) => ({ ok, status, data, ...(error ? { error } : {}) });
/** Resend's own list body. */
const domains = (items) => ({ object: 'list', data: items });

beforeEach(() => {
  postJSON.mockReset();
  runJob.mockReset();
  getJSON.mockReset();
  getJSON.mockImplementation(async (route) =>
    route === 'cms/newsletters' ? { ok: true, issues: [] } : { value: {} }
  );
  searchParams = 'tab=settings';
});

describe('the page header', () => {
  it('names the page Newsletter Hub, matching the menu (#566)', () => {
    postJSON.mockResolvedValue(envelope(true, 200, domains([])));
    render(<MailingListPage />);
    expect(screen.getByText('Newsletter Hub')).toBeInTheDocument();
    expect(screen.queryByText('Mailing List')).not.toBeInTheDocument();
  });
});

describe('Test Connection', () => {
  it('asks the server by name, never by path', async () => {
    postJSON.mockResolvedValue(envelope(true, 200, domains([])));
    render(<MailingListPage />);

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith('connectionProbe', { probe: 'resend' })
    );
    expect(postJSON.mock.calls.flat().some((arg) => arg === 'klaviyoProxy')).toBe(false);
  });

  it('reports a sending-only key as a failure, in Resend’s words, never as connected', async () => {
    const sentence = 'This API key is restricted to only send emails';
    postJSON.mockResolvedValue(
      envelope(false, 401, { name: 'restricted_api_key', message: sentence }, sentence)
    );
    render(<MailingListPage />);

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/Resend answered 401 - This API key is restricted/)
      ).toBeInTheDocument()
    );
    expect(screen.queryByText(/Connected to Resend/i)).not.toBeInTheDocument();
  });

  it('reports a real connection with the domain count that proves it reached data', async () => {
    postJSON.mockResolvedValue(envelope(true, 200, domains([{ id: 'd1' }, { id: 'd2' }])));
    render(<MailingListPage />);

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() =>
      expect(screen.getByText('Connected to Resend — 2 sending domain(s).')).toBeInTheDocument()
    );
  });

  it('says so when the key works but no domain has been added, because nothing can send', async () => {
    postJSON.mockResolvedValue(envelope(true, 200, domains([])));
    render(<MailingListPage />);

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() =>
      expect(screen.getByText(/no sending domain has been added to Resend yet/)).toBeInTheDocument()
    );
  });

  it('reports an unseeded key as not configured rather than as a failed call', async () => {
    postJSON.mockResolvedValue({
      ok: false,
      error: 'Resend is not configured: RESEND_API_KEY is not set',
      code: 'INTEGRATION_NOT_CONFIGURED',
    });
    render(<MailingListPage />);

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() =>
      expect(
        screen.getByText('Resend is not configured: RESEND_API_KEY is not set')
      ).toBeInTheDocument()
    );
  });
});

describe('The newsletter tab', () => {
  it('is where a bookmark to a removed Klaviyo tab lands', async () => {
    postJSON.mockResolvedValue(envelope(true, 200, domains([])));
    for (const tab of ['lists', 'campaigns']) {
      searchParams = `tab=${tab}`;
      const { unmount } = render(<MailingListPage />);
      expect(
        await screen.findByRole('button', { name: /build this week's issue/i })
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('builds the weekly issue with the job that replaced the old digest', async () => {
    searchParams = 'tab=newsletter';
    postJSON.mockResolvedValue(envelope(true, 200, domains([])));
    runJob.mockResolvedValue({
      status: 'succeeded',
      result: { success: false, message: 'Nothing new in the last 7 days, so no issue was built.' },
    });
    render(<MailingListPage />);

    fireEvent.click(await screen.findByRole('button', { name: /build this week's issue/i }));

    await waitFor(() =>
      expect(screen.getByText(/Nothing new in the last 7 days/)).toBeInTheDocument()
    );
    // No days: the window saved in Newsletter settings applies (#557).
    expect(runJob).toHaveBeenCalledWith('build-newsletter-issue', {});
  });

  it('keeps newsletter settings and the Resend connection on the Settings tab', async () => {
    searchParams = 'tab=settings';
    postJSON.mockResolvedValue(envelope(true, 200, domains([])));
    render(<MailingListPage />);
    expect(await screen.findByLabelText('Postal address')).toBeInTheDocument();
    expect(screen.getByLabelText('Reply-to address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument();
  });

  it('adds Resend domains, emails and logs below the settings and connection on Settings', async () => {
    searchParams = 'tab=settings';
    postJSON.mockResolvedValue(envelope(true, 200, domains([])));
    getJSON.mockImplementation(async (route) => {
      if (route === 'cms/mailing-list/domains')
        throw Object.assign(new Error('x'), { status: 503 });
      if (route.startsWith('cms/mailing-list/emails')) return { ok: true, emails: [] };
      if (route.startsWith('cms/mailing-list/logs')) return { ok: true, logs: [] };
      return { value: {} };
    });
    render(<MailingListPage />);
    expect(await screen.findByLabelText('Postal address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sending domains' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent emails' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'API logs' })).toBeInTheDocument();
    expect(await screen.findByText(/Resend is not configured/)).toBeInTheDocument();
    expect(await screen.findByText('No emails yet.')).toBeInTheDocument();
    expect(await screen.findByText('No API calls logged yet.')).toBeInTheDocument();
    expect(screen.getByLabelText('Postal address')).toBeInTheDocument();
  });

  it('no longer shows settings under the issues', async () => {
    searchParams = 'tab=newsletter';
    postJSON.mockResolvedValue(envelope(true, 200, domains([])));
    render(<MailingListPage />);
    expect(
      await screen.findByRole('button', { name: /build this week's issue/i })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Postal address')).not.toBeInTheDocument();
  });

  it('sends an old Connection bookmark to Settings', async () => {
    searchParams = 'tab=connection';
    postJSON.mockResolvedValue(envelope(true, 200, domains([])));
    render(<MailingListPage />);
    expect(await screen.findByRole('button', { name: /test connection/i })).toBeInTheDocument();
  });

  it('has Newsletter, Drafts, Published, Audience and Settings tabs, in that order', () => {
    searchParams = 'tab=settings';
    postJSON.mockResolvedValue(envelope(true, 200, domains([])));
    render(<MailingListPage />);
    const labels = ['Newsletter', 'Drafts', 'Published', 'Audience', 'Settings'];
    const tabs = screen.getAllByRole('button').filter((b) => labels.includes(b.textContent));
    expect(tabs.map((b) => b.textContent)).toEqual(labels);
  });

  it('opens Drafts without a build button or settings', async () => {
    searchParams = 'tab=drafts';
    postJSON.mockResolvedValue(envelope(true, 200, domains([])));
    render(<MailingListPage />);
    expect(await screen.findByText(/Nothing in Drafts/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /build this week's issue/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Postal address')).not.toBeInTheDocument();
  });

  it('opens Audience on the Newsletter segment in Resend', async () => {
    searchParams = 'tab=audience';
    postJSON.mockResolvedValue(envelope(true, 200, domains([])));
    getJSON.mockImplementation(async (route) =>
      route.startsWith('cms/mailing-list/audience?')
        ? { ok: true, segmentFound: false, contacts: [], has_more: false, next_after: null }
        : { ok: true, total: 0, subscribed: 0, unsubscribed: 0, truncated: false }
    );
    render(<MailingListPage />);
    expect(await screen.findByText(/No subscribers yet/)).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith('cms/mailing-list/audience/summary');
  });

  it('opens Published on a month calendar', async () => {
    searchParams = 'tab=published';
    postJSON.mockResolvedValue(envelope(true, 200, domains([])));
    render(<MailingListPage />);
    expect(await screen.findByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        getJSON.mock.calls.some(([route]) => /^cms\/newsletters\?month=\d{4}-\d{2}$/.test(route))
      ).toBe(true)
    );
  });
});
