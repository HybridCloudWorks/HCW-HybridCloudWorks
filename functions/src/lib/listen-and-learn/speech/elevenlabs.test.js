/**
 * ElevenLabs — the paid provider (ADR 0029 §2a, #436).
 *
 * The load-bearing assertions are about money and about the one failure a
 * paid provider has that a free one does not. A missing voice must fail before
 * a character is billed; a chunk must never exceed the documented ceiling; the
 * usage row must carry what the API says it charged, not what we think we
 * sent; and an account that is out of credit must be reported as exactly
 * that, once, with no retry that would spend nothing and hide the state.
 */
import { describe, it, expect, vi } from 'vitest';
import { COST_TABLE, getCostEstimate } from '../../ai/router.js';
import {
  ELEVENLABS_DEFAULT_MODEL,
  ELEVENLABS_DEFAULT_VOICES,
  ELEVENLABS_LIMITS,
  ELEVENLABS_OUTPUT_FORMAT,
  MAX_CHARACTERS_PER_REQUEST,
  buildInputs,
  characterCount,
  dialogueCharacters,
  isQuotaExceeded,
  readVoiceOverrides,
  synthesizeWithElevenLabs,
} from './elevenlabs.js';

const KEYED_ENV = { ELEVENLABS_API_KEY: 'xi-key' };
const isSpeechError = (err) => err?.name === 'SpeechError';

const turn = (speaker, text) => ({ speaker, text });
const DIALOGUE = [turn('Maya', 'Hello there'), turn('Elena', 'Hi back'), turn('Maya', 'And so')];

/** A response carrying MP3-ish bytes and, optionally, the billed-character header. */
const okResponse = (bytes = [0xff, 0xfb, 1, 2], { characterCost } = {}) => ({
  ok: true,
  status: 200,
  headers: {
    get: (name) =>
      name.toLowerCase() === 'character-cost' && characterCost !== undefined
        ? String(characterCost)
        : null,
  },
  arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  text: async () => '',
});

const errorResponse = (status, body = '') => ({
  ok: false,
  status,
  headers: { get: () => null },
  text: async () => body,
  arrayBuffer: async () => new ArrayBuffer(0),
});

const QUOTA_BODY = JSON.stringify({
  detail: {
    status: 'quota_exceeded',
    message: 'This request exceeds your quota of 10000. You have 0 credits remaining.',
  },
});

const noSleep = vi.fn(async () => {});

