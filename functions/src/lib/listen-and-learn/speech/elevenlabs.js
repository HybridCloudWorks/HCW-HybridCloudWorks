/**
 * Render a two-host dialogue to MP3 with ElevenLabs — the paid provider.
 *
 * Added when the owner approved a paid ElevenLabs plan on 2026-09-08 (ADR 0029
 * §2a, #436). It is what the owner is paying for and chose for its dialogue
 * quality, so it runs whenever `ELEVENLABS_API_KEY` is present; Gemini and
 * Azure stay behind it, in that order, for the states a paid provider has and
 * a free one does not — see speech/index.js.
 *
 * Contract, verified against the Text to Dialogue API reference and capability
 * guide on 2026-09-08:
 *
 *   POST https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_64
 *   xi-api-key: <key>
 *   { model_id: 'eleven_v3', inputs: [{ text, voice_id }, …] }
 *
 * Four properties of that contract shape this module:
 *
 *   - **The dialogue is structured, not prompted.** Every turn is an
 *     `inputs[]` entry carrying its own `voice_id`, so alternating hosts are
 *     alternating entries — no speaker labels to keep in step with a voice
 *     table, as the Gemini path must. A turn whose speaker has no voice is
 *     therefore a hard error BEFORE any request is sent: there is nothing to
 *     put in `voice_id`, and the API would reject it after the bytes had been
 *     uploaded.
 *   - **The response is MP3.** `output_format` is a query parameter with a
 *     documented enum; `mp3_44100_64` is 64 kbps constant-bitrate mono, the
 *     bitrate mp3.js encodes the Gemini PCM to, so the stored bytes-per-second
 *     are the same whichever provider ran and mp3.js is bypassed entirely.
 *     (Only the 192 kbps MP3 and the 44.1 kHz PCM/WAV formats are tier-gated.)
 *   - **A request is capped at 2,000 characters.** The capability guide says to
 *     "keep the total length of all `inputs[].text` values at or below 2,000
 *     characters per request for reliable generation" and to concatenate the
 *     resulting audio, so a 9,000-byte episode is four or five requests.
 *     `chunkTurnsByCharacters` below measures CODE POINTS, the unit the
 *     ceiling is stated in and the unit the API bills. The Azure chunker
 *     measures UTF-8 bytes; borrowing it was safe but wasteful — a CJK script
 *     is three bytes a character and would have gone out in three times as
 *     many requests as it needed.
 *   - **Billing is per character**, USD 0.10 per 1,000 on the plans in
 *     question, and the API reports what it charged in a `character-cost`
 *     response header. That figure is preferred over our own count for the
 *     usage row: what was billed beats what was sent.
 *
 * ## How cost is recorded
 *
 * `ai_usage` rows carry `promptTokens` / `completionTokens` and are priced by
 * `getCostEstimate(provider, model, in, out)` against `COST_TABLE`, and the
 * admin usage page totals those columns client-side. Inventing a "characters"
 * column would need a second code path in the page and in `totalCostUsd`, and
 * every historical row would lack it. So a character IS the output unit here:
 * `completionTokens` is the billed character count, `promptTokens` is 0, and
 * `COST_TABLE.elevenlabs[model]` is expressed as USD per 1M characters (0.10
 * per 1,000 = 100 per 1M). `getCostEstimate` then prices the row without
 * knowing the unit changed, which is the whole point. The row is flagged
 * `estimatedTokens` only when the header was absent and the count is ours.
 *
 * ## Out of credit
 *
 * A paid provider has a state a free one does not. When the account's credits
 * are spent the API answers **401** with `detail.status === 'quota_exceeded'`
 * (ElevenLabs help centre, "API - Error Code 400 or 401"); a 402 would mean
 * the same thing. Neither improves on a retry, so neither is retried, and the
 * error carries `code: 'quota_exceeded'` and its HTTP status so the switch in
 * index.js can recognise it and fall back to the next configured provider.
 *
 * ## Voices
 *
 * Two premade voices, both female, matching the Azure pair and the two hosts
 * script.js writes (DEFAULT_SPEAKERS). Premade voices are available on every
 * plan and need no library add step:
 *
 *   Maya  → Sarah  (EXAVITQu4vr4xnSDxMaL) — the lead, who frames the area
 *   Elena → Aria   (9BWtsMINqrJLrRacOk9x) — the voice the official Text to
 *                                            Dialogue quickstart uses
 *
 * ElevenLabs has announced that its default voices are being replaced, with
 * the current set expiring on 2026-12-31. Override per host with
 * `LISTEN_AND_LEARN_VOICE_MAYA` / `…_ELENA` — the same settings the other
 * providers read, so set them together with a `LISTEN_AND_LEARN_TTS_PROVIDER`
 * pin: a Gemini voice name in that setting would be sent here as a voice id.
 */
