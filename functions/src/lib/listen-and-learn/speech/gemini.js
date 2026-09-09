/**
 * Render a two-host dialogue with the Gemini TTS models.
 *
 * This is the capability the feature was asked for: a two-host "deep dive" read
 * from source material is what a NotebookLM audio overview is, and these are
 * the models that produce it. It runs on `GEMINI_API_KEY` — the key the text
 * side of the site already uses — so the whole feature needs no new service, no
 * new resource and no new credential.
 *
 * Contract, verified on 2026-09-09 against the Interactions API reference
 * (https://ai.google.dev/api/interactions-api) and the speech-generation guide
 * (https://ai.google.dev/gemini-api/docs/speech-generation):
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions
 *   x-goog-api-key: <key>
 *   { model, input, response_format: {type:'audio'},
 *     generation_config: { speech_config: [{speaker, voice}, …] } }
 *
 * The reply is an **Interaction object**, not an audio payload:
 *
 *   { status: 'completed' | 'incomplete' | 'failed' | 'cancelled' | …,
 *     errors?: [{ code, message }],
 *     steps: [{ type: 'model_output',
 *               content: [{ type: 'audio', data: <base64>,
 *                           mime_type?, sample_rate?, channels? }, …] }],
 *     usage?: { total_input_tokens, total_output_tokens, … } }
 *
 * `output_audio.data`, which this module read until 2026-09-09, is a
 * convenience accessor the Python and JavaScript SDKs expose on *their*
 * Interaction object — the guide's examples use it — and the REST JSON has no
 * such field. Reading it made every 200 with audio in `steps` look like "no
 * audio" (#458). `extractAudio` walks `steps` and keeps the accessor only as a
 * fallback, in case a REST revision adds it.
 *
 * Three properties of that contract shape this module:
 *
 *   - **Multi-speaker takes at most two speakers**, which is exactly the number
 *     this feature has. `assertTwoSpeakers` turns a third into a clear error
 *     rather than an opaque 400.
 *   - **The dialogue is a PROMPT, not markup.** The model is told to speak a
 *     transcript, and the speaker labels in that transcript must match the
 *     `speaker` names in `speech_config` — so the labels are load-bearing and
 *     are written from the same map that assigns the voices.
 *   - **The session context is 32k tokens**, and a whole episode script is
 *     capped at 9,000 bytes (~2.5k tokens). One request per episode, no
 *     chunking — unlike the Azure path, which chunks against a ten-minute
 *     audio cap.
 *
 * The audio block's `mime_type`, `sample_rate` and `channels` have no
 * documented defaults. The guide says the models produce 24 kHz 16-bit PCM, so
 * a block that omits them is read as headerless 24 kHz 16-bit mono; one that
 * says `audio/wav`, or whose bytes begin `RIFF`, has its header read for the
 * rate and channel count and stripped. Stereo is averaged to mono because
 * mp3.js encodes mono. Either way the PCM is encoded to MP3 here; see mp3.js
 * for why that is not optional.
 *
 * Every Gemini TTS model is a preview model. That is the reason the Azure
 * provider is kept alongside this one rather than deleted — see speech/index.js.
 */
import { encodePcmToMp3, pcmDurationSeconds } from './mp3.js';

const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/**
 * Default model, overridable with `LISTEN_AND_LEARN_TTS_MODEL`.
 *
 * `gemini-3.1-flash-tts-preview` is the model the guide's own multi-speaker
 * example uses and the one the owner asked for (#458); `COST_TABLE` in
 * lib/ai/router.js prices it. The three TTS models the guide lists on
 * 2026-09-09 are all preview:
 *
 *   gemini-3.1-flash-tts-preview   <- default here
 *   gemini-2.5-flash-preview-tts   older, half the price
 *   gemini-2.5-pro-preview-tts     higher quality
 *
 * The same guide lists 30 voices, each with a one-word descriptor, and the two
 * used here are both in it — see GEMINI_DEFAULT_VOICES.
 */
const DEFAULT_MODEL = 'gemini-3.1-flash-tts-preview';
/** Named for index.js, which prices a run against this model before it starts. */
export { DEFAULT_MODEL as GEMINI_DEFAULT_MODEL };

/**
 * What the speech guide says the models produce, and the rate assumed for a
 * raw-PCM block that carries no `sample_rate`. A block that carries one wins.
 */
const PCM_SAMPLE_RATE = 24000;

/**
 * Audio tokens per second, for the case where the response reports no `usage`.
 *
 * 32/second is the rate the token-counting reference publishes for audio. It is
 * documented for audio *input*; applying it to generated audio is an estimate,
 * which is exactly why a row derived this way is flagged `estimatedTokens` and
 * the reported counts are preferred whenever the API sends them. Without the
 * flag the portal would show a derived number and a billed number as the same
 * kind of fact.
 */
