/**
 * Which Gemini TTS model reads a Listen & Learn episode — the owner's button.
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
 * speech/index.js: the run's choice → the stored default →
 * `LISTEN_AND_LEARN_TTS_MODEL` → gemini.js's own default. The rule of thumb
 * on the control ("newer certifications: Best; older ones: Economy") is
 * guidance for the person choosing, not automation — choosing by
 * certification age is a follow-up, if it is ever wanted.
 *
 * Both models are priced in `COST_TABLE`; `listenAndLearnModelOptions` states
 * each one's per-episode ceiling with the same arithmetic the 202 uses, so the
 * page and the queued toast cannot disagree about what a choice costs.
 */
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { MAX_SCRIPT_BYTES } from './script.js';
import { estimateGeminiCostUsd } from './speech/index.js';

/** The `admin_config` document the stored default lives in. */
export const LISTEN_AND_LEARN_SPEECH_CONFIG_ID = 'listen_and_learn_speech';

/**
 * The two choices, in the order the control shows them. `label` is the
 * owner's wording; `tier` is the stable key the frontend and tests use.
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
 * the most UTF-8 bytes a script may hold — so it reads "up to".
 *
 * @returns {{id: string, tier: string, label: string, perEpisodeUsd: number|null}[]}
 */
export function listenAndLearnModelOptions() {
  return LISTEN_AND_LEARN_GEMINI_MODELS.map((m) => ({
    ...m,
    perEpisodeUsd: estimateGeminiCostUsd(m.id, MAX_SCRIPT_BYTES),
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
  const doc = await readDoc('admin_config', LISTEN_AND_LEARN_SPEECH_CONFIG_ID, ADMIN_CONFIG_PARTITION);
  return isListenAndLearnGeminiModel(doc?.geminiModel) ? doc.geminiModel : null;
}

/**
 * The run's choice, else the stored default, else null — which speech/index.js
 * and gemini.js then resolve to `LISTEN_AND_LEARN_TTS_MODEL` and the module
 * default. Both inputs are validated ids or null by the time they get here.
 */
export function resolveListenAndLearnModel({ requested = null, stored = null } = {}) {
  return requested || stored || null;
}
