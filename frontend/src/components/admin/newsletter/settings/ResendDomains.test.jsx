/**
 * Sending domains on the Settings tab. What must hold: the list and a
 * domain's records come from the API as projected, Copy uses the clipboard,
 * Verify and the tracking switches write to the domain's id route and send
 * only what changed, Add domain posts `{ name, region }` and opens the new
 * domain, a refusal is shown in the server's words, and there is no delete.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import ResendDomains from './ResendDomains';
import { normaliseHostname } from './DomainAddForm';

const getJSON = vi.fn();
const sendJSON = vi.fn();
vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
}));

const refusal = (status, message, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });

const NEWS = {
  id: 'd-1111',
  name: 'news.hybridcloudworks.com',
  status: 'verified',
  region: 'us-east-1',
  created_at: '2026-09-01T12:00:00.000Z',
};
const PENDING = { ...NEWS, id: 'd-2222', name: 'mail.example.com', status: 'pending' };

const NEWS_DETAIL = {
  ...NEWS,
  open_tracking: false,
  click_tracking: true,
  tracking_subdomain: 'links',
  records: [
    {
      record: 'SPF',
      name: 'send',
      type: 'MX',
      ttl: 'Auto',
      status: 'verified',
      value: 'feedback-smtp.us-east-1.amazonses.com',
      priority: 10,
    },
    {
      record: 'DKIM',
      name: 'resend._domainkey',
      type: 'TXT',
      ttl: 'Auto',
      status: 'not_started',
      value: 'p=MIGfMA0GCSqGSIb3DQEB',
    },
  ],
};

let clipboardWrite;

beforeEach(() => {
  getJSON.mockReset();
  sendJSON.mockReset();
  getJSON.mockImplementation(async (route) => {
    if (route === 'cms/mailing-list/domains') return { ok: true, domains: [NEWS, PENDING] };
    if (route === 'cms/mailing-list/domains/d-1111') return { ok: true, domain: NEWS_DETAIL };
    throw new Error(`unexpected ${route}`);
  });
  sendJSON.mockResolvedValue({ ok: true, id: 'd-1111' });
  clipboardWrite = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: clipboardWrite },
    configurable: true,
  });
});

afterEach(() => {
  delete navigator.clipboard;
});

// Substring matchers, not RegExps: a hostname in a RegExp is an unanchored,
// unescaped pattern, which CodeQL rightly flags even in a test.
const includes = (text) => (value) => value.includes(text);

const domainButton = async (name) => screen.findByRole('button', { name: includes(name) });

const openNews = async () => {
  render(<ResendDomains />);
  fireEvent.click(await domainButton('news.hybridcloudworks.com'));
  return screen.findByRole('table');
};

describe('normaliseHostname', () => {
  it('trims and lower-cases a hostname, and refuses what is not one', () => {
    expect(normaliseHostname('  News.Example.COM ')).toBe('news.example.com');
    expect(normaliseHostname('localhost')).toBeNull();
    expect(normaliseHostname('https://example.com')).toBeNull();
    expect(normaliseHostname('-bad.example.com')).toBeNull();
  });
});

describe('ResendDomains', () => {
  it('lists each domain with its status and region', async () => {
    render(<ResendDomains />);
    const news = await domainButton('news.hybridcloudworks.com');
    expect(within(news).getByText('verified')).toBeInTheDocument();
    expect(within(news).getByText('us-east-1')).toBeInTheDocument();
    expect(within(await domainButton('mail.example.com')).getByText('pending')).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith('cms/mailing-list/domains');
  });

  it('loads the detail on expand and shows the DNS records and tracking state', async () => {
    const table = await openNews();
    expect(getJSON).toHaveBeenCalledWith('cms/mailing-list/domains/d-1111');
    expect(within(table).getByText('feedback-smtp.us-east-1.amazonses.com')).toBeInTheDocument();
    expect(within(table).getByText('resend._domainkey')).toBeInTheDocument();
    expect(within(table).getByText('10')).toBeInTheDocument();
    expect(within(table).getByText('not started')).toBeInTheDocument();
    expect(screen.getByText(includes('Cloudflare for hybridcloudworks.com'))).toBeInTheDocument();
    expect(screen.getByText('Open tracking off · Click tracking on')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Open tracking' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    expect(screen.getByText(/tracking subdomain CNAME \(links\)/)).toBeInTheDocument();
  });

  it('copies a record value to the clipboard', async () => {
    const table = await openNews();
    fireEvent.click(within(table).getByRole('button', { name: 'Copy TXT value' }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith('p=MIGfMA0GCSqGSIb3DQEB'));
    expect(await within(table).findByText('Copied')).toBeInTheDocument();
  });

  it('says to select the value when the clipboard is unavailable', async () => {
    delete navigator.clipboard;
    const table = await openNews();
    fireEvent.click(within(table).getByRole('button', { name: 'Copy MX value' }));
    expect(await within(table).findByText(/Copy failed/)).toBeInTheDocument();
  });

  it('verifies by POSTing to the id route, then offers a refresh', async () => {
    await openNews();
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith('cms/mailing-list/domains/d-1111/verify', 'POST')
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/in the background/);

    getJSON.mockImplementation(async () => ({ ok: true, domain: { ...NEWS_DETAIL } }));
    const before = getJSON.mock.calls.length;
    const refreshes = screen.getAllByRole('button', { name: 'Refresh' });
    fireEvent.click(refreshes[refreshes.length - 1]);
    await waitFor(() => expect(getJSON.mock.calls.length).toBe(before + 1));
    expect(getJSON).toHaveBeenLastCalledWith('cms/mailing-list/domains/d-1111');
  });

  it('PATCHes only the tracking switch that changed and updates it in place', async () => {
    await openNews();
    fireEvent.click(screen.getByRole('switch', { name: 'Open tracking' }));
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith('cms/mailing-list/domains/d-1111', 'PATCH', {
        open_tracking: true,
      })
    );
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Open tracking' })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    );
    expect(screen.getByText('Open tracking on · Click tracking on')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Click tracking' }));
    await waitFor(() =>
      expect(sendJSON).toHaveBeenLastCalledWith('cms/mailing-list/domains/d-1111', 'PATCH', {
        click_tracking: false,
      })
    );
  });

  it('adds a domain with its name and region, then opens it on its records', async () => {
    const created = {
      id: 'd-3333',
      name: 'letters.example.com',
      status: 'not_started',
      region: 'eu-west-1',
      open_tracking: false,
      click_tracking: false,
      records: [{ record: 'DKIM', name: 'resend._domainkey.letters', type: 'TXT', value: 'p=NEW' }],
    };
    sendJSON.mockResolvedValue({ ok: true, domain: created });
    render(<ResendDomains />);
    await domainButton('news.hybridcloudworks.com');

    fireEvent.change(screen.getByLabelText('Domain name'), {
      target: { value: ' Letters.Example.com ' },
    });
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'eu-west-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add domain' }));

    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith('cms/mailing-list/domains', 'POST', {
        name: 'letters.example.com',
        region: 'eu-west-1',
      })
    );
    const item = await domainButton('letters.example.com');
    expect(item).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('p=NEW')).toBeInTheDocument();
    expect(getJSON).not.toHaveBeenCalledWith('cms/mailing-list/domains/d-3333');
  });

  it('defaults the region to us-east-1 and refuses a name that is not a hostname', async () => {
    render(<ResendDomains />);
    await domainButton('news.hybridcloudworks.com');
    expect(screen.getByLabelText('Region')).toHaveValue('us-east-1');
    fireEvent.change(screen.getByLabelText('Domain name'), { target: { value: 'not a domain' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add domain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('news.example.com');
    expect(sendJSON).not.toHaveBeenCalled();
  });

  it('shows the server’s message when a write is refused', async () => {
    sendJSON.mockRejectedValue(refusal(403, 'This action requires the publisher role'));
    await openNews();
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This action requires the publisher role'
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers no delete, and points to Resend for it', async () => {
    await openNews();
    expect(screen.queryByRole('button', { name: /delete|remove/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: includes('resend.com/domains') })).toHaveAttribute(
      'href',
      'https://resend.com/domains'
    );
  });

  it('clears the list when a refresh fails, so a stale list never reads as current', async () => {
    render(<ResendDomains />);
    await domainButton('news.hybridcloudworks.com');
    getJSON.mockRejectedValue(refusal(502, 'Resend did not answer'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Resend did not answer');
    expect(
      screen.queryByRole('button', { name: includes('news.hybridcloudworks.com') })
    ).not.toBeInTheDocument();
  });

  it('says Resend is not configured on a 503', async () => {
    getJSON.mockRejectedValue(refusal(503, 'Resend is not configured: RESEND_API_KEY is not set'));
    render(<ResendDomains />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Resend is not configured/);
  });

  it('says how long to wait on a 429', async () => {
    getJSON.mockRejectedValue(refusal(429, 'rate_limit_exceeded', { retryAfterSeconds: 4 }));
    render(<ResendDomains />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Wait 4 seconds, then try again.');
  });
});
