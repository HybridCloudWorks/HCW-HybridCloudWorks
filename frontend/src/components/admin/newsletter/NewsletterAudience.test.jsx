/**
 * The Audience tab. What must hold: counts and contacts come from the API as
 * projected, paging follows `next_after`, search goes to the server and says
 * it searches the page, every write addresses a contact by id and never by
 * email, removing asks first, and a refusal is shown in the server's words.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import NewsletterAudience, { audienceRoute } from './NewsletterAudience';

const getJSON = vi.fn();
const sendJSON = vi.fn();
vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
}));

const refusal = (status, message, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });

const JANE = {
  id: 'c-1111',
  email: 'jane@example.com',
  first_name: 'Jane',
  last_name: 'Doe',
  created_at: '2026-09-01T12:00:00.000Z',
  unsubscribed: false,
};
const JOHN = {
  id: 'c-2222',
  email: 'john@example.com',
  first_name: null,
  last_name: null,
  created_at: '2026-09-02T12:00:00.000Z',
  unsubscribed: true,
};
const PAT = { ...JANE, id: 'c-3333', email: 'pat@example.com', first_name: 'Pat' };

const SUMMARY = {
  ok: true,
  total: 2,
  subscribed: 1,
  unsubscribed: 1,
  truncated: false,
  cachedAt: '2026-09-13T12:00:00.000Z',
};

const page = (contacts, more = null) => ({
  ok: true,
  segmentFound: true,
  contacts,
  has_more: Boolean(more),
  next_after: more,
  searchScope: 'page',
});

beforeEach(() => {
  getJSON.mockReset();
  sendJSON.mockReset();
  getJSON.mockImplementation(async (route) => {
    if (route === 'cms/mailing-list/audience/summary') return SUMMARY;
    if (route.includes('after=c-2222')) return page([PAT]);
    return page([JANE, JOHN], 'c-2222');
  });
  sendJSON.mockResolvedValue({ ok: true });
});

const rowFor = async (email) => (await screen.findByText(email)).closest('tr');

describe('audienceRoute', () => {
  it('carries the limit, and the cursor and search only when there are any', () => {
    expect(audienceRoute()).toBe('cms/mailing-list/audience?limit=50');
    expect(audienceRoute({ search: ' jane ', after: 'c-9' })).toBe(
      'cms/mailing-list/audience?limit=50&after=c-9&search=jane'
    );
  });
});

describe('NewsletterAudience', () => {
  it('shows the summary counts and when they were counted', async () => {
    render(<NewsletterAudience />);
    expect(await screen.findByText('Subscribers')).toBeInTheDocument();
    expect(screen.getByText('Unsubscribed', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText(/^As of /)).toBeInTheDocument();
    expect(screen.queryByText(/lower bound/)).not.toBeInTheDocument();
  });

  it('says the counts are a lower bound when the server stopped counting', async () => {
    getJSON.mockImplementation(async (route) =>
      route.endsWith('/summary') ? { ...SUMMARY, truncated: true } : page([])
    );
    render(<NewsletterAudience />);
    expect(await screen.findByText(/lower bound/)).toBeInTheDocument();
  });

  it('lists contacts with a status badge, and loads more from next_after', async () => {
    render(<NewsletterAudience />);
    const jane = await rowFor('jane@example.com');
    expect(within(jane).getByText('Jane Doe')).toBeInTheDocument();
    expect(within(jane).getByText('Subscribed')).toBeInTheDocument();
    expect(within(await rowFor('john@example.com')).getByText('Unsubscribed')).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith('cms/mailing-list/audience?limit=50');

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('pat@example.com')).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith('cms/mailing-list/audience?limit=50&after=c-2222');
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('searches on the server after typing settles, and says it searches the page', async () => {
    render(<NewsletterAudience />);
    await screen.findByText('jane@example.com');
    expect(screen.getByText(/Searches the contacts loaded in each page/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search by email'), { target: { value: 'ja' } });
    fireEvent.change(screen.getByLabelText('Search by email'), { target: { value: 'jane' } });
    await waitFor(() =>
      expect(getJSON).toHaveBeenCalledWith('cms/mailing-list/audience?limit=50&search=jane')
    );
    expect(getJSON).not.toHaveBeenCalledWith('cms/mailing-list/audience?limit=50&search=ja');
  });

  it('explains an empty list when the Newsletter segment does not exist yet', async () => {
    getJSON.mockImplementation(async (route) =>
      route.endsWith('/summary')
        ? { ...SUMMARY, total: 0, subscribed: 0, unsubscribed: 0 }
        : { ok: true, segmentFound: false, contacts: [], has_more: false, next_after: null }
    );
    render(<NewsletterAudience />);
    expect(
      await screen.findByText(
        'No subscribers yet. The Newsletter list is created by the first confirmed signup.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says Resend is not configured on a 503', async () => {
    getJSON.mockRejectedValue(refusal(503, 'Resend is not configured: RESEND_API_KEY is not set'));
    render(<NewsletterAudience />);
    const alerts = await screen.findAllByRole('alert');
    expect(alerts[0]).toHaveTextContent(/Resend is not configured/);
  });

  it('says how long to wait on a 429', async () => {
    getJSON.mockImplementation(async (route) => {
      if (route.endsWith('/summary')) return SUMMARY;
      throw refusal(429, 'rate_limit_exceeded', { retryAfterSeconds: 7 });
    });
    render(<NewsletterAudience />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Wait 7 seconds, then try again.');
  });

  it('unsubscribes and resubscribes by contact id, never by email, and recounts', async () => {
    render(<NewsletterAudience />);
    const jane = await rowFor('jane@example.com');
    fireEvent.click(within(jane).getByRole('button', { name: 'Unsubscribe' }));
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith('cms/mailing-list/audience/c-1111', 'PATCH', {
        unsubscribed: true,
      })
    );
    expect(await within(jane).findByText('Unsubscribed')).toBeInTheDocument();

    const john = await rowFor('john@example.com');
    fireEvent.click(within(john).getByRole('button', { name: 'Resubscribe' }));
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith('cms/mailing-list/audience/c-2222', 'PATCH', {
        unsubscribed: false,
      })
    );

    for (const [path] of sendJSON.mock.calls) expect(path).not.toMatch(/@|%40/);
    await waitFor(() =>
      expect(
        getJSON.mock.calls.filter(([route]) => route.endsWith('/summary')).length
      ).toBeGreaterThanOrEqual(3)
    );
  });

  it('removes only after the confirm, by id, and drops the row', async () => {
    render(<NewsletterAudience />);
    const jane = await rowFor('jane@example.com');
    fireEvent.click(within(jane).getByRole('button', { name: 'Remove' }));
    expect(sendJSON).not.toHaveBeenCalled();
    expect(
      within(jane).getByText('Remove from Resend? This deletes the contact.')
    ).toBeInTheDocument();

    fireEvent.click(within(jane).getByRole('button', { name: 'Cancel' }));
    expect(sendJSON).not.toHaveBeenCalled();

    fireEvent.click(within(jane).getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(jane).getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith('cms/mailing-list/audience/c-1111', 'DELETE')
    );
    await waitFor(() => expect(screen.queryByText('jane@example.com')).not.toBeInTheDocument());
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
  });

  it('shows the server’s message when a write is refused', async () => {
    sendJSON.mockRejectedValue(refusal(403, 'This action requires the publisher role'));
    render(<NewsletterAudience />);
    const jane = await rowFor('jane@example.com');
    fireEvent.click(within(jane).getByRole('button', { name: 'Unsubscribe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This action requires the publisher role'
    );
    expect(within(jane).getByText('Subscribed')).toBeInTheDocument();
  });
});
