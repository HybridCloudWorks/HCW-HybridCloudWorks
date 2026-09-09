/**
 * The Gemini model choice: two ids, priced, with the precedence the job
 * applies (run → stored → null for the setting and module default).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  LISTEN_AND_LEARN_GEMINI_MODELS,
  LISTEN_AND_LEARN_GEMINI_MODEL_IDS,
  LISTEN_AND_LEARN_SPEECH_CONFIG_ID,
  MODEL_CHOICE_RULE,
  isListenAndLearnGeminiModel,
  listenAndLearnModelOptions,
  parseTtsModel,
  readStoredListenAndLearnModel,
  resolveListenAndLearnModel,
} from './speech-settings.js';
import { GEMINI_DEFAULT_MODEL } from './speech/gemini.js';
import { estimateGeminiCostUsd } from './speech/index.js';
import { MAX_SCRIPT_BYTES } from './script.js';
import { COST_TABLE } from '../ai/router.js';
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';

const BEST = 'gemini-3.1-flash-tts-preview';
const ECONOMY = 'gemini-2.5-flash-preview-tts';

describe('the two choices', () => {
  it('are Best (3.1, the module default) and Economy (2.5), in that order, with the owner’s labels', () => {
    expect(LISTEN_AND_LEARN_GEMINI_MODELS).toEqual([
      { id: BEST, tier: 'best', label: 'Best — newest voice, about twice the cost' },
      { id: ECONOMY, tier: 'economy', label: 'Economy — cheaper' },
    ]);
    expect(LISTEN_AND_LEARN_GEMINI_MODEL_IDS).toEqual([BEST, ECONOMY]);
    expect(GEMINI_DEFAULT_MODEL).toBe(BEST);
    expect(Object.isFrozen(LISTEN_AND_LEARN_GEMINI_MODELS)).toBe(true);
  });

  it('are both priced in the cost table, Economy at half', () => {
    // "About twice the cost" on the Best label is a claim about COST_TABLE.
    const [, bestOut] = COST_TABLE.gemini[BEST];
    const [, economyOut] = COST_TABLE.gemini[ECONOMY];
    expect(bestOut).toBe(economyOut * 2);
  });

  it('are the only ids accepted, matched exactly', () => {
    expect(isListenAndLearnGeminiModel(BEST)).toBe(true);
    expect(isListenAndLearnGeminiModel(ECONOMY)).toBe(true);
    expect(isListenAndLearnGeminiModel('gemini-2.5-pro-preview-tts')).toBe(false);
    expect(isListenAndLearnGeminiModel(` ${BEST}`)).toBe(false);
    expect(isListenAndLearnGeminiModel(null)).toBe(false);
    expect(isListenAndLearnGeminiModel(['gemini-3.1-flash-tts-preview'])).toBe(false);
  });
});

describe('parseTtsModel', () => {
  it('reads absent as "the stored default" and anything else as one of the two, or a sentence', () => {
    expect(parseTtsModel(undefined)).toEqual({ value: null });
    expect(parseTtsModel(null)).toEqual({ value: null });
    expect(parseTtsModel('')).toEqual({ value: null });
    expect(parseTtsModel(BEST)).toEqual({ value: BEST });
    expect(parseTtsModel(ECONOMY)).toEqual({ value: ECONOMY });
    expect(parseTtsModel('gemini-2.5-pro-preview-tts')).toEqual({ error: MODEL_CHOICE_RULE });
    expect(parseTtsModel(0)).toEqual({ error: MODEL_CHOICE_RULE });
    expect(MODEL_CHOICE_RULE).toBe(`ttsModel must be one of ${BEST}, ${ECONOMY}`);
  });
});

describe('listenAndLearnModelOptions', () => {
  it('prices each choice at the script ceiling with the 202’s arithmetic', () => {
    const options = listenAndLearnModelOptions();
    expect(options.map((o) => o.id)).toEqual([BEST, ECONOMY]);
    for (const option of options) {
      expect(option.perEpisodeUsd).toBe(estimateGeminiCostUsd(option.id, MAX_SCRIPT_BYTES));
      expect(option.perEpisodeUsd).toBeGreaterThan(0);
    }
    expect(options[1].perEpisodeUsd).toBeCloseTo(options[0].perEpisodeUsd / 2, 6);
    // A fresh array each call; the frozen table is not handed out to be edited.
    expect(Object.isFrozen(options)).toBe(false);
  });
});

describe('the stored default', () => {
  it('is read from admin_config/listen_and_learn_speech at the admin_config partition', async () => {
    const readDoc = vi.fn(async () => ({ geminiModel: ECONOMY }));
    expect(await readStoredListenAndLearnModel(readDoc)).toBe(ECONOMY);
    expect(readDoc).toHaveBeenCalledWith(
      'admin_config',
      LISTEN_AND_LEARN_SPEECH_CONFIG_ID,
      ADMIN_CONFIG_PARTITION
    );
    expect(LISTEN_AND_LEARN_SPEECH_CONFIG_ID).toBe('listen_and_learn_speech');
  });

  it('is null for no document, a document without the field, or a hand-seeded id that is not offered', async () => {
    expect(await readStoredListenAndLearnModel(vi.fn(async () => null))).toBeNull();
    expect(await readStoredListenAndLearnModel(vi.fn(async () => ({})))).toBeNull();
    expect(
      await readStoredListenAndLearnModel(vi.fn(async () => ({ geminiModel: 'gemini-2.5-pro-preview-tts' })))
    ).toBeNull();
  });

  it('does not swallow a read failure', async () => {
    await expect(
      readStoredListenAndLearnModel(
        vi.fn(async () => {
          throw new Error('Cosmos unavailable');
        })
      )
    ).rejects.toThrow('Cosmos unavailable');
  });
});

describe('resolveListenAndLearnModel', () => {
  it('prefers the run, then the stored default, then nothing', () => {
    expect(resolveListenAndLearnModel({ requested: ECONOMY, stored: BEST })).toBe(ECONOMY);
    expect(resolveListenAndLearnModel({ requested: null, stored: BEST })).toBe(BEST);
    expect(resolveListenAndLearnModel({ requested: null, stored: null })).toBeNull();
    expect(resolveListenAndLearnModel()).toBeNull();
  });
});
