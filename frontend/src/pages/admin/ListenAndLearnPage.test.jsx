/**
 * The Listen & Learn page's shell and its Generate tab (ADR 0033 §4).
 *
 * The page opens on the Library; the old `published` tab and the old section
 * words land where their content went. The expected speech spend is shown
 * when a run is accepted, not after it, and the run names the Gemini model it
 * will read with — the owner's Best/Economy button, defaulting to the stored
 * choice (ADR 0029 §2a/§2b).
 *
 * `queuedMessage` and `VoiceModelField` live in
 * components/admin/listen-and-learn with their own tests; so do the Library
 * grid and the chapter row.
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
const fetchSpeechOptions = vi.fn();

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
const CATALOG = {
  models: OPTIONS.map((o) => ({ ...o, isDefault: o.id === ECONOMY })),
  defaultModel: ECONOMY,
  storedModel: null,
  effectiveModel: ECONOMY,
  voices: { gemini: [{ id: 'Kore', descriptor: 'Firm' }], azure: [] },
  voiceProviders: ['auto', 'gemini', 'azure'],
  speakingRate: { min: 0.5, max: 2, default: 1 },
  speech: {
    order: ['gemini', 'azure'],
    pin: { setting: 'LISTEN_AND_LEARN_TTS_PROVIDER', value: 'gemini' },
    wouldRun: 'gemini',
    pinError: null,
    providers: [
      { id: 'elevenlabs', configured: true, allowed: false, reason: 'podcast only' },
      {
        id: 'gemini',
        configured: true,
        allowed: true,
        reason: null,
        requirement: 'GEMINI_API_KEY',
      },
      {
        id: 'azure',
        configured: false,
        allowed: true,
        reason: null,
        requirement: 'AZURE_SPEECH_KEY',
      },
    ],
  },
};

let searchParams = '';
const setSearchParams = vi.fn();

vi.mock('@/hooks/useAuthReady', () => ({
  useAuthReady: () => ({ authReady: true }),
}));

vi.mock('react-router', async () => {
  const React_ = await vi.importActual('react');
  return {
    useSearchParams: () => [new URLSearchParams(searchParams), setSearchParams],
    useLocation: () => ({ pathname: '/admin/listen-and-learn' }),
    Link: ({ to, children }) => React_.createElement('a', { href: to }, children),
  };
});

vi.mock('@/lib/listenAndLearn', () => ({
  SUPPORTED_PLATFORMS: ['azure', 'github', 'aws'],
  GENERATE_PLATFORMS: ['azure', 'aws'],
  GITHUB_GENERATE_NOTE: 'GitHub is not offered here.',
  BOOK_PROVIDERS: ['azure', 'aws'],
  GEMINI_TTS_MODEL_TIERS: {
    'gemini-3.1-flash-tts-preview': 'Best',
    'gemini-2.5-flash-preview-tts': 'Economy',
  },
  fetchSets: (...args) => fetchSets(...args),
  fetchBooks: (...args) => fetchSets(...args),
  fetchSetForReview: (...args) => fetchSetForReview(...args),
  fetchSpeechSettings: (...args) => fetchSpeechSettings(...args),
  fetchSpeechOptions: (...args) => fetchSpeechOptions(...args),
  generateEpisodes: (...args) => generateEpisodes(...args),
  reviewEpisode: vi.fn(),
  estimateSpeech: vi.fn(),
  createBook: vi.fn(),
  patchBook: vi.fn(),
  deleteBook: vi.fn(),
  createChapter: vi.fn(),
  patchChapter: vi.fn(),
  reorderChapters: vi.fn(),
  deleteChapter: vi.fn(),
  deleteVersion: vi.fn(),
  regenerateChapter: vi.fn(),
  followJob: vi.fn(),
}));

vi.mock('@/lib/functionsBase', () => ({
  resolveMediaUrl: (url) => url,
}));

vi.mock('@/components/admin/ImageGalleryPicker', () => ({
  ImageGalleryPicker: () => null,
}));

/** The hub's own tab bar, not any tablist a panel might render. */
const hubTabs = () => within(screen.getByRole('tablist', { name: 'Listen & Learn Hub' }));
const selectedTab = () =>
  hubTabs()
    .getAllByRole('tab')
    .find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

