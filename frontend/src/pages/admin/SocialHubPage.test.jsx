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
/**
 * What an unseeded integration returns (functions/src/lib/integrations/rest-proxy.js).
 * The same code covers a missing PUBLER_API_KEY and a missing
 * PUBLER_WORKSPACE_ID; only `error` says which, so the page must not guess.
 */
const unseeded = {
  ok: false,
  code: 'INTEGRATION_NOT_CONFIGURED',
  error: 'Publer is not configured: PUBLER_WORKSPACE_ID is not set',
};
/**
 * Publer answered, and refused. The proxy passes that through as HTTP 200 with
 * `ok: false`, so this is a RESOLVED promise — nothing a `.catch()` will ever
 * see. Reading it as "no accounts" is the #397 conflation one layer down.
 */
const refused = { ok: false, status: 401, data: { error: 'Invalid API key' } };

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

  it('says the integration is unconfigured, naming the setting the server named', async () => {
    postJSON.mockResolvedValue(unseeded);
    render(<ComposeTab recentContent={[]} initialContentId={null} />);

    expect(await screen.findByText(/Publer is not connected/)).toBeTruthy();
    expect(screen.getByText(/PUBLER_WORKSPACE_ID is not set/)).toBeTruthy();
    expect(screen.getByText(/Connect it in the Connection Settings tab/)).toBeTruthy();
    // The two other empty states are wrong answers here and must not appear.
    expect(screen.queryByText(/No accounts found/)).toBeNull();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('does not claim it is the API key when the server did not say which setting', async () => {
    postJSON.mockResolvedValue({ ok: false, code: 'INTEGRATION_NOT_CONFIGURED' });
    render(<ComposeTab recentContent={[]} initialContentId={null} />);

    // Either setting can produce this code, so the copy names both.
    expect(
      await screen.findByText(/PUBLER_API_KEY or PUBLER_WORKSPACE_ID is not set/)
    ).toBeTruthy();
  });

  it('says the call failed rather than showing an empty list', async () => {
    postJSON.mockRejectedValue(new Error('403 Forbidden'));
    render(<ComposeTab recentContent={[]} initialContentId={null} />);

    expect(await screen.findByText(/Publer accounts could not be loaded/)).toBeTruthy();
    expect(screen.getByText(/403 Forbidden/)).toBeTruthy();
    expect(screen.queryByText(/No accounts found/)).toBeNull();
  });

  it('treats a resolved not-ok envelope as a failure, with the upstream status', async () => {
    // The regression Copilot found on #402: this call RESOLVES, so a page that
    // only catches rejections shows a Publer 401 as an empty workspace.
    postJSON.mockResolvedValue(refused);
    render(<ComposeTab recentContent={[]} initialContentId={null} />);

    expect(await screen.findByText(/Publer accounts could not be loaded/)).toBeTruthy();
    expect(screen.getByText(/Publer answered 401/)).toBeTruthy();
    expect(screen.queryByText(/No accounts found/)).toBeNull();
    expect(screen.queryByText(/Publer is not connected/)).toBeNull();
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
    expect(screen.getByText(/the proxy resolved its credentials and Publer answered/)).toBeTruthy();
    // Supported Platforms is derived from the accounts, so it only appears once
    // the list is actually read.
    expect(screen.getByText('Supported Platforms')).toBeTruthy();
  });

  it('renders without a ReferenceError and reports an unseeded key as unconfigured', async () => {
    // The card used to call publerKey() and publerWsId(), neither of which is
    // defined anywhere in the bundle, so this tab threw before it painted.
    postJSON.mockResolvedValue(unseeded);
    render(<SettingsTab />);

    expect(await screen.findByText(/a required app setting is missing/)).toBeTruthy();
    expect(screen.getByText(/Publer is not connected/)).toBeTruthy();
    expect(screen.getByText(/PUBLER_WORKSPACE_ID is not set/)).toBeTruthy();
    // On the tab that holds the fix, pointing at the tab itself would be a loop.
    expect(screen.queryByText(/Connect it in the Connection Settings tab/)).toBeNull();
    expect(screen.getByText(/Set both on the function app/)).toBeTruthy();
  });

  it('distinguishes a failed call from an empty workspace', async () => {
    postJSON.mockRejectedValue(new Error('upstream 500'));
    render(<SettingsTab />);

    expect(await screen.findByText(/Publer accounts could not be loaded/)).toBeTruthy();
    // Twice on purpose: the credential tile and the account list both carry it,
    // so neither can be read on its own as "connected, just empty".
    expect(screen.getAllByText(/upstream 500/)).toHaveLength(2);
    expect(screen.getByText(/The accounts call failed/)).toBeTruthy();
    expect(screen.queryByText(/No accounts found/)).toBeNull();
  });

  it('treats a resolved not-ok envelope as a failure, in the tile and the list', async () => {
    postJSON.mockResolvedValue(refused);
    render(<SettingsTab />);

    // The credential tile carries the upstream status, so the operator can see
    // that the key was rejected rather than absent.
    expect(await screen.findByText(/The accounts call failed — Publer answered 401/)).toBeTruthy();
    expect(screen.getByText(/Publer accounts could not be loaded/)).toBeTruthy();
    expect(screen.queryByText(/No accounts found/)).toBeNull();
    expect(screen.queryByText(/a required app setting is missing/)).toBeNull();
    // A rejected key is not an absent one; Supported Platforms stays away too.
    expect(screen.queryByText('Supported Platforms')).toBeNull();
  });

  it('asks the proxy exactly once', async () => {
    postJSON.mockResolvedValue(connected);
    render(<SettingsTab />);

    await screen.findByText('HCW on LinkedIn');
    await waitFor(() => expect(postJSON).toHaveBeenCalledTimes(1));
  });
});
