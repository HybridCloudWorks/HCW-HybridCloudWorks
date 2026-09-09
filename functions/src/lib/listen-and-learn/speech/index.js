/**
 * Turn a two-host dialogue into an episode MP3.
 *
 * Three providers, selected the way the AI router selects text models: a key
 * makes a provider POSSIBLE, and the first configured one in preference order
 * runs. Seed nothing and synthesis reports itself as not configured, which
 * generate.js treats as "publish the transcript, skip the audio" rather than as
 * a failed episode.
 *
 * Preference order, and why (ADR 0029 §2, amended by §2a on 2026-09-08):
 *
 *   1. **ElevenLabs** (`ELEVENLABS_API_KEY`). The owner approved a paid plan
 *      on 2026-09-08 and chose it for its dialogue quality, so when its key is
 *      present it is the provider that runs: it is what is being paid for.
 *      That also means every generation now spends money where the free path
 *      spent none — roughly USD 0.10 per 1,000 characters, about USD 4 per
 *      certification — which is why `estimateSpeechCostUsd` exists and the
 *      figure is stated before a run starts rather than found in the usage
 *      table afterwards.
 *   2. **Gemini** (`GEMINI_API_KEY`). The same key the text side of the site
 *      already uses, so it costs no new service, resource or credential. It
 *      stays as the fallback for a state a paid provider has and a free one
 *      does not: **out of credit**. An ElevenLabs run that fails with
 *      `quota_exceeded` falls through to the next configured provider (unless
 *      a pin says otherwise), because a certification with episodes in a
 *      different voice beats a certification with no audio.
 *   3. **Azure AI Speech** (`AZURE_SPEECH_KEY`). Kept for one concrete
 *      reason: every Gemini TTS model is a *preview* model (`…-preview-tts`,
 *      `…-tts-preview`), and preview endpoints get retired on notice. Azure
 *      Speech is GA. Having the path written and tested is the difference
 *      between a model retirement being a config change and being an outage.
 *      It needs a Cognitive Services resource, which is a spend decision, so
 *      nothing here assumes one exists.
 *
 * All three return MP3, so everything downstream — the blob path, the stored
 * `contentType`, the `<audio>` element — is identical whichever ran. That is
 * deliberate: the provider is an implementation detail of this directory and
 * must not leak into the document shape.
 */
import { getCostEstimate } from '../../ai/router.js';
import {
  synthesizeWithElevenLabs,
  ELEVENLABS_DEFAULT_VOICES,
  ELEVENLABS_DEFAULT_MODEL,
  ELEVENLABS_MODEL_SETTING,
  dialogueCharacters,
} from './elevenlabs.js';
import {
  synthesizeWithGemini,
  GEMINI_DEFAULT_VOICES,
  GEMINI_DEFAULT_MODEL,
  GEMINI_AUDIO_TOKENS_PER_SECOND,
} from './gemini.js';
import { synthesizeWithAzure, AZURE_DEFAULT_VOICES, SPEECH_LIMITS } from './azure.js';

export { encodePcmToMp3, MP3_BITRATE_KBPS } from './mp3.js';

/** Every provider returns this, so the caller never branches on which ran. */
export const CONTENT_TYPE = 'audio/mpeg';

export class SpeechError extends Error {
  constructor(message, { status = null, provider = null } = {}) {
    super(message);
    this.name = 'SpeechError';
    this.status = status;
    this.provider = provider;
  }
}

/** Thrown when no key is configured, so a caller can degrade instead of fail. */
export class SpeechNotConfiguredError extends SpeechError {
  constructor(
    // Each provider's REAL requirement, matching PROVIDERS below: Azure needs
    // somewhere to send its key, so the key alone does not configure it.
    message = 'No speech provider is configured — set ELEVENLABS_API_KEY, or GEMINI_API_KEY, or AZURE_SPEECH_KEY together with AZURE_SPEECH_REGION or AZURE_SPEECH_ENDPOINT'
  ) {
    super(message);
    this.name = 'SpeechNotConfiguredError';
  }
}

/**
 * A Key Vault reference that failed to resolve arrives as the literal
 * `@Microsoft.KeyVault(...)` string. That is not a key — the same rule the AI
 * router applies in `readKey`, repeated here because this directory does not
 * import it.
 */
export function readSetting(env, name) {
  const value = String(env?.[name] || '').trim();
  if (!value || value.startsWith('@Microsoft.KeyVault(')) return '';
  return value;
}

