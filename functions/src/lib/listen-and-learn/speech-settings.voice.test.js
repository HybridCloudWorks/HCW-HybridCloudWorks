/**
 * Per-book voice settings (ADR 0033 §4): the voices a book may name, the
 * defaults a document without any reads as, and the arguments synthesis
 * receives for a dialogue and for a narrator.
 */
import { describe, it, expect } from 'vitest';
import {
  AZURE_VOICES,
  DEFAULT_VOICE_SETTINGS,
  GEMINI_VOICES,
  GEMINI_VOICE_IDS,
  NARRATOR_SPEAKER,
  SPEAKING_RATE,
  isVoiceName,
  normalizeVoiceSettings,
  speechArgsFor,
  voiceSettingsOf,
} from './speech-settings.js';
import { GEMINI_DEFAULT_VOICES } from './speech/gemini.js';

describe('the voice catalogue', () => {
  it('lists the thirty Gemini voices with a descriptor each, including the two defaults', () => {
    expect(GEMINI_VOICES).toHaveLength(30);
    expect(new Set(GEMINI_VOICE_IDS).size).toBe(30);
    for (const voice of GEMINI_VOICES) expect(voice.descriptor).toBeTruthy();
    expect(GEMINI_VOICE_IDS).toContain(GEMINI_DEFAULT_VOICES.Maya);
    expect(GEMINI_VOICE_IDS).toContain(GEMINI_DEFAULT_VOICES.Elena);
    expect(AZURE_VOICES.length).toBeGreaterThan(0);
  });

  it('accepts the shapes both providers spell a voice in, and nothing executable', () => {
    expect(isVoiceName('Kore')).toBe(true);
    expect(isVoiceName('en-US-Ava:DragonHDLatestNeural')).toBe(true);
    expect(isVoiceName('<script>')).toBe(false);
    expect(isVoiceName('')).toBe(false);
    expect(isVoiceName(7)).toBe(false);
  });
});

describe('normalizeVoiceSettings', () => {
  it('reads nothing as the defaults', () => {
    expect(normalizeVoiceSettings(undefined).value).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(normalizeVoiceSettings(null).value).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(DEFAULT_VOICE_SETTINGS.speakers).toEqual(GEMINI_DEFAULT_VOICES);
  });

  it('fills what the body leaves out and validates what it names', () => {
    const { value } = normalizeVoiceSettings({
      speakers: { Maya: 'Sulafat' },
      language: 'en-GB',
      speakingRate: '1.1',
    });
    expect(value).toEqual({
      provider: 'auto',
      speakers: { Maya: 'Sulafat', Elena: 'Leda' },
      narrator: 'Kore',
      language: 'en-GB',
      speakingRate: 1.1,
    });
  });

  it('refuses a Gemini-bound voice that Gemini does not have, and any other malformed field', () => {
    expect(normalizeVoiceSettings({ narrator: 'Nope' }).error).toMatch(/Gemini voices/);
    expect(normalizeVoiceSettings({ speakers: { Elena: 'en-US-AvaNeural' } }).error).toMatch(
      /Gemini voices/
    );
    expect(normalizeVoiceSettings({ provider: 'elevenlabs' }).error).toMatch(
      /provider must be one of/
    );
    // A model is ignored, not refused: the listenAndLearnSpeech task owns it
    // (ADR 0034 slice 5), and a client from before still saves its book.
    expect(normalizeVoiceSettings({ model: 'gemini-2.5-pro-preview-tts' }).value).toEqual(
      DEFAULT_VOICE_SETTINGS
    );
    expect(normalizeVoiceSettings({ model: 'gemini-3.1-flash-tts-preview' }).value).not.toHaveProperty(
      'model'
    );
    expect(normalizeVoiceSettings({ language: 'english' }).error).toMatch(/BCP 47/);
    expect(normalizeVoiceSettings({ speakingRate: SPEAKING_RATE.max + 1 }).error).toMatch(
      /speakingRate/
    );
    expect(normalizeVoiceSettings([]).error).toMatch(/object/);
  });

  it('lets an Azure book name any well-formed Azure voice', () => {
    const { value } = normalizeVoiceSettings({ provider: 'azure', narrator: 'en-US-AvaNeural' });
    expect(value.narrator).toBe('en-US-AvaNeural');
    expect(value.provider).toBe('azure');
  });

  it('voiceSettingsOf never fails a read: a bad stored voice reads as the defaults', () => {
    expect(voiceSettingsOf({ voice: { narrator: 'Nope' } })).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(voiceSettingsOf(null)).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(voiceSettingsOf({ voice: { narrator: 'Puck' } }).narrator).toBe('Puck');
  });
});

describe('speechArgsFor', () => {
  it('hands the hosts their voices and passes no provider for auto', () => {
    expect(speechArgsFor(DEFAULT_VOICE_SETTINGS)).toEqual({
      voices: { Maya: 'Kore', Elena: 'Leda' },
      lang: 'en-US',
      speakingRate: 1,
      provider: null,
    });
  });

  it('hands a narrator chapter one voice and an explicit provider through, never a model (the task’s)', () => {
    const voice = {
      ...DEFAULT_VOICE_SETTINGS,
      provider: 'azure',
      model: 'gemini-3.1-flash-tts-preview',
      narrator: 'Puck',
    };
    expect(speechArgsFor(voice, { narrator: true })).toEqual({
      voices: { [NARRATOR_SPEAKER]: 'Puck' },
      lang: 'en-US',
      speakingRate: 1,
      provider: 'azure',
    });
  });
});
