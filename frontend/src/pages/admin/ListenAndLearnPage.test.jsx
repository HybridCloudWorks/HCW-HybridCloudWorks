/**
 * The expected speech spend is shown when a run is accepted, not after it,
 * and the run names the Gemini model it will read with — the owner's
 * Best/Economy button, defaulting to the stored choice.
 *
 * ADR 0029 §2a/§2b: the estimate arrives in the 202 and this page is where
 * an operator reads it before the money goes; Listen & Learn is Gemini TTS,
 * never ElevenLabs.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ListenAndLearnPage, { VoiceModelField, queuedMessage } from './ListenAndLearnPage';

const generateEpisodes = vi.fn();
const fetchSets = vi.fn();
const fetchSetForReview = vi.fn();
const fetchSpeechSettings = vi.fn();

const BEST = 'gemini-3.1-flash-tts-preview';
const ECONOMY = 'gemini-2.5-flash-preview-tts';
const OPTIONS = [
  {
    id: BEST,
    tier: 'best',
    label: 'Best — newest voice, about twice the cost',
    perEpisodeUsd: 0.44,
  },
  { id: ECONOMY, tier: 'economy', label: 'Economy — cheaper', perEpisodeUsd: 0.22 },
];

vi.mock('@/hooks/useAuthReady', () => ({
  useAuthReady: () => ({ authReady: true }),
}));

vi.mock('@/lib/listenAndLearn', () => ({
  SUPPORTED_PLATFORMS: ['azure', 'github', 'aws'],
  GEMINI_TTS_MODEL_TIERS: {
    'gemini-3.1-flash-tts-preview': 'Best',
    'gemini-2.5-flash-preview-tts': 'Economy',
  },
  fetchSets: (...args) => fetchSets(...args),
  fetchSetForReview: (...args) => fetchSetForReview(...args),
  fetchSpeechSettings: (...args) => fetchSpeechSettings(...args),
  generateEpisodes: (...args) => generateEpisodes(...args),
  reviewEpisode: vi.fn(),
}));

vi.mock('@/lib/functionsBase', () => ({
  resolveMediaUrl: (url) => url,
}));

describe('queuedMessage', () => {
  it('states the provider, the model and the ceiling, with the arithmetic', () => {
    expect(
      queuedMessage({
        provider: 'gemini',
        model: BEST,
        episodes: 8,
        perEpisodeUsd: 0.44,
        estimatedCostUsd: 3.52,
      })
    ).toBe(
      'Queued — speech by Gemini Best (gemini-3.1-flash-tts-preview), up to $3.52 (8 episodes × $0.44)'
    );
    expect(
      queuedMessage({
        provider: 'gemini',
        model: ECONOMY,
        episodes: 2,
        perEpisodeUsd: 0.22,
        estimatedCostUsd: 0.44,
      })
    ).toBe(
      'Queued — speech by Gemini Economy (gemini-2.5-flash-preview-tts), up to $0.44 (2 episodes × $0.22)'
    );
  });

  it('says the stored default applies when the run named no model, with the ceiling priced at the dearer one', () => {
    expect(
      queuedMessage({
        provider: 'gemini',
        model: null,
        modelSource: 'stored',
        modelNote: 'the stored default applies; see Platform settings',
        episodes: 8,
        perEpisodeUsd: 0.44,
        estimatedCostUsd: 3.52,
      })
    ).toBe(
      'Queued — speech by Gemini (the stored default applies; see Platform settings), up to $3.52 (8 episodes × $0.44)'
    );
    expect(
      queuedMessage({ provider: 'gemini', model: null, modelSource: 'stored', estimatedCostUsd: 1 })
    ).toBe('Queued — speech by Gemini (the stored default model applies), up to $1.00');
  });

  it('shows a model outside the pair as sent, and none at all without inventing one', () => {
    expect(
      queuedMessage({
        provider: 'gemini',
        model: 'gemini-2.5-pro-preview-tts',
        estimatedCostUsd: 1,
      })
    ).toBe('Queued — speech by Gemini gemini-2.5-pro-preview-tts, up to $1.00');
    expect(queuedMessage({ provider: 'gemini', estimatedCostUsd: 1 })).toBe(
      'Queued — speech by Gemini, up to $1.00'
    );
  });

  it('says in words when there will be no audio, rather than showing a zero', () => {
    expect(
      queuedMessage({
        provider: null,
        reason: 'not_configured',
        estimatedCostUsd: null,
        episodes: 8,
      })
    ).toMatch(/no speech provider is configured.*transcripts only/);
  });

  it('distinguishes an unusable pin from nothing configured — they need different fixes', () => {
    // The server returns provider: null for both; `reason` says which
    // (Copilot on #447). A pin names the setting to correct.
    expect(
      queuedMessage({
        provider: null,
        reason: 'pin_unavailable',
        estimatedCostUsd: null,
        episodes: 8,
      })
    ).toMatch(
      /pinned speech provider \(LISTEN_AND_LEARN_TTS_PROVIDER\) is not configured.*transcripts only/
    );
  });

  it('covers both causes when an older server sends no reason', () => {
    expect(queuedMessage({ provider: null, estimatedCostUsd: null, episodes: 8 })).toMatch(
      /no usable speech provider \(none configured, or the pinned one is not\).*transcripts only/
    );
  });

  it('names a provider it cannot price without inventing a figure', () => {
    expect(queuedMessage({ provider: 'azure', estimatedCostUsd: null, episodes: 8 })).toBe(
      'Queued — speech by Azure AI Speech'
    );
  });

  it('degrades to the plain queued line when the server said nothing', () => {
    expect(queuedMessage(undefined)).toBe('Queued…');
    expect(queuedMessage(null)).toBe('Queued…');
  });
});

describe('VoiceModelField', () => {
  it('offers the two server-priced choices and reports a pick', () => {
    const onChange = vi.fn();
    render(<VoiceModelField value={BEST} options={OPTIONS} onChange={onChange} />);
    const select = screen.getByLabelText('Voice model');
    expect(select.value).toBe(BEST);
    const labels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toEqual([
      'Stored default (set on Platform settings)',
      'Best — newest voice, about twice the cost · up to $0.44 an episode',
      'Economy — cheaper · up to $0.22 an episode',
    ]);
    fireEvent.change(select, { target: { value: ECONOMY } });
    expect(onChange).toHaveBeenCalledWith(ECONOMY);
    expect(screen.getByText(/newer certifications: Best; older ones: Economy/)).toBeInTheDocument();
  });

  it('lets a per-run override be undone: "Stored default" stays on the list after a model is picked', () => {
    // Copilot on #462: the option used to render only while the value was
    // blank, so a pick was sticky until a reload.
    const onChange = vi.fn();
    render(<VoiceModelField value={ECONOMY} options={OPTIONS} onChange={onChange} />);
    const select = screen.getByLabelText('Voice model');
    expect(select.value).toBe(ECONOMY);
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('still offers both ids by short name, behind "Stored default", when the settings did not load', () => {
    render(<VoiceModelField value="" options={[]} onChange={vi.fn()} />);
    const labels = within(screen.getByLabelText('Voice model'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toEqual(['Stored default (set on Platform settings)', 'Best', 'Economy']);
  });
});

describe('ListenAndLearnPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSets.mockResolvedValue([]);
    fetchSetForReview.mockResolvedValue({ episodes: [] });
    fetchSpeechSettings.mockResolvedValue({ geminiModel: BEST, options: OPTIONS });
  });

  /** Fill the study-guide form and submit it, returning its scope. */
  const submitGuideForm = async () => {
    await waitFor(() => expect(fetchSets).toHaveBeenCalled());
    // Scoped to the study-guide form: since #452 the source-grounding panel
    // has its own Generate button on the same page.
    const examCode = screen.getByPlaceholderText('AZ-104');
    const form = within(examCode.closest('form'));
    await waitFor(() => expect(form.getByLabelText('Voice model').value).toBe(BEST));
    fireEvent.change(examCode, { target: { value: 'AZ-104' } });
    fireEvent.change(form.getByPlaceholderText(/study-guides\/az-104/), {
      target: { value: 'https://learn.microsoft.com/az-104' },
    });
    return form;
  };

  it('loads the sets and the speech settings once auth is ready', async () => {
    render(<ListenAndLearnPage />);
    await waitFor(() => expect(fetchSets).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchSpeechSettings).toHaveBeenCalledTimes(1));
  });

  it('defaults the run to the stored model and shows the expected spend as soon as the run is accepted', async () => {
    // The job never finishes during this test; the assertion is about the
    // moment between acceptance and the first poll.
    generateEpisodes.mockImplementation(async ({ onAccepted }) => {
      onAccepted({
        ok: true,
        jobId: 'j1',
        speech: {
          provider: 'gemini',
          model: BEST,
          episodes: 8,
          perEpisodeUsd: 0.44,
          estimatedCostUsd: 3.52,
        },
      });
      return new Promise(() => {});
    });

    render(<ListenAndLearnPage />);
    const form = await submitGuideForm();
    fireEvent.click(form.getByRole('button', { name: /generate/i }));

    expect(
      await screen.findByText(
        'Queued — speech by Gemini Best (gemini-3.1-flash-tts-preview), up to $3.52 (8 episodes × $0.44)'
      )
    ).toBeInTheDocument();
    expect(generateEpisodes).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'azure',
        examCode: 'AZ-104',
        studyGuideUrl: 'https://learn.microsoft.com/az-104',
        ttsModel: BEST,
        onAccepted: expect.any(Function),
      })
    );
  });

  it('sends the per-run choice when the operator picks Economy', async () => {
    generateEpisodes.mockImplementation(async () => new Promise(() => {}));
    render(<ListenAndLearnPage />);
    const form = await submitGuideForm();
    fireEvent.change(form.getByLabelText('Voice model'), { target: { value: ECONOMY } });
    fireEvent.click(form.getByRole('button', { name: /generate/i }));
    await waitFor(() =>
      expect(generateEpisodes).toHaveBeenCalledWith(expect.objectContaining({ ttsModel: ECONOMY }))
    );
  });

  it('sends no ttsModel when the operator picks Best and then returns to Stored default', async () => {
    // Copilot on #462: the override must be undoable within the page, and
    // undoing it means the payload carries no model at all.
    generateEpisodes.mockImplementation(async () => new Promise(() => {}));
    render(<ListenAndLearnPage />);
    const form = await submitGuideForm();
    const select = form.getByLabelText('Voice model');
    fireEvent.change(select, { target: { value: BEST } });
    expect(select.value).toBe(BEST);
    fireEvent.change(select, { target: { value: '' } });
    expect(select.value).toBe('');
    fireEvent.click(form.getByRole('button', { name: /generate/i }));
    await waitFor(() => expect(generateEpisodes).toHaveBeenCalled());
    const [[call]] = generateEpisodes.mock.calls;
    expect(call.ttsModel).toBeUndefined();
    expect(call).toMatchObject({ platform: 'azure', examCode: 'AZ-104' });
  });

  it('leaves the choice on the stored default when the settings fail to load', async () => {
    fetchSpeechSettings.mockRejectedValue(new Error('500'));
    generateEpisodes.mockImplementation(async () => new Promise(() => {}));
    render(<ListenAndLearnPage />);
    await waitFor(() => expect(fetchSpeechSettings).toHaveBeenCalled());
    const examCode = screen.getByPlaceholderText('AZ-104');
    const form = within(examCode.closest('form'));
    expect(form.getByLabelText('Voice model').value).toBe('');
    fireEvent.change(examCode, { target: { value: 'AZ-104' } });
    fireEvent.change(form.getByPlaceholderText(/study-guides\/az-104/), {
      target: { value: 'https://learn.microsoft.com/az-104' },
    });
    fireEvent.click(form.getByRole('button', { name: /generate/i }));
    await waitFor(() => expect(generateEpisodes).toHaveBeenCalled());
    expect(generateEpisodes.mock.calls[0][0].ttsModel).toBeUndefined();
  });
});