const PROVIDERS = [
  { name: 'elevenlabs', keys: ['ELEVENLABS_API_KEY'], synthesize: synthesizeWithElevenLabs },
  { name: 'gemini', keys: ['GEMINI_API_KEY'], synthesize: synthesizeWithGemini },
  {
    name: 'azure',
    // Azure needs a key AND somewhere to send it; a key with no region is not
    // a usable configuration, so it does not count as one.
    keys: ['AZURE_SPEECH_KEY'],
    extra: ['AZURE_SPEECH_REGION', 'AZURE_SPEECH_ENDPOINT'],
    synthesize: synthesizeWithAzure,
  },
];

/** The providers with a usable configuration, in preference order. */
function configuredProviders(env) {
  return PROVIDERS.filter(
    (p) =>
      p.keys.every((k) => readSetting(env, k)) &&
      (!p.extra || p.extra.some((k) => readSetting(env, k)))
  );
}

/**
 * The provider that would run, or null.
 *
 * `LISTEN_AND_LEARN_TTS_PROVIDER` pins one outright — an instruction rather
 * than a preference, so a pin that is not configured FAILS rather than falling
 * through to another provider. Falling through would silently produce
 * episodes in a voice nobody chose.
 */
export function resolveSpeechProvider(env = process.env) {
  const configured = configuredProviders(env);

  const pinned = readSetting(env, 'LISTEN_AND_LEARN_TTS_PROVIDER').toLowerCase();
  if (pinned) {
    const match = configured.find((p) => p.name === pinned);
    if (match) return match;
    const known = PROVIDERS.some((p) => p.name === pinned);
    throw new SpeechNotConfiguredError(
      known
        ? `LISTEN_AND_LEARN_TTS_PROVIDER pins "${pinned}", which is not configured`
        : `LISTEN_AND_LEARN_TTS_PROVIDER is "${pinned}"; known providers are ${PROVIDERS.map((p) => p.name).join(', ')}`
    );
  }

  return configured[0] || null;
}

/**
 * The providers `synthesizeDialogue` may try, in order.
 *
 * A pin is exactly one provider. Otherwise it is every configured one, so
 * that the out-of-credit fallback has somewhere to go.
 */
function candidateProviders(env) {
  const first = resolveSpeechProvider(env);
  if (!first) return [];
  if (readSetting(env, 'LISTEN_AND_LEARN_TTS_PROVIDER')) return [first];
  return configuredProviders(env);
}

const isOutOfCredit = (err) => err?.name === 'SpeechError' && err?.code === 'quota_exceeded';

/**
 * The turns that will actually be spoken: those with non-blank text.
 *
 * One helper for both `synthesizeDialogue` and `estimateSpeechCostUsd`, so
 * the estimate can never count a turn synthesis would drop. Before this was
 * shared, a whitespace-only dialogue estimated $0 while synthesis refused it.
 *
 * @param {{speaker: string, text: string}[]|null|undefined} dialogue
 * @returns {{speaker: string, text: string}[]}
 */
export function speakableTurns(dialogue) {
  return (dialogue || []).filter((t) => String(t?.text || '').trim());
}

/**
 * Synthesise a whole dialogue, returning one MP3.
 *
 * Only ONE failure moves on to the next provider: the paid provider reporting
 * that its credit is spent, which is a state of the account rather than of
 * the request. A bad request, a rejected key or a 5xx that survived its
 * retries still fails the area, because retrying those elsewhere would hide
 * a fault behind a different voice. When a fallback ran, `fellBackFrom` says
 * which provider was skipped and why.
 *
 * @param {object} params
 * @param {{speaker: string, text: string}[]} params.dialogue
 * @param {Record<string,string>} [params.voices] speaker name → provider voice
 * @param {object} [params.env]
 * @param {Function} [params.fetchImpl]
 * @returns {Promise<{audio: Buffer, contentType: string, bytes: number, provider: string, requests: number, fellBackFrom?: {provider: string, reason: string}}>}
 */
export async function synthesizeDialogue({
  dialogue,
  voices = null,
  env = process.env,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const turns = speakableTurns(dialogue);
  if (turns.length === 0) throw new SpeechError('No dialogue turns to synthesise');

  const candidates = candidateProviders(env);
  if (candidates.length === 0) throw new SpeechNotConfiguredError();

  let fellBackFrom = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const provider = candidates[i];
    try {
      const result = await provider.synthesize({ dialogue: turns, voices, env, fetchImpl, sleep });
      return {
        ...result,
        provider: provider.name,
        contentType: CONTENT_TYPE,
        ...(fellBackFrom ? { fellBackFrom } : {}),
      };
    } catch (err) {
      if (!isOutOfCredit(err) || i === candidates.length - 1) throw err;
      fellBackFrom = { provider: provider.name, reason: err.message };
    }
  }

  // Unreachable: the loop returns or throws. Kept so a future edit that
  // breaks that invariant fails loudly rather than resolving undefined.
  throw new SpeechError('No speech provider produced audio');
}

