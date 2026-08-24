/**
 * Azure Speech synthesis — the fallback provider.
 *
 * The load-bearing assertions are about the ten-minute truncation: the API
 * does not error when a request runs long, it silently returns short audio,
 * so a chunking bug ships as an episode that stops talking mid-sentence and
 * looks complete to a reviewer. That failure mode is the reason these tests
 * stay maintained on a path that is not the default.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  AZURE_DEFAULT_VOICES,
  SPEECH_LIMITS,
  buildSsml,
  chunkTurns,
  escapeXml,
  readVoiceOverrides,
  resolveSpeechEndpoint,
  synthesizeWithAzure,
} from './azure.js';

const DEFAULT_VOICES = AZURE_DEFAULT_VOICES;
/** The provider raises name-tagged errors rather than shared classes (no cycle). */
const isNotConfigured = (err) => err?.name === 'SpeechNotConfiguredError';
const isSpeechError = (err) => err?.name === 'SpeechError';

const KEYED_ENV = { AZURE_SPEECH_KEY: 'k-123', AZURE_SPEECH_REGION: 'eastus' };

const okResponse = (bytes = [1, 2, 3]) => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => Uint8Array.from(bytes).buffer,
});

const turn = (speaker, text) => ({ speaker, text });

describe('configuration', () => {
  it('builds the regional endpoint from a region', () => {
    expect(resolveSpeechEndpoint({ AZURE_SPEECH_REGION: 'westeurope' })).toBe(
      'https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1'
    );
  });

  it('prefers an explicit endpoint, so a custom subdomain needs no code change', () => {
    expect(
      resolveSpeechEndpoint({
        AZURE_SPEECH_ENDPOINT: 'https://hcw.cognitiveservices.azure.com/cognitiveservices/v1/',
        AZURE_SPEECH_REGION: 'eastus',
      })
    ).toBe('https://hcw.cognitiveservices.azure.com/cognitiveservices/v1');
  });

  it('reads per-host voice overrides', () => {
    expect(readVoiceOverrides({ LISTEN_AND_LEARN_VOICE_MAYA: 'en-GB-SoniaNeural' })).toEqual({
      Maya: 'en-GB-SoniaNeural',
    });
    expect(readVoiceOverrides({})).toEqual({});
  });
});

describe('SSML', () => {
  it('escapes text so an ampersand in a script cannot break the document', () => {
    expect(escapeXml('AKS & ACR <tag> "q" \'a\'')).toBe(
      'AKS &amp; ACR &lt;tag&gt; &quot;q&quot; &apos;a&apos;'
    );
  });

  it('emits one voice element per turn, alternating hosts', () => {
    const ssml = buildSsml([turn('Maya', 'Hello'), turn('Elena', 'Hi')], {
      voices: DEFAULT_VOICES,
    });

    expect(ssml).toContain(`<voice name="${DEFAULT_VOICES.Maya}">Hello</voice>`);
    expect(ssml).toContain(`<voice name="${DEFAULT_VOICES.Elena}">Hi</voice>`);
    expect(ssml.startsWith('<speak version="1.0"')).toBe(true);
    expect(ssml.endsWith('</speak>')).toBe(true);
  });

  it('refuses a speaker with no voice rather than sending a nameless voice', () => {
    expect(() => buildSsml([turn('Nobody', 'x')], { voices: DEFAULT_VOICES })).toThrow(
      /No voice configured for speaker "Nobody"/
    );
  });
});

describe('chunking against the ten-minute cap', () => {
  const { MAX_BYTES_PER_REQUEST } = SPEECH_LIMITS;

  it('keeps a short dialogue in one request', () => {
    const chunks = chunkTurns([turn('Maya', 'a'), turn('Elena', 'b')]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(2);
  });

  it('splits before a chunk can exceed the budget', () => {
    // Three turns of 60% of the budget each: 1 + 1 + 1, never 2 in a chunk.
    const big = 'x'.repeat(Math.floor(MAX_BYTES_PER_REQUEST * 0.6));
    const chunks = chunkTurns([turn('Maya', big), turn('Elena', big), turn('Maya', big)]);

    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      const bytes = chunk.reduce((n, t) => n + Buffer.byteLength(t.text, 'utf8'), 0);
      expect(bytes).toBeLessThanOrEqual(MAX_BYTES_PER_REQUEST);
    }
  });

  it('never emits a chunk over budget, whatever the turn sizes', () => {
    const turns = Array.from({ length: 40 }, (_, i) =>
      turn(i % 2 ? 'Elena' : 'Maya', 'word '.repeat(200 + i * 10))
    );
    for (const chunk of chunkTurns(turns)) {
      const bytes = chunk.reduce((n, t) => n + Buffer.byteLength(t.text, 'utf8'), 0);
      expect(bytes).toBeLessThanOrEqual(MAX_BYTES_PER_REQUEST);
    }
  });

  it('splits one over-long turn on sentence boundaries instead of truncating it', () => {
    // A single turn bigger than a whole request. Dropping it loses content;
    // sending it whole gets silently truncated at ten minutes.
    const sentence = 'This is a sentence about Azure networking. ';
    const long = sentence.repeat(Math.ceil((MAX_BYTES_PER_REQUEST * 1.5) / sentence.length));
    const chunks = chunkTurns([turn('Maya', long)]);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk).toHaveLength(1);
      expect(chunk[0].speaker).toBe('Maya');
      expect(Buffer.byteLength(chunk[0].text, 'utf8')).toBeLessThanOrEqual(MAX_BYTES_PER_REQUEST);
    }
    // Nothing is lost: every sentence survives somewhere.
    const rejoined = chunks.map((c) => c[0].text).join(' ');
    expect(rejoined.split('Azure networking').length - 1).toBe(
      long.split('Azure networking').length - 1
    );
  });

  it('splits punctuation-free text rather than looping forever', () => {
    const chunks = chunkTurns([turn('Maya', 'a'.repeat(MAX_BYTES_PER_REQUEST * 2 + 5))]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk[0].text, 'utf8')).toBeLessThanOrEqual(MAX_BYTES_PER_REQUEST);
    }
  });

  it('drops empty turns without emitting an empty chunk', () => {
    expect(chunkTurns([turn('Maya', '   '), turn('Elena', 'real')])).toEqual([
      [{ speaker: 'Elena', text: 'real' }],
    ]);
    expect(chunkTurns([])).toEqual([]);
  });

  it('estimates duration with a slow voice, which is the safe direction', () => {
    // A fast voice produces more bytes per second, so estimating with one
    // would under-count seconds and walk into the truncation.
    expect(SPEECH_LIMITS.BYTES_PER_SECOND * SPEECH_LIMITS.MAX_SECONDS_PER_REQUEST).toBe(
      SPEECH_LIMITS.MAX_BYTES_PER_REQUEST
    );
    expect(SPEECH_LIMITS.MAX_SECONDS_PER_REQUEST).toBeLessThan(600);
  });
});

