/**
 * The Social Hub's side of the Publer accounts contract (#397).
 *
 * The bug these cover: both tabs tested the response with `Array.isArray`, and
 * the publerProxy answers with an envelope — `{ ok: true, status, data }`, or
 * `{ ok: false, code: 'INTEGRATION_NOT_CONFIGURED' }` when no key is seeded —
 * which is never an array. So a fully connected workspace rendered exactly like
 * an empty one, and so did a failed call. Every fixture here is therefore the
 * envelope the function actually returns; a bare array would be testing a shape
 * the server has never sent, which is how this stayed green while broken.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { ComposeTab, SettingsTab } from './SocialHubPage';

const getJSON = vi.fn();
const sendJSON = vi.fn();
const postJSON = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
  postJSON: (...args) => postJSON(...args),
}));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

const accounts = [
  { id: 'acc-1', name: 'HCW on LinkedIn', provider: 'linkedin' },
  { id: 'acc-2', name: 'HCW on X', provider: 'twitter' },
];

/** What a configured estate returns: the envelope, with Publer's bare array inside `data`. */
const connected = { ok: true, status: 200, data: accounts };
/** What an unseeded integration returns (functions/src/lib/integrations/rest-proxy.js). */
const unseeded = { ok: false, code: 'INTEGRATION_NOT_CONFIGURED' };

beforeEach(() => {
  getJSON.mockReset().mockResolvedValue({ success: true, items: [] });
  sendJSON.mockReset().mockResolvedValue({ success: true });
  postJSON.mockReset().mockResolvedValue(unseeded);
  toast.mockReset();
});

describe('the Compose tab account picker', () => {
  it('lists the accounts a configured Publer returns inside the proxy envelope', async () => {
    postJSON.mockResolvedValue(connected);
    render(<ComposeTab recentContent={[]} initialContentId={null} />);

    expect(await screen.findByRole('button', { name: /HCW on LinkedIn/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /HCW on X/ })).toBeTruthy();
    expect(screen.queryByText(/No accounts found/)).toBeNull();
    expect(postJSON).toHaveBeenCalledWith('publerProxy', {
      path: '/accounts',
      method: 'GET',
      body: undefined,
    });
  });

  it('says the integration is unconfigured and names the tab that fixes it', async () => {
    postJSON.mockResolvedValue(unseeded);
    render(<ComposeTab recentContent={[]} initialContentId={null} />);

    expect(await screen.findByText(/Publer is not connected/)).toBeTruthy();
    expect(screen.getByText(/Connect it in the Connection Settings tab/)).toBeTruthy();
    // The two other empty states are wrong answers here and must not appear.
    expect(screen.queryByText(/No accounts found/)).toBeNull();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('says the call failed rather than showing an empty list', async () => {
    postJSON.mockRejectedValue(new Error('403 Forbidden'));
    render(<ComposeTab recentContent={[]} initialContentId={null} />);

    expect(await screen.findByText(/Publer accounts could not be loaded/)).toBeTruthy();
    expect(screen.getByText(/403 Forbidden/)).toBeTruthy();
    expect(screen.queryByText(/No accounts found/)).toBeNull();
  });

  it('says the workspace is empty only when Publer answered with no accounts', async () => {
    postJSON.mockResolvedValue({ ok: true, status: 200, data: [] });
    render(<ComposeTab recentContent={[]} initialContentId={null} />);

    expect(await screen.findByText(/No accounts found/)).toBeTruthy();
    expect(screen.queryByText(/Publer is not connected/)).toBeNull();
  });
});

describe('the Connection Settings tab', () => {
  it('lists the connected accounts from the envelope and reports the credential as usable', async () => {
    postJSON.mockResolvedValue(connected);
    render(<SettingsTab />);

    expect(await screen.findByText('HCW on LinkedIn')).toBeTruthy();
    expect(screen.getByText('HCW on X')).toBeTruthy();
    expect(screen.getByText(/the proxy resolved its key and answered/)).toBeTruthy();
    // Supported Platforms is derived from the accounts, so it only appears once
    // the list is actually read.
    expect(screen.getByText('Supported Platforms')).toBeTruthy();
  });

  it('renders without a ReferenceError and reports an unseeded key as unconfigured', async () => {
    // The card used to call publerKey() and publerWsId(), neither of which is
    // defined anywhere in the bundle, so this tab threw before it painted.
    postJSON.mockResolvedValue(unseeded);
    render(<SettingsTab />);

    expect(await screen.findByText(/no API key is set on the function app/)).toBeTruthy();
    expect(screen.getByText(/Publer is not connected/)).toBeTruthy();
    // On the tab that holds the fix, pointing at the tab itself would be a loop.
    expect(screen.queryByText(/Connect it in the Connection Settings tab/)).toBeNull();
    expect(screen.getByText(/Set PUBLER_API_KEY and PUBLER_WORKSPACE_ID/)).toBeTruthy();
  });

  it('distinguishes a failed call from an empty workspace', async () => {
    postJSON.mockRejectedValue(new Error('upstream 500'));
    render(<SettingsTab />);

    expect(await screen.findByText(/Publer accounts could not be loaded/)).toBeTruthy();
    expect(screen.getByText(/upstream 500/)).toBeTruthy();
    expect(screen.getByText(/The accounts call failed/)).toBeTruthy();
    expect(screen.queryByText(/No accounts found/)).toBeNull();
  });

  it('asks the proxy exactly once', async () => {
    postJSON.mockResolvedValue(connected);
    render(<SettingsTab />);

    await screen.findByText('HCW on LinkedIn');
    await waitFor(() => expect(postJSON).toHaveBeenCalledTimes(1));
  });
});
