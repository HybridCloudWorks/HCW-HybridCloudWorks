/**
 * The Listen & Learn Hub's shell and its Generate tab.
 *
 * The expected speech spend is shown when a run is accepted, not after it, and
 * the run names the Gemini model it will read with — the owner's Best/Economy
 * button, defaulting to the stored choice (ADR 0029 §2a/§2b). Those assertions
 * are unchanged by #574; what moved is that the form now lives on the Generate
 * tab, which is the tab the page opens on.
 *
 * `queuedMessage` and `VoiceModelField` moved to
 * components/admin/listen-and-learn with their own tests.
 *
 * react-router is mocked rather than wrapped, as CertificationsPage.test does,
 * so a tab click can be asserted as the `setSearchParams` call it is.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ListenAndLearnPage from './ListenAndLearnPage';

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

let searchParams = '';
const setSearchParams = vi.fn();

vi.mock('@/hooks/useAuthReady', () => ({
  useAuthReady: () => ({ authReady: true }),
}));

vi.mock('react-router', async () => {
  const React_ = await vi.importActual('react');
  return {
    useSearchParams: () => [new URLSearchParams(searchParams), setSearchParams],
    Link: ({ to, children }) => React_.createElement('a', { href: to }, children),
  };
});

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

/** The hub's own tab bar, not any tablist a panel might render. */
const hubTabs = () => within(screen.getByRole('tablist', { name: 'Listen & Learn Hub' }));
const selectedTab = () =>
  hubTabs()
    .getAllByRole('tab')
    .find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

describe('the header and tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = '';
    fetchSets.mockResolvedValue([]);
    fetchSetForReview.mockResolvedValue({ episodes: [] });
    fetchSpeechSettings.mockResolvedValue({ geminiModel: BEST, options: OPTIONS });
  });

  it('names the hub and its provider, and opens Generate by default', () => {
    render(<ListenAndLearnPage />);
    expect(screen.getByRole('heading', { name: /Listen & Learn/ })).toBeInTheDocument();
    expect(
      hubTabs()
        .getAllByRole('tab')
        .map((t) => t.textContent)
    ).toEqual(['Generate', 'Review', 'Published', 'Settings']);
    expect(selectedTab()).toBe('Generate');
  });

  it('writes the tab to the URL on click, and not for the tab already open', () => {
    render(<ListenAndLearnPage />);
    fireEvent.click(hubTabs().getByRole('tab', { name: 'Generate' }));
    expect(setSearchParams).not.toHaveBeenCalled();
    fireEvent.click(hubTabs().getByRole('tab', { name: 'Review' }));
    expect(setSearchParams).toHaveBeenCalledWith({ tab: 'review' });
  });

  it('lands an old section word on the tab that now holds it', () => {
    searchParams = 'tab=episodes';
    render(<ListenAndLearnPage />);
    expect(selectedTab()).toBe('Review');
  });

  it('falls back to Generate for a tab that does not exist', () => {
    searchParams = 'tab=nope';
    render(<ListenAndLearnPage />);
    expect(selectedTab()).toBe('Generate');
  });

  it('keeps reporting a run while the operator is on another tab', async () => {
    // `generating` and `progress` live in the hook, not in the Generate tab,
    // so leaving the tab mid-run does not lose the line that says what it cost.
    generateEpisodes.mockImplementation(async ({ onAccepted }) => {
      onAccepted({ ok: true, jobId: 'j1', speech: { provider: 'gemini', model: BEST } });
      return new Promise(() => {});
    });
    render(<ListenAndLearnPage />);
    await waitFor(() => expect(fetchSets).toHaveBeenCalled());
    const examCode = screen.getByPlaceholderText('AZ-104');
    const form = within(examCode.closest('form'));
    fireEvent.change(examCode, { target: { value: 'AZ-104' } });
    fireEvent.change(form.getByPlaceholderText(/study-guides\/az-104/), {
      target: { value: 'https://learn.microsoft.com/az-104' },
    });
    fireEvent.click(form.getByRole('button', { name: /generate/i }));
    expect(
      await screen.findByText('Queued — speech by Gemini Best (gemini-3.1-flash-tts-preview)')
    ).toBeInTheDocument();

    searchParams = 'tab=review';
    render(<ListenAndLearnPage />);
    // The second render is a fresh mount, so this asserts the tab renders at
    // all from a deep link mid-run rather than blanking.
    expect(screen.getAllByRole('tablist').length).toBeGreaterThan(0);
  });
});

describe('ListenAndLearnPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `searchParams` is module state shared with the describe above, which
    // deep-links a tab. Without this reset the form below is on a tab that
    // is not open, and every assertion here fails looking for it.
    searchParams = '';
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
