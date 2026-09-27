/**
 * The Podcast voices picker (#725): the owner hears each voice and saves one
 * per host.
 *
 * Pinned: the list is asked for only with a key; a voice the plan does not
 * allow is shown, disabled, with the server's reason, never hidden; Save
 * sends exactly { Maya, Elena } to the platform-settings route and is held
 * back until both are chosen and different; a preview is fetched with the
 * token from the proxy route and played through Web Audio (the CSP admits
 * no third-party or blob: media), once per voice, and a second click stops
 * it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import PodcastVoices, {
  ELEVENLABS_VOICES_ROUTE,
  MY_VOICES_PAGE,
  PODCAST_HOSTS,
  previewRoute,
  useVoiceList,
  voiceLabel,
} from './PodcastVoices';
import { settingRoute, useSetting } from './settingShared';

const getJSON = vi.fn();
const sendJSON = vi.fn();
const authedFetch = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
  postJSON: vi.fn(),
  authedFetch: (...args) => authedFetch(...args),
}));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

const TALIA = 'TaliaVoice0000000001';
const ELARA = 'ElaraVoice0000000002';
const EMMA = 'EmmaVoice00000000003';

const voice = (over) => ({
  voiceId: TALIA,
  name: 'Talia',
  category: 'premade',
  type: 'default',
  labels: {
    gender: 'female',
    accent: 'american',
    age: 'young',
    description: 'warm',
    useCase: null,
  },
  description: null,
  legacy: false,
  tiers: [],
  hasPreview: true,
  usable: true,
  unavailableReason: null,
  ...over,
});

const LIBRARY_REASON =
  'Voice Library voice: the free plan cannot use it through the API (HTTP 402 paid_plan_required).';

const LIST = {
  success: true,
  configured: true,
  rule: 'On the free plan ElevenLabs lets the API use your own voices and its default voices, not Voice Library voices.',
  plan: { tier: 'free', freePlan: true },
  subscriptionError: null,
  voices: [
    voice(),
    voice({
      voiceId: ELARA,
      name: 'Elara',
      type: 'own',
      labels: { gender: 'female', accent: 'british' },
    }),
    voice({
      voiceId: EMMA,
      name: 'Emma',
      type: 'library',
      category: 'professional',
      usable: false,
      unavailableReason: LIBRARY_REASON,
    }),
  ],
  truncated: false,
  voicesError: null,
};

const UNSET = {
  success: true,
  setting: 'podcast-voices',
  value: { Maya: '', Elena: '' },
  exists: false,
  stored: null,
  updatedAt: null,
};

let answers;

function Harness({ configured = true }) {
  const setting = useSetting('podcast-voices', true);
  return <PodcastVoices setting={setting} configured={configured} />;
}

/** A Web Audio stand-in: records the contexts and sources the picker makes. */
let contexts;
let sources;
class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.destination = {};
    this.decodeAudioData = vi.fn(async (bytes) => ({ decodedFrom: bytes.byteLength }));
    this.close = vi.fn();
    contexts.push(this);
  }

  createBufferSource() {
    const source = { connect: vi.fn(), start: vi.fn(), onended: null };
    source.stop = vi.fn(() => source.onended?.());
    sources.push(source);
    return source;
  }
}

beforeEach(() => {
  answers = { list: LIST, voices: UNSET };
  getJSON.mockReset().mockImplementation(async (route) => {
    if (route === ELEVENLABS_VOICES_ROUTE) {
      if (answers.list instanceof Error) throw answers.list;
      return answers.list;
    }
    if (route === settingRoute('podcast-voices')) return answers.voices;
    throw new Error(`unexpected route ${route}`);
  });
  sendJSON.mockReset().mockImplementation(async (_route, _method, body) => ({
    success: true,
    setting: 'podcast-voices',
    value: body,
    exists: true,
    stored: 'valid',
    updatedAt: '2026-09-26T12:00:00.000Z',
  }));
  authedFetch.mockReset().mockImplementation(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  }));
  toast.mockReset();
  contexts = [];
  sources = [];
  window.AudioContext = FakeAudioContext;
});

afterEach(() => {
  delete window.AudioContext;
});