const DIALOGUE_URL = 'https://api.elevenlabs.io/v1/text-to-dialogue';

/**
 * The only model the dialogue endpoint serves. Overridable with
 * `LISTEN_AND_LEARN_ELEVENLABS_MODEL` for the day that changes — its own
 * setting rather than the shared `LISTEN_AND_LEARN_TTS_MODEL`, because a
 * Gemini model id left in that one would be sent here as `model_id` the
 * moment this key was seeded and fail every run with a 400.
 */
export const ELEVENLABS_DEFAULT_MODEL = 'eleven_v3';
export const ELEVENLABS_MODEL_SETTING = 'LISTEN_AND_LEARN_ELEVENLABS_MODEL';

/**
 * 64 kbps CBR mono MP3 — the bitrate mp3.js already stores, so the media
 * route serves the same bytes-per-second whichever provider read the episode.
 */
export const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_64';
const OUTPUT_BITS_PER_SECOND = 64_000;
const CONTENT_TYPE = 'audio/mpeg';

/** Documented ceiling on the summed `inputs[].text` length per request. */
export const MAX_CHARACTERS_PER_REQUEST = 2000;

export const ELEVENLABS_DEFAULT_VOICES = {
  Maya: 'EXAVITQu4vr4xnSDxMaL',
  Elena: '9BWtsMINqrJLrRacOk9x',
};

/** Retried; anything else — a bad request, a rejected key, no credit — is not. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

/**
 * A locally-defined error rather than an import from `./index.js`, which
 * imports this module — a cycle would make one of the two undefined at load.
 * `name`, `provider`, `status` and `code` are what callers key off.
 */
class ElevenLabsSpeechError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'SpeechError';
    this.status = status;
    this.provider = 'elevenlabs';
    this.code = code;
  }
}

function readSetting(env, name) {
  const value = String(env?.[name] || '').trim();
  if (!value || value.startsWith('@Microsoft.KeyVault(')) return '';
  return value;
}

/** `LISTEN_AND_LEARN_VOICE_MAYA` etc., so a voice can be changed by ear. */
export function readVoiceOverrides(env = process.env) {
  const overrides = {};
  for (const speaker of Object.keys(ELEVENLABS_DEFAULT_VOICES)) {
    const value = readSetting(env, `LISTEN_AND_LEARN_VOICE_${speaker.toUpperCase()}`);
    if (value) overrides[speaker] = value;
  }
  return overrides;
}

/** Characters as the API counts them: code points, not UTF-16 units. */
export const characterCount = (text) => [...String(text ?? '')].length;

/** Sum of every turn's text, for the cost estimate and the usage row. */
export function dialogueCharacters(turns) {
  return (turns || []).reduce((total, turn) => total + characterCount(turn?.text), 0);
}

/**
 * Split one over-long turn on sentence boundaries, measured in code points.
 *
 * Both halves are spoken by the same voice, so the listener hears continuous
 * speech. Falls back to a per-character split only when a single "sentence"
 * is itself over the limit, which means punctuation-free text.
 */
function splitTurnText(text, limit) {
  const sentences = String(text).match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [String(text)];
  const parts = [];
  let buffer = '';

  for (const sentence of sentences) {
    if (buffer && characterCount(buffer) + characterCount(sentence) > limit) {
      parts.push(buffer.trim());
      buffer = '';
    }
    if (characterCount(sentence) > limit) {
      if (buffer.trim()) parts.push(buffer.trim());
      buffer = '';
      let chunk = '';
      for (const char of sentence) {
        if (characterCount(chunk) + 1 > limit) {
          parts.push(chunk.trim());
          chunk = '';
        }
        chunk += char;
      }
      buffer = chunk;
      continue;
    }
    buffer += sentence;
  }

  if (buffer.trim()) parts.push(buffer.trim());
  return parts.filter(Boolean);
}