/**
 * The model the current settings would use for a provider — the same rule
 * each provider applies when it runs, so the estimate prices what will
 * actually be called.
 */
function modelFor(providerName, env) {
  if (providerName === 'elevenlabs') {
    return readSetting(env, ELEVENLABS_MODEL_SETTING) || ELEVENLABS_DEFAULT_MODEL;
  }
  if (providerName === 'gemini') {
    return readSetting(env, 'LISTEN_AND_LEARN_TTS_MODEL') || GEMINI_DEFAULT_MODEL;
  }
  return null;
}

/**
 * What a dialogue of this size would cost to read, BEFORE reading it.
 *
 * Provider-aware. ElevenLabs is exact in its unit — characters × the rate in
 * `COST_TABLE`, the same arithmetic the usage row is priced with afterwards.
 * Gemini is best-effort: characters → seconds at the pessimistic speaking rate
 * azure.js chunks with → audio tokens at the published per-second rate → the
 * model's output price, an over-estimate in every step, which is the right
 * direction for a figure shown before spending. Azure Speech is not in the
 * cost table, so its estimate is honestly `null` rather than a guess.
 *
 * Pass `dialogue` when there is one, or `characters` when there is not yet —
 * the enqueue handler estimates against the script's byte ceiling before any
 * script exists. Two units are in play and they are kept apart: ElevenLabs
 * bills CHARACTERS (code points), while the speaking-rate constant borrowed
 * from azure.js is UTF-8 BYTES per second. A dialogue is therefore measured
 * both ways, and a bare `characters` ceiling is treated as BYTES — a byte
 * count is never fewer than a character count, so the ceiling over-estimates
 * for both providers, which is the direction a figure shown before spending
 * must err in. Dividing characters by a bytes-per-second rate would have
 * under-estimated any non-ASCII script.
 *
 * @param {object} params
 * @param {{speaker: string, text: string}[]} [params.dialogue]
 * @param {number} [params.characters] a ceiling in UTF-8 bytes (see above)
 * @param {object} [params.env]
 * @returns {{provider: string, model: string|null, characters: number, estimatedCostUsd: number|null}|null}
 *   null when no provider is configured (or the pin is unusable), and null
 *   when there is nothing to price — no ceiling and no speakable turn — since
 *   synthesis would refuse that dialogue rather than read it for free.
 */
export function estimateSpeechCostUsd({ dialogue = null, characters = null, env = process.env } = {}) {
  let provider;
  try {
    provider = resolveSpeechProvider(env);
  } catch (err) {
    if (err?.name === 'SpeechNotConfiguredError') return null;
    throw err;
  }
  if (!provider) return null;

  // `Number(null)` is 0, so the null check comes first or a dialogue is
  // never counted.
  const hasCeiling =
    characters !== null && characters !== undefined && Number.isFinite(Number(characters));
  const ceiling = hasCeiling ? Math.max(0, Math.round(Number(characters))) : null;
  // The same filter synthesis applies, so a blank turn is never priced — and
  // a dialogue that is nothing but blank turns is "nothing to price", not $0.
  const turns = speakableTurns(dialogue);
  if (!hasCeiling && turns.length === 0) return null;
  const count = hasCeiling ? ceiling : dialogueCharacters(turns);
  const bytes = hasCeiling ? ceiling : dialogueBytes(turns);
  const model = modelFor(provider.name, env);

  let estimatedCostUsd = null;
  if (provider.name === 'elevenlabs') {
    estimatedCostUsd = getCostEstimate('elevenlabs', model, 0, count);
  } else if (provider.name === 'gemini') {
    const seconds = bytes / SPEECH_LIMITS.BYTES_PER_SECOND;
    const audioTokens = Math.round(seconds * GEMINI_AUDIO_TOKENS_PER_SECOND);
    estimatedCostUsd = getCostEstimate('gemini', model, 0, audioTokens);
  }

  return { provider: provider.name, model, characters: count, estimatedCostUsd };
}

/** UTF-8 bytes of every turn's text — the unit azure.js's speaking rate is in. */
function dialogueBytes(turns) {
  return turns.reduce((total, turn) => total + Buffer.byteLength(String(turn?.text ?? ''), 'utf8'), 0);
}

/** Exposed so the admin surface can say which voices an episode was read in. */
export const DEFAULT_VOICES = Object.freeze({
  elevenlabs: ELEVENLABS_DEFAULT_VOICES,
  gemini: GEMINI_DEFAULT_VOICES,
  azure: AZURE_DEFAULT_VOICES,
});