describe('PodcastVoices', () => {
  it('asks for the list only with a key, and says to seed it otherwise', async () => {
    render(<Harness configured={false} />);
    expect(await screen.findByText(/Seed the ElevenLabs key first/)).toBeTruthy();
    expect(getJSON).not.toHaveBeenCalledWith(ELEVENLABS_VOICES_ROUTE);
  });

  it('says the previews cost no credits, so they are the first thing to reach for', async () => {
    render(<Harness />);
    expect(
      await screen.findByText("Previews are ElevenLabs's samples and cost no credits.")
    ).toBeTruthy();
  });

  it('uses a list its card holds instead of loading its own', async () => {
    function Held() {
      const setting = useSetting('podcast-voices', true);
      const voiceList = useVoiceList(true);
      return <PodcastVoices setting={setting} configured voiceList={voiceList} />;
    }
    render(<Held />);
    const maya = await screen.findByLabelText('Maya');
    await within(maya).findByText('Talia — female, american, young');
    expect(getJSON.mock.calls.filter(([route]) => route === ELEVENLABS_VOICES_ROUTE)).toHaveLength(
      1
    );
  });

  it('offers the usable voices per host and shows the others disabled, with the reason', async () => {
    render(<Harness />);
    const maya = await screen.findByLabelText('Maya');
    await within(maya).findByText('Talia — female, american, young');

    const usable = within(maya).getByRole('group', { name: 'Usable on this plan' });
    expect(
      within(usable)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Talia — female, american, young', 'Elara — female, british']);
    const unavailable = within(maya).getByRole('group', { name: 'Not available on this plan' });
    const emma = within(unavailable).getByRole('option');
    expect(emma.textContent).toBe(`Emma — female, american, young — ${LIBRARY_REASON}`);
    expect(emma.disabled).toBe(true);

    // The full list says the same, beside a play button for every voice.
    expect(screen.getByText('All voices: 2 usable, 1 not available on this plan')).toBeTruthy();
    expect(screen.getByText(`Not available: ${LIBRARY_REASON}`)).toBeTruthy();
    const rows = within(screen.getByRole('list', { name: 'ElevenLabs voices' })).getAllByRole(
      'listitem'
    );
    expect(rows).toHaveLength(3);
    for (const row of rows)
      expect(within(row).getByRole('button', { name: /^Play / })).toBeTruthy();
    expect(screen.getByText(/not Voice Library voices/)).toBeTruthy();
    expect(PODCAST_HOSTS).toEqual(['Maya', 'Elena']);
  });

  it('saves exactly { Maya, Elena } to the platform-settings route, only once both are chosen', async () => {
    render(<Harness />);
    const maya = await screen.findByLabelText('Maya');
    await within(maya).findByText('Talia — female, american, young');
    const save = screen.getByRole('button', { name: /Save/ });
    expect(save.disabled).toBe(true);

    fireEvent.change(maya, { target: { value: TALIA } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Elena'), { target: { value: ELARA } });
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith(settingRoute('podcast-voices'), 'PUT', {
        Maya: TALIA,
        Elena: ELARA,
      })
    );
    expect(sendJSON).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Saved' }))
    );
  });

  it('will not save one voice for both hosts, and says why', async () => {
    render(<Harness />);
    const maya = await screen.findByLabelText('Maya');
    await within(maya).findByText('Talia — female, american, young');
    fireEvent.change(maya, { target: { value: TALIA } });
    fireEvent.change(screen.getByLabelText('Elena'), { target: { value: TALIA } });
    expect(screen.getByText(/Maya and Elena need different voices/)).toBeTruthy();
    const save = screen.getByRole('button', { name: /Save/ });
    expect(save.disabled).toBe(true);
    fireEvent.submit(save.closest('form'));
    expect(sendJSON).not.toHaveBeenCalled();
  });

  it('shows the saved pair selected, and a saved id the list no longer has rather than dropping it', async () => {
    answers.voices = {
      ...UNSET,
      value: { Maya: TALIA, Elena: 'GoneVoice00000000009' },
      exists: true,
      stored: 'valid',
    };
    render(<Harness />);
    const maya = await screen.findByLabelText('Maya');
    await within(maya).findByText('Talia — female, american, young');
    expect(maya.value).toBe(TALIA);
    const elena = screen.getByLabelText('Elena');
    expect(elena.value).toBe('GoneVoice00000000009');
    expect(
      within(elena).getByText("GoneVoice00000000009 (saved; not in this key's list)")
    ).toBeTruthy();
  });

  it('plays a preview from the proxy route through Web Audio, fetches it once, and stops on a second click', async () => {
    render(<Harness />);
    const row = (await screen.findByText('Talia', { selector: 'p' })).closest('li');
    const play = within(row).getByRole('button', { name: 'Play Talia' });

    fireEvent.click(play);
    await waitFor(() => expect(sources).toHaveLength(1));
    expect(authedFetch).toHaveBeenCalledWith(previewRoute(TALIA), {
      method: 'GET',
      headers: { Accept: 'audio/mpeg' },
    });
    expect(previewRoute(TALIA)).toBe(`cms/podcast/elevenlabs/voices/${TALIA}/preview`);
    expect(contexts[0].decodeAudioData).toHaveBeenCalledTimes(1);
    expect(sources[0].buffer).toEqual({ decodedFrom: 8 });
    expect(sources[0].connect).toHaveBeenCalledWith(contexts[0].destination);
    expect(sources[0].start).toHaveBeenCalled();
    const stop = await within(row).findByRole('button', { name: 'Stop Talia' });

    fireEvent.click(stop);
    expect(sources[0].stop).toHaveBeenCalled();
    await within(row).findByRole('button', { name: 'Play Talia' });

    // Played again: the decoded buffer is reused, nothing is fetched.
    fireEvent.click(within(row).getByRole('button', { name: 'Play Talia' }));
    await waitFor(() => expect(sources).toHaveLength(2));
    expect(authedFetch).toHaveBeenCalledTimes(1);
    expect(contexts).toHaveLength(1);
  });

  it('stops one preview when another starts', async () => {
    render(<Harness />);
    const talia = (await screen.findByText('Talia', { selector: 'p' })).closest('li');
    const elara = screen.getByText('Elara', { selector: 'p' }).closest('li');
    fireEvent.click(within(talia).getByRole('button', { name: 'Play Talia' }));
    await waitFor(() => expect(sources).toHaveLength(1));
    fireEvent.click(within(elara).getByRole('button', { name: 'Play Elara' }));
    await waitFor(() => expect(sources).toHaveLength(2));
    expect(sources[0].stop).toHaveBeenCalled();
    expect(authedFetch).toHaveBeenLastCalledWith(previewRoute(ELARA), expect.anything());
  });

  it('offers a play button beside a host’s chosen voice', async () => {
    render(<Harness />);
    const maya = await screen.findByLabelText('Maya');
    await within(maya).findByText('Talia — female, american, young');
    expect(screen.queryByRole('button', { name: "Play Maya's voice" })).toBeNull();
    fireEvent.change(maya, { target: { value: TALIA } });
    fireEvent.click(screen.getByRole('button', { name: "Play Maya's voice" }));
    await waitFor(() =>
      expect(authedFetch).toHaveBeenCalledWith(previewRoute(TALIA), expect.anything())
    );
  });

  it('says so when the browser has no Web Audio, or the preview is refused', async () => {
    delete window.AudioContext;
    render(<Harness />);
    const row = (await screen.findByText('Talia', { selector: 'p' })).closest('li');
    fireEvent.click(within(row).getByRole('button', { name: 'Play Talia' }));
    expect(
      await screen.findByText(/Preview: This browser cannot play the preview here/)
    ).toBeTruthy();
    expect(authedFetch).not.toHaveBeenCalled();

    window.AudioContext = FakeAudioContext;
    authedFetch.mockRejectedValueOnce(
      new Error('ElevenLabs has no preview for this voice on its preview host.')
    );
    fireEvent.click(within(row).getByRole('button', { name: 'Play Talia' }));
    expect(
      await screen.findByText(
        'Preview: ElevenLabs has no preview for this voice on its preview host.'
      )
    ).toBeTruthy();
  });

  it('disables play for a voice with no preview', async () => {
    answers.list = { ...LIST, voices: [voice({ hasPreview: false })] };
    render(<Harness />);
    const row = (await screen.findByText('Talia', { selector: 'p' })).closest('li');
    expect(within(row).getByRole('button', { name: 'Play Talia' }).disabled).toBe(true);
  });

  it('shows a refused list with its fix, and a failed one with a retry', async () => {
    const fix =
      'Could not list the ElevenLabs voices (HTTP 401 missing_permissions: the key needs the Voices → Read permission (voices_read), set at https://elevenlabs.io/app/developers/api-keys).';
    answers.list = { ...LIST, voices: [], voicesError: fix };
    const { unmount } = render(<Harness />);
    expect(await screen.findByText(fix)).toBeTruthy();
    unmount();

    answers.list = new Error('HTTP 500');
    render(<Harness />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Voices: HTTP 500');
    answers.list = LIST;
    fireEvent.click(within(alert).getByRole('button', { name: /Retry/ }));
    expect(
      await screen.findByText('All voices: 2 usable, 1 not available on this plan')
    ).toBeTruthy();
  });

  it('says what to do when the plan allows none of the listed voices', async () => {
    answers.list = {
      ...LIST,
      voices: [LIST.voices[2]],
    };
    render(<Harness />);
    expect(
      await screen.findByText(/None of these voices can be used through the API on this plan/)
    ).toBeTruthy();
    const note = screen.getByText(/None of these voices can be used through the API on this plan/);
    expect(note.textContent).toContain(MY_VOICES_PAGE);
  });

  it('labels a voice by name and the traits a host is chosen by', () => {
    expect(voiceLabel(voice())).toBe('Talia — female, american, young');
    expect(voiceLabel(voice({ labels: {} }))).toBe('Talia');
  });
});
