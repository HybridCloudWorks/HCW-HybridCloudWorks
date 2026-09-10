/**
 * The page's own half of the no-readback promise, and the join that merged
 * two pages into one.
 *
 * The API cannot return a value and the vault role cannot read one, so the only
 * way a credential could reach a screen is if this page rendered something the
 * operator typed back at them. The input is `type="password"` and is cleared on
 * success; these hold that.
 *
 * The rest holds the merge: a service's connection status and its credential
 * are the same subject, so a secret belongs on its service's card and must not
 * also appear in the credential sections below.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import IntegrationsPage, {
  SERVICES,
  STATE_PRESENTATION,
  SecretRow,
  buildIntegrationView,
} from './IntegrationsPage';

const getJSON = vi.fn();
const sendJSON = vi.fn();
const toast = vi.fn();

const postJSON = vi.fn();
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
  DEFAULT_SESSIONIZE_SPEAKER_ID: 'default-speaker',
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
  postJSON.mockReset();
  getIntegrationSettings.mockReset().mockResolvedValue({ sessionizeSpeakerId: 'speaker-42' });
  saveIntegrationSettings.mockReset().mockResolvedValue({ success: true });
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

describe('the page', () => {
  it('loads status once auth is ready and groups by section', async () => {
    render(<IntegrationsPage />);
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
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText('AI & generation')).toBeTruthy());
    expect(screen.queryByText('Empty Section')).toBeNull();
  });

  it('PUTs to the same route it read from', async () => {
    render(<IntegrationsPage />);
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
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText('Google Gemini')).toBeTruthy());

    // Types a value first. This used to submit an empty form, which reached
    // the API only because nothing guarded against it; an empty write is now
    // refused from the keyboard as well as from the disabled button, so the
    // test has to do what an operator does. The assertion is unchanged.
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
    render(<IntegrationsPage />);
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

// ── The merge: a service and its credential are one subject ──────────────────

describe('joining services to credentials', () => {
  const sections = [
    { id: 'social', title: 'Social & audience', blurb: 'Publishing credentials.' },
    { id: 'ai', title: 'AI & generation', blurb: 'AI keys.' },
  ];
  const klaviyoKey = item({
    secret: 'KLAVIYO-PRIVATE-KEY',
    section: 'social',
    label: 'Klaviyo — private key',
  });
  const klaviyoList = item({
    secret: 'KLAVIYO-LIST-ID',
    section: 'social',
    label: 'Klaviyo — list id',
  });
  const telegram = item({
    secret: 'TELEGRAM-BOT-TOKEN',
    section: 'social',
    label: 'Telegram — bot token',
  });

  it('gives a credential to the service that owns it', () => {
    const { serviceCards } = buildIntegrationView({
      sections,
      secrets: [klaviyoKey, klaviyoList, telegram],
    });
    const klaviyo = serviceCards.find((service) => service.id === 'klaviyo');
    expect(klaviyo.items.map((row) => row.secret)).toEqual([
      'KLAVIYO-PRIVATE-KEY',
      'KLAVIYO-LIST-ID',
    ]);
  });

  it('does not list a claimed credential a second time in the sections below', () => {
    // The whole point of the merge. Rotating Klaviyo from the card and from a
    // duplicate row further down would be two paths to one write, and the
    // second would look like a different credential.
    const { otherSections } = buildIntegrationView({
      sections,
      secrets: [klaviyoKey, klaviyoList, telegram],
    });
    const social = otherSections.find((section) => section.id === 'social');
    expect(social.items.map((row) => row.secret)).toEqual(['TELEGRAM-BOT-TOKEN']);
  });

  it('drops a section whose every credential went to a service card', () => {
    const { otherSections } = buildIntegrationView({
      sections,
      secrets: [klaviyoKey, klaviyoList],
    });
    expect(otherSections.map((section) => section.id)).toEqual([]);
  });

  it('renders nothing for a credential a service names but the API did not return', () => {
    // The catalogue can grow a name this page has not been taught yet, and an
    // empty row would read as "not set" for a credential that does not exist.
    const { serviceCards } = buildIntegrationView({ sections, secrets: [] });
    expect(serviceCards.every((service) => service.items.length === 0)).toBe(true);
    expect(serviceCards.map((service) => service.id)).toContain('klaviyo');
  });
});

describe('the service cards', () => {
  const withKlaviyo = () =>
    getJSON.mockResolvedValue({
      success: true,
      sections: [{ id: 'social', title: 'Social & audience', blurb: 'Publishing credentials.' }],
      secrets: [
        item({ secret: 'KLAVIYO-PRIVATE-KEY', section: 'social', label: 'Klaviyo — private key' }),
      ],
    });

  it('carries the test button and the credential row on one card', async () => {
    withKlaviyo();
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText('Klaviyo')).toBeTruthy());

    // The status question and the rotation answer, in one place.
    const card = screen.getByText('Klaviyo').closest('.p-4');
    expect(card.textContent).toContain('Test Connection');
    expect(card.textContent).toContain('KLAVIYO-PRIVATE-KEY');
    expect(within(card).getByLabelText('New value for Klaviyo — private key')).toBeTruthy();
  });

  it('runs the service test through its own proxy and reports the result', async () => {
    withKlaviyo();
    postJSON.mockResolvedValue({ data: [{ id: 'list-1' }, { id: 'list-2' }] });
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText('Klaviyo')).toBeTruthy());

    const card = screen.getByText('Klaviyo').closest('.p-4');
    fireEvent.click(within(card).getByText('Test Connection'));

    await waitFor(() => expect(screen.getByText(/2 list\(s\) visible/)).toBeTruthy());
    expect(postJSON).toHaveBeenCalledWith('klaviyoProxy', { path: '/api/lists/', method: 'GET' });
  });

  it('does not call YouTube a placeholder, because its key has a live consumer', async () => {
    // lib/listen-and-learn/videos.js calls the Data API v3 with
    // YOUTUBE_API_KEY to pick the "watch next" videos beside every episode.
    // The old card read "not wired up yet" behind a Placeholder badge.
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText('YouTube')).toBeTruthy());

    const card = screen.getByText('YouTube').closest('.p-4');
    expect(card.textContent).toContain('Data API v3');
    expect(screen.queryByText('Placeholder')).toBeNull();
    expect(card.textContent).not.toContain('not wired up');
  });

  it('puts the Sessionize speaker id on the Sessionize card, beside the test that uses it', async () => {
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText('Sessionize')).toBeTruthy());

    const speakerInput = await screen.findByLabelText('Sessionize Speaker ID');
    expect(speakerInput.value).toBe('speaker-42');
    expect(screen.getByText('Sessionize')).toBeTruthy();
  });

  it('says why Plaud has no credential row rather than showing none and explaining nothing', async () => {
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText('Plaud')).toBeTruthy());
    const card = screen.getByText('Plaud').closest('.p-4');
    expect(card.textContent).toContain('No Key Vault secret');
  });

  it('names every service the old Connections page did', () => {
    // The merge must not quietly drop one.
    expect(SERVICES.map((service) => service.name)).toEqual([
      'Publer',
      'Plaud',
      'Sessionize',
      'Credly',
      'Linkie',
      'Klaviyo',
      'YouTube',
    ]);
  });
});
