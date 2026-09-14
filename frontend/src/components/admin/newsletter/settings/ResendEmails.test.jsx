/**
 * Recent emails on the Settings tab: masked rows as the server sent them,
 * paging by `next_after`, and the not-configured and rate-limit wording.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import ResendEmails from './ResendEmails';

const getJSON = vi.fn();
vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: vi.fn(),
}));

const refusal = (status, message, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });

const first = {
  id: 'e-1111',
  to: ['j***@example.com'],
  subject: 'This week in hybrid cloud',
  created_at: '2026-09-10T15:00:00.000Z',
  last_event: 'delivered',
};
const second = { ...first, id: 'e-2222', to: ['p***@example.org'], last_event: 'bounced' };

beforeEach(() => {
  getJSON.mockReset();
  getJSON.mockImplementation(async (route) =>
    route.includes('after=e-1111')
      ? { ok: true, emails: [second], has_more: false, next_after: null }
      : { ok: true, emails: [first], has_more: true, next_after: 'e-1111' }
  );
});

describe('ResendEmails', () => {
  it('shows masked recipients, subject and last event, and loads more with after', async () => {
    render(<ResendEmails />);
    const row = (await screen.findByText('j***@example.com')).closest('tr');
    expect(within(row).getByText('This week in hybrid cloud')).toBeInTheDocument();
    expect(within(row).getByText('delivered')).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith('cms/mailing-list/emails?limit=20');

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('p***@example.org')).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith('cms/mailing-list/emails?limit=20&after=e-1111');
    expect(screen.getByText('j***@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('fetches a cursor once, however fast Load more is pressed', async () => {
    render(<ResendEmails />);
    const button = await screen.findByRole('button', { name: 'Load more' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByText('p***@example.org')).toBeInTheDocument();
    expect(getJSON.mock.calls.filter(([route]) => route.includes('after=e-1111'))).toHaveLength(1);
    expect(screen.getAllByText('p***@example.org')).toHaveLength(1);
  });

  it('shows no error from a Load more that fails after Refresh has started', async () => {
    render(<ResendEmails />);
    await screen.findByText('j***@example.com');
    let failMore;
    let finishReload;
    getJSON.mockImplementation((route) =>
      route.includes('after=e-1111')
        ? new Promise((_, reject) => {
            failMore = () => reject(refusal(502, 'Resend did not answer'));
          })
        : new Promise((resolve) => {
            finishReload = () =>
              resolve({ ok: true, emails: [first], has_more: true, next_after: 'e-1111' });
          })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(failMore).toBeTypeOf('function'));
    failMore();
    finishReload();
    expect(await screen.findByText('j***@example.com')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('says Resend is not configured on a 503', async () => {
    getJSON.mockRejectedValue(refusal(503, 'Resend is not configured'));
    render(<ResendEmails />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Resend is not configured/);
  });

  it('says how long to wait on a 429', async () => {
    getJSON.mockRejectedValue(refusal(429, 'rate_limit_exceeded', { retryAfterSeconds: 1 }));
    render(<ResendEmails />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Wait 1 second, then try again.');
  });
});
