/**
 * Social automation: the autopost card edits the body the trigger reads, the
 * Publer picker offers only what the trigger can post to, and a Publer
 * envelope that failed is reported as a failure rather than as an empty
 * workspace (#397).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import SocialAutomationTab, { SocialAutopostCard } from './SocialAutomationTab';
import { settingRoute } from './settingShared';

// The Radix Switch measures its thumb with ResizeObserver, which jsdom lacks.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const getJSON = vi.fn();
const sendJSON = vi.fn();
const postJSON = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
  postJSON: (...args) => postJSON(...args),
}));
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

const meta = { exists: false, stored: null, updatedAt: null, problem: null };

beforeEach(() => {
  getJSON.mockReset().mockResolvedValue({
    success: true,
    setting: 'social-autopost',
    value: { enabled: false, accountIds: [], scheduleDelayMinutes: 60 },
    exists: false,
    stored: null,
    updatedAt: null,
  });
  sendJSON.mockReset().mockImplementation(async (_route, _method, body) => ({
    success: true,
    value: body,
    exists: true,
    stored: 'valid',
    updatedAt: '2026-09-07T12:00:00.000Z',
  }));
  // The proxy envelope for an unseeded key (rest-proxy.js), not a bare array.
  postJSON.mockReset().mockResolvedValue({ ok: false, code: 'INTEGRATION_NOT_CONFIGURED' });
  toast.mockReset();
});

describe('SocialAutopostCard', () => {
  const value = {
    enabled: false,
    accountIds: [{ id: 'acc-1', provider: 'linkedin' }],
    scheduleDelayMinutes: 60,
  };

  it('toggles enabled, edits the delay, and edits an account row in place', () => {
    const onChange = vi.fn();
    render(
      <SocialAutopostCard
        value={value}
        meta={meta}
        saving={false}
        onChange={onChange}
        onSave={vi.fn()}
        publerAccounts={[]}
      />
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, enabled: true });

    fireEvent.change(screen.getByLabelText('Delay (minutes)'), { target: { value: '90' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...value, scheduleDelayMinutes: '90' });

    fireEvent.change(screen.getByLabelText('Provider 1'), { target: { value: 'twitter' } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      accountIds: [{ id: 'acc-1', provider: 'twitter' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove account 1' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, accountIds: [] });
  });

  it('offers only the free-text row when Publer lists nothing', () => {
    render(
      <SocialAutopostCard
        value={value}
        meta={meta}
        saving={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        publerAccounts={[]}
      />
    );
    expect(screen.queryByLabelText('Publer account to add')).toBeNull();
    expect(screen.getByRole('button', { name: /Add account by id/ })).toBeTruthy();
  });

  it('adds a Publer account with its own provider, hiding chosen and unsupported ones', () => {
    const onChange = vi.fn();
    render(
      <SocialAutopostCard
        value={value}
        meta={meta}
        saving={false}
        onChange={onChange}
        onSave={vi.fn()}
        publerAccounts={[
          { id: 'acc-1', name: 'Already chosen', provider: 'linkedin' },
          { id: 'acc-2', name: 'HCW on X', provider: 'Twitter' },
          { id: 'acc-3', name: 'Odd network', provider: 'mastodon' },
        ]}
      />
    );
    const picker = screen.getByLabelText('Publer account to add');
    const options = within(picker)
      .getAllByRole('option')
      .map((option) => option.textContent);
    // acc-1 is already chosen; mastodon is a network the trigger cannot post
    // to, and it must not be offered and then silently rewritten to another.
    expect(options).toEqual(['Pick a Publer account…', 'HCW on X · Twitter']);
    expect(screen.getByText(/1 Publer account hidden/)).toBeTruthy();

    fireEvent.change(picker, { target: { value: 'acc-2' } });
    fireEvent.click(screen.getByRole('button', { name: /Add from Publer/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      accountIds: [
        { id: 'acc-1', provider: 'linkedin' },
        { id: 'acc-2', provider: 'twitter' },
      ],
    });
  });
});

// unwrapPublerAccounts moved to src/lib/publerAccounts.js with #397; its unit
// tests moved with it to src/lib/publerAccounts.test.js. What stays here is
// what this tab does with the result.

describe('the Social automation tab', () => {
  it('loads its own setting and asks Publer for accounts, and nothing else', async () => {
    render(<SocialAutomationTab />);
    await screen.findByText('Social autoposting');
    expect(getJSON).toHaveBeenCalledTimes(1);
    expect(getJSON).toHaveBeenCalledWith(settingRoute('social-autopost'));
    expect(postJSON).toHaveBeenCalledWith('publerProxy', { path: '/accounts', method: 'GET' });
  });

  it('offers the accounts a configured Publer returns inside the proxy envelope', async () => {
    // The regression: the envelope is { ok, status, data }, and treating it as
    // a bare array left the picker permanently empty on a configured estate.
    postJSON.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ id: 'acc-9', name: 'HCW on LinkedIn', provider: 'linkedin' }],
    });
    render(<SocialAutomationTab />);
    const picker = await screen.findByLabelText('Publer account to add');
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Pick a Publer account…', 'HCW on LinkedIn · linkedin']);
    expect(screen.queryByText(/Publer not configured/)).toBeNull();
  });

  it('says Publer is not configured and falls back to adding by id', async () => {
    render(<SocialAutomationTab />);
    await waitFor(() => expect(screen.getByText(/Publer not configured/)).toBeTruthy());
    expect(screen.queryByLabelText('Publer account to add')).toBeNull();
    expect(screen.getByRole('button', { name: /Add account by id/ })).toBeTruthy();
  });

  it('reports a resolved not-ok envelope as a failure carrying the upstream status', async () => {
    // Publer refused the key. The proxy answers HTTP 200 with ok:false, so this
    // resolves — a page that only catches rejections would call it "ready" and
    // show an empty picker, which is the #397 conflation one layer down.
    postJSON.mockResolvedValue({ ok: false, status: 401, data: { error: 'Invalid API key' } });
    render(<SocialAutomationTab />);
    await waitFor(() =>
      expect(screen.getByText(/Publer accounts could not be loaded/)).toBeTruthy()
    );
    expect(screen.getByText(/Publer answered 401/)).toBeTruthy();
    // Not the unconfigured message: the key is present, it is being rejected.
    expect(screen.queryByText(/Publer not configured/)).toBeNull();
    expect(screen.getByRole('button', { name: /Add account by id/ })).toBeTruthy();
  });

  it('PUTs the autopost body the trigger reads, with the delay as typed', async () => {
    render(<SocialAutomationTab />);
    await screen.findByText('Social autoposting');
    fireEvent.click(screen.getByRole('button', { name: /Add account by id/ }));
    fireEvent.change(screen.getByLabelText('Account id 1'), { target: { value: 'pub-123' } });
    fireEvent.change(screen.getByLabelText('Delay (minutes)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.submit(screen.getByLabelText('Delay (minutes)').closest('form'));
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith(settingRoute('social-autopost'), 'PUT', {
        enabled: true,
        accountIds: [{ id: 'pub-123', provider: 'linkedin' }],
        scheduleDelayMinutes: '30',
      })
    );
  });
});