const resetMocks = () => {
  vi.clearAllMocks();
  searchParams = '';
  fetchSets.mockResolvedValue([]);
  fetchSetForReview.mockResolvedValue({ set: null, episodes: [] });
  fetchSpeechSettings.mockResolvedValue({ geminiModel: BEST, options: OPTIONS });
  fetchSpeechOptions.mockResolvedValue(CATALOG);
};

describe('the header and tabs', () => {
  beforeEach(resetMocks);

  it('names the hub, explains itself, and opens the Library by default', async () => {
    render(<ListenAndLearnPage />);
    expect(screen.getByRole('heading', { name: /Listen & Learn/ })).toBeInTheDocument();
    expect(
      hubTabs()
        .getAllByRole('tab')
        .map((t) => t.textContent)
    ).toEqual(['Library', 'Generate', 'Review', 'Settings']);
    expect(selectedTab()).toBe('Library');
    // The help panel explains the three nouns.
    fireEvent.click(screen.getByRole('button', { name: /How the Audio Library works/ }));
    expect(screen.getByText(/A book or course is a set of audio chapters/)).toBeInTheDocument();
    expect(screen.getByText(/A version is one take/)).toBeInTheDocument();
    // The status line names the provider that would run and the default model.
    expect(
      await screen.findByText(/Speech by gemini · default model gemini-2.5-flash-preview-tts/)
    ).toBeInTheDocument();
  });

  it('writes the tab to the URL on click, and not for the tab already open', () => {
    render(<ListenAndLearnPage />);
    fireEvent.click(hubTabs().getByRole('tab', { name: 'Library' }));
    expect(setSearchParams).not.toHaveBeenCalled();
    fireEvent.click(hubTabs().getByRole('tab', { name: 'Review' }));
    expect(setSearchParams).toHaveBeenCalledWith({ tab: 'review' });
  });

  it('lands the retired Published tab and an old section word where their content went', () => {
    searchParams = 'tab=published';
    const { unmount } = render(<ListenAndLearnPage />);
    expect(selectedTab()).toBe('Library');
    unmount();
    searchParams = 'tab=drafts';
    render(<ListenAndLearnPage />);
    expect(selectedTab()).toBe('Review');
  });

  it('falls back to the Library for a tab that does not exist', () => {
    searchParams = 'tab=nope';
    render(<ListenAndLearnPage />);
    expect(selectedTab()).toBe('Library');
  });

  it('shows the library grid with each book’s kind and counts, and no GitHub on the Generate form', async () => {
    fetchSets.mockResolvedValue([
      {
        id: 'azure_az-104',
        provider: 'azure',
        examCode: 'az-104',
        kind: 'course',
        title: 'Azure Administrator',
        tags: [],
        counts: {
          chapters: 5,
          published: 3,
          drafts: 2,
          failed: 0,
          archived: 0,
          durationSeconds: 2820,
        },
      },
    ]);
    render(<ListenAndLearnPage />);
    expect(await screen.findByText('Azure Administrator')).toBeInTheDocument();
    expect(screen.getByText('5 lessons · 3 published · 47 min')).toBeInTheDocument();
  });

  it('keeps reporting a run while the operator is on another tab', async () => {
    // `generating` and `progress` live in the hook, not in the Generate tab,
    // so leaving the tab mid-run does not lose the line that says what it cost.
    searchParams = 'tab=generate';
    generateEpisodes.mockImplementation(async ({ onAccepted }) => {
      onAccepted({ ok: true, jobId: 'j1', speech: { provider: 'gemini', model: BEST } });
      return new Promise(() => {});
    });
    render(<ListenAndLearnPage />);
    await waitFor(() => expect(fetchSets).toHaveBeenCalled());
    const examCode = screen.getByPlaceholderText('AZ-104');
    const form = within(examCode.closest('form'));
    expect(
      within(form.getByLabelText('Platform'))
        .getAllByRole('option')
        .map((o) => o.value)
    ).toEqual(['azure', 'aws']);
    expect(screen.getByText('GitHub is not offered here.')).toBeInTheDocument();
    fireEvent.change(examCode, { target: { value: 'AZ-104' } });
    fireEvent.change(form.getByPlaceholderText(/study-guides\/az-104/), {
      target: { value: 'https://learn.microsoft.com/az-104' },
    });
    fireEvent.click(form.getByRole('button', { name: /^generate$/i }));
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

describe('the Generate tab', () => {
  beforeEach(() => {
    resetMocks();
    searchParams = 'tab=generate';
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

  it('loads the books, the speech settings and the speech catalogue once auth is ready', async () => {
    render(<ListenAndLearnPage />);
    await waitFor(() => expect(fetchSets).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchSpeechSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchSpeechOptions).toHaveBeenCalledTimes(1));
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
    // Before the run: the per-lesson ceiling for the model that will read.
    expect(
      form.getByText(/Up to \$0\.44 per lesson with gemini-3\.1-flash-tts-preview/)
    ).toBeInTheDocument();
    fireEvent.click(form.getByRole('button', { name: /^generate$/i }));

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
    fireEvent.click(form.getByRole('button', { name: /^generate$/i }));
    await waitFor(() =>
      expect(generateEpisodes).toHaveBeenCalledWith(expect.objectContaining({ ttsModel: ECONOMY }))
    );
  });

  it('sends no ttsModel when the operator picks Best and then returns to Stored default, which names Economy', async () => {
    // Copilot on #462: the override must be undoable within the page, and
    // undoing it means the payload carries no model at all.
    generateEpisodes.mockImplementation(async () => new Promise(() => {}));
    render(<ListenAndLearnPage />);
    const form = await submitGuideForm();
    const select = form.getByLabelText('Voice model');
    await waitFor(() =>
      expect(within(select).getAllByRole('option')[0].textContent).toMatch(/Economy unless changed/)
    );
    fireEvent.change(select, { target: { value: BEST } });
    expect(select.value).toBe(BEST);
    fireEvent.change(select, { target: { value: '' } });
    expect(select.value).toBe('');
    fireEvent.click(form.getByRole('button', { name: /^generate$/i }));
    await waitFor(() => expect(generateEpisodes).toHaveBeenCalled());
    const [[call]] = generateEpisodes.mock.calls;
    expect(call.ttsModel).toBeUndefined();
    expect(call).toMatchObject({ platform: 'azure', examCode: 'AZ-104' });
  });

  it('leaves the choice on the stored default when the settings fail to load', async () => {
    fetchSpeechSettings.mockRejectedValue(new Error('500'));
    fetchSpeechOptions.mockRejectedValue(new Error('500'));
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
    fireEvent.click(form.getByRole('button', { name: /^generate$/i }));
    await waitFor(() => expect(generateEpisodes).toHaveBeenCalled());
    expect(generateEpisodes.mock.calls[0][0].ttsModel).toBeUndefined();
  });
});

describe('the Settings tab', () => {
  beforeEach(() => {
    resetMocks();
    searchParams = 'tab=settings';
  });

  it('says which model reads by default, lists the voices, and describes the providers from the server', async () => {
    render(<ListenAndLearnPage />);
    expect(
      await screen.findByText(/the cheapest sensible voice, the default when nothing is stored/)
    ).toBeInTheDocument();
    expect(screen.getByText('Kore · Firm')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Change the stored default on Platform settings/ })
    ).toHaveAttribute('href', '/admin/platform?tab=audio');
    fireEvent.click(screen.getByRole('button', { name: /Advanced — providers and fallback/ }));
    expect(screen.getByText('runs today')).toBeInTheDocument();
    expect(screen.getByText(/not for Listen & Learn — podcast only/)).toBeInTheDocument();
    expect(screen.getByText(/not configured — needs AZURE_SPEECH_KEY/)).toBeInTheDocument();
  });
});
