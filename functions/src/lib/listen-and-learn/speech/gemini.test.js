/**
 * Gemini TTS — the default provider.
 *
 * The request shape is pinned against the published contract because every
 * part of it is load-bearing in a way that fails quietly rather than loudly:
 * a speaker label that does not match its `speech_config` entry is read aloud
 * as text instead of switching voice, and a 200 with no audio is a real
 * outcome rather than an impossible one.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  GEMINI_DEFAULT_VOICES,
  buildDialoguePrompt,
  readVoiceOverrides,
  speakersIn,
  synthesizeWithGemini,
} from './gemini.js';

const KEYED_ENV = { GEMINI_API_KEY: 'g-key' };

/** 0.1s of 24 kHz mono PCM, which is enough for the encoder to emit frames. */
const pcmBase64 = (samples = 2400) =>
  Buffer.from(new Int16Array(samples).fill(1000).buffer).toString('base64');

const audioResponse = (over = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ output_audio: { data: pcmBase64(), sample_rate: 24000, ...over } }),
});

const turn = (speaker, text) => ({ speaker, text });
const DIALOGUE = [turn('Maya', 'Hello there'), turn('Elena', 'Hi back'), turn('Maya', 'And so')];

describe('the transcript prompt', () => {
  it('labels every turn with the speaker whose voice is configured', () => {
    // A label that does not match a speech_config entry is spoken as text —
    // "Maya colon" before each line — instead of switching voice.
    const prompt = buildDialoguePrompt(DIALOGUE, ['Maya', 'Elena']);

    expect(prompt.startsWith('TTS the following conversation between Maya and Elena:')).toBe(true);
    expect(prompt).toContain('Maya: Hello there');
    expect(prompt).toContain('Elena: Hi back');
  });

  it('separates turns by line, so they are not merged into a paragraph', () => {
    const prompt = buildDialoguePrompt(DIALOGUE, ['Maya', 'Elena']);
    expect(prompt.split('\n')).toHaveLength(4); // instruction + 3 turns
  });

  it('lists speakers in first-appearance order', () => {
    expect(speakersIn(DIALOGUE)).toEqual(['Maya', 'Elena']);
    expect(speakersIn([turn('Elena', 'x'), turn('Maya', 'y')])).toEqual(['Elena', 'Maya']);
    expect(speakersIn([])).toEqual([]);
  });
});

describe('voices', () => {
  it('pairs the two hosts with distinct voices', () => {
    const voices = Object.values(GEMINI_DEFAULT_VOICES);
    expect(voices).toHaveLength(2);
    expect(new Set(voices).size).toBe(2); // a listener must tell them apart
  });

  it('reads per-host overrides from the environment', () => {
    expect(readVoiceOverrides({ LISTEN_AND_LEARN_VOICE_MAYA: 'Aoede' })).toEqual({ Maya: 'Aoede' });
    expect(readVoiceOverrides({})).toEqual({});
  });

  it('lets an override outrank the default', async () => {
    const fetchImpl = vi.fn(async () => audioResponse());
    await synthesizeWithGemini({
      dialogue: DIALOGUE,
      env: { ...KEYED_ENV, LISTEN_AND_LEARN_VOICE_MAYA: 'Aoede' },
      fetchImpl,
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.generation_config.speech_config).toEqual([
      { speaker: 'Maya', voice: 'Aoede' },
      { speaker: 'Elena', voice: GEMINI_DEFAULT_VOICES.Elena },
    ]);
  });
});

describe('the request', () => {
  it('posts the documented shape to the interactions endpoint', async () => {
    const fetchImpl = vi.fn(async () => audioResponse());
    await synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(init.headers['x-goog-api-key']).toBe('g-key');
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body.response_format).toEqual({ type: 'audio' });
    expect(body.model).toBe('gemini-2.5-flash-preview-tts');
    expect(body.generation_config.speech_config).toEqual([
      { speaker: 'Maya', voice: GEMINI_DEFAULT_VOICES.Maya },
      { speaker: 'Elena', voice: GEMINI_DEFAULT_VOICES.Elena },
    ]);
  });

  it('sends the whole episode in one request', async () => {
    // A 9,000-byte script is roughly 2.5k tokens against a 32k session window,
    // so unlike the Azure path there is nothing to chunk.
    const long = Array.from({ length: 60 }, (_, i) =>
      turn(i % 2 ? 'Elena' : 'Maya', 'word '.repeat(30))
    );
    const fetchImpl = vi.fn(async () => audioResponse());
    const result = await synthesizeWithGemini({ dialogue: long, env: KEYED_ENV, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.requests).toBe(1);
  });

  it('honours a model override without a deploy', async () => {
    const fetchImpl = vi.fn(async () => audioResponse());
    await synthesizeWithGemini({
      dialogue: DIALOGUE,
      env: { ...KEYED_ENV, LISTEN_AND_LEARN_TTS_MODEL: 'gemini-3.1-flash-tts-preview' },
      fetchImpl,
    });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('gemini-3.1-flash-tts-preview');
  });
});

describe('the two-speaker limit', () => {
  it('refuses a third speaker with a message naming them', async () => {
    // The API accepts at most two; a third would come back as an opaque 400.
    const fetchImpl = vi.fn();
    await expect(
      synthesizeWithGemini({
        dialogue: [turn('Maya', 'a'), turn('Elena', 'b'), turn('Sam', 'c')],
        env: KEYED_ENV,
        fetchImpl,
      })
    ).rejects.toThrow(/at most 2 speakers; this dialogue has 3 \(Maya, Elena, Sam\)/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a speaker with no voice rather than sending a nameless one', async () => {
    await expect(
      synthesizeWithGemini({
        dialogue: [turn('Nobody', 'x')],
        env: KEYED_ENV,
        fetchImpl: vi.fn(),
      })
    ).rejects.toThrow(/No voice configured for speaker Nobody/);
  });

  it('handles a monologue, which is within the limit', async () => {
    const fetchImpl = vi.fn(async () => audioResponse());
    await synthesizeWithGemini({
      dialogue: [turn('Maya', 'Solo episode')],
      env: KEYED_ENV,
      fetchImpl,
    });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).generation_config.speech_config).toEqual([
      { speaker: 'Maya', voice: GEMINI_DEFAULT_VOICES.Maya },
    ]);
  });
});

