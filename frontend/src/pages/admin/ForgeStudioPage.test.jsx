import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ForgeStudioPage from './ForgeStudioPage';

const getJSON = vi.fn();
const postJSON = vi.fn();
const runJob = vi.fn();

vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));
vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  postJSON: (...args) => postJSON(...args),
}));
vi.mock('@/lib/jobs', () => ({ runJob: (...args) => runJob(...args) }));

const CONFIG = {
  ok: true,
  profile: {
    wordSoup: 'I run a homelab.',
    interestAreas: [
      { key: 'hybrid_arch', label: 'Hybrid Architecture', weight: 90, keywords: ['vmware'] },
    ],
    certifications: [],
    speakingTopics: [],
  },
  suggestions: {
    generatedAt: '2026-08-28T00:00:00Z',
    postCount: 4,
    wordSoupAdditions: ['Prefers boring technology'],
    styleHints: ['Short sentences'],
    recurringPhrases: ['blast radius'],
  },
  prompts: {
    masterPrompt: 'Write like me.',
    extraBannedPhrases: ['delve'],
    styleRules: { noEmDash: true, noHyphenTells: true, custom: [] },
    publishThreshold: 80,
    autoForge: { enabled: false, dailyLimit: 3 },
  },
  formats: [{ key: 'how_to', label: 'How-To / Tutorial', wordRange: [1000, 1500] }],
  stats: { totals: { forged: 7 }, formats: {}, updatedAt: null },
};

describe('ForgeStudioPage', () => {
  beforeEach(() => {
    getJSON.mockReset();
    postJSON.mockReset();
    runJob.mockReset();
    getJSON.mockResolvedValue(CONFIG);
  });

  it('loads and renders the voice configuration', async () => {
    render(<ForgeStudioPage />);
    expect(await screen.findByText('Forge Studio')).toBeInTheDocument();
    expect(screen.getByLabelText(/Word soup/)).toHaveValue('I run a homelab.');
    expect(screen.getByLabelText('Master prompt')).toHaveValue('Write like me.');
    expect(screen.getByLabelText(/Publish threshold/)).toHaveValue(80);
    expect(screen.getByText('How-To / Tutorial')).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith('getForgeConfig');
  });

  it('saves the whitelisted payload shape and applies the response', async () => {
    postJSON.mockResolvedValue({ ...CONFIG, prompts: { ...CONFIG.prompts, publishThreshold: 85 } });
    render(<ForgeStudioPage />);
    await screen.findByText('Forge Studio');

    fireEvent.change(screen.getByLabelText(/Publish threshold/), { target: { value: '85' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));

    await waitFor(() => expect(postJSON).toHaveBeenCalled());
    expect(postJSON.mock.calls[0][0]).toBe('updateForgeConfig');
    expect(postJSON.mock.calls[0][1].prompts.publishThreshold).toBe(85);
    expect(postJSON.mock.calls[0][1].profile.wordSoup).toBe('I run a homelab.');
    expect(postJSON.mock.calls[0][1].profile.interestAreas[0]).toEqual({
      key: 'hybrid_arch',
      label: 'Hybrid Architecture',
      weight: 90,
      keywords: ['vmware'],
    });
    expect(await screen.findByText(/Saved\./)).toBeInTheDocument();
  });

  it('accepting a suggestion appends it to the word soup and trims the chip list', async () => {
    postJSON.mockResolvedValue({
      ...CONFIG,
      profile: { ...CONFIG.profile, wordSoup: 'I run a homelab.\nPrefers boring technology' },
      suggestions: { ...CONFIG.suggestions, wordSoupAdditions: [] },
    });
    render(<ForgeStudioPage />);
    await screen.findByText('Forge Studio');

    fireEvent.click(
      screen.getByRole('button', { name: 'Accept suggestion: Prefers boring technology' })
    );

    await waitFor(() => expect(postJSON).toHaveBeenCalled());
    expect(postJSON.mock.calls[0][1].profile.wordSoup).toBe(
      'I run a homelab.\nPrefers boring technology'
    );
    expect(postJSON.mock.calls[0][1].profile.suggestionsKept).toEqual([]);
  });

  it('removing the first row keeps the remaining row’s values (stable keys)', async () => {
    getJSON.mockResolvedValue({
      ...CONFIG,
      profile: {
        ...CONFIG.profile,
        // No other row lists in this fixture, so "Remove row 1" is
        // unambiguous — it can only be the first certification.
        interestAreas: [],
        certifications: [
          { name: 'AZ-104', issuer: 'Microsoft', keywords: ['azure'] },
          { name: 'SAA-C03', issuer: 'AWS', keywords: ['aws'] },
        ],
      },
    });
    render(<ForgeStudioPage />);
    await screen.findByText('Forge Studio');

    const nameInputs = () => screen.getAllByLabelText('Name');
    expect(nameInputs().map((input) => input.value)).toEqual(['AZ-104', 'SAA-C03']);

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove row 1' })[0]);

    // The exact bug class index keys cause: the survivor must be SAA-C03,
    // not AZ-104's DOM node wearing SAA-C03's position.
    expect(nameInputs().map((input) => input.value)).toEqual(['SAA-C03']);
  });

  it('calibration runs the job and reloads the config', async () => {
    runJob.mockResolvedValue({ status: 'succeeded', result: {} });
    render(<ForgeStudioPage />);
    await screen.findByText('Forge Studio');
    getJSON.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Calibrate from my published posts/ }));

    await waitFor(() =>
      expect(runJob).toHaveBeenCalledWith('voice-calibration', {}, expect.any(Object))
    );
    await waitFor(() => expect(getJSON).toHaveBeenCalledWith('getForgeConfig'));
    expect(await screen.findByText(/Calibration complete/)).toBeInTheDocument();
  });
});
