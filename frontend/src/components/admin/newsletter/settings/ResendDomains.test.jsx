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
    // A create answer with the tracking fields is a full detail: no second read.
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

  it('reads the detail after a create that returned no tracking fields, so the switches are real', async () => {
    const created = {
      id: 'd-3333',
      name: 'letters.example.com',
      status: 'not_started',
      region: 'us-east-1',
      records: [{ record: 'DKIM', name: 'resend._domainkey.letters', type: 'TXT', value: 'p=NEW' }],
    };
    const base = getJSON.getMockImplementation();
    getJSON.mockImplementation(async (route) =>
      route === 'cms/mailing-list/domains/d-3333'
        ? { ok: true, domain: { ...created, open_tracking: false, click_tracking: true } }
        : base(route)
    );
    sendJSON.mockResolvedValue({ ok: true, domain: created });
    render(<ResendDomains />);
    await domainButton('news.hybridcloudworks.com');
    fireEvent.change(screen.getByLabelText('Domain name'), {
      target: { value: 'letters.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add domain' }));

    expect(await screen.findByText('p=NEW')).toBeInTheDocument();
    await waitFor(() => expect(getJSON).toHaveBeenCalledWith('cms/mailing-list/domains/d-3333'));
    expect(await screen.findByText('Open tracking off · Click tracking on')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Click tracking' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('does not leave a partial detail when a tracking change finishes after Refresh dropped it', async () => {
    await openNews();
    let finishPatch;
    sendJSON.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPatch = resolve;
        })
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Open tracking' }));
    await waitFor(() => expect(finishPatch).toBeTypeOf('function'));

    // Refresh drops the cached detail; its reload of the detail then fails.
    getJSON.mockImplementation(async (route) => {
      if (route === 'cms/mailing-list/domains/d-1111') {
        throw Object.assign(new Error('rate_limit_exceeded'), {
          status: 429,
          retryAfterSeconds: 2,
        });
      }
      return { ok: true, domains: [NEWS] };
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);
    finishPatch({ ok: true });

    expect(
      await screen.findByText(includes('Wait 2 seconds, then try again.'))
    ).toBeInTheDocument();
    expect(screen.getByText('Tracking: open to see')).toBeInTheDocument();
    expect(screen.queryByText(/returned no/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Open tracking' })).not.toBeInTheDocument();
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

  it('shows the refreshed status, not a cached detail, after Refresh', async () => {
    await openNews();
    const news = await domainButton('news.hybridcloudworks.com');
    expect(within(news).getByText('verified')).toBeInTheDocument();
    const base = getJSON.getMockImplementation();
    getJSON.mockImplementation(async (route) => {
      const res = await base(route);
      if (route === 'cms/mailing-list/domains') {
        return {
          ...res,
          domains: res.domains.map((d) => (d.id === 'd-1111' ? { ...d, status: 'failed' } : d)),
        };
      }
      if (route === 'cms/mailing-list/domains/d-1111')
        return { ...res, domain: { ...res.domain, status: 'failed' } };
      return res;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(
        within(
          screen.getByRole('button', { name: includes('news.hybridcloudworks.com') })
        ).getByText('failed')
      ).toBeInTheDocument()
    );
    expect(
      getJSON.mock.calls.filter(([route]) => route === 'cms/mailing-list/domains/d-1111').length
    ).toBeGreaterThanOrEqual(2);
  });

  it('lets only the latest refresh write, when an earlier one answers last', async () => {
    render(<ResendDomains />);
    await domainButton('news.hybridcloudworks.com');
    const answers = [];
    getJSON.mockImplementation(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(answers).toHaveLength(2));
    const row = (id, name) => ({ id, name, status: 'verified', region: 'us-east-1' });
    answers[1]({ ok: true, domains: [row('d-new', 'fresh.example.com')] });
    expect(await domainButton('fresh.example.com')).toBeInTheDocument();
    answers[0]({ ok: true, domains: [row('d-old', 'stale.example.com')] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      screen.queryByRole('button', { name: includes('stale.example.com') })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: includes('fresh.example.com') })).toBeInTheDocument();
  });

  it('sends Verify, a tracking change and Add domain once, however fast they are pressed', async () => {
    let finish;
    sendJSON.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await openNews();
    const verifyButton = screen.getByRole('button', { name: 'Verify' });
    fireEvent.click(verifyButton);
    fireEvent.click(verifyButton);
    const openSwitch = screen.getByRole('switch', { name: 'Open tracking' });
    fireEvent.click(openSwitch);
    fireEvent.click(openSwitch);
    fireEvent.change(screen.getByLabelText('Domain name'), {
      target: { value: 'twice.example.com' },
    });
    const addButton = screen.getByRole('button', { name: 'Add domain' });
    fireEvent.click(addButton);
    fireEvent.click(addButton);
    await waitFor(() => expect(sendJSON).toHaveBeenCalledTimes(3));
    const kinds = sendJSON.mock.calls.map(([path, method]) => `${method} ${path}`).sort();
    expect(kinds).toEqual([
      'PATCH cms/mailing-list/domains/d-1111',
      'POST cms/mailing-list/domains',
      'POST cms/mailing-list/domains/d-1111/verify',
    ]);
    finish({ ok: true });
  });

  it('lets only the latest detail reload write, when an earlier one answers last', async () => {
    sendJSON.mockResolvedValue({ ok: true });
    await openNews();
    // The panel's own Refresh appears once verification has been requested.
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByRole('status');
    const answers = [];
    getJSON.mockImplementation(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        })
    );
    const panelRefresh = screen.getAllByRole('button', { name: 'Refresh' }).at(-1);
    fireEvent.click(panelRefresh);
    fireEvent.click(panelRefresh);
    await waitFor(() => expect(answers).toHaveLength(2));
    const withValue = (value) => ({
      ok: true,
      domain: { ...NEWS_DETAIL, records: [{ ...NEWS_DETAIL.records[0], value }] },
    });
    answers[1](withValue('p=LATEST'));
    expect(await screen.findByText('p=LATEST')).toBeInTheDocument();
    answers[0](withValue('p=STALE'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('p=STALE')).not.toBeInTheDocument();
    expect(screen.getByText('p=LATEST')).toBeInTheDocument();
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
