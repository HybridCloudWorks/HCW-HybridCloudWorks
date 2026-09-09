/**
 * Gemini TTS — the default provider.
 *
 * The request shape is pinned against the published contract because every
 * part of it is load-bearing in a way that fails quietly rather than loudly:
 * a speaker label that does not match its `speech_config` entry is read aloud
 * as text instead of switching voice, and a 200 with no audio is a real
 * outcome rather than an impossible one.
 *
 * The response fixtures are the REST Interaction object — audio under
 * `steps[].content[]` — because parsing the SDK's `output_audio` accessor
 * instead is what made every production reply read as "no audio" (#458).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  GEMINI_DEFAULT_MODEL,
  GEMINI_DEFAULT_VOICES,
  buildDialoguePrompt,
  downmixToMono,
  extractAudio,
  parseWav,
  readVoiceOverrides,
  speakersIn,
  synthesizeWithGemini,
} from './gemini.js';

const KEYED_ENV = { GEMINI_API_KEY: 'g-key' };

/** 0.1s of 24 kHz mono PCM, which is enough for the encoder to emit frames. */
const pcmBase64 = (samples = 2400, value = 1000) =>
  Buffer.from(new Int16Array(samples).fill(value).buffer).toString('base64');

/** One audio content block, as the REST reply carries it. */
const audioBlock = (over = {}) => ({
  type: 'audio',
  data: pcmBase64(),
  mime_type: 'audio/L16',
  sample_rate: 24000,
  channels: 1,
  ...over,
});

/** A completed Interaction whose only model output is `content`. */
const interaction = (content = [audioBlock()], over = {}) => ({
  id: 'int-1',
  status: 'completed',
  steps: [{ type: 'model_output', content }],
  ...over,
});

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload });
const audioResponse = () => ok(interaction());

