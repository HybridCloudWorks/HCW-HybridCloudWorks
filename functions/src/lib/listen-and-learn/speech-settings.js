/**
 * Which Gemini TTS model reads a Listen & Learn episode — the owner's button —
 * and, since ADR 0033 §4 (Audio Library), the voice a BOOK is read in.
 *
 * Owner instruction 2026-09-09: "have a button to go from gemini 2.5 to 3.1
 * and back — for newer technologies, better is best, for older, cheaper is
 * best." Two models are offered, and the choice is made twice:
 *
 *   - once as a STORED DEFAULT in `admin_config/listen_and_learn_speech`,
 *     edited on the Platform settings page (lib/platform-settings.js writes
 *     it through `normalizeListenAndLearnSpeech`, so only these two ids are
 *     ever stored), and
 *   - once PER RUN on the generation form, carried in the job payload as
 *     `ttsModel`, which defaults to the stored value.
 *
 * Precedence, highest first, is `resolveListenAndLearnModel` below and then
 * speech/index.js: the run's choice → the book's choice → the stored default →
 * `LISTEN_AND_LEARN_TTS_MODEL` → gemini.js's own default. ADR 0033 §4 makes
 * that module default ECONOMY: when nothing is stored, the cheapest sensible
 * voice reads, and the admin page says so beside the per-episode estimate.
 * "Newer certifications: Best; older ones: Economy" stays as guidance for the
 * person choosing, not automation.
 *
 * Both models are priced in `COST_TABLE`; `listenAndLearnModelOptions` states
 * each one's per-episode ceiling with the same arithmetic the 202 uses, so the
 * page and the queued toast cannot disagree about what a choice costs.
 *
 * PER-BOOK VOICE (ADR 0033 §4). A book or course document may carry a `voice`
 * object — which provider reads it, which Gemini model, which voice per host
 * and for a narrator, the language and the speaking rate — normalised here by
 * `normalizeVoiceSettings` so a document never holds a voice id the providers
 * would not accept. Gemini voices are the thirty the speech-generation guide
 * lists; Azure voices are free-form neural voice names because the catalogue
 * is regional and too large to pin. Speaking rate applies where the provider
 * supports it (Azure SSML `<prosody rate>`); Gemini TTS has no rate parameter
 * and reads at its own pace, which the admin page says.
 */
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { MAX_SCRIPT_BYTES } from './script.js';
import { estimateGeminiCostUsd } from './speech/index.js';
import { GEMINI_DEFAULT_MODEL } from './speech/gemini.js';

/** The `admin_config` document the stored default lives in. */
export const LISTEN_AND_LEARN_SPEECH_CONFIG_ID = 'listen_and_learn_speech';

/**
 * The two choices, in the order the control shows them. `label` is the
 * owner's wording; `tier` is the stable key the frontend and tests use. The
 * DEFAULT is Economy (ADR 0033 §4), marked by `isDefault` on the options
 * rather than by position, so the control's order and the refusal sentence
 * every client already knows stay as they were.
 */
export const LISTEN_AND_LEARN_GEMINI_MODELS = Object.freeze([
  Object.freeze({
    id: 'gemini-3.1-flash-tts-preview',
    tier: 'best',
    label: 'Best — newest voice, about twice the cost',
  }),
  Object.freeze({
    id: 'gemini-2.5-flash-preview-tts',
    tier: 'economy',
    label: 'Economy — cheaper',
  }),
]);

export const LISTEN_AND_LEARN_GEMINI_MODEL_IDS = Object.freeze(
  LISTEN_AND_LEARN_GEMINI_MODELS.map((m) => m.id)
);

/**
 * The model that reads when nothing is stored and no run or book chooses:
 * gemini.js's own default, which is Economy. One source, read rather than
 * restated, so the two cannot disagree.
 */
export const LISTEN_AND_LEARN_DEFAULT_MODEL = GEMINI_DEFAULT_MODEL;

/** The sentence every refusal of a model id uses, at the route and in the job. */
export const MODEL_CHOICE_RULE = `ttsModel must be one of ${LISTEN_AND_LEARN_GEMINI_MODEL_IDS.join(', ')}`;

export function isListenAndLearnGeminiModel(id) {
  return typeof id === 'string' && LISTEN_AND_LEARN_GEMINI_MODEL_IDS.includes(id);
}

/**
 * A model id from an untrusted field: `{ value }` (null when absent) or
 * `{ error }`. Absent means "the stored default"; anything present must be
 * one of the two ids exactly — no trimming to a match, because a request
 * that almost names a model is a request to read before spending on it.
 */
export function parseTtsModel(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  if (isListenAndLearnGeminiModel(raw)) return { value: raw };
  return { error: MODEL_CHOICE_RULE };
}