describe('voices', () => {
  it('pairs the two hosts the script writes with distinct premade voices', () => {
    expect(Object.keys(ELEVENLABS_DEFAULT_VOICES)).toEqual(['Maya', 'Elena']);
    const ids = Object.values(ELEVENLABS_DEFAULT_VOICES);
    expect(new Set(ids).size).toBe(2); // a listener must tell them apart
    // Voice ids are 20-character opaque strings; a name here would be sent
    // verbatim as `voice_id` and rejected after the upload.
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
  });

  it('reads per-host overrides from the environment', () => {
    expect(readVoiceOverrides({ LISTEN_AND_LEARN_VOICE_MAYA: 'abc' })).toEqual({ Maya: 'abc' });
    expect(readVoiceOverrides({})).toEqual({});
    expect(
      readVoiceOverrides({ LISTEN_AND_LEARN_VOICE_ELENA: '@Microsoft.KeyVault(SecretUri=x)' })
    ).toEqual({});
  });

  it('builds one input per turn carrying that speaker’s voice id', () => {
    expect(buildInputs(DIALOGUE, ELEVENLABS_DEFAULT_VOICES)).toEqual([
      { text: 'Hello there', voice_id: ELEVENLABS_DEFAULT_VOICES.Maya },
      { text: 'Hi back', voice_id: ELEVENLABS_DEFAULT_VOICES.Elena },
      { text: 'And so', voice_id: ELEVENLABS_DEFAULT_VOICES.Maya },
    ]);
  });

  it('fails a turn whose speaker has no voice BEFORE any request is sent', async () => {
    const fetchImpl = vi.fn();
    await expect(
      synthesizeWithElevenLabs({
        dialogue: [turn('Maya', 'Hi'), turn('Narrator', 'Welcome')],
        env: KEYED_ENV,
        fetchImpl,
        sleep: noSleep,
      })
    ).rejects.toThrow(/No voice configured for speaker "Narrator" \(known: Maya, Elena\)/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('checks every chunk before the first request, so a late turn cannot bill an early one', async () => {
    // A missing voice on the LAST turn of a multi-request dialogue.
    const long = 'word '.repeat(300).trim(); // 1,499 chars → forces a second chunk
    const fetchImpl = vi.fn(async () => okResponse());
    await expect(
      synthesizeWithElevenLabs({
        dialogue: [turn('Maya', long), turn('Elena', long), turn('Guest', 'Bye')],
        env: KEYED_ENV,
        fetchImpl,
        sleep: noSleep,
      })
    ).rejects.toThrow(/No voice configured for speaker "Guest"/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lets an environment override outrank the default and a caller argument outrank both', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await synthesizeWithElevenLabs({
      dialogue: [turn('Maya', 'Hi'), turn('Elena', 'Hello')],
      env: { ...KEYED_ENV, LISTEN_AND_LEARN_VOICE_MAYA: 'envMayaVoice000000000' },
      voices: { Elena: 'callerElenaVoice00000' },
      fetchImpl,
      sleep: noSleep,
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.inputs.map((i) => i.voice_id)).toEqual([
      'envMayaVoice000000000',
      'callerElenaVoice00000',
    ]);
  });
});

describe('the request', () => {
  it('posts the dialogue endpoint with the key header, the v3 model and the 64 kbps MP3 format', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await synthesizeWithElevenLabs({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl, sleep: noSleep });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      `https://api.elevenlabs.io/v1/text-to-dialogue?output_format=${ELEVENLABS_OUTPUT_FORMAT}`
    );
    expect(ELEVENLABS_OUTPUT_FORMAT).toBe('mp3_44100_64');
    expect(init.method).toBe('POST');
    expect(init.headers['xi-api-key']).toBe('xi-key');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      model_id: ELEVENLABS_DEFAULT_MODEL,
      inputs: buildInputs(DIALOGUE, ELEVENLABS_DEFAULT_VOICES),
    });
    expect(ELEVENLABS_DEFAULT_MODEL).toBe('eleven_v3');
  });

  it('honours its own model override and ignores the shared Gemini one', async () => {
    // A Gemini model id in LISTEN_AND_LEARN_TTS_MODEL must not become this
    // request's model_id the day the ElevenLabs key is seeded.
    const fetchImpl = vi.fn(async () => okResponse());
    await synthesizeWithElevenLabs({
      dialogue: DIALOGUE,
      env: {
        ...KEYED_ENV,
        LISTEN_AND_LEARN_TTS_MODEL: 'gemini-3.1-flash-tts-preview',
        LISTEN_AND_LEARN_ELEVENLABS_MODEL: 'eleven_v4',
      },
      fetchImpl,
      sleep: noSleep,
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model_id).toBe('eleven_v4');

    fetchImpl.mockClear();
    await synthesizeWithElevenLabs({
      dialogue: DIALOGUE,
      env: { ...KEYED_ENV, LISTEN_AND_LEARN_TTS_MODEL: 'gemini-3.1-flash-tts-preview' },
      fetchImpl,
      sleep: noSleep,
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model_id).toBe('eleven_v3');
  });

  it('refuses to run without a key, or with an unresolved Key Vault reference as one', async () => {
    await expect(
      synthesizeWithElevenLabs({ dialogue: DIALOGUE, env: {}, fetchImpl: vi.fn() })
    ).rejects.toThrow(/ELEVENLABS_API_KEY is not configured/);
    await expect(
      synthesizeWithElevenLabs({
        dialogue: DIALOGUE,
        env: { ELEVENLABS_API_KEY: '@Microsoft.KeyVault(SecretUri=https://v/s/1)' },
        fetchImpl: vi.fn(),
      })
    ).rejects.toThrow(/ELEVENLABS_API_KEY is not configured/);
  });

  it('refuses an empty dialogue', async () => {
    await expect(
      synthesizeWithElevenLabs({ dialogue: [turn('Maya', '  ')], env: KEYED_ENV, fetchImpl: vi.fn() })
    ).rejects.toThrow(/No dialogue turns/);
  });
});

describe('chunking at the documented ceiling', () => {
  it('keeps every request at or under 2,000 characters and concatenates the parts in order', async () => {
    expect(MAX_CHARACTERS_PER_REQUEST).toBe(2000);
    // 9,000 bytes — MAX_SCRIPT_BYTES in script.js — as twelve 750-character turns.
    const dialogue = Array.from({ length: 12 }, (_, i) =>
      turn(i % 2 ? 'Elena' : 'Maya', `${String.fromCharCode(65 + i)}`.repeat(750))
    );
    let call = 0;
    const fetchImpl = vi.fn(async () => okResponse([call++, 0xff]));

    const result = await synthesizeWithElevenLabs({
      dialogue,
      env: KEYED_ENV,
      fetchImpl,
      sleep: noSleep,
    });

    // 750 × 2 = 1,500 fits; 750 × 3 = 2,250 does not — so two turns per request.
    expect(result.requests).toBe(6);
    for (const [, init] of fetchImpl.mock.calls) {
      const total = JSON.parse(init.body).inputs.reduce((n, i) => n + i.text.length, 0);
      expect(total).toBeLessThanOrEqual(MAX_CHARACTERS_PER_REQUEST);
    }
    // Parts arrive back in request order: [0,ff,1,ff,2,ff,…].
    expect([...result.audio]).toEqual([0, 0xff, 1, 0xff, 2, 0xff, 3, 0xff, 4, 0xff, 5, 0xff]);
    expect(result.bytes).toBe(12);
  });

  it('never splits a speaker change across a request when whole turns fit', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await synthesizeWithElevenLabs({
      dialogue: [turn('Maya', 'a'.repeat(1200)), turn('Elena', 'b'.repeat(1200))],
      env: KEYED_ENV,
      fetchImpl,
      sleep: noSleep,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const first = JSON.parse(fetchImpl.mock.calls[0][1].body).inputs;
    expect(first).toHaveLength(1);
    expect(first[0].voice_id).toBe(ELEVENLABS_DEFAULT_VOICES.Maya);
  });

  it('splits one over-long turn rather than sending it whole and having it refused', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await synthesizeWithElevenLabs({
      dialogue: [turn('Maya', 'A sentence. '.repeat(250).trim())], // 2,999 chars
      env: KEYED_ENV,
      fetchImpl,
      sleep: noSleep,
    });
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
    for (const [, init] of fetchImpl.mock.calls) {
      const inputs = JSON.parse(init.body).inputs;
      for (const input of inputs) {
        expect(input.text.length).toBeLessThanOrEqual(MAX_CHARACTERS_PER_REQUEST);
        expect(input.voice_id).toBe(ELEVENLABS_DEFAULT_VOICES.Maya);
      }
    }
  });

  it('counts characters as code points, so a multi-byte script is not over-counted', () => {
    expect(characterCount('héllo')).toBe(5);
    expect(characterCount('日本語')).toBe(3);
    expect(dialogueCharacters([turn('Maya', 'ab'), turn('Elena', 'cde')])).toBe(5);
  });
});

describe('usage and cost', () => {
  it('reports the billed character count from the character-cost header as the output unit', async () => {
    const fetchImpl = vi.fn(async () => okResponse([1, 2, 3, 4], { characterCost: 27 }));
    const result = await synthesizeWithElevenLabs({
      dialogue: DIALOGUE,
      env: KEYED_ENV,
      fetchImpl,
      sleep: noSleep,
    });
    expect(result).toMatchObject({
      model: 'eleven_v3',
      promptTokens: 0,
      completionTokens: 27,
      estimatedTokens: false,
      contentType: 'audio/mpeg',
    });
  });

  it('sums the header across chunks', async () => {
    const fetchImpl = vi.fn(async () => okResponse([1], { characterCost: 1200 }));
    const result = await synthesizeWithElevenLabs({
      dialogue: [turn('Maya', 'a'.repeat(1200)), turn('Elena', 'b'.repeat(1200))],
      env: KEYED_ENV,
      fetchImpl,
      sleep: noSleep,
    });
    expect(result.requests).toBe(2);
    expect(result.completionTokens).toBe(2400);
    expect(result.estimatedTokens).toBe(false);
  });

  it('falls back to its own count, flagged as estimated, when the header is absent', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const result = await synthesizeWithElevenLabs({
      dialogue: DIALOGUE,
      env: KEYED_ENV,
      fetchImpl,
      sleep: noSleep,
    });
    // 'Hello there' + 'Hi back' + 'And so' = 11 + 7 + 6
    expect(result.completionTokens).toBe(24);
    expect(result.estimatedTokens).toBe(true);
  });

  it('is priced by the cost table at USD 0.10 per 1,000 characters', () => {
    // The row the usage writer prices with; a 9,000-character episode is 90 cents.
    expect(COST_TABLE.elevenlabs[ELEVENLABS_DEFAULT_MODEL]).toEqual([0, 100.0]);
    expect(getCostEstimate('elevenlabs', ELEVENLABS_DEFAULT_MODEL, 0, 9000)).toBeCloseTo(0.9, 6);
    expect(getCostEstimate('elevenlabs', ELEVENLABS_DEFAULT_MODEL, 0, 1000)).toBeCloseTo(0.1, 6);
  });

  it('derives the duration from the byte count, because the stream is constant-bitrate', async () => {
    // 64 kbps → 8,000 bytes per second.
    const fetchImpl = vi.fn(async () => okResponse(new Array(80_000).fill(0)));
    const result = await synthesizeWithElevenLabs({
      dialogue: DIALOGUE,
      env: KEYED_ENV,
      fetchImpl,
      sleep: noSleep,
    });
    expect(result.estimatedSeconds).toBe(10);
  });
});

