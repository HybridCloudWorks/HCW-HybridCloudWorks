/**
 * Provider selection.
 *
 * The rule is the AI router's: a key makes a provider possible, and the first
 * configured one in preference order runs. Gemini is first because it runs on
 * a key the site already holds; Azure needs a paid resource, so it never gets
 * chosen by accident.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CONTENT_TYPE,
  DEFAULT_VOICES,
  SpeechNotConfiguredError,
  readSetting,
  resolveSpeechProvider,
  synthesizeDialogue,
} from './index.js';

const GEMINI = { GEMINI_API_KEY: 'g' };
const AZURE = { AZURE_SPEECH_KEY: 'a', AZURE_SPEECH_REGION: 'eastus' };

const DIALOGUE = [
  { speaker: 'Maya', text: 'Hello' },
  { speaker: 'Elena', text: 'Hi' },
];

const pcmBase64 = (samples = 2400) =>
  Buffer.from(new Int16Array(samples).fill(500).buffer).toString('base64');

const geminiOk = () =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ output_audio: { data: pcmBase64(), sample_rate: 24000 } }),
  }));

const azureOk = () =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => Uint8Array.from([0xff, 0xfb, 1, 2]).buffer,
  }));

describe('readSetting', () => {
  it('treats an unresolved Key Vault reference as absent, not as a key', () => {
    // App Service hands the literal string through when a reference fails to
    // resolve. Sending it as a key produces a 401 that looks like a bad secret.
    expect(readSetting({ K: '@Microsoft.KeyVault(SecretUri=https://v/s/1)' }, 'K')).toBe('');
    expect(readSetting({ K: '  k  ' }, 'K')).toBe('k');
    expect(readSetting({}, 'K')).toBe('');
  });
});

describe('resolveSpeechProvider', () => {
  it('returns nothing when neither provider has a key', () => {
    expect(resolveSpeechProvider({})).toBeNull();
  });

  it('prefers Gemini, which runs on a key the site already holds', () => {
    expect(resolveSpeechProvider({ ...GEMINI, ...AZURE }).name).toBe('gemini');
    expect(resolveSpeechProvider(GEMINI).name).toBe('gemini');
  });

  it('falls back to Azure when only it is configured', () => {
    expect(resolveSpeechProvider(AZURE).name).toBe('azure');
  });

  it('does not count an Azure key with nowhere to send it', () => {
    // A key and no region is not a usable configuration; treating it as one
    // would pick Azure and then fail every episode.
    expect(resolveSpeechProvider({ AZURE_SPEECH_KEY: 'a' })).toBeNull();
    expect(
      resolveSpeechProvider({
        AZURE_SPEECH_KEY: 'a',
        AZURE_SPEECH_ENDPOINT: 'https://h/cognitiveservices/v1',
      }).name
    ).toBe('azure');
  });

  it('ignores an unresolved Key Vault reference when deciding', () => {
    expect(
      resolveSpeechProvider({ GEMINI_API_KEY: '@Microsoft.KeyVault(SecretUri=https://v/s/1)' })
    ).toBeNull();
  });

  it('honours a pin', () => {
    expect(
      resolveSpeechProvider({ ...GEMINI, ...AZURE, LISTEN_AND_LEARN_TTS_PROVIDER: 'azure' }).name
    ).toBe('azure');
  });

  it('fails a pin that is not configured rather than falling through', () => {
    // Falling through would silently produce episodes in a voice nobody chose.
    expect(() =>
      resolveSpeechProvider({ ...GEMINI, LISTEN_AND_LEARN_TTS_PROVIDER: 'azure' })
    ).toThrow(/pins "azure", which is not configured/);
  });

  it('names the known providers when the pin is not one of them', () => {
    expect(() =>
      resolveSpeechProvider({ ...GEMINI, LISTEN_AND_LEARN_TTS_PROVIDER: 'elevenlabs' })
    ).toThrow(/known providers are gemini, azure/);
  });
});

describe('synthesizeDialogue', () => {
  it('routes to Gemini and reports which provider ran', async () => {
    const fetchImpl = geminiOk();
    const result = await synthesizeDialogue({ dialogue: DIALOGUE, env: GEMINI, fetchImpl });

    expect(result.provider).toBe('gemini');
    expect(fetchImpl.mock.calls[0][0]).toContain('generativelanguage.googleapis.com');
  });

  it('routes to Azure when that is the configured one', async () => {
    const fetchImpl = azureOk();
    const result = await synthesizeDialogue({ dialogue: DIALOGUE, env: AZURE, fetchImpl });

    expect(result.provider).toBe('azure');
    expect(fetchImpl.mock.calls[0][0]).toContain('tts.speech.microsoft.com');
  });

  it('returns the same content type whichever provider ran', async () => {
    // The provider is an implementation detail of this directory: the blob
    // path, the stored contentType and the <audio> element must not vary.
    const viaGemini = await synthesizeDialogue({
      dialogue: DIALOGUE,
      env: GEMINI,
      fetchImpl: geminiOk(),
    });
    const viaAzure = await synthesizeDialogue({
      dialogue: DIALOGUE,
      env: AZURE,
      fetchImpl: azureOk(),
    });

    expect(viaGemini.contentType).toBe(CONTENT_TYPE);
    expect(viaAzure.contentType).toBe(CONTENT_TYPE);
    expect(CONTENT_TYPE).toBe('audio/mpeg');
  });

  it('degrades with a distinguishable error when nothing is configured', async () => {
    // generate.js keys off this name to publish a transcript-only episode
    // rather than failing the area.
    const fetchImpl = vi.fn();
    await expect(
      synthesizeDialogue({ dialogue: DIALOGUE, env: {}, fetchImpl })
    ).rejects.toBeInstanceOf(SpeechNotConfiguredError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('names both settings so the message says what to do', async () => {
    await expect(
      synthesizeDialogue({ dialogue: DIALOGUE, env: {}, fetchImpl: vi.fn() })
    ).rejects.toThrow(/GEMINI_API_KEY.*AZURE_SPEECH_KEY/);
  });

  it('refuses an empty dialogue before choosing a provider', async () => {
    await expect(
      synthesizeDialogue({ dialogue: [{ speaker: 'Maya', text: '  ' }], env: GEMINI })
    ).rejects.toThrow(/No dialogue turns/);
  });

  it('publishes a default voice map per provider', () => {
    expect(Object.keys(DEFAULT_VOICES)).toEqual(['gemini', 'azure']);
    // Both name the same two hosts the script writes.
    expect(Object.keys(DEFAULT_VOICES.gemini)).toEqual(['Maya', 'Elena']);
    expect(Object.keys(DEFAULT_VOICES.azure)).toEqual(['Maya', 'Elena']);
  });
});