/**
 * The choices with their per-episode ceiling, for the settings card and the
 * generation form. A ceiling — every episode priced at `MAX_SCRIPT_BYTES`,
 * the most UTF-8 bytes a script may hold — so it reads "up to". `isDefault`
 * marks the one that reads when nothing is stored, so the page can say so.
 *
 * @returns {{id: string, tier: string, label: string, perEpisodeUsd: number|null, isDefault: boolean}[]}
 */
export function listenAndLearnModelOptions() {
  return LISTEN_AND_LEARN_GEMINI_MODELS.map((m) => ({
    ...m,
    perEpisodeUsd: estimateGeminiCostUsd(m.id, MAX_SCRIPT_BYTES),
    isDefault: m.id === LISTEN_AND_LEARN_DEFAULT_MODEL,
  }));
}

/**
 * The stored default, or null when there is none or it is not one of the two
 * ids (a hand-seeded document is shown as invalid on the page, and here it
 * is simply not a choice). A read FAILURE is not caught: a run that cannot
 * read its settings must not quietly proceed in a voice nobody chose, and it
 * is about to need Cosmos for everything else anyway.
 *
 * @param {(container: string, id: string, partition: string) => Promise<object|null>} readDoc
 */
export async function readStoredListenAndLearnModel(readDoc) {
  const doc = await readDoc(
    'admin_config',
    LISTEN_AND_LEARN_SPEECH_CONFIG_ID,
    ADMIN_CONFIG_PARTITION
  );
  return isListenAndLearnGeminiModel(doc?.geminiModel) ? doc.geminiModel : null;
}

/**
 * The run's choice, else the book's, else the stored default, else null —
 * which speech/index.js and gemini.js then resolve to
 * `LISTEN_AND_LEARN_TTS_MODEL` and the module default (Economy). Every input
 * is a validated id or null by the time it gets here.
 */
export function resolveListenAndLearnModel({ requested = null, book = null, stored = null } = {}) {
  return requested || book || stored || null;
}

// ── voices ──────────────────────────────────────────────────────────────────

/**
 * The thirty Gemini TTS voices, with the one-word descriptor the
 * speech-generation guide gives each (https://ai.google.dev/gemini-api/docs/
 * speech-generation, read 2026-09-09). The descriptor is the only thing the
 * documentation says about a voice, so it is the only thing shown.
 */
export const GEMINI_VOICES = Object.freeze(
  [
    ['Zephyr', 'Bright'],
    ['Puck', 'Upbeat'],
    ['Charon', 'Informative'],
    ['Kore', 'Firm'],
    ['Fenrir', 'Excitable'],
    ['Leda', 'Youthful'],
    ['Orus', 'Firm'],
    ['Aoede', 'Breezy'],
    ['Callirrhoe', 'Easy-going'],
    ['Autonoe', 'Bright'],
    ['Enceladus', 'Breathy'],
    ['Iapetus', 'Clear'],
    ['Umbriel', 'Easy-going'],
    ['Algieba', 'Smooth'],
    ['Despina', 'Smooth'],
    ['Erinome', 'Clear'],
    ['Algenib', 'Gravelly'],
    ['Rasalgethi', 'Informative'],
    ['Laomedeia', 'Upbeat'],
    ['Achernar', 'Soft'],
    ['Alnilam', 'Firm'],
    ['Schedar', 'Even'],
    ['Gacrux', 'Mature'],
    ['Pulcherrima', 'Forward'],
    ['Achird', 'Friendly'],
    ['Zubenelgenubi', 'Casual'],
    ['Vindemiatrix', 'Gentle'],
    ['Sadachbia', 'Lively'],
    ['Sadaltager', 'Knowledgeable'],
    ['Sulafat', 'Warm'],
  ].map(([id, descriptor]) => Object.freeze({ id, descriptor }))
);

export const GEMINI_VOICE_IDS = Object.freeze(GEMINI_VOICES.map((v) => v.id));

/**
 * A handful of Azure neural voices to offer by name. The full catalogue is
 * regional and runs to hundreds; these are the en-US voices the Azure
 * provider's own defaults sit among. Any other well-formed voice name is
 * accepted too (see `isVoiceName`), because an operator may know one.
 */
export const AZURE_VOICES = Object.freeze(
  [
    'en-US-Ava:DragonHDLatestNeural',
    'en-US-Emma:DragonHDLatestNeural',
    'en-US-AvaNeural',
    'en-US-EmmaNeural',
    'en-US-AndrewNeural',
    'en-US-BrianNeural',
    'en-US-JennyNeural',
    'en-US-AriaNeural',
    'en-US-GuyNeural',
    'en-US-DavisNeural',
  ].map((id) => Object.freeze({ id, descriptor: '' }))
);

/** The providers a book may name. `auto` is the product's own order and pin. */
export const VOICE_PROVIDERS = Object.freeze(['auto', 'gemini', 'azure']);

/** The two hosts every dialogue script names (script.js DEFAULT_SPEAKERS). */
export const VOICE_SPEAKERS = Object.freeze(['Maya', 'Elena']);

