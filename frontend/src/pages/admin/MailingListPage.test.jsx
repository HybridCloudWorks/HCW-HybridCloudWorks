/**
 * A refused Klaviyo key must never render as a connection.
 *
 * The integrations proxy answers HTTP 200 for every outcome, carrying the real
 * result in an envelope. `postJSON` is `return res.json()`, so a 401 arrives
 * as a RESOLVED promise — and the page called `setResult({ ok: true, … })`
 * unconditionally after it. So a rejected credential rendered in green, with a
 * tick:
 *
 *     Connected to Klaviyo — 0 list(s) visible.
 *
 * That is #430. The header dot came from the same call and inherited the same
 * lie.
 *
 * These tests drive the envelope through the real page rather than through the
 * helpers, because the helpers were never the part that was wrong — the
 * wiring was.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import MailingListPage from './MailingListPage';

const postJSON = vi.fn();
let searchParams = 'tab=connection';

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
  getJSON: vi.fn(),
}));
vi.mock('@/lib/jobs', () => ({ runJob: vi.fn() }));
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));
vi.mock('react-router', () => ({
  useSearchParams: () => [new URLSearchParams(searchParams), vi.fn()],
}));

/** The proxy's envelope, HTTP 200 whatever Klaviyo said. */
const envelope = (ok, status, data) => ({ ok, status, data });
/** Klaviyo's own body: JSON:API, so the collection sits under `data`. */
const klaviyoBody = (items) => ({ data: items });

beforeEach(() => {
  postJSON.mockReset();
  searchParams = 'tab=connection';
});

describe('Test Connection', () => {
  it('reports a rejected key as a failure, never as connected', async () => {
    postJSON.mockResolvedValue(envelope(false, 401, { errors: [{ detail: 'invalid key' }] }));
    render(<MailingListPage />);

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() => expect(screen.getByText(/Klaviyo answered 401/i)).toBeInTheDocument());
    // The exact string the bug produced, in green, must not appear.
    expect(screen.queryByText(/Connected to Klaviyo/i)).not.toBeInTheDocument();
  });

  it('reports a real connection with the count that proves it reached data', async () => {
    postJSON.mockResolvedValue(
      envelope(true, 200, klaviyoBody([{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }]))
    );
    render(<MailingListPage />);

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    // Three, not zero: the page used to read the collection one level too
    // shallow, so a successful call counted nothing either.
    await waitFor(() =>
      expect(screen.getByText(/Connected to Klaviyo — 3 lists visible\./i)).toBeInTheDocument()
    );
  });

  it('does not report success when Klaviyo answers 2xx with a body it cannot read', async () => {
    postJSON.mockResolvedValue(envelope(true, 200, { unexpected: 'shape' }));
    render(<MailingListPage />);

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() =>
      expect(screen.getByText(/body this page cannot read/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/Connected to Klaviyo/i)).not.toBeInTheDocument();
  });
});

describe('The lists tab', () => {
  it('says the call failed rather than showing an empty audience', async () => {
    // An operator who sees "No lists found in Klaviyo" concludes the audience
    // is empty. That is the wrong conclusion and an expensive one.
    searchParams = 'tab=lists';
    postJSON.mockResolvedValue(envelope(false, 401, { errors: [] }));
    render(<MailingListPage />);

    await waitFor(() => expect(screen.getByText(/Klaviyo answered 401/i)).toBeInTheDocument());
    expect(screen.queryByText(/No lists found in Klaviyo/i)).not.toBeInTheDocument();
  });

  it('renders the lists that a successful call returns', async () => {
    searchParams = 'tab=lists';
    postJSON.mockResolvedValue(
      envelope(true, 200, klaviyoBody([{ id: 'l1', attributes: { name: 'Newsletter' } }]))
    );
    render(<MailingListPage />);

    await waitFor(() => expect(screen.getByText('Newsletter')).toBeInTheDocument());
  });

  it('still says "no lists" when the audience really is empty', async () => {
    searchParams = 'tab=lists';
    postJSON.mockResolvedValue(envelope(true, 200, klaviyoBody([])));
    render(<MailingListPage />);

    await waitFor(() =>
      expect(screen.getByText(/No lists found in Klaviyo/i)).toBeInTheDocument()
    );
  });
});