/** A canonical 44-byte-header WAV around the given samples. */
function wav(samples, { sampleRate = 24000, channels = 1 } = {}) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

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

  it('uses voices the speech guide lists', () => {
    // Kore (Firm) and Leda (Youthful) are in the 30-voice list as of
    // 2026-09-09; a voice the API does not know is a 400 at generation time.
    expect(GEMINI_DEFAULT_VOICES).toEqual({ Maya: 'Kore', Elena: 'Leda' });
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
    expect(body.model).toBe('gemini-3.1-flash-tts-preview');
    expect(body.generation_config.speech_config).toEqual([
      { speaker: 'Maya', voice: GEMINI_DEFAULT_VOICES.Maya },
      { speaker: 'Elena', voice: GEMINI_DEFAULT_VOICES.Elena },
    ]);
  });

  it('defaults to the 3.1 flash model the owner asked for', () => {
    expect(GEMINI_DEFAULT_MODEL).toBe('gemini-3.1-flash-tts-preview');
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
      env: { ...KEYED_ENV, LISTEN_AND_LEARN_TTS_MODEL: 'gemini-2.5-pro-preview-tts' },
      fetchImpl,
    });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('gemini-2.5-pro-preview-tts');
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
  it('reads the audio from the model_output step, where the REST reply puts it', async () => {
    // This is the production bug: the reply has no `output_audio`, and a
    // parser that only looked there reported "no audio" on every episode.
    const samples = 24000 * 4; // 4 seconds
    const fetchImpl = vi.fn(async () => ok(interaction([audioBlock({ data: pcmBase64(samples) })])));

    const result = await synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl });

    expect(result.audio[0]).toBe(0xff); // MPEG frame sync
    expect(result.audio[1] & 0xe0).toBe(0xe0);
    expect(result.bytes).toBe(result.audio.length);
    expect(result.estimatedSeconds).toBe(4);
    expect(result.model).toBe('gemini-3.1-flash-tts-preview');
  });

  it('still reads the SDK-style output_audio field if a REST revision adds it', async () => {
    const fetchImpl = vi.fn(async () =>
      ok({ output_audio: { data: pcmBase64(24000), sample_rate: 24000 } })
    );
    const result = await synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl });

    expect(result.audio[0]).toBe(0xff);
    expect(result.estimatedSeconds).toBe(1);
  });

  it('returns MP3, not the PCM the API sent', async () => {
    // The API has no output-format option, and the delivery route buffers a
    // whole blob into memory — so 48 KB/s of PCM never reaches storage.
    const samples = 24000 * 4;
    const fetchImpl = vi.fn(async () => ok(interaction([audioBlock({ data: pcmBase64(samples) })])));

    const result = await synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl });
    expect(result.audio.length).toBeLessThan(samples * 2 * 0.5);
  });

  it('uses the sample rate the block reports', async () => {
    const fetchImpl = vi.fn(async () =>
      ok(interaction([audioBlock({ data: pcmBase64(16000), sample_rate: 16000 })]))
    );
    const result = await synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl });
    expect(result.estimatedSeconds).toBe(1);
  });

  it('assumes 24 kHz mono when the block says nothing about its format', () => {
    // The audio block documents no defaults; the speech guide says the models
    // produce 24 kHz 16-bit PCM, and that is the assumption written down.
    const found = extractAudio(interaction([{ type: 'audio', data: pcmBase64(2400) }]));
    expect(found).toMatchObject({ sampleRate: 24000, channels: 1 });
    expect(found.pcm.length).toBe(4800);
  });

  it('strips a WAV header and reads the rate and channels from it', () => {
    const samples = new Int16Array(16000).fill(700);
    const data = wav(samples, { sampleRate: 16000 }).toString('base64');

    const found = extractAudio(interaction([{ type: 'audio', data, mime_type: 'audio/wav' }]));

    expect(found.pcm.length).toBe(samples.byteLength); // 44 header bytes gone
    expect(found.sampleRate).toBe(16000);
    expect(found.channels).toBe(1);
    expect(found.pcm.readInt16LE(0)).toBe(700);
  });

  it('recognises RIFF bytes even when the mime type says raw PCM', () => {
    const data = wav(new Int16Array(2400), { sampleRate: 22050 }).toString('base64');
    const found = extractAudio(
      interaction([{ type: 'audio', data, mime_type: 'audio/L16', sample_rate: 24000 }])
    );
    expect(found.sampleRate).toBe(22050);
    expect(found.pcm.length).toBe(4800);
  });

  it('walks WAV chunks rather than assuming data starts at byte 44', () => {
    const samples = new Int16Array(100).fill(5);
    const canonical = wav(samples);
    const list = Buffer.alloc(8 + 4);
    list.write('LIST', 0, 'latin1');
    list.writeUInt32LE(4, 4);
    const withList = Buffer.concat([canonical.subarray(0, 36), list, canonical.subarray(36)]);

    const found = parseWav(withList);
    expect(found.pcm.length).toBe(200);
    expect(found.pcm.readInt16LE(0)).toBe(5);
  });

  it('refuses a WAV that is not 16-bit PCM instead of encoding noise', () => {
    const bytes = wav(new Int16Array(10));
    bytes.writeUInt16LE(24, 34); // bits per sample
    expect(() => parseWav(bytes)).toThrow(/24-bit; only 16-bit PCM/);
  });

  it('joins several audio blocks in the order they arrived', () => {
    const first = audioBlock({ data: pcmBase64(100, 1) });
    const second = audioBlock({ data: pcmBase64(100, 2) });

    const found = extractAudio(interaction([first, { type: 'text', text: 'between' }, second]));

    expect(found.pcm.length).toBe(400);
    expect(found.pcm.readInt16LE(0)).toBe(1);
    expect(found.pcm.readInt16LE(200)).toBe(2);
  });

  it('collects audio across several model_output steps too', () => {
    const payload = {
      status: 'completed',
      steps: [
        { type: 'model_output', content: [audioBlock({ data: pcmBase64(10, 1) })] },
        { type: 'tool_call', content: [] },
        { type: 'model_output', content: [audioBlock({ data: pcmBase64(10, 2) })] },
      ],
    };
    expect(extractAudio(payload).pcm.length).toBe(40);
  });

  it('refuses to join blocks that disagree on their format', () => {
    const payload = interaction([audioBlock(), audioBlock({ sample_rate: 16000 })]);
    expect(() => extractAudio(payload)).toThrow(
      /different formats \(24000 Hz 1-channel and 16000 Hz 1-channel\)/
    );
  });

  it('downmixes stereo to mono before encoding', async () => {
    const frames = 24000; // one second
    const stereo = new Int16Array(frames * 2);
    for (let i = 0; i < frames; i += 1) {
      stereo[i * 2] = 1000;
      stereo[i * 2 + 1] = 3000;
    }
    const data = Buffer.from(stereo.buffer).toString('base64');

    const found = extractAudio(interaction([audioBlock({ data, channels: 2 })]));
    expect(found.channels).toBe(2);

    const mono = downmixToMono(found.pcm, 2);
    expect(mono.length).toBe(frames * 2);
    expect(mono.readInt16LE(0)).toBe(2000);

    const fetchImpl = vi.fn(async () => ok(interaction([audioBlock({ data, channels: 2 })])));
    const result = await synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl });
    expect(result.estimatedSeconds).toBe(1);
  });

  it('refuses a mime type it cannot decode, naming it', () => {
    const payload = interaction([audioBlock({ mime_type: 'audio/opus' })]);
    expect(() => extractAudio(payload)).toThrow(/audio\/opus, which this module cannot decode/);
  });

  it('returns null, not a throw, when the reply simply has no audio', () => {
    expect(extractAudio({})).toBeNull();
    expect(extractAudio(interaction([{ type: 'text', text: 'hi' }]))).toBeNull();
  });

  it('prefers the token counts the API reports', async () => {
    const fetchImpl = vi.fn(async () =>
      ok(interaction([audioBlock()], { usage: { total_input_tokens: 120, total_output_tokens: 3400 } }))
    );
    const result = await synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl });
    expect(result).toMatchObject({ promptTokens: 120, completionTokens: 3400, estimatedTokens: false });
  });
});