describe('the response', () => {
  it('returns MP3, not the PCM the API sent', async () => {
    // The API has no output-format option, and the delivery route buffers a
    // whole blob into memory — so 48 KB/s of PCM never reaches storage.
    const fetchImpl = vi.fn(async () => audioResponse());
    const result = await synthesizeWithGemini({
      dialogue: DIALOGUE,
      env: KEYED_ENV,
      fetchImpl,
    });

    expect(result.audio[0]).toBe(0xff); // MPEG frame sync
    expect(result.audio[1] & 0xe0).toBe(0xe0);
    expect(result.bytes).toBe(result.audio.length);
    expect(result.model).toBe('gemini-2.5-flash-preview-tts');
  });

  it('is materially smaller than the PCM it encoded', async () => {
    const samples = 24000 * 4; // 4 seconds
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ output_audio: { data: pcmBase64(samples), sample_rate: 24000 } }),
    }));

    const result = await synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl });
    expect(result.audio.length).toBeLessThan(samples * 2 * 0.5);
    expect(result.estimatedSeconds).toBe(4);
  });

  it('treats a 200 with no audio as a failure, not an empty episode', async () => {
    // A safety block, or a model that answered in text, both land here.
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    await expect(
      synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl })
    ).rejects.toThrow(/returned no audio/);
  });

  it('uses the sample rate the response reports', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ output_audio: { data: pcmBase64(16000), sample_rate: 16000 } }),
    }));
    const result = await synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl });
    expect(result.estimatedSeconds).toBe(1);
  });
});

describe('failures', () => {
  it('reports a missing key as not-configured so the caller can degrade', async () => {
    const fetchImpl = vi.fn();
    await expect(
      synthesizeWithGemini({ dialogue: DIALOGUE, env: {}, fetchImpl })
    ).rejects.toThrow(/GEMINI_API_KEY is not configured/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats an unresolved Key Vault reference as no key at all', async () => {
    await expect(
      synthesizeWithGemini({
        dialogue: DIALOGUE,
        env: { GEMINI_API_KEY: '@Microsoft.KeyVault(SecretUri=https://v/s/1)' },
        fetchImpl: vi.fn(),
      })
    ).rejects.toThrow(/GEMINI_API_KEY is not configured/);
  });

  it('retries a 429 and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'slow down' })
      .mockResolvedValueOnce(audioResponse());

    const result = await synthesizeWithGemini({
      dialogue: DIALOGUE,
      env: KEYED_ENV,
      fetchImpl,
      sleep: async () => {},
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.audio.length).toBeGreaterThan(0);
  });

  it('does not retry a rejected key or a bad request', async () => {
    for (const status of [400, 401, 403]) {
      const fetchImpl = vi.fn(async () => ({ ok: false, status, text: async () => 'no' }));
      await expect(
        synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl, sleep: async () => {} })
      ).rejects.toThrow(new RegExp(`Gemini TTS HTTP ${status}`));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('gives up after the attempt ceiling on a persistent 5xx', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, text: async () => 'down' }));
    await expect(
      synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl, sleep: async () => {} })
    ).rejects.toThrow(/Gemini TTS HTTP 503/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('tags its errors so the selector and the caller can tell them apart', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400, text: async () => 'bad' }));
    await synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl }).catch((err) => {
      expect(err.name).toBe('SpeechError');
      expect(err.provider).toBe('gemini');
      expect(err.status).toBe(400);
    });
  });
});
