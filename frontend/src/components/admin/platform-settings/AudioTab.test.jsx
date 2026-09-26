/**
 * Audio: the podcast feeds card keeps the main feed and the provider rows
 * together on the way to a save, the voice card offers the server's priced
 * choices, and each card loads and fails on its own. The podcast voice card
 * (ElevenLabs, 2026-09-26) has its own tests in ElevenLabsCard.test.jsx; here
 * it is one more card that loads beside the others.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import AudioTab, { ListenAndLearnSpeechCard, PodcastFeedsCard } from './AudioTab';
import { ELEVENLABS_STATUS_ROUTE } from './ElevenLabsCard';
import { PODCAST_PROVIDERS, settingRoute } from './settingShared';

const BEST = 'gemini-3.1-flash-tts-preview';
const ECONOMY = 'gemini-2.5-flash-preview-tts';
/** What the server offers, priced (functions/src/lib/listen-and-learn/speech-settings.js). */
const SPEECH_OPTIONS = [
  {
    id: BEST,
    tier: 'best',
    label: 'Best — newest voice, about twice the cost',
    perEpisodeUsd: 0.44,
  },
  { id: ECONOMY, tier: 'economy', label: 'Economy — cheaper', perEpisodeUsd: 0.22 },
];

const getJSON = vi.fn();
const sendJSON = vi.fn();
const postJSON = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
  postJSON: (...args) => postJSON(...args),
}));

/** The podcast voice card's read: an unseeded key, which is a 200, not an error. */
const ELEVENLABS_UNSEEDED = {
  success: true,
  configured: false,
  reason: 'ELEVENLABS_API_KEY is not configured.',
  subscription: null,
  lastRender: null,
  sample: { characters: 257, turns: 2 },
};
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

const empty = {
  'podcast-feeds': { feeds: [] },
  // Nothing stored shows the module default selected — that is what runs.
  'listen-and-learn-speech': { geminiModel: BEST },
};
const settingFor = (route) => route.replace('cms/platform-settings/', '');
const optionsFor = (setting) =>
  setting === 'listen-and-learn-speech' ? { options: SPEECH_OPTIONS } : {};

const meta = { exists: false, stored: null, updatedAt: null, problem: null };

beforeEach(() => {
  getJSON.mockReset().mockImplementation(async (route) =>
    route === ELEVENLABS_STATUS_ROUTE
      ? ELEVENLABS_UNSEEDED
      : {
          success: true,
          setting: settingFor(route),
          value: empty[settingFor(route)],
          exists: false,
          stored: null,
          updatedAt: null,
          ...optionsFor(settingFor(route)),
        }
  );
  postJSON.mockReset();
  sendJSON.mockReset().mockImplementation(async (route, _method, body) => ({
    success: true,
    setting: settingFor(route),
    value: body,
    exists: true,
    stored: 'valid',
    updatedAt: '2026-09-07T12:00:00.000Z',
    ...optionsFor(settingFor(route)),
  }));
  toast.mockReset();
});

