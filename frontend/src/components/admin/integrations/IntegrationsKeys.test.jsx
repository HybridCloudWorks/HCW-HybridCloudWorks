/**
 * The Keys tab. The write tests moved from IntegrationsPage.test.jsx (#570).
 * What must hold: every key shows under its group with the services that use
 * it, a write is the same PUT to the same route, one write runs at a time, a
 * failed refresh leaves no stale lights, and no secret value ever renders.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import IntegrationsKeys from './IntegrationsKeys';

const getJSON = vi.fn();
const sendJSON = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
  postJSON: vi.fn(),
}));
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

// The API's real shape. `section` is a GROUP id - the same vocabulary the
// page renders headings from.
const item = (overrides = {}) => ({
  secret: 'GEMINI-API-KEY',
  setting: 'GEMINI_API_KEY',
  section: 'gen-ai',
  label: 'Google Gemini',
  help: 'API key. The first model the site asks to write.',
  state: 'never',
  generatable: false,
  hasLivenessCheck: true,
  lastWriteAt: null,
  lastWriteBy: null,
  lastOkAt: null,
  lastFailAt: null,
  lastFailStatus: null,
  ...overrides,
});

const payload = (secrets) => ({
  success: true,
  sections: [{ id: 'gen-ai', title: 'Gen AI', blurb: 'Models that write and draw.' }],
  secrets,
});

beforeEach(() => {
  getJSON.mockReset().mockResolvedValue(payload([item()]));
  sendJSON.mockReset().mockResolvedValue({ success: true, message: 'Stored.' });
  toast.mockReset();
});

describe('the list', () => {
  it('loads status once auth is ready and shows the credential under its group', async () => {
    // The heading comes from SERVICE_GROUPS, not from the API's sections - one
    // taxonomy drives both, so a key appears under the same words as the
    // service it belongs to.
    render(<IntegrationsKeys />);
    await waitFor(() => expect(screen.getByText('Gen AI')).toBeTruthy());
    expect(getJSON).toHaveBeenCalledWith('cms/secrets');
    expect(screen.getByText('Google Gemini')).toBeTruthy();
  });

  it('hides a group that has nothing in it rather than showing an empty heading', async () => {
    getJSON.mockResolvedValue({
      success: true,
      sections: [
        { id: 'gen-ai', title: 'Gen AI', blurb: 'Models that write and draw.' },
        { id: 'ghost', title: 'Empty Section', blurb: 'Nothing here.' },
      ],
      secrets: [item()],
    });
    render(<IntegrationsKeys />);
    await waitFor(() => expect(screen.getByText('Gen AI')).toBeTruthy());
    expect(screen.queryByText('Empty Section')).toBeNull();
    expect(screen.queryByText('Cloud')).toBeNull();
  });

  it('names the services that use a key, and keeps a claimed key on this tab', async () => {
    getJSON.mockResolvedValue(
      payload([
        item({ secret: 'PUBLER-API-KEY', section: 'communication', label: 'Publer — API key' }),
      ])
    );
    render(<IntegrationsKeys />);
    await waitFor(() => expect(screen.getByText('Publer — API key')).toBeTruthy());
    expect(screen.getByText('Communication')).toBeTruthy();
    expect(screen.getByText('Publer')).toBeTruthy();
    expect(screen.getByLabelText('New value for Publer — API key')).toBeTruthy();
  });

  it('shows a key whose section no group knows under Other credentials', async () => {
    getJSON.mockResolvedValue({
      success: true,
      sections: [{ id: 'brand-new', title: 'Brand new', blurb: 'Just added.' }],
      secrets: [item({ secret: 'NEW-KEY', section: 'brand-new', label: 'New thing' })],
    });
    render(<IntegrationsKeys />);
    await waitFor(() => expect(screen.getByText('Other credentials')).toBeTruthy());
    expect(screen.getByText('Brand new')).toBeTruthy();
    expect(screen.getByLabelText('New value for New thing')).toBeTruthy();
  });

  it('never renders a secret value, even one that arrived in the response', async () => {
    // The route has no read path for a value. This pins the page's half: a
    // row renders the fields it names, so a stray field cannot leak.
    const LEAK = 'sk-live-THIS-MUST-NEVER-RENDER-0123456789';
    getJSON.mockResolvedValue(
      payload([
        item({
          value: LEAK,
          secretValue: LEAK,
          state: 'live',
          lastWriteAt: '2026-09-01T00:00:00Z',
        }),
      ])
    );
    const { container } = render(<IntegrationsKeys />);
    await waitFor(() => expect(screen.getByText('Google Gemini')).toBeTruthy());

    expect(container.innerHTML).not.toContain(LEAK);
    for (const input of container.querySelectorAll('input')) {
      expect(input.value).toBe('');
      expect(input.getAttribute('type')).toBe('password');
    }
    // It only ever asks for status.
    expect(getJSON.mock.calls.map(([route]) => route)).toEqual(['cms/secrets']);
  });
});

describe('writing a key', () => {
  it('PUTs to the same route it read from', async () => {
    render(<IntegrationsKeys />);
    await waitFor(() => expect(screen.getByText('Google Gemini')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('New value for Google Gemini'), {
      target: { value: 'sk-a-real-looking-key' },
    });
    fireEvent.submit(screen.getByLabelText('New value for Google Gemini').closest('form'));

    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith('cms/secrets', 'PUT', {
        secret: 'GEMINI-API-KEY',
        value: 'sk-a-real-looking-key',
      })
    );
  });

  it('generates without a value, through the same route', async () => {
    getJSON.mockResolvedValue(payload([item({ generatable: true })]));
    render(<IntegrationsKeys />);
    fireEvent.click(await screen.findByTitle(/Generate a random value/));
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith('cms/secrets', 'PUT', {
        secret: 'GEMINI-API-KEY',
        generate: true,
      })
    );
  });

  it('surfaces the API’s own message rather than inventing one', async () => {
    sendJSON.mockResolvedValue({
      success: true,
      message: 'Stored. It goes live within 24 hours or at the next deploy (HTTP 403).',
    });
    render(<IntegrationsKeys />);
    await waitFor(() => expect(screen.getByText('Google Gemini')).toBeTruthy());

    const input = screen.getByLabelText('New value for Google Gemini');
    fireEvent.change(input, { target: { value: 'a-real-looking-value' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringContaining('within 24 hours') })
      )
    );
  });

  it('reports a refused write without clearing the field', async () => {
    sendJSON.mockRejectedValue(new Error('that looks like a placeholder'));
    render(<IntegrationsKeys />);
    await waitFor(() => expect(screen.getByText('Google Gemini')).toBeTruthy());

    const input = screen.getByLabelText('New value for Google Gemini');
    fireEvent.change(input, { target: { value: 'changeme' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
    );
    expect(input.value).toBe('changeme');
  });

  it('sends one write at a time, however many rows are submitted', async () => {
    getJSON.mockResolvedValue(
      payload([item(), item({ secret: 'OPENAI-API-KEY', label: 'OpenAI', section: 'gen-ai' })])
    );
    let finish;
    sendJSON.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<IntegrationsKeys />);
    await waitFor(() => expect(screen.getByText('OpenAI')).toBeTruthy());

    for (const label of ['Google Gemini', 'OpenAI']) {
      const input = screen.getByLabelText(`New value for ${label}`);
      fireEvent.change(input, { target: { value: 'a-real-looking-value' } });
      fireEvent.submit(input.closest('form'));
    }
    finish({ success: true, message: 'Stored.' });

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(sendJSON).toHaveBeenCalledTimes(1);
  });

  it('reloads the status after a write', async () => {
    render(<IntegrationsKeys />);
    await waitFor(() => expect(screen.getByText('Google Gemini')).toBeTruthy());
    const input = screen.getByLabelText('New value for Google Gemini');
    fireEvent.change(input, { target: { value: 'a-real-looking-value' } });
    fireEvent.submit(input.closest('form'));
    await waitFor(() => expect(getJSON).toHaveBeenCalledTimes(2));
  });
});

describe('loading', () => {
  it('shows the error in the tab when status cannot be read', async () => {
    getJSON.mockRejectedValue(new Error('HTTP 403 from cms/secrets'));
    render(<IntegrationsKeys />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/HTTP 403/));
  });

  it('clears the rows when a refresh fails, rather than leaving lights that are no longer true', async () => {
    render(<IntegrationsKeys />);
    await waitFor(() => expect(screen.getByText('Google Gemini')).toBeTruthy());

    getJSON.mockRejectedValue(new Error('HTTP 401'));
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/HTTP 401/));
    expect(screen.queryByText('Google Gemini')).toBeNull();
  });

  it('lets only the newest load land, so a slow first answer cannot overwrite a refresh', async () => {
    let slow;
    getJSON
      .mockReturnValueOnce(new Promise((resolve) => (slow = resolve)))
      .mockResolvedValueOnce(payload([item({ label: 'Fresh' })]));
    render(<IntegrationsKeys />);
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(screen.getByText('Fresh')).toBeTruthy());

    slow(payload([item({ label: 'Stale' })]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('Stale')).toBeNull();
    expect(screen.getByText('Fresh')).toBeTruthy();
  });
});
