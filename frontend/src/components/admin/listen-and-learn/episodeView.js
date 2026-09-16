/**
 * How a Listen & Learn run and its episodes read: durations, sizes, spend, and
 * the sentence the 202 turns into.
 *
 * Pure functions, no React and no icons, so the wording can be tested without
 * rendering anything — the same split certView.js uses for the Certifications
 * Hub. Moved here from ListenAndLearnPage when #574 split the page into tabs;
 * the behaviour is unchanged.
 */
import { GEMINI_TTS_MODEL_TIERS } from '@/lib/listenAndLearn';

export const formatDuration = (seconds) => {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

export const formatSize = (bytes) =>
  bytes > 0 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : null;

/** Sub-cent runs are normal here, so two decimals would read as free. */
export const formatCost = (usd) => (usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`);

/**
 * Listen & Learn is Gemini TTS with Azure AI Speech as the fallback, never
 * ElevenLabs (owner rule 2026-09-09, ADR 0029 §2b); the server enforces it
 * per product, so a 202 cannot name ElevenLabs here. Anything unlisted is
 * shown as sent.
 */
const PROVIDER_LABEL = { gemini: 'Gemini', azure: 'Azure AI Speech' };

/** "Best (gemini-3.1-flash-tts-preview)", or the bare id for a model not in the pair. */
const modelLabel = (model) =>
  GEMINI_TTS_MODEL_TIERS[model] ? `${GEMINI_TTS_MODEL_TIERS[model]} (${model})` : model;

/**
 * "Gemini Best (gemini-3.1-flash-tts-preview)", or — for a run that named
 * no model — "Gemini (the stored default applies; see Platform settings)".
 * The 202 cannot know the stored default, so it says so and prices the
 * dearer model rather than guessing; the toast repeats its sentence.
 */
function voiceLabel(speech) {
  const name = PROVIDER_LABEL[speech.provider] || speech.provider;
  if (speech.model) return `${name} ${modelLabel(speech.model)}`;
  if (speech.modelSource === 'stored') {
    return `${name} (${speech.modelNote || 'the stored default model applies'})`;
  }
  return name;
}

/**
 * Why a run will produce no audio, by the reason the server gave. The two
 * causes need different fixes — seeding a key, or correcting
 * `LISTEN_AND_LEARN_TTS_PROVIDER` — so they are worded separately, and a 202
 * from an older server carries no reason at all, which `noProviderMessage`
 * covers with wording true of both.
 */
const NO_PROVIDER = Object.freeze({
  pin_unavailable:
    'Queued — the pinned speech provider (LISTEN_AND_LEARN_TTS_PROVIDER) is not configured, so the audio step will fail and episodes will have transcripts only',
  not_configured:
    'Queued — no speech provider is configured, so episodes will have transcripts only',
});

const NO_PROVIDER_UNKNOWN =
  'Queued — no usable speech provider (none configured, or the pinned one is not), so episodes will have transcripts only';

/** Own properties only: a `reason` of "constructor" must not reach a function. */
function noProviderMessage(reason) {
  return Object.prototype.hasOwnProperty.call(NO_PROVIDER, reason ?? '')
    ? NO_PROVIDER[reason]
    : NO_PROVIDER_UNKNOWN;
}

/**
 * The progress line for a run that has just been accepted.
 *
 * The server's 202 says what the run is expected to spend on speech BEFORE it
 * starts (ADR 0029 §2a). It is a ceiling — every episode priced at
 * `MAX_SCRIPT_BYTES`, the most UTF-8 bytes a script may hold — so it reads
 * "up to", and it names the Gemini model the run will read with, because the
 * two on offer differ by a factor of two. No provider means the run will
 * publish transcripts with no audio; the server says which of the two causes
 * that is, because they call for different fixes — seeding a key, or
 * correcting `LISTEN_AND_LEARN_TTS_PROVIDER` — and a 202 from an older server
 * carries no reason, so the wording without one covers both.
 *
 * @param {{provider?: string|null, model?: string|null, reason?: string|null, estimatedCostUsd?: number|null, episodes?: number, perEpisodeUsd?: number|null}|null|undefined} speech
 */
export function queuedMessage(speech) {
  if (!speech) return 'Queued…';
  if (!speech.provider) return noProviderMessage(speech.reason);
  const voice = voiceLabel(speech);
  if (typeof speech.estimatedCostUsd !== 'number') return `Queued — speech by ${voice}`;
  const perEpisode =
    typeof speech.perEpisodeUsd === 'number' && speech.episodes
      ? ` (${speech.episodes} episodes × ${formatCost(speech.perEpisodeUsd)})`
      : '';
  return `Queued — speech by ${voice}, up to ${formatCost(speech.estimatedCostUsd)}${perEpisode}`;
}

/** Published / draft / failed counts for a set, for the tab's summary line. */
export function statusCounts(episodes) {
  return episodes.reduce((acc, e) => ({ ...acc, [e.status]: (acc[e.status] || 0) + 1 }), {});
}
