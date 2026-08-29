/**
 * The page's own half of the no-readback promise.
 *
 * The API cannot return a value and the vault role cannot read one, so the only
 * way a credential could reach a screen is if this page rendered something the
 * operator typed back at them. The input is `type="password"` and is cleared on
 * success; these hold that.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import ApiKeysPage, { STATE_PRESENTATION, SecretRow } from './ApiKeysPage';

const getJSON = vi.fn();
const sendJSON = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
}));
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

const item = (overrides = {}) => ({
  secret: 'GEMINI-API-KEY',
  setting: 'GEMINI_API_KEY',
  section: 'ai',
  label: 'Google Gemini',
  help: 'First in the router’s preference order.',
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
  sections: [{ id: 'ai', title: 'AI & generation', blurb: 'AI keys.' }],
  secrets,
});

beforeEach(() => {
  getJSON.mockReset().mockResolvedValue(payload([item()]));
  sendJSON.mockReset().mockResolvedValue({ success: true, message: 'Stored.' });
  toast.mockReset();
});

describe('the pasted value stays out of the DOM', () => {
  it('uses a password input, so it is never legible on screen', () => {
    const { container } = render(<SecretRow item={item()} onSubmit={vi.fn()} busy={false} />);
    const input = container.querySelector('input');
    expect(input.getAttribute('type')).toBe('password');
    // Autofill would put a credential into a browser's password manager under
    // this site's origin, where it outlives the rotation.
    expect(input.getAttribute('autocomplete')).toBe('off');
  });

  it('clears the field once the write succeeded', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const { container } = render(<SecretRow item={item()} onSubmit={onSubmit} busy={false} />);
    const input = container.querySelector('input');

    fireEvent.change(input, { target: { value: 'sk-real-credential-value' } });
    fireEvent.submit(container.querySelector('form'));

    await waitFor(() => expect(input.value).toBe(''));
    expect(onSubmit).toHaveBeenCalledWith('GEMINI-API-KEY', { value: 'sk-real-credential-value' });
  });

  it('keeps what was typed when the write was refused, so it can be corrected', async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    const { container } = render(<SecretRow item={item()} onSubmit={onSubmit} busy={false} />);
    const input = container.querySelector('input');

    fireEvent.change(input, { target: { value: 'sk-typo ' } });
    fireEvent.submit(container.querySelector('form'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(input.value).toBe('sk-typo ');
  });
});

describe('the lights', () => {
  it('names every state the API can return', () => {
    // A state with no presentation falls back to gray, which would quietly
    // report a rejected key as "not set".
    expect(Object.keys(STATE_PRESENTATION).sort()).toEqual(['failing', 'live', 'never', 'pending']);
  });

  it('carries words as well as a colour', () => {
    render(<SecretRow item={item({ state: 'failing', lastFailStatus: 401 })} onSubmit={vi.fn()} />);
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.getByText(/HTTP 401/)).toBeTruthy();
    // The dot is labelled for anyone not reading colour.
    expect(screen.getByRole('img', { name: 'Rejected' })).toBeTruthy();
  });

  it('says so when a green light is not backed by a liveness check', () => {
    render(
      <SecretRow item={item({ state: 'live', hasLivenessCheck: false })} onSubmit={vi.fn()} />
    );
    expect(screen.getByText(/no liveness check/)).toBeTruthy();
  });

  it('does not add that caveat where a check does exist', () => {
    render(<SecretRow item={item({ state: 'live', hasLivenessCheck: true })} onSubmit={vi.fn()} />);
    expect(screen.queryByText(/no liveness check/)).toBeNull();
  });
});

describe('generate', () => {
  it('is offered only for values this estate invents', () => {
    const { rerender, container } = render(
      <SecretRow item={item({ generatable: false })} onSubmit={vi.fn()} />
    );
    expect(container.querySelectorAll('button')).toHaveLength(0);

    rerender(<SecretRow item={item({ generatable: true })} onSubmit={vi.fn()} />);
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  it('sends generate without a value', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const { container } = render(
      <SecretRow item={item({ generatable: true })} onSubmit={onSubmit} />
    );
    fireEvent.click(container.querySelector('button'));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith('GEMINI-API-KEY', { generate: true })
    );
  });
});

describe('the page', () => {
  it('loads status once auth is ready and groups by section', async () => {
    render(<ApiKeysPage />);
    await waitFor(() => expect(screen.getByText('AI & generation')).toBeTruthy());
    expect(getJSON).toHaveBeenCalledWith('cms/secrets');
    expect(screen.getByText('Google Gemini')).toBeTruthy();
  });

  it('hides a section that has no secrets rather than showing an empty heading', async () => {
    getJSON.mockResolvedValue({
      success: true,
      sections: [
        { id: 'ai', title: 'AI & generation', blurb: 'AI keys.' },
        { id: 'ghost', title: 'Empty Section', blurb: 'Nothing here.' },
      ],
      secrets: [item()],
    });
    render(<ApiKeysPage />);
    await waitFor(() => expect(screen.getByText('AI & generation')).toBeTruthy());
    expect(screen.queryByText('Empty Section')).toBeNull();
  });

  it('PUTs to the same route it read from', async () => {
    render(<ApiKeysPage />);
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

  it('surfaces the API’s own message rather than inventing one', async () => {
    sendJSON.mockResolvedValue({
      success: true,
      message: 'Stored. It goes live within 24 hours or at the next deploy (HTTP 403).',
    });
    render(<ApiKeysPage />);
    await waitFor(() => expect(screen.getByText('Google Gemini')).toBeTruthy());

    fireEvent.submit(screen.getByLabelText('New value for Google Gemini').closest('form'));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringContaining('within 24 hours') })
      )
    );
  });

  it('reports a refused write without clearing the field', async () => {
    sendJSON.mockRejectedValue(new Error('that looks like a placeholder'));
    render(<ApiKeysPage />);
    await waitFor(() => expect(screen.getByText('Google Gemini')).toBeTruthy());

    const input = screen.getByLabelText('New value for Google Gemini');
    fireEvent.change(input, { target: { value: 'changeme' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
    );
    expect(input.value).toBe('changeme');
  });
});