/** The speaker label a single-voice chapter is read under. */
export const NARRATOR_SPEAKER = 'Narrator';

export const SPEAKING_RATE = Object.freeze({ min: 0.5, max: 2, default: 1 });

/** Gemini's own defaults for the two hosts and a narrator (gemini.js). */
export const DEFAULT_VOICE_SETTINGS = Object.freeze({
  provider: 'auto',
  model: null,
  speakers: Object.freeze({ Maya: 'Kore', Elena: 'Leda' }),
  narrator: 'Kore',
  language: 'en-US',
  speakingRate: SPEAKING_RATE.default,
});

/** A voice id as either provider spells one: letters, digits, `-`, `:`, `_`. */
export function isVoiceName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$/.test(value);
}

const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2}|-\d{3})?$/;

/**
 * A book's voice settings from an untrusted body: `{ value }` or `{ error }`.
 * Absent fields take the defaults; a present field must be well formed, and
 * a voice named for Gemini must be one of its thirty — Gemini refuses an
 * unknown voice with an opaque 400, so the refusal happens here, by sentence.
 *
 * @param {unknown} raw
 */
export function normalizeVoiceSettings(raw) {
  if (raw === undefined || raw === null) return { value: { ...DEFAULT_VOICE_SETTINGS } };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'voice must be an object' };
  }

  const provider = raw.provider === undefined ? 'auto' : String(raw.provider);
  if (!VOICE_PROVIDERS.includes(provider)) {
    return { error: `voice.provider must be one of ${VOICE_PROVIDERS.join(', ')}` };
  }

  const model = parseTtsModel(raw.model);
  if (model.error) return { error: `voice.model: ${model.error}` };

  const geminiBound = provider !== 'azure';
  const checkVoice = (value, field) => {
    if (value === undefined || value === null || value === '') return null;
    if (!isVoiceName(value)) return { error: `${field} is not a voice name` };
    if (geminiBound && !GEMINI_VOICE_IDS.includes(value)) {
      return { error: `${field} must be one of the Gemini voices: ${GEMINI_VOICE_IDS.join(', ')}` };
    }
    return { value };
  };

  const speakers = {};
  const rawSpeakers =
    raw.speakers && typeof raw.speakers === 'object' && !Array.isArray(raw.speakers)
      ? raw.speakers
      : {};
  for (const speaker of VOICE_SPEAKERS) {
    const checked = checkVoice(rawSpeakers[speaker], `voice.speakers.${speaker}`);
    if (checked?.error) return { error: checked.error };
    speakers[speaker] = checked?.value || DEFAULT_VOICE_SETTINGS.speakers[speaker];
  }

  const narrator = checkVoice(raw.narrator, 'voice.narrator');
  if (narrator?.error) return { error: narrator.error };

  const language =
    raw.language === undefined || raw.language === null || raw.language === ''
      ? DEFAULT_VOICE_SETTINGS.language
      : String(raw.language).trim();
  if (!LANGUAGE_PATTERN.test(language)) {
    return { error: 'voice.language must be a BCP 47 tag such as en-US' };
  }

  let speakingRate = SPEAKING_RATE.default;
  if (raw.speakingRate !== undefined && raw.speakingRate !== null && raw.speakingRate !== '') {
    const rate = Number(raw.speakingRate);
    if (!Number.isFinite(rate) || rate < SPEAKING_RATE.min || rate > SPEAKING_RATE.max) {
      return {
        error: `voice.speakingRate must be between ${SPEAKING_RATE.min} and ${SPEAKING_RATE.max}`,
      };
    }
    speakingRate = Math.round(rate * 100) / 100;
  }

  return {
    value: {
      provider,
      model: model.value,
      speakers,
      narrator: narrator?.value || DEFAULT_VOICE_SETTINGS.narrator,
      language,
      speakingRate,
    },
  };
}

/**
 * The voice settings a stored book carries, defaults filled in, never an
 * error: a document written by hand with a bad voice is read as the
 * defaults rather than failing every read of the book.
 */
export function voiceSettingsOf(doc) {
  const parsed = normalizeVoiceSettings(doc?.voice);
  return parsed.value || { ...DEFAULT_VOICE_SETTINGS };
}

/**
 * The arguments `synthesizeDialogue` takes for a book's voice settings and a
 * dialogue's speakers. Hosts get their per-book voices; a narrator chapter
 * gets the narrator voice; `provider: 'auto'` passes no override.
 *
 * @param {ReturnType<typeof voiceSettingsOf>} voice
 * @param {{ narrator?: boolean }} [options]
 */
export function speechArgsFor(voice, { narrator = false } = {}) {
  const settings = voice || DEFAULT_VOICE_SETTINGS;
  return {
    voices: narrator ? { [NARRATOR_SPEAKER]: settings.narrator } : { ...settings.speakers },
    lang: settings.language,
    speakingRate: settings.speakingRate,
    provider: settings.provider === 'auto' ? null : settings.provider,
    model: settings.model || null,
  };
}