const AUDIO_TOKENS_PER_SECOND = 32;
export { AUDIO_TOKENS_PER_SECOND as GEMINI_AUDIO_TOKENS_PER_SECOND };

/**
 * Voices for the two hosts, chosen by the descriptor the voice list publishes
 * rather than by gender, which it does not publish.
 *
 * The pairing follows the roles script.js already assigns: the lead frames the
 * area (Kore, *Firm*) and the second host asks the question a learner would ask
 * (Leda, *Youthful*). Two distinct descriptors is what a listener needs to tell
 * the hosts apart; anything more specific would be an assumption about voices
 * the documentation does not describe that way. Override per host with
 * `LISTEN_AND_LEARN_VOICE_MAYA` / `…_ELENA`.
 */
export const GEMINI_DEFAULT_VOICES = {
  Maya: 'Kore',
  Elena: 'Leda',
};

/** The API accepts at most two speaker configurations. */
const MAX_SPEAKERS = 2;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

/** Mime types that mean headerless signed 16-bit little-endian PCM. */
const RAW_PCM_MIMES = new Set(['audio/l16', 'audio/pcm', 'audio/x-pcm', 'audio/raw']);
/** Mime types that mean a RIFF/WAVE container around the same samples. */
const WAV_MIMES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']);

export class GeminiSpeechError extends Error {
  constructor(message, { status = null } = {}) {
    super(message);
    this.name = 'SpeechError';
    this.status = status;
    this.provider = 'gemini';
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
  for (const speaker of Object.keys(GEMINI_DEFAULT_VOICES)) {
    const value = readSetting(env, `LISTEN_AND_LEARN_VOICE_${speaker.toUpperCase()}`);
    if (value) overrides[speaker] = value;
  }
  return overrides;
}

/**
 * Render the dialogue as the transcript the model is asked to speak.
 *
 * The speaker labels must match the `speech_config` names exactly — an
 * unmatched label is read aloud as text instead of switching voice, which
 * sounds like a narrator announcing "Maya colon" before every line. Newlines
 * separate turns because a run-on paragraph invites the model to merge them.
 */
export function buildDialoguePrompt(turns, speakers) {
  const [a, b] = speakers;
  const transcript = turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n');
  return `TTS the following conversation between ${a} and ${b}:\n${transcript}`;
}

/** The distinct speakers in a dialogue, in the order they first appear. */
export function speakersIn(turns) {
  const seen = [];
  for (const turn of turns) {
    if (turn.speaker && !seen.includes(turn.speaker)) seen.push(turn.speaker);
  }
  return seen;
}

function assertTwoSpeakers(speakers, voices) {
  if (speakers.length === 0) throw new GeminiSpeechError('Dialogue names no speakers');
  if (speakers.length > MAX_SPEAKERS) {
    throw new GeminiSpeechError(
      `Gemini multi-speaker TTS accepts at most ${MAX_SPEAKERS} speakers; this dialogue has ${speakers.length} (${speakers.join(', ')})`
    );
  }
  const missing = speakers.filter((s) => !voices[s]);
  if (missing.length) {
    throw new GeminiSpeechError(
      `No voice configured for speaker${missing.length > 1 ? 's' : ''} ${missing.join(', ')} (known: ${Object.keys(voices).join(', ') || 'none'})`
    );
  }
}

async function requestAudio(body, { key, fetchImpl, sleep }) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(INTERACTIONS_URL, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastError = new GeminiSpeechError(`Failed to reach the Gemini API: ${err.message}`);
      if (attempt === MAX_ATTEMPTS) throw lastError;
      await sleep(attempt * 500);
      continue;
    }

    if (response.ok) return response.json();

    // 400 is a malformed request and 401/403 a rejected key; neither improves
    // on a retry. 429 and 5xx do.
    const detail = await response.text().catch(() => '');
    lastError = new GeminiSpeechError(
      `Gemini TTS HTTP ${response.status}: ${detail.slice(0, 300) || 'no detail'}`,
      { status: response.status }
    );
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS) throw lastError;
    await sleep(attempt * 500);
  }

  throw lastError;
}

/**
 * Every audio content block in the reply, in the order the model produced it.
 *
 * The SDK-style `output_audio` accessor is checked first so that a REST
 * revision adding it keeps working; otherwise the `model_output` steps are
 * walked. Anything that is not audio — text, a tool call — is skipped here
 * and named by `describeShape` when nothing is left.
 */
function audioBlocks(payload) {
  if (payload?.output_audio?.data) return [payload.output_audio];
  const blocks = [];
  for (const step of Array.isArray(payload?.steps) ? payload.steps : []) {
    if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue;
    for (const item of step.content) {
      if (item?.type === 'audio' && item.data) blocks.push(item);
    }
  }
  return blocks;
}

