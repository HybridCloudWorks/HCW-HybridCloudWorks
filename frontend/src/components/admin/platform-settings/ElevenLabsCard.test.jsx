/**
 * The podcast voice card (#432, 2026-09-26): "not configured" reads as a
 * state, not a failure; a configured key shows the plan, the credits, the
 * reset date and what the last render billed; the free plan says it is not
 * published; and the live check runs only on a click, once, and shows the
 * audio, the characters billed and the credits left, or the server's refusal
 * word for word.
 *
 * Since #725 the card also holds the Podcast voices picker (its own tests are
 * in PodcastVoices.test.jsx); here, the live check waits for a saved pair and
 * a paid-only voice points at the picker.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import ElevenLabsCard, { ELEVENLABS_SAMPLE_ROUTE, ELEVENLABS_STATUS_ROUTE } from './ElevenLabsCard';
import { ELEVENLABS_VOICES_ROUTE } from './PodcastVoices';
import { settingRoute } from './settingShared';

const getJSON = vi.fn();
const postJSON = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  postJSON: (...args) => postJSON(...args),
  sendJSON: vi.fn(),
  authedFetch: vi.fn(),
}));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/functionsBase', () => ({
  resolveMediaUrl: (url) => `https://api.example.test${url}`,
}));

const SAMPLE = { characters: 257, turns: 2 };

const UNSEEDED = {
  success: true,
  configured: false,
  reason:
    'ELEVENLABS_API_KEY is not configured. Create a key at https://elevenlabs.io/app/developers/api-keys and seed it as the ELEVENLABS-API-KEY secret at https://hybridcloudworks.com/admin/integrations?tab=keys.',
  subscription: null,
  subscriptionError: null,
  lastRender: null,
  lastRenderError: null,
  sample: SAMPLE,
};

const FREE_MONTH = {
  success: true,
  configured: true,
  reason: null,
  subscription: {
    tier: 'free',
    status: 'free',
    freePlan: true,
    creditsUsed: 8912,
    creditLimit: 10000,
    creditsLeft: 1088,
    overageCredits: 0,
    resetAt: '2026-10-26T00:00:00.000Z',
  },
  subscriptionError: null,
  lastRender: {
    characters: 8912,
    estimated: false,
    at: null,
    source: 'podcast:audio',
    model: 'eleven_v3',
  },
  lastRenderError: null,
  sample: SAMPLE,
};

const RENDERED = {
  ok: true,
  audioUrl: '/api/public/media/podcast/sample/elevenlabs-live-check.mp3?v=1790000000000',
  audioError: null,
  charactersBilled: 257,
  billedEstimated: false,
  creditsLeftBefore: 10000,
  creditsLeft: 9743,
  creditLimit: 10000,
  tier: 'free',
  freePlan: true,
};

/** The saved podcast voices (#725), as the platform-settings route answers. */
const SAVED_VOICES = {
  success: true,
  setting: 'podcast-voices',
  value: { Maya: 'MayaVoice00000000001', Elena: 'ElenaVoice0000000002' },
  exists: true,
  stored: 'valid',
  updatedAt: '2026-09-26T12:00:00.000Z',
};
const NO_VOICES = {
  success: true,
  setting: 'podcast-voices',
  value: { Maya: '', Elena: '' },
  exists: false,
  stored: null,
  updatedAt: null,
};
const VOICE_LIST = {
  success: true,
  configured: true,
  rule: 'On the free plan ElevenLabs lets the API use your own voices and its default voices, not Voice Library voices.',
  plan: { tier: 'free', freePlan: true },
  subscriptionError: null,
  voices: [],
  truncated: false,
  voicesError: null,
};

/**
 * One answer per route. `status` is what the ElevenLabs status route returns
 * (a value, or a function for a sequence); `voices` is the saved setting.
 */