describe('PodcastFeedsCard', () => {
  it('renders the fixed rows plus any extra provider the document carries', () => {
    render(
      <PodcastFeedsCard
        value={{ feeds: [{ provider: 'kubernetes', url: 'https://x.example/k8s.rss' }] }}
        meta={meta}
        saving={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />
    );
    for (const provider of PODCAST_PROVIDERS) expect(screen.getByLabelText(provider)).toBeTruthy();
    expect(screen.getByLabelText('kubernetes').value).toBe('https://x.example/k8s.rss');
  });

  it('keeps one row per provider when a URL is edited', () => {
    const onChange = vi.fn();
    render(
      <PodcastFeedsCard
        value={{ feeds: [{ provider: 'azure', url: 'https://x.example/old' }] }}
        meta={meta}
        saving={false}
        onChange={onChange}
        onSave={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText('azure'), {
      target: { value: 'https://x.example/new' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      feeds: [{ provider: 'azure', url: 'https://x.example/new' }],
    });
    fireEvent.change(screen.getByLabelText('finops'), { target: { value: 'https://x.example/f' } });
    expect(onChange).toHaveBeenLastCalledWith({
      feeds: [
        { provider: 'azure', url: 'https://x.example/old' },
        { provider: 'finops', url: 'https://x.example/f' },
      ],
    });
  });

  it('edits the main feed and the provider rows without either dropping the other', () => {
    // Two controls, one document. The main feed is the site's show and the
    // provider rows are optional extras; a save that carried only the field
    // last touched would silently blank the other.
    const onChange = vi.fn();
    const value = {
      mainFeedUrl: 'https://media.rss.com/hybrid-cloud-insights/feed.xml',
      feeds: [{ provider: 'azure', url: 'https://x.example/azure.xml' }],
    };
    render(
      <PodcastFeedsCard
        value={value}
        meta={meta}
        saving={false}
        onChange={onChange}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Main feed').value).toBe(
      'https://media.rss.com/hybrid-cloud-insights/feed.xml'
    );

    fireEvent.change(screen.getByLabelText('Main feed'), {
      target: { value: 'https://media.rss.com/hybrid-cloud-insights/feed.xml?v=2' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      mainFeedUrl: 'https://media.rss.com/hybrid-cloud-insights/feed.xml?v=2',
      feeds: [{ provider: 'azure', url: 'https://x.example/azure.xml' }],
    });

    fireEvent.change(screen.getByLabelText('aws'), { target: { value: 'https://x.example/aws' } });
    expect(onChange).toHaveBeenLastCalledWith({
      mainFeedUrl: 'https://media.rss.com/hybrid-cloud-insights/feed.xml',
      feeds: [
        { provider: 'azure', url: 'https://x.example/azure.xml' },
        { provider: 'aws', url: 'https://x.example/aws' },
      ],
    });
  });
});

describe('ListenAndLearnSpeechCard', () => {
  it('offers the two priced choices as radios with the owner’s labels, selecting the stored one', () => {
    const onChange = vi.fn();
    render(
      <ListenAndLearnSpeechCard
        value={{ geminiModel: BEST }}
        options={SPEECH_OPTIONS}
        meta={meta}
        saving={false}
        onChange={onChange}
        onSave={vi.fn()}
      />
    );
    const best = screen.getByLabelText(/Best — newest voice, about twice the cost/);
    const economy = screen.getByLabelText(/Economy — cheaper/);
    expect(best.checked).toBe(true);
    expect(economy.checked).toBe(false);
    expect(screen.getByText(/up to \$0\.44 an episode/)).toBeTruthy();
    expect(screen.getByText(/up to \$0\.22 an episode/)).toBeTruthy();
    expect(screen.getByText(/newer certifications: Best; older ones: Economy/)).toBeTruthy();
    // ElevenLabs is named only to say it is never used here.
    expect(screen.getByText(/ElevenLabs is the podcast voice and is never used here/)).toBeTruthy();

    fireEvent.click(economy);
    expect(onChange).toHaveBeenCalledWith({ geminiModel: ECONOMY });
  });

  it('says so, rather than rendering nothing, when the server offered no choices', () => {
    render(
      <ListenAndLearnSpeechCard
        value={{ geminiModel: ECONOMY }}
        options={[]}
        meta={meta}
        saving={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByText(/The server offered no choices/)).toBeTruthy();
    expect(screen.getByText(ECONOMY)).toBeTruthy();
  });
});

describe('the Audio tab', () => {
  it('loads its two settings and the podcast voice status, and nothing else', async () => {
    render(<AudioTab />);
    await screen.findByText('Podcast feeds');
    await screen.findByText('Listen & Learn voice');
    await screen.findByText('Not configured');
    expect(getJSON).toHaveBeenCalledTimes(3);
    expect(getJSON).toHaveBeenCalledWith(settingRoute('podcast-feeds'));
    expect(getJSON).toHaveBeenCalledWith(settingRoute('listen-and-learn-speech'));
    expect(getJSON).toHaveBeenCalledWith(ELEVENLABS_STATUS_ROUTE);
    // The live check spends credits, so loading the tab never runs it.
    expect(postJSON).not.toHaveBeenCalled();
  });

  it('PUTs the chosen Gemini model to the listen-and-learn-speech route, with the options from GET', async () => {
    render(<AudioTab />);
    const economy = await screen.findByLabelText(/Economy — cheaper/);
    expect(screen.getByLabelText(/Best — newest voice/).checked).toBe(true);
    fireEvent.click(economy);
    fireEvent.submit(economy.closest('form'));
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith(settingRoute('listen-and-learn-speech'), 'PUT', {
        geminiModel: ECONOMY,
      })
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Saved' }))
    );
    expect(screen.getByLabelText(/Economy — cheaper/).checked).toBe(true);
  });

  it('surfaces a refused write as the server said it and keeps the edit', async () => {
    sendJSON.mockRejectedValue(new Error('feeds[0].url must be an https URL'));
    render(<AudioTab />);
    await screen.findByText('Podcast feeds');
    fireEvent.change(screen.getByLabelText('azure'), { target: { value: 'http://x.example/f' } });
    fireEvent.submit(screen.getByLabelText('azure').closest('form'));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          description: 'feeds[0].url must be an https URL',
        })
      )
    );
    expect(screen.getByLabelText('azure').value).toBe('http://x.example/f');
  });

  it('shows a failed load for one card without hiding the other', async () => {
    getJSON.mockImplementation(async (route) => {
      if (settingFor(route) === 'podcast-feeds') throw new Error('HTTP 500');
      if (route === ELEVENLABS_STATUS_ROUTE) return ELEVENLABS_UNSEEDED;
      return {
        success: true,
        value: empty[settingFor(route)],
        exists: false,
        ...optionsFor(settingFor(route)),
      };
    });
    render(<AudioTab />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Podcast feeds: HTTP 500');
    expect(screen.getByText('Listen & Learn voice')).toBeTruthy();
    expect(screen.queryByLabelText('Main feed')).toBeNull();
  });
});