function isRiffWave(bytes) {
  return (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WAVE'
  );
}

/**
 * Read a RIFF/WAVE header for its format and return the samples after it.
 *
 * The canonical header is 44 bytes — `RIFF`, size, `WAVE`, a 16-byte `fmt `
 * chunk and the `data` chunk header — but the chunks are walked rather than
 * read at fixed offsets, because an encoder is free to put a `LIST` chunk
 * before `data`, and a fixed 44-byte skip would then hand the encoder a
 * header as if it were samples.
 *
 * @param {Buffer} bytes
 * @returns {{pcm: Buffer, sampleRate: number, channels: number}}
 */
export function parseWav(bytes) {
  if (!isRiffWave(bytes)) {
    throw new GeminiSpeechError('Gemini labelled the audio as WAV but it has no RIFF/WAVE header');
  }
  let format = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('latin1', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= bytes.length) {
      format = {
        codec: bytes.readUInt16LE(body),
        channels: bytes.readUInt16LE(body + 2),
        sampleRate: bytes.readUInt32LE(body + 4),
        bitsPerSample: bytes.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!format) throw new GeminiSpeechError('WAV audio has a data chunk before its fmt chunk');
      if (format.codec !== 1 || format.bitsPerSample !== 16) {
        throw new GeminiSpeechError(
          `WAV audio is format ${format.codec} at ${format.bitsPerSample}-bit; only 16-bit PCM can be encoded`
        );
      }
      // A streaming writer may leave the size 0 or 0xFFFFFFFF; the bytes that
      // are actually present are the truth either way.
      const end = size === 0 || body + size > bytes.length ? bytes.length : body + size;
      return { pcm: bytes.subarray(body, end), sampleRate: format.sampleRate, channels: format.channels };
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }
  throw new GeminiSpeechError('WAV audio has no data chunk');
}

/** One audio block → headerless PCM plus what the block or its header said about it. */
function decodeBlock(block) {
  const bytes = Buffer.from(String(block.data), 'base64');
  const [mime, ...params] = String(block.mime_type || '')
    .toLowerCase()
    .split(';')
    .map((part) => part.trim());

  if (isRiffWave(bytes) || WAV_MIMES.has(mime)) return parseWav(bytes);

  if (mime && !RAW_PCM_MIMES.has(mime)) {
    throw new GeminiSpeechError(
      `Gemini returned audio as ${mime}, which this module cannot decode (it expects raw PCM or WAV)`
    );
  }

  // RFC 2586 lets audio/L16 carry its rate as a parameter; the block's own
  // sample_rate field is the documented place and wins when both are present.
  const rateParam = params.find((p) => p.startsWith('rate='));
  const sampleRate =
    Number(block.sample_rate) ||
    (rateParam ? Number(rateParam.slice('rate='.length)) : 0) ||
    PCM_SAMPLE_RATE;
  const channels = Number(block.channels) || 1;
  return { pcm: bytes, sampleRate, channels };
}

/**
 * The audio in an Interactions reply as one PCM buffer, or null if it has none.
 *
 * Pure: reads the payload, touches no network. Several audio blocks are joined
 * in order; blocks that disagree on rate or channel count cannot be joined
 * without resampling and are refused rather than played at the wrong speed.
 *
 * @param {object} payload the parsed Interaction object
 * @returns {{pcm: Buffer, sampleRate: number, channels: number} | null}
 *   interleaved signed 16-bit little-endian samples, header stripped
 */
export function extractAudio(payload) {
  const parts = audioBlocks(payload).map(decodeBlock);
  if (parts.length === 0) return null;

  const [{ sampleRate, channels }] = parts;
  const odd = parts.find((p) => p.sampleRate !== sampleRate || p.channels !== channels);
  if (odd) {
    throw new GeminiSpeechError(
      `Gemini returned audio blocks in different formats (${sampleRate} Hz ${channels}-channel and ${odd.sampleRate} Hz ${odd.channels}-channel), which cannot be joined`
    );
  }

  const pcm = parts.length === 1 ? parts[0].pcm : Buffer.concat(parts.map((p) => p.pcm));
  return { pcm, sampleRate, channels };
}

/**
 * Average interleaved channels into one, because mp3.js encodes mono.
 * A dialogue is one sound stage, so nothing a listener would miss is lost.
 *
 * @param {Buffer} pcm interleaved signed 16-bit little-endian samples
 * @param {number} channels
 * @returns {Buffer} mono samples; the same buffer when it already was
 */
export function downmixToMono(pcm, channels) {
  if (!(channels > 1)) return pcm;
  const frameBytes = channels * 2;
  if (pcm.length % frameBytes !== 0) {
    throw new GeminiSpeechError(
      `${pcm.length} bytes is not a whole number of ${channels}-channel 16-bit frames`
    );
  }
  const frames = pcm.length / frameBytes;
  const mono = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += pcm.readInt16LE(i * frameBytes + c * 2);
    mono.writeInt16LE(Math.round(sum / channels), i * 2);
  }
  return mono;
}

