/**
 * The expected speech spend is shown when a run is accepted, not after it.
 *
 * ADR 0029 §2a: ElevenLabs is paid per character, so the estimate arrives in
 * the 202 and this page is where an operator reads it before the money goes.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ListenAndLearnPage, { queuedMessage } from './ListenAndLearnPage';

const generateEpisodes = vi.fn();
const fetchSets = vi.fn();
const fetchSetForReview = vi.fn();

vi.mock('@/hooks/useAuthReady', () => ({
  useAuthReady: () => ({ authReady: true }),
}));

vi.mock('@/lib/listenAndLearn', () => ({
  SUPPORTED_PLATFORMS: ['azure', 'github', 'aws'],
  fetchSets: (...args) => fetchSets(...args),
  fetchSetForReview: (...args) => fetchSetForReview(...args),
  generateEpisodes: (...args) => generateEpisodes(...args),
  reviewEpisode: vi.fn(),
}));

vi.mock('@/lib/functionsBase', () => ({
  resolveMediaUrl: (url) => url,
}));

describe('queuedMessage', () => {
  it('states the provider and the ceiling, with the arithmetic', () => {
    expect(
      queuedMessage({
        provider: 'elevenlabs',
        episodes: 8,
        perEpisodeUsd: 0.9,
        estimatedCostUsd: 7.2,
      })
    ).toBe('Queued — speech by ElevenLabs, up to $7.20 (8 episodes × $0.90)');
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

describe('ListenAndLearnPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSets.mockResolvedValue([]);
    fetchSetForReview.mockResolvedValue({ episodes: [] });
  });

  it('loads the sets once auth is ready', async () => {
    render(<ListenAndLearnPage />);
    await waitFor(() => expect(fetchSets).toHaveBeenCalledTimes(1));
  });

  it('shows the expected speech spend as soon as the run is accepted', async () => {
    // The job never finishes during this test; the assertion is about the
    // moment between acceptance and the first poll.
    generateEpisodes.mockImplementation(async ({ onAccepted }) => {
      onAccepted({
        ok: true,
        jobId: 'j1',
        speech: { provider: 'elevenlabs', episodes: 8, perEpisodeUsd: 0.9, estimatedCostUsd: 7.2 },
      });
      return new Promise(() => {});
    });

    render(<ListenAndLearnPage />);
    await waitFor(() => expect(fetchSets).toHaveBeenCalled());

    // Scoped to the study-guide form: since #452 the source-grounding panel
    // has its own Generate button on the same page.
    const examCode = screen.getByPlaceholderText('AZ-104');
    const form = within(examCode.closest('form'));
    fireEvent.change(examCode, { target: { value: 'AZ-104' } });
    fireEvent.change(form.getByPlaceholderText(/study-guides\/az-104/), {
      target: { value: 'https://learn.microsoft.com/az-104' },
    });
    fireEvent.click(form.getByRole('button', { name: /generate/i }));

    expect(
      await screen.findByText('Queued — speech by ElevenLabs, up to $7.20 (8 episodes × $0.90)')
    ).toBeInTheDocument();
    expect(generateEpisodes).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'azure',
        examCode: 'AZ-104',
        studyGuideUrl: 'https://learn.microsoft.com/az-104',
        onAccepted: expect.any(Function),
      })
    );
  });
});