describe('a 200 that is not a success', () => {
  it('treats a 200 with no audio as a failure, not an empty episode', async () => {
    const fetchImpl = vi.fn(async () => ok({}));
    await expect(
      synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl })
    ).rejects.toThrow(/returned no audio/);
  });

  it('names the shape it saw when the model answered in text, without quoting it', async () => {
    // What the operator reads on the episode card. Types only: the text the
    // model produced is content and stays out of the error.
    const fetchImpl = vi.fn(async () =>
      ok(interaction([{ type: 'text', text: 'SECRET-TRANSCRIPT-DO-NOT-LEAK' }]))
    );
    const err = await synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl }).catch(
      (e) => e
    );

    expect(err.message).toContain('status completed');
    expect(err.message).toContain('model_output[text]');
    expect(err.message).not.toContain('SECRET-TRANSCRIPT');
    expect(err.provider).toBe('gemini');
  });

  it('reports a failed status with each error code and message', async () => {
    const fetchImpl = vi.fn(async () =>
      ok({
        status: 'failed',
        errors: [
          { code: 'https://ai.google.dev/errors/safety', message: 'Blocked by safety filter' },
          { code: 'quota', message: 'Daily audio quota exhausted' },
        ],
        steps: [],
      })
    );
    const err = await synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl }).catch(
      (e) => e
    );

    expect(err.message).toMatch(/status failed/);
    expect(err.message).toContain('https://ai.google.dev/errors/safety: Blocked by safety filter');
    expect(err.message).toContain('quota: Daily audio quota exhausted');
  });

  it('refuses an incomplete reply even when it carries audio, because it would be cut off', async () => {
    const fetchImpl = vi.fn(async () => ok(interaction([audioBlock()], { status: 'incomplete' })));
    await expect(
      synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl })
    ).rejects.toThrow(/status incomplete.*truncated/);
  });

  it('proceeds on any other status as long as audio is present', async () => {
    // The reference lists statuses this module has no opinion on; audio in
    // hand is the thing that matters, and the status is not a reason to drop it.
    const fetchImpl = vi.fn(async () =>
      ok(interaction([audioBlock()], { status: 'requires_action' }))
    );
    const result = await synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl });
    expect(result.audio.length).toBeGreaterThan(0);
  });

  it('names an unfamiliar status when it came with no audio', async () => {
    const fetchImpl = vi.fn(async () => ok({ status: 'cancelled', steps: [] }));
    await expect(
      synthesizeWithGemini({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl })
    ).rejects.toThrow(/status cancelled; the reply held no steps/);
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
