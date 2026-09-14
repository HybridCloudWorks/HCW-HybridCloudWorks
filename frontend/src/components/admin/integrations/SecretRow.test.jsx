/**
 * The Keys tab's row: the page's own half of the no-readback promise (moved
 * from IntegrationsPage.test.jsx, #570).
 *
 * The API cannot return a value and the vault role cannot read one, so the only
 * way a credential could reach a screen is if this row rendered something the
 * operator typed back at them. The input is `type="password"` and is cleared on
 * success; these hold that.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { SecretRow } from './SecretRow';
import { STATE_PRESENTATION } from './StateDot';

// The API's real shape. `section` is a GROUP id now - the same vocabulary the
// page renders headings from - and `help` is written the way the catalogue
// writes it: what kind of value, what it does here, no repository jargon.
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

describe('saving a value', () => {
  it('has a Save button, because Enter is not a control on a phone', async () => {
    // This form had no submit control at all: the only way to store a pasted
    // value was to press Enter in the field. On a mobile keyboard the return
    // key is not reliably a form submit, so a value could be pasted with no
    // way to save it - reported from a phone while correcting
    // PUBLER-WORKSPACE-ID, which is not generatable and so had no button of
    // any kind beside it.
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<SecretRow item={item({ state: 'live', generatable: false })} onSubmit={onSubmit} />);

    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeTruthy();

    // Disabled with nothing to send, so it cannot fire an empty write.
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/New value for/), {
      target: { value: '68ca33f83b3adc54100358cc' },
    });
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.any(String), {
        value: '68ca33f83b3adc54100358cc',
      })
    );
  });

  it('shows only an icon, never the word Save, but stays named for screen readers', () => {
    render(<SecretRow item={item({ state: 'live', generatable: false })} onSubmit={vi.fn()} />);
    const save = screen.getByRole('button', { name: /^Save / });
    // No visible text: the label lives on aria-label so the control is still
    // named without the word competing with the icon.
    expect(save.textContent.trim()).toBe('');
    expect(save.getAttribute('aria-label')).toMatch(/^Save /);
  });

  it('says "Saving…" on the row while a write is in flight', () => {
    // A Key Vault write plus an ARM reference refresh plus a page reload runs
    // for seconds. A spinner inside one small button is easy to miss on a
    // phone, so the row says so in words too - without it the page reads as
    // frozen.
    render(
      <SecretRow item={item({ state: 'live', generatable: false })} onSubmit={vi.fn()} busy />
    );
    expect(screen.getByText(/Saving/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Saving / })).toBeTruthy();
  });

  it('hides the old status while saving, so it cannot be read as the new one', () => {
    const props = { state: 'failing', lastFailStatus: 401, lastFailDetail: 'nope' };
    const { rerender } = render(<SecretRow item={item(props)} onSubmit={vi.fn()} />);
    expect(screen.getByText(/HTTP 401/)).toBeTruthy();

    rerender(<SecretRow item={item(props)} onSubmit={vi.fn()} busy />);
    expect(screen.queryByText(/HTTP 401/)).toBeNull();
    expect(screen.queryByText(/Rejected/)).toBeNull();
    expect(screen.getByText(/Saving/)).toBeTruthy();
  });

  it('stays disabled for whitespace, which is not a credential', () => {
    render(<SecretRow item={item({ state: 'live', generatable: false })} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/New value for/), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /save/i }).disabled).toBe(true);
  });

  it('refuses an empty or whitespace submit from Enter too, not just from the button', async () => {
    // Disabling the button closes one of two doors. Enter still reaches the
    // form's onSubmit, so the guard has to live there as well or the keyboard
    // path fires a write the button refuses to (Copilot review of 215eeb5b).
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<SecretRow item={item({ state: 'live', generatable: false })} onSubmit={onSubmit} />);
    const input = screen.getByLabelText(/New value for/);

    fireEvent.submit(input.closest('form'));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('still submits on Enter, so the keyboard path is not lost', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<SecretRow item={item({ state: 'never', generatable: false })} onSubmit={onSubmit} />);
    const input = screen.getByLabelText(/New value for/);
    fireEvent.change(input, { target: { value: 'a-real-looking-value' } });
    fireEvent.submit(input.closest('form'));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.any(String), { value: 'a-real-looking-value' })
    );
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

  it("shows the provider's own sentence beside the status, not just the number", () => {
    // `HTTP 401` alone sent #358 into two days of reminting a key. "Missing or
    // invalid Authorization header" says the request is malformed — our bug —
    // and a revoked-key message says it is not; both are the same red light.
    render(
      <SecretRow
        item={item({
          state: 'failing',
          lastFailStatus: 401,
          lastFailDetail: 'Missing or invalid Authorization header',
        })}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByText(/HTTP 401/)).toBeTruthy();
    expect(screen.getByText(/Missing or invalid Authorization header/)).toBeTruthy();
  });

  it('shows nothing extra when the provider gave no reason', () => {
    render(<SecretRow item={item({ state: 'failing', lastFailStatus: 500 })} onSubmit={vi.fn()} />);
    expect(screen.getByText(/HTTP 500/).textContent).not.toMatch(/—/);
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
  // These used to count buttons, which worked only while the generate button
  // was the ONLY button in the row. Every row now carries a Save button, so
  // they identify the generate control by its title instead - the assertion
  // they were always making.
  const generateButton = () => screen.queryByTitle(/Generate a random value/);

  it('is offered only for values this estate invents', () => {
    const { rerender } = render(
      <SecretRow item={item({ generatable: false })} onSubmit={vi.fn()} />
    );
    expect(generateButton()).toBeNull();
    // ...while Save is there either way, since any row can be pasted into.
    expect(screen.getByRole('button', { name: /save/i })).toBeTruthy();

    rerender(<SecretRow item={item({ generatable: true })} onSubmit={vi.fn()} />);
    expect(generateButton()).toBeTruthy();
  });

  it('sends generate without a value', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<SecretRow item={item({ generatable: true })} onSubmit={onSubmit} />);
    fireEvent.click(generateButton());
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith('GEMINI-API-KEY', { generate: true })
    );
  });
});

describe('used by (#570)', () => {
  it('names the services that use the key, and says nothing when none do', () => {
    const { rerender } = render(
      <SecretRow item={item({ usedBy: ['Publer', 'Social Hub'] })} onSubmit={vi.fn()} />
    );
    expect(screen.getByText('Publer, Social Hub')).toBeTruthy();

    rerender(<SecretRow item={item({ usedBy: [] })} onSubmit={vi.fn()} />);
    expect(screen.queryByText(/Used by/)).toBeNull();
  });
});