describe('synthesizeDialogue', () => {
  const dialogue = [turn('Maya', 'Hello there'), turn('Elena', 'Hi back')];

  it('sends the documented headers and returns concatenated MP3 bytes', async () => {
    const fetchImpl = vi.fn(async () => okResponse([9, 9]));
    const result = await synthesizeWithAzure({ dialogue, env: KEYED_ENV, fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://eastus.tts.speech.microsoft.com/cognitiveservices/v1');
    expect(init.headers['Ocp-Apim-Subscription-Key']).toBe('k-123');
    expect(init.headers['Content-Type']).toBe('application/ssml+xml');
    expect(init.headers['X-Microsoft-OutputFormat']).toBe(SPEECH_LIMITS.OUTPUT_FORMAT);
    expect(init.headers['User-Agent']).toBeTruthy(); // required by the API
    expect(result.contentType).toBe('audio/mpeg');
    expect(result.audio).toEqual(Buffer.from([9, 9]));
    expect(result.requests).toBe(1);
  });

  it('concatenates the parts of a multi-request dialogue in order', async () => {
    const big = 'x'.repeat(Math.floor(SPEECH_LIMITS.MAX_BYTES_PER_REQUEST * 0.7));
    let call = 0;
    const fetchImpl = vi.fn(async () => okResponse([(call += 1)]));

    const result = await synthesizeWithAzure({
      dialogue: [turn('Maya', big), turn('Elena', big)],
      env: KEYED_ENV,
      fetchImpl,
    });

    expect(result.requests).toBe(2);
    expect(result.audio).toEqual(Buffer.from([1, 2]));
  });

  it('degrades with a distinguishable error when no key is configured', async () => {
    // generate.js keys off this exact type to publish a transcript-only
    // episode instead of failing the area.
    const fetchImpl = vi.fn();
    await expect(
      synthesizeWithAzure({ dialogue, env: { AZURE_SPEECH_REGION: 'eastus' }, fetchImpl })
    ).rejects.toSatisfy(isNotConfigured);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a missing region or endpoint as not-configured too', async () => {
    await expect(
      synthesizeWithAzure({ dialogue, env: { AZURE_SPEECH_KEY: 'k' }, fetchImpl: vi.fn() })
    ).rejects.toSatisfy(isNotConfigured);
  });

  it('retries a 429 and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'slow down' })
      .mockResolvedValueOnce(okResponse([7]));

    const result = await synthesizeWithAzure({
      dialogue,
      env: KEYED_ENV,
      fetchImpl,
      sleep: async () => {},
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.audio).toEqual(Buffer.from([7]));
  });

  it('does not retry a rejected key, which would fail identically every time', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, text: async () => 'denied' }));

    await expect(
      synthesizeWithAzure({ dialogue, env: KEYED_ENV, fetchImpl, sleep: async () => {} })
    ).rejects.toThrow(/Azure Speech HTTP 401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 400, which is a malformed SSML document', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400, text: async () => 'bad ssml' }));
    await expect(
      synthesizeWithAzure({ dialogue, env: KEYED_ENV, fetchImpl, sleep: async () => {} })
    ).rejects.toThrow(/Azure Speech HTTP 400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt ceiling on a persistent 5xx', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, text: async () => 'down' }));
    await expect(
      synthesizeWithAzure({ dialogue, env: KEYED_ENV, fetchImpl, sleep: async () => {} })
    ).rejects.toSatisfy(isSpeechError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('refuses an empty dialogue rather than requesting silence', async () => {
    await expect(
      synthesizeWithAzure({ dialogue: [{ speaker: 'Maya', text: '  ' }], env: KEYED_ENV })
    ).rejects.toThrow(/No dialogue turns/);
  });

  it('applies a voice override from the environment', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await synthesizeWithAzure({
      dialogue: [turn('Maya', 'Hello')],
      env: { ...KEYED_ENV, LISTEN_AND_LEARN_VOICE_MAYA: 'en-GB-SoniaNeural' },
      fetchImpl,
    });

    expect(fetchImpl.mock.calls[0][1].body).toContain('name="en-GB-SoniaNeural"');
  });
});
