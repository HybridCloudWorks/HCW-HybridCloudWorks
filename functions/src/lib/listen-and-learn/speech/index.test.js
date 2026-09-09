/**
 * Provider selection.
 *
 * The rule is the AI router's: a key makes a provider possible, and the first
 * configured one in preference order runs. ElevenLabs is first because it is
 * the provider the owner is paying for (ADR 0029 §2a); Gemini follows because
 * it runs on a key the site already holds; Azure needs a paid resource, so it
 * never gets chosen by accident.
 *
 * Until 2026-09-08 this file asserted that `elevenlabs` was NOT a known
 * provider — the record of the deferral in ADR 0029 §2. That assertion is
 * replaced here by tests of the provider, as §2a says it would be.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CONTENT_TYPE,
  DEFAULT_VOICES,
  SpeechNotConfiguredError,
  estimateSpeechCostUsd,
  readSetting,
  resolveSpeechProvider,
  synthesizeDialogue,
} from './index.js';

const ELEVEN = { ELEVENLABS_API_KEY: 'e' };
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

const elevenOk = () =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: (n) => (n === 'character-cost' ? '7' : null) },
    arrayBuffer: async () => Uint8Array.from([0xff, 0xfb, 9, 9]).buffer,
    text: async () => '',
  }));

const QUOTA_BODY = JSON.stringify({ detail: { status: 'quota_exceeded', message: 'no credits' } });
const elevenOutOfCredit = () =>
  vi.fn(async () => ({
    ok: false,
    status: 401,
    headers: { get: () => null },
    text: async () => QUOTA_BODY,
  }));

/** Route by host, so one fetch stub can serve a fallback sequence. */
const byHost = (handlers) =>
  vi.fn(async (url, init) => {
    const host = new URL(url).hostname;
    const handler = Object.entries(handlers).find(([needle]) => host.includes(needle))?.[1];
    if (!handler) throw new Error(`unexpected host ${host}`);
    return handler(url, init);
  });

const noSleep = async () => {};

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
  it('returns nothing when no provider has a key', () => {
    expect(resolveSpeechProvider({})).toBeNull();
  });

  it('prefers ElevenLabs, which is the provider the owner is paying for', () => {
    expect(resolveSpeechProvider({ ...ELEVEN, ...GEMINI, ...AZURE }).name).toBe('elevenlabs');
    expect(resolveSpeechProvider({ ...ELEVEN, ...GEMINI }).name).toBe('elevenlabs');
    expect(resolveSpeechProvider(ELEVEN).name).toBe('elevenlabs');
  });

  it('falls back to Gemini when the ElevenLabs key is absent', () => {
    // The shape of an episode does not change — only the voice does.
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
      resolveSpeechProvider({ ELEVENLABS_API_KEY: '@Microsoft.KeyVault(SecretUri=https://v/s/1)' })
    ).toBeNull();
    expect(
      resolveSpeechProvider({
        ELEVENLABS_API_KEY: '@Microsoft.KeyVault(SecretUri=https://v/s/1)',
        ...GEMINI,
      }).name
    ).toBe('gemini');
  });

  it('honours a pin', () => {
    expect(
      resolveSpeechProvider({ ...ELEVEN, ...GEMINI, ...AZURE, LISTEN_AND_LEARN_TTS_PROVIDER: 'azure' })
        .name
    ).toBe('azure');
    expect(
      resolveSpeechProvider({ ...ELEVEN, ...GEMINI, LISTEN_AND_LEARN_TTS_PROVIDER: 'gemini' }).name
    ).toBe('gemini');
    expect(
      resolveSpeechProvider({ ...ELEVEN, ...GEMINI, LISTEN_AND_LEARN_TTS_PROVIDER: 'ElevenLabs' })
        .name
    ).toBe('elevenlabs');
  });

  it('fails a pin that is not configured rather than falling through', () => {
    // Falling through would silently produce episodes in a voice nobody chose.
    expect(() =>
      resolveSpeechProvider({ ...GEMINI, LISTEN_AND_LEARN_TTS_PROVIDER: 'azure' })
    ).toThrow(/pins "azure", which is not configured/);
    expect(() =>
      resolveSpeechProvider({ ...GEMINI, LISTEN_AND_LEARN_TTS_PROVIDER: 'elevenlabs' })
    ).toThrow(/pins "elevenlabs", which is not configured/);
  });

  it('names the known providers when the pin is not one of them', () => {
    expect(() =>
      resolveSpeechProvider({ ...GEMINI, LISTEN_AND_LEARN_TTS_PROVIDER: 'polly' })
    ).toThrow(/known providers are elevenlabs, gemini, azure/);
  });
});

