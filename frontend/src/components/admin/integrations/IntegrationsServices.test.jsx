/**
 * The Services tab. The card tests moved from IntegrationsPage.test.jsx (#570);
 * what changed is that a card now shows its keys by name and light only, and
 * the paste box lives on the Keys tab. What must hold: the test button and the
 * key names share a card, tests go server-side by NAME and read the envelope,
 * a group is picked by `?group=`, and a failed status read leaves the cards up.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import IntegrationsServices from './IntegrationsServices';
import useServiceTests from './useServiceTests';

const getJSON = vi.fn();
const sendJSON = vi.fn();
const postJSON = vi.fn();
const toast = vi.fn();
const getIntegrationSettings = vi.fn();
const saveIntegrationSettings = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
  postJSON: (...args) => postJSON(...args),
}));
vi.mock('@/lib/adminSettings', () => ({
  getIntegrationSettings: (...args) => getIntegrationSettings(...args),
  saveIntegrationSettings: (...args) => saveIntegrationSettings(...args),
  getSessionizeSpeakerId: async () => 'speaker-42',
  DEFAULT_SESSIONIZE_SPEAKER_ID: 'default-speaker',
}));
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

const item = (overrides = {}) => ({
  secret: 'RESEND-API-KEY',
  section: 'communication',
  label: 'Resend — API key',
  help: 'API key.',
  state: 'live',
  generatable: false,
  hasLivenessCheck: false,
  ...overrides,
});

const payload = (secrets) => ({
  success: true,
  sections: [{ id: 'communication', title: 'Communication', blurb: 'b' }],
  secrets,
});

const onGroupChange = vi.fn();
const onOpenKeys = vi.fn();

function Harness({ group }) {
  const tests = useServiceTests();
  return (
    <IntegrationsServices
      group={group}
      onGroupChange={onGroupChange}
      onOpenKeys={onOpenKeys}
      tests={tests}
    />
  );
}

const cardFor = (name) => screen.getByText(name).closest('.p-4');

beforeEach(() => {
  getJSON.mockReset().mockResolvedValue(payload([item()]));
  sendJSON.mockReset();
  postJSON.mockReset();
  toast.mockReset();
  onGroupChange.mockReset();
  onOpenKeys.mockReset();
  getIntegrationSettings.mockReset().mockResolvedValue({ sessionizeSpeakerId: 'speaker-42' });
  saveIntegrationSettings.mockReset().mockResolvedValue({ success: true });
});

describe('the service cards', () => {
  it('carries the test button and the names of its keys on one card, with no paste box', async () => {
    render(<Harness group="communication" />);
    await waitFor(() => expect(cardFor('Resend').textContent).toContain('RESEND-API-KEY'));

    const card = cardFor('Resend');
    expect(within(card).getByRole('button', { name: /^Test Resend$/ })).toBeTruthy();
    expect(within(card).getByText('Live')).toBeTruthy();
    // Writing a key happens on the Keys tab only: one write path per key.
    expect(card.querySelector('input')).toBeNull();
  });

  it('runs the service test server-side and reports the result', async () => {
    // THE REAL ENVELOPE: connectionProbe answers `{ ok, status, data }` where
    // `data` is Resend's own `{ object: 'list', data: [...] }` body.
    postJSON.mockResolvedValue({
      ok: true,
      status: 200,
      data: { object: 'list', data: [{ id: 'd-1' }, { id: 'd-2' }] },
    });
    render(<Harness group="communication" />);
    fireEvent.click(within(cardFor('Resend')).getByRole('button', { name: /^Test Resend$/ }));

    await waitFor(() => expect(screen.getByText(/2 sending domain\(s\)/)).toBeTruthy());
    // A name, never a path: the probe builds the call on the server.
    expect(postJSON).toHaveBeenCalledWith('connectionProbe', { probe: 'resend' });
    expect(within(cardFor('Resend')).getByText(/tested just now/)).toBeTruthy();
  });

  it('says a working Resend key with no domain yet cannot send anything', async () => {
    postJSON.mockResolvedValue({ ok: true, status: 200, data: { object: 'list', data: [] } });
    render(<Harness group="communication" />);
    fireEvent.click(within(cardFor('Resend')).getByRole('button', { name: /^Test Resend$/ }));

    await waitFor(() =>
      expect(screen.getByText(/no sending domain has been added to Resend yet/)).toBeTruthy()
    );
  });

  it('shows Resend refusing a sending-only key instead of a green tick', async () => {
    postJSON.mockResolvedValue({
      ok: false,
      status: 401,
      data: {
        name: 'restricted_api_key',
        message: 'This API key is restricted to only send emails',
      },
      error: 'This API key is restricted to only send emails',
    });
    render(<Harness group="communication" />);
    fireEvent.click(within(cardFor('Resend')).getByRole('button', { name: /^Test Resend$/ }));

    await waitFor(() => expect(screen.getByText(/restricted to only send emails/)).toBeTruthy());
    expect(screen.queryByText(/sending domain\(s\)/)).toBeNull();
    expect(within(cardFor('Resend')).getByText('Failed')).toBeTruthy();
  });

  it('does not call YouTube a placeholder, because its key has a live consumer', async () => {
    // lib/listen-and-learn/videos.js calls the Data API v3 with
    // YOUTUBE_API_KEY to pick the "watch next" videos beside every episode.
    render(<Harness group="content" />);
    await waitFor(() => expect(screen.getByText('YouTube')).toBeTruthy());

    const card = cardFor('YouTube');
    expect(card.textContent).toContain('watch next');
    expect(screen.queryByText('Placeholder')).toBeNull();
    expect(card.textContent).not.toContain('not wired up');
  });

  it('puts the Sessionize speaker id on the Sessionize card, beside the test that uses it', async () => {
    render(<Harness group="content" />);
    const speakerInput = await screen.findByLabelText('Sessionize Speaker ID');
    await waitFor(() => expect(speakerInput.value).toBe('speaker-42'));
    expect(within(cardFor('Sessionize')).getByLabelText('Sessionize Speaker ID')).toBe(
      speakerInput
    );
  });

  it('tests Sessionize with the trimmed speaker id, and a blank one falls back to the default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<Harness group="content" />);
      const input = await screen.findByLabelText('Sessionize Speaker ID');
      await waitFor(() => expect(input.disabled).toBe(false));
      const test = within(cardFor('Sessionize')).getByRole('button', { name: /^Test Sessionize$/ });

      fireEvent.change(input, { target: { value: '  speaker-7  ' } });
      fireEvent.click(test);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(fetchMock.mock.calls[0][0]).toBe('https://sessionize.com/api/speaker/json/speaker-7');

      await waitFor(() => expect(test.disabled).toBe(false));
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.click(test);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(fetchMock.mock.calls[1][0]).toBe(
        'https://sessionize.com/api/speaker/json/default-speaker'
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('saves the speaker id once, however fast Save is pressed', async () => {
    let finish;
    saveIntegrationSettings.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<Harness group="content" />);
    const input = await screen.findByLabelText('Sessionize Speaker ID');
    await waitFor(() => expect(input.disabled).toBe(false));

    const save = within(cardFor('Sessionize')).getByRole('button', { name: /Save/ });
    fireEvent.click(save);
    fireEvent.click(save);
    finish({ success: true });

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(saveIntegrationSettings).toHaveBeenCalledTimes(1);
    expect(saveIntegrationSettings).toHaveBeenCalledWith({ sessionizeSpeakerId: 'speaker-42' });
  });

  it('says why Plaud has no credential row rather than showing none and explaining nothing', async () => {
    render(<Harness group="content" />);
    await waitFor(() => expect(screen.getByText('Plaud')).toBeTruthy());
    const card = cardFor('Plaud');
    // The note must explain the OTHER sign-in without naming a database
    // document, an issue number or a file path.
    expect(card.textContent).toContain('12 hours');
    expect(card.textContent).toContain('Recording Hub');
    expect(card.textContent).not.toMatch(/mcp_servers|#\d{3}|\.js\b/);
  });
});

describe('the group picker', () => {
  it('shows only the group in `?group=`, and the first group when there is none', async () => {
    const { rerender } = render(<Harness group="education" />);
    await waitFor(() => expect(screen.getByText('Credly')).toBeTruthy());
    expect(screen.queryByText('Publer')).toBeNull();

    rerender(<Harness group={null} />);
    await waitFor(() => expect(screen.getByText('Publer')).toBeTruthy());
    expect(screen.queryByText('Credly')).toBeNull();
  });

  it('asks for a group change rather than keeping it to itself, so it deep-links', async () => {
    render(<Harness group="communication" />);
    fireEvent.click(await screen.findByRole('button', { name: /Education/ }));
    expect(onGroupChange).toHaveBeenCalledWith('education');
  });

  it('points at the Keys tab for keys in the group that no card uses', async () => {
    getJSON.mockResolvedValue({
      success: true,
      sections: [],
      secrets: [item({ secret: 'LOOSE-ONE', section: 'communication', label: 'Loose' })],
    });
    render(<Harness group="communication" />);
    fireEvent.click(await screen.findByRole('button', { name: /See them on the Keys tab/ }));
    expect(onOpenKeys).toHaveBeenCalled();
  });
});

describe('loading on its own', () => {
  it('keeps the cards and their tests when the key status cannot be read', async () => {
    getJSON.mockRejectedValue(new Error('HTTP 503'));
    render(<Harness group="communication" />);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/HTTP 503/));
    expect(within(cardFor('Resend')).getByRole('button', { name: /^Test Resend$/ })).toBeTruthy();
    expect(cardFor('Resend').textContent).not.toContain('RESEND-API-KEY');
  });
});
