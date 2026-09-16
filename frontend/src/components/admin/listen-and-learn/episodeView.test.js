/**
 * What a run's 202 turns into on screen.
 *
 * ADR 0029 §2a/§2b: the estimate arrives in the 202 and the Generate tab is
 * where an operator reads it before the money goes; Listen & Learn is Gemini
 * TTS, never ElevenLabs. Moved here with queuedMessage when #574 split the
 * page into tabs — the assertions are unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import { queuedMessage } from './episodeView';

const BEST = 'gemini-3.1-flash-tts-preview';
const ECONOMY = 'gemini-2.5-flash-preview-tts';

vi.mock('@/lib/listenAndLearn', () => ({
  GEMINI_TTS_MODEL_TIERS: {
    'gemini-3.1-flash-tts-preview': 'Best',
    'gemini-2.5-flash-preview-tts': 'Economy',
  },
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