let answers;
const routeAnswer = async (route) => {
  if (route === ELEVENLABS_STATUS_ROUTE) {
    return typeof answers.status === 'function' ? answers.status() : answers.status;
  }
  if (route === settingRoute('podcast-voices')) return answers.voices;
  if (route === ELEVENLABS_VOICES_ROUTE) return VOICE_LIST;
  throw new Error(`unexpected route ${route}`);
};
const statusReads = () =>
  getJSON.mock.calls.filter(([route]) => route === ELEVENLABS_STATUS_ROUTE).length;

beforeEach(() => {
  answers = { status: FREE_MONTH, voices: SAVED_VOICES };
  getJSON.mockReset().mockImplementation(routeAnswer);
  postJSON.mockReset();
  toast.mockReset();
});

describe('ElevenLabsCard', () => {
  it('shows "Not configured" and the sentence that says how to seed it, as a state rather than an error', async () => {
    answers.status = UNSEEDED;
    render(<ElevenLabsCard authReady />);
    expect(await screen.findByText('Not configured')).toBeTruthy();
    expect(screen.getByText(/ELEVENLABS-API-KEY secret/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    // Nothing to check without a key.
    expect(screen.getByRole('button', { name: /Run live check/ }).disabled).toBe(true);
    expect(getJSON).toHaveBeenCalledWith(ELEVENLABS_STATUS_ROUTE);
    // Without a key there is no list to ask for.
    expect(getJSON).not.toHaveBeenCalledWith(ELEVENLABS_VOICES_ROUTE);
  });

  it('shows the plan, the credits used of the limit, the reset date and what the last render billed', async () => {
    render(<ElevenLabsCard authReady />);
    expect(await screen.findByText('free (free)')).toBeTruthy();
    expect(screen.getByText('8,912 used of 10,000, 1,088 left')).toBeTruthy();
    expect(screen.getByText('2026-10-26 (UTC)')).toBeTruthy();
    expect(screen.getByText('Last render billed 8,912 characters, an episode')).toBeTruthy();
  });

  it('says a free-plan episode is not published, and why', async () => {
    render(<ElevenLabsCard authReady />);
    expect(await screen.findByText(/Free plan: no commercial licence/)).toBeTruthy();
    expect(screen.getByText(/never\s+published to RSS\.com; approval refuses them/)).toBeTruthy();
  });

  it('does not show the free-plan note on a paid plan', async () => {
    answers.status = {
      ...FREE_MONTH,
      subscription: {
        ...FREE_MONTH.subscription,
        tier: 'creator',
        status: 'active',
        freePlan: false,
      },
    };
    render(<ElevenLabsCard authReady />);
    await screen.findByText('creator (active)');
    expect(screen.queryByText(/Free plan: no commercial licence/)).toBeNull();
  });

  it('shows why the account could not be read, and "no render yet" only when there was none', async () => {
    answers.status = {
      ...FREE_MONTH,
      subscription: null,
      subscriptionError:
        'Could not read the ElevenLabs subscription (HTTP 403 insufficient_permissions: the key needs the User → Read permission (user_read), set at https://elevenlabs.io/app/developers/api-keys); nothing was sent, so no credits were spent.',
      lastRender: null,
    };
    render(<ElevenLabsCard authReady />);
    expect(await screen.findByText(/User → Read permission \(user_read\)/)).toBeTruthy();
    expect(screen.getByText('No ElevenLabs render recorded yet.')).toBeTruthy();
  });

  it('reports a failed status read as an alert with a retry that reads again', async () => {
    let reads = 0;
    answers.status = () => {
      reads += 1;
      if (reads === 1) throw new Error('HTTP 500');
      return FREE_MONTH;
    };
    render(<ElevenLabsCard authReady />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('ElevenLabs: HTTP 500');
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('free (free)')).toBeTruthy();
    expect(statusReads()).toBe(2);
  });

  it('never runs the live check on load, and waits for auth before reading', async () => {
    const { rerender } = render(<ElevenLabsCard authReady={false} />);
    expect(getJSON).not.toHaveBeenCalled();
    rerender(<ElevenLabsCard authReady />);
    await screen.findByText('free (free)');
    expect(postJSON).not.toHaveBeenCalled();
  });

  it('runs the live check on a click, once, and shows the audio, the characters billed and the credits left', async () => {
    let resolve;
    postJSON.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    render(<ElevenLabsCard authReady />);
    const button = await screen.findByRole('button', { name: /Run live check/ });
    expect(screen.getByText(/fixed two-turn sample of 257 characters/)).toBeTruthy();
    // Enabled once the saved voices have loaded.
    await waitFor(() => expect(button.disabled).toBe(false));

    fireEvent.click(button);
    fireEvent.click(button); // a double click sends one request
    expect(postJSON).toHaveBeenCalledTimes(1);
    expect(postJSON).toHaveBeenCalledWith(ELEVENLABS_SAMPLE_ROUTE, {});

    resolve(RENDERED);
    expect(await screen.findByText('Characters billed: 257')).toBeTruthy();
    expect(screen.getByText('Credits left: 9,743 of 10,000')).toBeTruthy();
    const audio = document.querySelector('audio');
    expect(audio.getAttribute('src')).toBe(
      'https://api.example.test/api/public/media/podcast/sample/elevenlabs-live-check.mp3?v=1790000000000'
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Live check rendered',
        description: '257 characters billed; 9,743 credits left.',
      })
    );
    // The figures above it are read again, so they show the spend.
    await waitFor(() => expect(statusReads()).toBe(2));
  });

  it('shows a refused live check word for word, and plays nothing', async () => {
    const sentence =
      'ElevenLabs has 100 credits left of 10,000, this episode needs 257; the allowance resets on 2026-10-26 (UTC). Nothing was sent, so no credits were spent.';
    postJSON.mockRejectedValue(new Error(sentence));
    render(<ElevenLabsCard authReady />);
    const button = await screen.findByRole('button', { name: /Run live check/ });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(document.querySelector('audio')).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Live check not rendered', variant: 'destructive' })
    );
  });

  it('waits for a saved pair of podcast voices before it will run, and says so', async () => {
    answers.voices = NO_VOICES;
    render(<ElevenLabsCard authReady />);
    expect(
      await screen.findByText('Choose the podcast voices first: save a voice for each host above.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Run live check/ }).disabled).toBe(true);
    expect(getJSON).toHaveBeenCalledWith(settingRoute('podcast-voices'));
  });

  it('points a paid-only voice at the picker, beside the server’s sentence', async () => {
    const sentence =
      'ElevenLabs refused this on the current plan (HTTP 402 paid_plan_required): a voice or feature it needs is paid-only. Choose voices your plan allows under Podcast voices at https://hybridcloudworks.com/admin/platform?tab=audio. ElevenLabs said: {"detail":{"code":"paid_plan_required"}}';
    postJSON.mockRejectedValue(Object.assign(new Error(sentence), { code: 'paid_plan_required' }));
    render(<ElevenLabsCard authReady />);
    const button = await screen.findByRole('button', { name: /Run live check/ });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(
      screen.getByText(
        'Choose voices your plan allows under Podcast voices above (the ones listed as usable), Save, and run the check again.'
      )
    ).toBeTruthy();
  });

  it('says so when the sample was billed but its audio could not be stored', async () => {
    postJSON.mockResolvedValue({
      ...RENDERED,
      audioUrl: null,
      audioError: 'The sample was rendered and billed but not stored: container missing',
    });
    render(<ElevenLabsCard authReady />);
    const button = await screen.findByRole('button', { name: /Run live check/ });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect(await screen.findByText(/rendered and billed but not stored/)).toBeTruthy();
    expect(screen.getByText('Characters billed: 257')).toBeTruthy();
    expect(document.querySelector('audio')).toBeNull();
  });
});