describe('synthesizeDialogue', () => {
  it('routes to ElevenLabs and reports which provider ran', async () => {
    const fetchImpl = elevenOk();
    const result = await synthesizeDialogue({
      dialogue: DIALOGUE,
      env: { ...ELEVEN, ...GEMINI },
      fetchImpl,
    });

    expect(result.provider).toBe('elevenlabs');
    expect(result.model).toBe('eleven_v3');
    expect(result.fellBackFrom).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain('api.elevenlabs.io');
  });

  it('routes to Gemini when that is the configured one', async () => {
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
    const viaEleven = await synthesizeDialogue({
      dialogue: DIALOGUE,
      env: ELEVEN,
      fetchImpl: elevenOk(),
    });
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

    expect(viaEleven.contentType).toBe(CONTENT_TYPE);
    expect(viaGemini.contentType).toBe(CONTENT_TYPE);
    expect(viaAzure.contentType).toBe(CONTENT_TYPE);
    expect(CONTENT_TYPE).toBe('audio/mpeg');
  });

  describe('out of credit', () => {
    it('falls back to Gemini when ElevenLabs reports its credit is spent', async () => {
      // The state a paid provider has and a free one does not (ADR 0029 §2a).
      const eleven = elevenOutOfCredit();
      const gemini = geminiOk();
      const fetchImpl = byHost({ 'elevenlabs.io': eleven, 'googleapis.com': gemini });

      const result = await synthesizeDialogue({
        dialogue: DIALOGUE,
        env: { ...ELEVEN, ...GEMINI },
        fetchImpl,
        sleep: noSleep,
      });

      expect(result.provider).toBe('gemini');
      expect(result.fellBackFrom).toEqual({
        provider: 'elevenlabs',
        reason: expect.stringMatching(/out of credit \(HTTP 401 quota_exceeded\)/),
      });
      expect(eleven).toHaveBeenCalledTimes(1); // not retried
      expect(gemini).toHaveBeenCalledTimes(1);
    });

    it('surfaces the out-of-credit error when there is nothing to fall back to', async () => {
      const fetchImpl = elevenOutOfCredit();
      await expect(
        synthesizeDialogue({ dialogue: DIALOGUE, env: ELEVEN, fetchImpl, sleep: noSleep })
      ).rejects.toMatchObject({
        name: 'SpeechError',
        provider: 'elevenlabs',
        status: 401,
        code: 'quota_exceeded',
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('does not fall back past a pin — a pin is an instruction', async () => {
      const eleven = elevenOutOfCredit();
      const gemini = geminiOk();
      const fetchImpl = byHost({ 'elevenlabs.io': eleven, 'googleapis.com': gemini });

      await expect(
        synthesizeDialogue({
          dialogue: DIALOGUE,
          env: { ...ELEVEN, ...GEMINI, LISTEN_AND_LEARN_TTS_PROVIDER: 'elevenlabs' },
          fetchImpl,
          sleep: noSleep,
        })
      ).rejects.toMatchObject({ code: 'quota_exceeded' });
      expect(gemini).not.toHaveBeenCalled();
    });

    it('does not fall back on any other failure', async () => {
      // A rejected key or a 5xx elsewhere would hide a fault behind a
      // different voice; only the account state moves on.
      const eleven = vi.fn(async () => ({
        ok: false,
        status: 401,
        headers: { get: () => null },
        text: async () => JSON.stringify({ detail: { status: 'invalid_api_key' } }),
      }));
      const gemini = geminiOk();
      const fetchImpl = byHost({ 'elevenlabs.io': eleven, 'googleapis.com': gemini });

      await expect(
        synthesizeDialogue({
          dialogue: DIALOGUE,
          env: { ...ELEVEN, ...GEMINI },
          fetchImpl,
          sleep: noSleep,
        })
      ).rejects.toThrow(/ElevenLabs HTTP 401/);
      expect(gemini).not.toHaveBeenCalled();
    });
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

  it('names every setting so the message says what to do', async () => {
    await expect(
      synthesizeDialogue({ dialogue: DIALOGUE, env: {}, fetchImpl: vi.fn() })
    ).rejects.toThrow(/ELEVENLABS_API_KEY.*GEMINI_API_KEY.*AZURE_SPEECH_KEY/);
  });

  it('refuses an empty dialogue before choosing a provider', async () => {
    await expect(
      synthesizeDialogue({ dialogue: [{ speaker: 'Maya', text: '  ' }], env: ELEVEN })
    ).rejects.toThrow(/No dialogue turns/);
  });

  it('publishes a default voice map per provider, in preference order', () => {
    expect(Object.keys(DEFAULT_VOICES)).toEqual(['elevenlabs', 'gemini', 'azure']);
    // All name the same two hosts the script writes.
    for (const voices of Object.values(DEFAULT_VOICES)) {
      expect(Object.keys(voices)).toEqual(['Maya', 'Elena']);
    }
  });
});

describe('estimateSpeechCostUsd', () => {
  it('is null when nothing is configured, or the pin is unusable', () => {
    expect(estimateSpeechCostUsd({ dialogue: DIALOGUE, env: {} })).toBeNull();
    expect(
      estimateSpeechCostUsd({
        dialogue: DIALOGUE,
        env: { ...GEMINI, LISTEN_AND_LEARN_TTS_PROVIDER: 'elevenlabs' },
      })
    ).toBeNull();
  });

  it('prices ElevenLabs by characters at the cost-table rate, before any request', () => {
    // 'Hello' + 'Hi' = 7 characters at USD 0.10 per 1,000.
    expect(estimateSpeechCostUsd({ dialogue: DIALOGUE, env: { ...ELEVEN, ...GEMINI } })).toEqual({
      provider: 'elevenlabs',
      model: 'eleven_v3',
      characters: 7,
      estimatedCostUsd: 0.0007,
    });
  });

  it('accepts a character count when there is no dialogue yet', () => {
    // The enqueue handler estimates against the script ceiling: 9,000
    // characters is 90 cents an episode, roughly USD 4.50 for five.
    expect(estimateSpeechCostUsd({ characters: 9000, env: ELEVEN })).toMatchObject({
      provider: 'elevenlabs',
      characters: 9000,
      estimatedCostUsd: 0.9,
    });
  });

  it('gives a best-effort figure for Gemini that over- rather than under-estimates', () => {
    // 9,000 chars ÷ 13 chars/s ≈ 692 s × 32 tokens/s ≈ 22,154 tokens at
    // USD 10 per 1M ≈ USD 0.22 — above the ~USD 0.17 an episode has measured.
    const estimate = estimateSpeechCostUsd({ characters: 9000, env: GEMINI });
    expect(estimate.provider).toBe('gemini');
    expect(estimate.model).toBe('gemini-2.5-flash-preview-tts');
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0.17);
    expect(estimate.estimatedCostUsd).toBeLessThan(0.3);
  });

  it('measures Gemini in bytes, so a non-ASCII script is never priced below its ASCII twin', () => {
    // The speaking rate borrowed from azure.js is UTF-8 bytes per second;
    // dividing a character count by it under-estimated every non-ASCII
    // script (Copilot review on #447). Same code-point length, more bytes.
    const ascii = [{ speaker: 'Maya', text: 'a'.repeat(1300) }];
    const accented = [{ speaker: 'Maya', text: 'é'.repeat(1300) }]; // 2 bytes each
    const cjk = [{ speaker: 'Maya', text: '語'.repeat(1300) }]; // 3 bytes each

    const asciiCost = estimateSpeechCostUsd({ dialogue: ascii, env: GEMINI }).estimatedCostUsd;
    const accentedCost = estimateSpeechCostUsd({ dialogue: accented, env: GEMINI }).estimatedCostUsd;
    const cjkCost = estimateSpeechCostUsd({ dialogue: cjk, env: GEMINI }).estimatedCostUsd;

    expect(asciiCost).toBeGreaterThan(0);
    expect(accentedCost).toBeCloseTo(asciiCost * 2, 6);
    expect(cjkCost).toBeCloseTo(asciiCost * 3, 6);
    // The billed unit for ElevenLabs is still characters, unchanged by width.
    expect(estimateSpeechCostUsd({ dialogue: cjk, env: ELEVEN }).characters).toBe(1300);
    expect(estimateSpeechCostUsd({ dialogue: cjk, env: ELEVEN }).estimatedCostUsd).toBe(
      estimateSpeechCostUsd({ dialogue: ascii, env: ELEVEN }).estimatedCostUsd
    );
  });

  it('treats a bare ceiling as bytes, so it never sits below any script that fits under it', () => {
    // The enqueue path passes MAX_SCRIPT_BYTES with no dialogue. A 9,000-byte
    // script of three-byte characters is the widest that fits.
    const widest = [{ speaker: 'Maya', text: '語'.repeat(3000) }];
    for (const env of [GEMINI, ELEVEN]) {
      const ceiling = estimateSpeechCostUsd({ characters: 9000, env }).estimatedCostUsd;
      const actual = estimateSpeechCostUsd({ dialogue: widest, env }).estimatedCostUsd;
      expect(ceiling).toBeGreaterThanOrEqual(actual);
    }
    // And a plain ASCII script under the ceiling is priced strictly below it.
    const plain = [{ speaker: 'Maya', text: 'a'.repeat(8000) }];
    expect(estimateSpeechCostUsd({ characters: 9000, env: GEMINI }).estimatedCostUsd).toBeGreaterThan(
      estimateSpeechCostUsd({ dialogue: plain, env: GEMINI }).estimatedCostUsd
    );
  });

  it('is honest that Azure Speech is not priced', () => {
    expect(estimateSpeechCostUsd({ characters: 9000, env: AZURE })).toEqual({
      provider: 'azure',
      model: null,
      characters: 9000,
      estimatedCostUsd: null,
    });
  });

  it('follows a pin and a model override', () => {
    const estimate = estimateSpeechCostUsd({
      characters: 1000,
      env: { ...ELEVEN, ...GEMINI, LISTEN_AND_LEARN_TTS_PROVIDER: 'gemini' },
    });
    expect(estimate.provider).toBe('gemini');
    expect(
      estimateSpeechCostUsd({
        characters: 1000,
        env: {
          ...ELEVEN,
          LISTEN_AND_LEARN_TTS_MODEL: 'gemini-3.1-flash-tts-preview',
          LISTEN_AND_LEARN_ELEVENLABS_MODEL: 'eleven_v4',
        },
      })
    ).toMatchObject({ provider: 'elevenlabs', model: 'eleven_v4', estimatedCostUsd: 0.1 });
    // The shared setting still steers Gemini, and prices what Gemini will call.
    expect(
      estimateSpeechCostUsd({
        characters: 1000,
        env: { ...GEMINI, LISTEN_AND_LEARN_TTS_MODEL: 'gemini-2.5-pro-preview-tts' },
      }).model
    ).toBe('gemini-2.5-pro-preview-tts');
  });
});