describe('out of credit', () => {
  it('recognises the documented 401 quota_exceeded body, and a 402', () => {
    expect(isQuotaExceeded(401, QUOTA_BODY)).toBe(true);
    expect(isQuotaExceeded(402, '')).toBe(true);
    expect(isQuotaExceeded(401, JSON.stringify({ detail: { status: 'invalid_api_key' } }))).toBe(
      false
    );
    expect(isQuotaExceeded(401, 'not json')).toBe(false);
    expect(isQuotaExceeded(500, QUOTA_BODY)).toBe(false);
  });

  it('surfaces it once, with the status and a code, and does not retry', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(401, QUOTA_BODY));
    let caught;
    try {
      await synthesizeWithElevenLabs({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl, sleep: noSleep });
    } catch (err) {
      caught = err;
    }
    expect(isSpeechError(caught)).toBe(true);
    expect(caught).toMatchObject({ provider: 'elevenlabs', status: 401, code: 'quota_exceeded' });
    expect(caught.message).toMatch(/out of credit/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it('does not mistake a rejected key for an empty account', async () => {
    const fetchImpl = vi.fn(async () =>
      errorResponse(401, JSON.stringify({ detail: { status: 'invalid_api_key' } }))
    );
    let caught;
    try {
      await synthesizeWithElevenLabs({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl, sleep: noSleep });
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ status: 401, code: null });
    expect(caught.message).toMatch(/ElevenLabs HTTP 401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('retries', () => {
  it('retries 429 and 5xx, then succeeds', async () => {
    const responses = [errorResponse(429, 'slow down'), errorResponse(503, ''), okResponse([9])];
    const fetchImpl = vi.fn(async () => responses.shift());
    const sleep = vi.fn(async () => {});
    const result = await synthesizeWithElevenLabs({
      dialogue: DIALOGUE,
      env: KEYED_ENV,
      fetchImpl,
      sleep,
    });
    expect([...result.audio]).toEqual([9]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after three attempts with the last status attached', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(500, 'boom'));
    await expect(
      synthesizeWithElevenLabs({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl, sleep: noSleep })
    ).rejects.toMatchObject({ name: 'SpeechError', status: 500, provider: 'elevenlabs' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 400', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(400, 'bad inputs'));
    await expect(
      synthesizeWithElevenLabs({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl, sleep: noSleep })
    ).rejects.toThrow(/HTTP 400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a network failure and reports it if it persists', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    await expect(
      synthesizeWithElevenLabs({ dialogue: DIALOGUE, env: KEYED_ENV, fetchImpl, sleep: noSleep })
    ).rejects.toThrow(/Failed to reach ElevenLabs: ECONNRESET/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('limits', () => {
  it('publishes the constants the switch and the docs quote', () => {
    expect(ELEVENLABS_LIMITS).toEqual({
      MAX_CHARACTERS_PER_REQUEST: 2000,
      OUTPUT_FORMAT: 'mp3_44100_64',
      CONTENT_TYPE: 'audio/mpeg',
    });
  });
});