/**
 * Group turns into requests of at most `limit` CODE POINTS of text.
 *
 * The same policy as azure.js's `chunkTurns` — whole turns wherever possible
 * so a speaker change never falls across a request boundary mid-thought, an
 * over-long turn split rather than sent whole and refused — in the unit this
 * API states its ceiling and its bill in. `text.length` would count UTF-16
 * units and over-count astral characters; bytes would over-count everything
 * outside ASCII.
 *
 * @param {{speaker: string, text: string}[]} turns
 * @param {number} [limit]
 * @returns {{speaker: string, text: string}[][]}
 */
export function chunkTurnsByCharacters(turns, limit = MAX_CHARACTERS_PER_REQUEST) {
  const chunks = [];
  let current = [];
  let currentCount = 0;

  const flush = () => {
    if (current.length) chunks.push(current);
    current = [];
    currentCount = 0;
  };

  for (const turn of turns) {
    const text = String(turn?.text || '').trim();
    if (!text) continue;
    const speaker = turn.speaker;
    const count = characterCount(text);

    if (count > limit) {
      flush();
      for (const part of splitTurnText(text, limit)) {
        chunks.push([{ speaker, text: part }]);
      }
      continue;
    }

    if (currentCount + count > limit) flush();
    current.push({ speaker, text });
    currentCount += count;
  }

  flush();
  return chunks;
}

/**
 * The `inputs` array for one request.
 *
 * Checked for every turn up front rather than lazily: the point of a hard
 * error here is that it happens before a byte is uploaded or a character is
 * billed.
 */
export function buildInputs(turns, voices) {
  return turns.map((turn) => {
    const voiceId = voices[turn.speaker];
    if (!voiceId) {
      throw new ElevenLabsSpeechError(
        `No voice configured for speaker "${turn.speaker}" (known: ${Object.keys(voices).join(', ') || 'none'})`
      );
    }
    return { text: turn.text, voice_id: voiceId };
  });
}

/**
 * Whether a non-2xx response is the out-of-credit state.
 *
 * The documented shape is 401 + `detail.status: "quota_exceeded"`; the body is
 * JSON but is read as text first so a non-JSON error page cannot throw here.
 */
export function isQuotaExceeded(status, bodyText) {
  if (status === 402) return true;
  if (status !== 401) return false;
  try {
    const detail = JSON.parse(bodyText)?.detail;
    return String(detail?.status || detail?.code || '').toLowerCase() === 'quota_exceeded';
  } catch {
    return /quota_exceeded/i.test(String(bodyText || ''));
  }
}

async function synthesizeOne(inputs, { key, model, fetchImpl, sleep }) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(`${DIALOGUE_URL}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`, {
        method: 'POST',
        headers: {
          'xi-api-key': key,
          'Content-Type': 'application/json',
          Accept: CONTENT_TYPE,
        },
        body: JSON.stringify({ model_id: model, inputs }),
      });
    } catch (err) {
      lastError = new ElevenLabsSpeechError(`Failed to reach ElevenLabs: ${err.message}`);
      if (attempt === MAX_ATTEMPTS) throw lastError;
      await sleep(attempt * 500);
      continue;
    }

    if (response.ok) {
      const audio = Buffer.from(await response.arrayBuffer());
      // `Number(null)` is 0, which would read as "billed nothing"; only a
      // header that is actually present and numeric counts as the API's word.
      const header = response.headers?.get?.('character-cost');
      const billed = header === null || header === undefined || header === '' ? NaN : Number(header);
      return { audio, billedCharacters: Number.isFinite(billed) ? billed : null };
    }

    const detail = await response.text().catch(() => '');
    if (isQuotaExceeded(response.status, detail)) {
      // Not retried and not a generic failure: the switch falls back on this.
      throw new ElevenLabsSpeechError(
        `ElevenLabs is out of credit (HTTP ${response.status} quota_exceeded): ${detail.slice(0, 300) || 'no detail'}`,
        { status: response.status, code: 'quota_exceeded' }
      );
    }
    lastError = new ElevenLabsSpeechError(
      `ElevenLabs HTTP ${response.status}: ${detail.slice(0, 300) || 'no detail'}`,
      { status: response.status }
    );
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS) throw lastError;
    await sleep(attempt * 500);
  }

  throw lastError;
}

