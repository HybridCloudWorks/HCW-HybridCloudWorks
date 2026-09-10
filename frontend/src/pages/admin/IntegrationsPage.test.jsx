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
  SERVICE_GROUPS,
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

const payload = (secrets) => ({
  success: true,
  sections: [{ id: 'gen-ai', title: 'Gen AI', blurb: 'Models that write and draw.' }],
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
  it('loads status once auth is ready and shows the credential under its group', async () => {
    // The heading comes from SERVICE_GROUPS, not from the API's sections - one
    // taxonomy drives both, so a key appears under the same words as the
    // service it belongs to.
    render(<IntegrationsPage />);
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
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText('Gen AI')).toBeTruthy());
    expect(screen.queryByText('Empty Section')).toBeNull();
    // 'Cloud' has neither a service card nor a credential in this payload.
    expect(screen.queryByText('Cloud')).toBeNull();
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
  // Section ids ARE group ids now - one taxonomy for services and credentials
  // alike, so a key is never under a different heading from the service it
  // unlocks.
  const sections = [
    { id: 'communication', title: 'Communication', blurb: 'Publishing credentials.' },
    { id: 'gen-ai', title: 'Gen AI', blurb: 'AI keys.' },
  ];
  const klaviyoKey = item({
    secret: 'KLAVIYO-PRIVATE-KEY',
    section: 'communication',
    label: 'Klaviyo — private key',
  });
  const klaviyoList = item({
    secret: 'KLAVIYO-LIST-ID',
    section: 'communication',
    label: 'Klaviyo — list id',
  });
  // Claimed by the Telegram card, so it is no longer a loose credential.
  const telegram = item({
    secret: 'TELEGRAM-BOT-TOKEN',
    section: 'communication',
    label: 'Telegram — bot token',
  });
  const firecrawl = item({
    secret: 'FIRECRAWL-API-KEY',
    section: 'ai-services',
    label: 'Firecrawl',
  });

  // ── grouping ────────────────────────────────────────────────────────────
  // The fallback below exists so a card cannot silently disappear, and an
  // untested guarantee is not one (Copilot review of 658b9407).

  const GROUPS = [
    { id: 'alpha', title: 'Alpha', blurb: 'a' },
    { id: 'omega', title: 'Omega', blurb: 'o' },
  ];
  const svc = (id, group) => ({ id, group, name: id, url: 'https://x.test', secrets: [] });

  it('sorts cards under their group, in registry order', () => {
    const { serviceGroups } = buildIntegrationView({
      services: [svc('one', 'alpha'), svc('two', 'omega'), svc('three', 'alpha')],
      groups: GROUPS,
    });
    expect(serviceGroups.map((group) => group.id)).toEqual(['alpha', 'omega']);
    expect(serviceGroups[0].cards.map((card) => card.id)).toEqual(['one', 'three']);
    expect(serviceGroups[1].cards.map((card) => card.id)).toEqual(['two']);
  });

  it('drops a group with no cards rather than rendering a bare heading', () => {
    const { serviceGroups } = buildIntegrationView({
      services: [svc('one', 'alpha')],
      groups: GROUPS,
    });
    expect(serviceGroups.map((group) => group.id)).toEqual(['alpha']);
  });

  it('NEVER drops a card whose group does not exist - it falls into the last group', () => {
    // The failure this guards: a typo in `group`, or a group removed from
    // SERVICE_GROUPS, quietly removing a service from the page. A card in the
    // wrong place is visible and fixable; a card that is gone is neither.
    const { serviceGroups } = buildIntegrationView({
      services: [svc('one', 'alpha'), svc('stray', 'nonesuch'), svc('none', undefined)],
      groups: GROUPS,
    });
    const placed = serviceGroups.flatMap((group) => group.cards.map((card) => card.id));
    expect(placed).toContain('stray');
    expect(placed).toContain('none');
    expect(serviceGroups.find((group) => group.id === 'omega').cards.map((c) => c.id)).toEqual([
      'stray',
      'none',
    ]);
  });

  it('places every service exactly once, whatever its group says', () => {
    // The property that matters more than any individual placement rule.
    const services = [
      svc('a', 'alpha'),
      svc('b', 'omega'),
      svc('c', 'nonesuch'),
      svc('d', 'alpha'),
    ];
    const { serviceGroups, serviceCards } = buildIntegrationView({ services, groups: GROUPS });
    const placed = serviceGroups.flatMap((group) => group.cards.map((card) => card.id)).sort();
    expect(placed).toEqual(['a', 'b', 'c', 'd']);
    expect(serviceCards).toHaveLength(4);
  });

  it('survives an empty group list without losing the cards from the page', () => {
    // No groups means nothing can be rendered under a heading, so the caller
    // still has `serviceCards`; what must not happen is a crash.
    const { serviceGroups, serviceCards } = buildIntegrationView({
      services: [svc('one', 'alpha')],
      groups: [],
    });
    expect(serviceGroups).toEqual([]);
    expect(serviceCards.map((card) => card.id)).toEqual(['one']);
  });

  it('groups the real registry with nothing left over', () => {
    const { serviceGroups } = buildIntegrationView({});
    const placed = serviceGroups.flatMap((group) => group.cards.map((card) => card.id));
    expect(placed.sort()).toEqual(SERVICES.map((service) => service.id).sort());
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

  it('never shows a claimed credential twice - on its card and loose in the group', () => {
    // The whole point of the merge. Rotating Klaviyo from the card and from a
    // duplicate row further down would be two paths to one write, and the
    // second would look like a different credential.
    const { serviceGroups } = buildIntegrationView({
      sections,
      secrets: [klaviyoKey, klaviyoList, telegram, firecrawl],
    });
    const communication = serviceGroups.find((group) => group.id === 'communication');
    const onCards = communication.cards.flatMap((card) => card.items.map((row) => row.secret));
    expect(onCards).toContain('KLAVIYO-PRIVATE-KEY');
    expect(onCards).toContain('TELEGRAM-BOT-TOKEN');
    // Everything in this group belongs to a card, so nothing is left loose.
    expect(communication.loose).toEqual([]);
  });

  it('shows a credential with no service card as a loose row in its own group', () => {
    // Firecrawl has no card. It must still appear, under AI services, rather
    // than falling off the page because nothing claimed it.
    const { serviceGroups } = buildIntegrationView({ sections, secrets: [firecrawl] });
    const aiServices = serviceGroups.find((group) => group.id === 'ai-services');
    expect(aiServices.loose.map((row) => row.secret)).toEqual(['FIRECRAWL-API-KEY']);
    expect(aiServices.cards).toEqual([]);
  });

  it('gives a credential whose group this page does not know a heading of its own', () => {
    // The safety net. A key nobody can see is a key nobody can rotate, so an
    // unknown section gets its own heading rather than silence.
    const stray = item({ secret: 'STRAY-KEY', section: 'nowhere', label: 'Stray' });
    const { orphanSections, serviceGroups } = buildIntegrationView({
      sections,
      secrets: [stray],
    });
    expect(orphanSections.map((section) => section.id)).toEqual(['nowhere']);
    expect(orphanSections[0].items.map((row) => row.secret)).toEqual(['STRAY-KEY']);
    const placed = serviceGroups.flatMap((group) => group.loose.map((row) => row.secret));
    expect(placed).not.toContain('STRAY-KEY');
  });

  it('leaves nothing loose when every credential went to a service card', () => {
    const { serviceGroups, orphanSections } = buildIntegrationView({
      sections,
      secrets: [klaviyoKey, klaviyoList],
    });
    expect(orphanSections).toEqual([]);
    for (const group of serviceGroups) {
      expect(group.loose, `${group.id} has loose credentials`).toEqual([]);
    }
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
      sections: [{ id: 'communication', title: 'Communication', blurb: 'Publishing credentials.' }],
      secrets: [
        item({
          secret: 'KLAVIYO-PRIVATE-KEY',
          section: 'communication',
          label: 'Klaviyo — private key',
        }),
      ],
    });

  it('carries the test button and the credential row on one card', async () => {
    withKlaviyo();
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText('Klaviyo')).toBeTruthy());

    // The status question and the rotation answer, in one place. The test
    // control is an icon button now - a beaker - so it is found by its label
    // rather than by the words that used to wrap the header row.
    const card = screen.getByText('Klaviyo').closest('.p-4');
    expect(within(card).getByRole('button', { name: /^Test Klaviyo$/ })).toBeTruthy();
    expect(card.textContent).toContain('KLAVIYO-PRIVATE-KEY');
    expect(within(card).getByLabelText('New value for Klaviyo — private key')).toBeTruthy();
  });

  it('runs the service test through its own proxy and reports the result', async () => {
    withKlaviyo();
    // THE REAL ENVELOPE. This mocked `{ data: [...] }` - the envelope's shape
    // minus its `ok`, which the proxy always sets - so it was asserting
    // against a response the server has never sent, and passed only because
    // nothing checked `ok`. klaviyoProxy answers `{ ok, status, data }` where
    // `data` is Klaviyo's own `{ data: [...] }` body.
    postJSON.mockResolvedValue({
      ok: true,
      status: 200,
      data: { data: [{ id: 'list-1' }, { id: 'list-2' }] },
    });
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText('Klaviyo')).toBeTruthy());

    const card = screen.getByText('Klaviyo').closest('.p-4');
    fireEvent.click(within(card).getByRole('button', { name: /^Test Klaviyo$/ }));

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
    // The description is shorter now and names the consumer rather than the
    // API version; what must not come back is the claim that it is unused.
    expect(card.textContent).toContain('watch next');
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
    // The note must explain the OTHER sign-in - the one with no row here -
    // without naming a database document, an issue number or a file path. A
    // reader of this page has never seen the repository.
    expect(card.textContent).toContain('12 hours');
    expect(card.textContent).toContain('Recording Hub');
    expect(card.textContent).not.toMatch(/mcp_servers|#\d{3}|\.js\b/);
  });

  it('still names every service the old Connections page did', () => {
    // The original seven. The order changed when the cards were sorted into
    // groups and three education profiles were added, so this asserts
    // PRESENCE rather than sequence - dropping one is the failure it guards.
    const names = SERVICES.map((service) => service.name);
    for (const name of [
      'Publer',
      'Plaud',
      'Sessionize',
      'Credly',
      'Linkie',
      'Klaviyo',
      'YouTube',
    ]) {
      expect(names, `${name} disappeared from the registry`).toContain(name);
    }
  });

  it('lists exactly the services it means to, in group order', () => {
    expect(SERVICES.map((service) => service.name)).toEqual([
      'Publer',
      'Klaviyo',
      'Linkie',
      'Telegram',
      'RSS.com',
      'YouTube',
      'Plaud',
      'Sessionize',
      'Credly',
      'Microsoft Learn',
      'AWS Skill Builder',
      'Google Developer',
    ]);
  });

  it('gives every service a URL, since that is the one thing they all have', () => {
    // A card with no globe is a dead end: no key to rotate, no test to run and
    // nowhere to go. Education profiles have only the globe, which is the
    // whole reason they are on the page.
    for (const service of SERVICES) {
      expect(service.url, `${service.name} has no url`).toMatch(/^https:\/\//);
    }
  });

  it('sends a credential with no test straight to the page that manages it', () => {
    // No beaker means the globe is the only thing this page can do about a red
    // light, so it has to land where the credential is minted - not on the
    // vendor's front door. A bare host would be a shrug.
    //
    // This used to assert the set was non-empty, because a vacuous rule is its
    // own kind of broken. #483 emptied it legitimately - Telegram, RSS.com and
    // YouTube were the last three and they all have server-side tests now - so
    // that guard would fail for the right reason, which makes it the wrong
    // guard. It is replaced by the test below, which pins the set to empty
    // rather than to non-empty. The rule here still stands and starts holding
    // again the moment anything joins the set.
    const untestable = SERVICES.filter(
      (service) => !service.test && (service.secrets ?? []).length > 0
    );
    for (const service of untestable) {
      const { pathname } = new URL(service.url);
      expect(
        pathname.replace(/\/+$/, '').length,
        `${service.name} points at a bare host (${service.url}) with no test beside it`
      ).toBeGreaterThan(0);
    }
  });

  it('leaves no credentialed service untestable, which is what #483 closed', () => {
    // The replacement for the vacuousness guard above. Every service that
    // holds a credential can now be asked whether it works, including the
    // three whose keys never reach the browser - those run server-side through
    // `connectionProbe`. Adding a credentialed service with no test is allowed,
    // but it has to be a decision made HERE, in the open, at which point the
    // globe rule above starts applying to it.
    const untestable = SERVICES.filter(
      (service) => !service.test && (service.secrets ?? []).length > 0
    ).map((service) => service.name);
    expect(untestable).toEqual([]);
  });

  describe('the three server-side probes (#483)', () => {
    // Exercised through SERVICES rather than by importing the runners, because
    // the field IS the contract: the card calls whatever sits in `test`.
    const runnerFor = (id) => SERVICES.find((service) => service.id === id).test;

    beforeEach(() => postJSON.mockReset());

    it('posts a probe NAME, never a path or a method', async () => {
      // The whole security argument for this route is that the caller supplies
      // no part of the outbound request. A runner that started sending a path
      // would silently undo it, so the shape is pinned here.
      for (const [id, probe] of [
        ['telegram', 'telegram'],
        ['rsscom', 'rsscom'],
        ['youtube', 'youtube'],
      ]) {
        postJSON.mockResolvedValueOnce({ ok: true, status: 200, data: {} });
        await runnerFor(id)();
        expect(postJSON).toHaveBeenLastCalledWith('connectionProbe', { probe });
      }
    });

    it('throws on a refusal instead of reporting Connected', async () => {
      // #463 item 1 and #479: the proxies answer HTTP 200 for every outcome,
      // so a runner that does not read `ok` says Connected for a 401. That
      // defect has now been written three times in this file's history, which
      // is why every new runner gets this test.
      for (const id of ['telegram', 'rsscom', 'youtube']) {
        postJSON.mockResolvedValueOnce({
          ok: false,
          status: 401,
          error: 'Unauthorized',
          data: { description: 'Unauthorized' },
        });
        await expect(runnerFor(id)(), id).rejects.toThrow(/Unauthorized/);
      }
    });

    it('names the bot a Telegram token belongs to, which is the useful half', async () => {
      postJSON.mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { ok: true, result: { username: 'hcw_bot' } },
      });
      await expect(runnerFor('telegram')()).resolves.toContain('@hcw_bot');
    });

    it('counts the shows an RSS.com key can see', async () => {
      postJSON.mockResolvedValueOnce({ ok: true, status: 200, data: [{ id: 1 }, { id: 2 }] });
      await expect(runnerFor('rsscom')()).resolves.toContain('2 show(s)');
    });

    it('says what a YouTube press costs, because pressing it spends quota', async () => {
      postJSON.mockResolvedValueOnce({ ok: true, status: 200, data: { items: [] } });
      await expect(runnerFor('youtube')()).resolves.toMatch(/quota/i);
    });
  });

  it('puts every service in a group that exists', () => {
    const ids = new Set(SERVICE_GROUPS.map((group) => group.id));
    for (const service of SERVICES) {
      expect(ids, `${service.name} is in group '${service.group}'`).toContain(service.group);
    }
  });
});
