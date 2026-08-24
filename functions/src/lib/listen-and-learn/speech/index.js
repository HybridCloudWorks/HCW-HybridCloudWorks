/**
 * Turn a two-host dialogue into an episode MP3.
 *
 * Two providers, selected the way the AI router selects text models: a key
 * makes a provider POSSIBLE, and the first configured one in preference order
 * runs. Seed nothing and synthesis reports itself as not configured, which
 * generate.js treats as "publish the transcript, skip the audio" rather than as
 * a failed episode.
 *
 * Preference order, and why:
 *
 *   1. **Gemini** (`GEMINI_API_KEY`). This is the same key the text side of the
 *      site already uses, so the feature costs no new service, no new resource
 *      and no new credential — it is switched on by a key that is already
 *      seeded. It is also the capability the request was actually for: a
 *      two-host "deep dive" read from source material is what NotebookLM's
 *      audio overview is, and the Gemini TTS models are what produce it.
 *   2. **Azure AI Speech** (`AZURE_SPEECH_KEY`). Kept as the fallback rather
 *      than deleted for one concrete reason: every Gemini TTS model is a
 *      *preview* model (`…-preview-tts`, `…-tts-preview`), and preview
 *      endpoints get retired on notice. Azure Speech is GA. Having the second
 *      path written and tested is the difference between a model retirement
 *      being a config change and being an outage. It needs a Cognitive
 *      Services resource, which is a spend decision, so nothing here assumes
 *      one exists.
 *
 * Both providers return MP3, so everything downstream — the blob path, the
 * stored `contentType`, the `<audio>` element — is identical whichever ran.
 * That is deliberate: the provider is an implementation detail of this
 * directory and must not leak into the document shape.
 */
import { synthesizeWithGemini, GEMINI_DEFAULT_VOICES } from './gemini.js';
import { synthesizeWithAzure, AZURE_DEFAULT_VOICES } from './azure.js';

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
    message = 'No speech provider is configured — set GEMINI_API_KEY (or AZURE_SPEECH_KEY)'
  ) {
    super(message);
    this.name = 'SpeechNotConfiguredError';
  }
}

/**
 * A Key Vault reference that failed to resolve arrives as the literal
 * `@Microsoft.KeyVault(...)` string. That is not a key — the same rule the AI
 * router applies in `readKey`, repeated here because this directory does not
 * import from it.
 */
export function readSetting(env, name) {
  const value = String(env?.[name] || '').trim();
  if (!value || value.startsWith('@Microsoft.KeyVault(')) return '';
  return value;
}

const PROVIDERS = [
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

/**
 * The provider that would run, or null.
 *
 * `LISTEN_AND_LEARN_TTS_PROVIDER` pins one outright — an instruction rather
 * than a preference, so a pin that is not configured FAILS rather than falling
 * through to the other provider. Falling through would silently produce
 * episodes in a voice nobody chose.
 */
export function resolveSpeechProvider(env = process.env) {
  const configured = PROVIDERS.filter(
    (p) =>
      p.keys.every((k) => readSetting(env, k)) &&
      (!p.extra || p.extra.some((k) => readSetting(env, k)))
  );

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
 * Synthesise a whole dialogue, returning one MP3.
 *
 * @param {object} params
 * @param {{speaker: string, text: string}[]} params.dialogue
 * @param {Record<string,string>} [params.voices] speaker name → provider voice
 * @param {object} [params.env]
 * @param {Function} [params.fetchImpl]
 * @returns {Promise<{audio: Buffer, contentType: string, bytes: number, provider: string, requests: number}>}
 */
export async function synthesizeDialogue({
  dialogue,
  voices = null,
  env = process.env,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const turns = (dialogue || []).filter((t) => String(t?.text || '').trim());
  if (turns.length === 0) throw new SpeechError('No dialogue turns to synthesise');

  const provider = resolveSpeechProvider(env);
  if (!provider) throw new SpeechNotConfiguredError();

  const result = await provider.synthesize({ dialogue: turns, voices, env, fetchImpl, sleep });
  return { ...result, provider: provider.name, contentType: CONTENT_TYPE };
}

/** Exposed so the admin surface can say which voices an episode was read in. */
export const DEFAULT_VOICES = Object.freeze({
  gemini: GEMINI_DEFAULT_VOICES,
  azure: AZURE_DEFAULT_VOICES,
});
