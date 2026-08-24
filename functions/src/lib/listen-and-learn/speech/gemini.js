/**
 * Render a two-host dialogue with the Gemini TTS models.
 *
 * This is the capability the feature was asked for: a two-host "deep dive" read
 * from source material is what a NotebookLM audio overview is, and these are
 * the models that produce it. It runs on `GEMINI_API_KEY` — the key the text
 * side of the site already uses — so the whole feature needs no new service, no
 * new resource and no new credential.
 *
 * Contract, verified against the Gemini API speech-generation reference on
 * 2026-08-24:
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions
 *   x-goog-api-key: <key>
 *   { model, input, response_format: {type:'audio'},
 *     generation_config: { speech_config: [{speaker, voice}, …] } }
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
 * Output is base64 **headerless 24 kHz 16-bit mono PCM** with no format option,
 * so it is encoded to MP3 here; see mp3.js for why that is not optional.
 *
 * Every Gemini TTS model is a preview model. That is the reason the Azure
 * provider is kept alongside this one rather than deleted — see speech/index.js.
 */
import { encodePcmToMp3, pcmDurationSeconds } from './mp3.js';

const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/**
 * Default model, overridable with `LISTEN_AND_LEARN_TTS_MODEL`.
 *
 * The flash tier is the cheap one, which is the tier this is meant to run on.
 * `gemini-3.1-flash-tts-preview` is newer and is what Google's own example
 * uses; it is a one-setting change if it turns out to sound better or cost
 * less. All three published TTS models are preview:
 *
 *   gemini-2.5-flash-preview-tts   <- default here
 *   gemini-2.5-pro-preview-tts     higher quality, costs more
 *   gemini-3.1-flash-tts-preview   newest
 */
const DEFAULT_MODEL = 'gemini-2.5-flash-preview-tts';

/** Source format of `output_audio.data`. Not configurable at the API. */
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

class GeminiSpeechError extends Error {
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

  const data = payload?.output_audio?.data;
  if (!data) {
    // A 200 with no audio is a real outcome — a safety block, or a model that
    // answered in text. Saying so beats a zero-byte MP3 nobody can play.
    throw new GeminiSpeechError('Gemini returned no audio for this dialogue');
  }

  const pcm = Buffer.from(data, 'base64');
  const sampleRate = Number(payload?.output_audio?.sample_rate) || PCM_SAMPLE_RATE;
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
