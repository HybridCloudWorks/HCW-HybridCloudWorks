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
const fetchSpeechOptions = vi.fn();

const BEST = 'gemini-3.1-flash-tts-preview';
const ECONOMY = 'gemini-2.5-flash-preview-tts';
const CATALOG = {
  // The Listen & Learn speech task's model, as the server resolves it (ADR 0034 slice 5).
  model: {
    task: 'listenAndLearnSpeech',
    provider: 'gemini',
    model: ECONOMY,
    why: 'recommended for this task: the Economy voice',
    perEpisodeUsd: 0.22,
  },
  defaultModel: ECONOMY,
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
    // The status line names the provider that would run and the task's model
    // (chosen under AI Engine → Tasks, ADR 0034 slice 5).
    expect(
      await screen.findByText(/Speech by gemini · model gemini-2.5-flash-preview-tts/)
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

  it('opens the book a Decision Center link names on Review, and rings the chapter', async () => {
    const link = 'tab=review&platform=azure&exam=AZ-104&chapter=storage';
    searchParams = link;
    // The chapter ring reads the address bar itself (hooks/useLinkedItem).
    window.history.replaceState({}, '', `/admin/listen-and-learn?${link}`);
    fetchSetForReview.mockResolvedValue({
      set: {
        id: 'azure_az-104',
        provider: 'azure',
        examCode: 'AZ-104',
        title: 'Azure Administrator',
      },
      episodes: [
        { id: 'compute', setId: 'azure_az-104', title: 'Compute', status: 'draft' },
        { id: 'storage', setId: 'azure_az-104', title: 'Storage', status: 'failed' },
      ],
    });
    try {
      const { container } = render(<ListenAndLearnPage />);
      expect(selectedTab()).toBe('Review');
      await waitFor(() =>
        expect(fetchSetForReview).toHaveBeenCalledWith({ platform: 'azure', examCode: 'AZ-104' })
      );
      await screen.findByText('Storage');
      const linked = container.querySelectorAll('[data-linked="true"]');
      expect(linked).toHaveLength(1);
      expect(linked[0]).toHaveTextContent('Storage');
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });

  it('opens no book when the link names none', async () => {
    searchParams = 'tab=review';
    render(<ListenAndLearnPage />);
    await waitFor(() => expect(fetchSets).toHaveBeenCalled());
    expect(fetchSetForReview).not.toHaveBeenCalled();
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
    await waitFor(() => expect(form.getByTestId('voice-model-line')).toHaveTextContent(ECONOMY));
    fireEvent.change(examCode, { target: { value: 'AZ-104' } });
    fireEvent.change(form.getByPlaceholderText(/study-guides\/az-104/), {
      target: { value: 'https://learn.microsoft.com/az-104' },
    });
    return form;
  };

  it('loads the books and the speech catalogue once auth is ready; nothing reads a stored model any more', async () => {
    render(<ListenAndLearnPage />);
    await waitFor(() => expect(fetchSets).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchSpeechOptions).toHaveBeenCalledTimes(1));
  });

  it('names the task’s model, links to where it is chosen, sends no model, and shows the expected spend as soon as the run is accepted', async () => {
    // The job never finishes during this test; the assertion is about the
    // moment between acceptance and the first poll.
    generateEpisodes.mockImplementation(async ({ onAccepted }) => {
      onAccepted({
        ok: true,
        jobId: 'j1',
        speech: {
          provider: 'gemini',
          model: null,
          modelSource: 'task',
          modelNote: 'the model is chosen under AI Engine → Tasks (Listen & Learn speech)',
          episodes: 8,
          perEpisodeUsd: 0.44,
          estimatedCostUsd: 3.52,
        },
      });
      return new Promise(() => {});
    });

    render(<ListenAndLearnPage />);
    const form = await submitGuideForm();
    // The model is the Listen & Learn speech task's (ADR 0034 slice 5): said
    // on the form with where it is chosen, and no longer a field of its own.
    const line = form.getByTestId('voice-model-line');
    expect(line).toHaveTextContent(`This run is read with ${ECONOMY} via gemini.`);
    expect(within(line).getByRole('link', { name: 'AI Engine → Tasks' })).toHaveAttribute(
      'href',
      '/admin/ai-engine?tab=routing'
    );
    expect(form.queryByLabelText('Voice model')).toBeNull();
    // Before the run: the per-lesson ceiling for the model that will read.
    expect(
      form.getByText(/Up to \$0\.22 per lesson with gemini-2\.5-flash-preview-tts/)
    ).toBeInTheDocument();
    fireEvent.click(form.getByRole('button', { name: /^generate$/i }));

    expect(
      await screen.findByText(
        'Queued — speech by Gemini (the model is chosen under AI Engine → Tasks (Listen & Learn speech)), up to $3.52 (8 episodes × $0.44)'
      )
    ).toBeInTheDocument();
    const [[call]] = generateEpisodes.mock.calls;
    expect(call).toMatchObject({
      platform: 'azure',
      examCode: 'AZ-104',
      studyGuideUrl: 'https://learn.microsoft.com/az-104',
      onAccepted: expect.any(Function),
    });
    expect(call).not.toHaveProperty('ttsModel');
  });

  it('says so when the task has nothing eligible, and still lets the run be queued', async () => {
    fetchSpeechOptions.mockResolvedValue({
      ...CATALOG,
      model: {
        task: 'listenAndLearnSpeech',
        provider: null,
        model: null,
        error: "No eligible model carries 'tts' for 'listenAndLearnSpeech'",
      },
    });
    generateEpisodes.mockImplementation(async () => new Promise(() => {}));
    render(<ListenAndLearnPage />);
    await waitFor(() => expect(fetchSpeechOptions).toHaveBeenCalled());
    const examCode = screen.getByPlaceholderText('AZ-104');
    const form = within(examCode.closest('form'));
    expect(form.getByTestId('voice-model-line')).toHaveTextContent(
      /No voice model is eligible right now: No eligible model carries 'tts'/
    );
    fireEvent.change(examCode, { target: { value: 'AZ-104' } });
    fireEvent.change(form.getByPlaceholderText(/study-guides\/az-104/), {
      target: { value: 'https://learn.microsoft.com/az-104' },
    });
    fireEvent.click(form.getByRole('button', { name: /^generate$/i }));
    await waitFor(() => expect(generateEpisodes).toHaveBeenCalled());
    expect(generateEpisodes.mock.calls[0][0]).not.toHaveProperty('ttsModel');
  });

  it('says the catalogue could not be read when the speech options fail to load', async () => {
    fetchSpeechOptions.mockRejectedValue(new Error('500'));
    render(<ListenAndLearnPage />);
    await waitFor(() => expect(fetchSpeechOptions).toHaveBeenCalled());
    const examCode = screen.getByPlaceholderText('AZ-104');
    const form = within(examCode.closest('form'));
    await waitFor(() =>
      expect(form.getByTestId('voice-model-line')).toHaveTextContent(
        'The voice model could not be read: 500.'
      )
    );
  });
});

describe('the Settings tab', () => {
  beforeEach(() => {
    resetMocks();
    searchParams = 'tab=settings';
  });

  it('says which model reads by default, lists the voices, and describes the providers from the server', async () => {
    render(<ListenAndLearnPage />);
    // The task's model, its reason and its ceiling, from the server; the
    // choice itself is on the Tasks tab (ADR 0034 slice 5).
    expect(await screen.findByTestId('task-model-line')).toHaveTextContent(
      `Episodes are read with ${ECONOMY} via gemini, at up to $0.22 an episode — recommended for this task: the Economy voice.`
    );
    expect(screen.getByText('Kore · Firm')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AI Engine → Tasks' })).toHaveAttribute(
      'href',
      '/admin/ai-engine?tab=routing'
    );
    fireEvent.click(screen.getByRole('button', { name: /Advanced — providers and fallback/ }));
    expect(screen.getByText('runs today')).toBeInTheDocument();
    expect(screen.getByText(/not for Listen & Learn — podcast only/)).toBeInTheDocument();
    expect(screen.getByText(/not configured — needs AZURE_SPEECH_KEY/)).toBeInTheDocument();
  });
});
