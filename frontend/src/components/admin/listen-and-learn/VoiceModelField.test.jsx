/**
 * The owner's per-run Best/Economy button: what it offers, and that the
 * override can be undone. Moved here with the component when #574 split the
 * page into tabs — the assertions are unchanged.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VoiceModelField from './VoiceModelField';

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

vi.mock('@/lib/listenAndLearn', () => ({
  GEMINI_TTS_MODEL_TIERS: {
    'gemini-3.1-flash-tts-preview': 'Best',
    'gemini-2.5-flash-preview-tts': 'Economy',
  },
}));

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