/**
 * The reply's shape by type only — `model_output[text]` — never its text.
 * This is what an operator reads on the episode card when there is no audio.
 */
function describeShape(payload) {
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  if (steps.length === 0) return payload?.output_audio ? 'output_audio without data' : 'no steps';
  return steps
    .map((step) => {
      const types = Array.isArray(step?.content) ? step.content.map((c) => c?.type || 'unknown') : [];
      return `${step?.type || 'unknown'}[${types.join(',')}]`;
    })
    .join(', ');
}

/** `errors[]` as `code: message; code: message`, or a note that there were none. */
function describeErrors(payload) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  if (errors.length === 0) return 'no error detail';
  return errors
    .map((e) => `${e?.code || 'unknown'}: ${String(e?.message || '').slice(0, 200) || 'no message'}`)
    .join('; ');
}

/**
 * @param {object} params
 * @param {{speaker: string, text: string}[]} params.dialogue
 * @param {Record<string,string>|null} [params.voices]
 * @param {object} [params.env]
 * @param {Function} [params.fetchImpl]
 * @returns {Promise<{audio: Buffer, bytes: number, requests: number, model: string, estimatedSeconds: number}>}
 */
export async function synthesizeWithGemini({
  dialogue,
  voices = null,
  env = process.env,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const key = readSetting(env, 'GEMINI_API_KEY');
  if (!key) throw new GeminiSpeechError('GEMINI_API_KEY is not configured');

  // Precedence, lowest to highest: built-in default, environment override,
  // explicit caller argument.
  const resolvedVoices = {
    ...GEMINI_DEFAULT_VOICES,
    ...readVoiceOverrides(env),
    ...(voices || {}),
  };

  const speakers = speakersIn(dialogue);
  assertTwoSpeakers(speakers, resolvedVoices);

  const model = readSetting(env, 'LISTEN_AND_LEARN_TTS_MODEL') || DEFAULT_MODEL;

  const payload = await requestAudio(
    {
      model,
      input: buildDialoguePrompt(dialogue, speakers),
      response_format: { type: 'audio' },
      generation_config: {
        speech_config: speakers.map((speaker) => ({
          speaker,
          voice: resolvedVoices[speaker],
        })),
      },
    },
    { key, fetchImpl, sleep }
  );

  // A 200 is the transport succeeding; whether the model did is `status`.
  // `failed` carries the reason in `errors`; `incomplete` means the model hit
  // a limit, so any audio present would stop mid-sentence and is not shipped.
  const status = String(payload?.status || 'unknown');
  if (status === 'failed') {
    throw new GeminiSpeechError(`Gemini TTS failed (status failed): ${describeErrors(payload)}.`);
  }
  if (status === 'incomplete') {
    throw new GeminiSpeechError(
      `Gemini TTS stopped early (status incomplete), so the audio would be truncated: ${describeErrors(payload)}.`
    );
  }

  const found = extractAudio(payload);
  if (!found) {
    // A 200 with no audio is a real outcome — a safety block, or a model that
    // answered in text. Saying what came back instead beats a zero-byte MP3
    // nobody can play, and a shape by type is content-free.
    throw new GeminiSpeechError(
      `Gemini returned no audio for this dialogue (status ${status}; the reply held ${describeShape(payload)}; ${describeErrors(payload)}).`
    );
  }

  const pcm = downmixToMono(found.pcm, found.channels);
  const { sampleRate } = found;
  const audio = encodePcmToMp3(pcm, { sampleRate });
  const seconds = pcmDurationSeconds(pcm, sampleRate);

  return {
    audio,
    bytes: audio.length,
    requests: 1,
    model,
    estimatedSeconds: Math.round(seconds),
    ...tokenUsage(payload?.usage, seconds),
  };
}

/**
 * What this call is billed on.
 *
 * Prefers the counts the API reports. TTS is priced with an audio-output rate
 * an order of magnitude above the text rate, so the output count is what
 * decides an episode's cost — reporting a made-up one would put a fictional
 * number on the portal's spend page next to real ones.
 */
export function tokenUsage(usage, seconds) {
  const reportedIn = Number(usage?.total_input_tokens);
  const reportedOut = Number(usage?.total_output_tokens);

  if (Number.isFinite(reportedIn) && Number.isFinite(reportedOut)) {
    return { promptTokens: reportedIn, completionTokens: reportedOut, estimatedTokens: false };
  }

  return {
    promptTokens: Number.isFinite(reportedIn) ? reportedIn : 0,
    completionTokens: Math.round(seconds * AUDIO_TOKENS_PER_SECOND),
    estimatedTokens: true,
  };
}