/**
 * Synthesise a whole dialogue, returning one MP3.
 *
 * MP3 parts are concatenated bytewise, as azure.js does and for the same
 * reason: a constant-bitrate MPEG audio stream is a sequence of
 * self-describing frames with no container header to reconcile.
 *
 * @param {object} params
 * @param {{speaker: string, text: string}[]} params.dialogue
 * @param {Record<string,string>|null} [params.voices] speaker name → voice id
 * @param {object} [params.env]
 * @param {Function} [params.fetchImpl]
 * @returns {Promise<{audio: Buffer, contentType: string, bytes: number, requests: number, model: string, estimatedSeconds: number, promptTokens: number, completionTokens: number, estimatedTokens: boolean}>}
 */
export async function synthesizeWithElevenLabs({
  dialogue,
  voices = null,
  env = process.env,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const turns = (dialogue || []).filter((t) => String(t?.text || '').trim());
  if (turns.length === 0) throw new ElevenLabsSpeechError('No dialogue turns to synthesise');

  const key = readSetting(env, 'ELEVENLABS_API_KEY');
  if (!key) throw new ElevenLabsSpeechError('ELEVENLABS_API_KEY is not configured');

  // Precedence, lowest to highest: built-in default, environment override,
  // explicit caller argument.
  const resolvedVoices = {
    ...ELEVENLABS_DEFAULT_VOICES,
    ...readVoiceOverrides(env),
    ...(voices || {}),
  };

  const model = readSetting(env, ELEVENLABS_MODEL_SETTING) || ELEVENLABS_DEFAULT_MODEL;

  // Every chunk's inputs are built before the first request, so a missing
  // voice on the last turn fails the run before the first turn is billed.
  const chunks = chunkTurnsByCharacters(turns, MAX_CHARACTERS_PER_REQUEST).map((chunk) =>
    buildInputs(chunk, resolvedVoices)
  );

  const parts = [];
  // Per chunk: the API's own count when the `character-cost` header came
  // back, else the code points this chunk actually posted. Summed that way,
  // a header present on some chunks and absent on others still counts every
  // billed figure that did arrive, and the row is flagged estimated if any
  // chunk had to be counted by us.
  let completionTokens = 0;
  let anyEstimated = false;
  for (const inputs of chunks) {
    // Sequential on purpose: the parts are concatenated in order, and a
    // parallel burst is the reliable way to meet the per-account 429.
    const { audio, billedCharacters } = await synthesizeOne(inputs, {
      key,
      model,
      fetchImpl,
      sleep,
    });
    parts.push(audio);
    if (billedCharacters === null) {
      // Counted over the inputs actually posted — after the chunker trimmed
      // and split them — not over the dialogue as handed in. This is a
      // billing row: what was sent is what counts, and a turn's surrounding
      // whitespace was not sent.
      completionTokens += inputs.reduce((total, input) => total + characterCount(input.text), 0);
      anyEstimated = true;
    } else {
      completionTokens += billedCharacters;
    }
  }

  const audio = Buffer.concat(parts);

  return {
    audio,
    contentType: CONTENT_TYPE,
    bytes: audio.length,
    requests: chunks.length,
    model,
    // CBR, so the byte count is the duration; no estimate needed.
    estimatedSeconds: Math.round((audio.length * 8) / OUTPUT_BITS_PER_SECOND),
    promptTokens: 0,
    completionTokens,
    estimatedTokens: anyEstimated,
  };
}

export const ELEVENLABS_LIMITS = Object.freeze({
  MAX_CHARACTERS_PER_REQUEST,
  OUTPUT_FORMAT: ELEVENLABS_OUTPUT_FORMAT,
  CONTENT_TYPE,
});
