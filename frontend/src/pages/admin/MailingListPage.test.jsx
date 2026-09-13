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
let searchParams = 'tab=connection';

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
  getJSON: vi.fn(),
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
  searchParams = 'tab=connection';
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
      expect(screen.getByRole('button', { name: /draft weekly digest/i })).toBeInTheDocument();
      unmount();
    }
  });

  it('still drafts the weekly digest, which is the part that always worked', async () => {
    searchParams = 'tab=newsletter';
    postJSON.mockResolvedValue(envelope(true, 200, domains([])));
    runJob.mockResolvedValue({
      status: 'succeeded',
      result: { success: true, sourceItemsCount: 4, draftId: 'n-1' },
    });
    render(<MailingListPage />);

    fireEvent.click(screen.getByRole('button', { name: /draft weekly digest/i }));

    await waitFor(() =>
      expect(screen.getByText(/drafted from 4 item\(s\)\. Draft id: n-1/)).toBeInTheDocument()
    );
    expect(runJob).toHaveBeenCalledWith('generate-weekly-digest', { dryRun: false, days: 7 });
  });
});
