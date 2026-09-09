/**
 * Listen & Learn data access.
 *
 * Site-Main read `listen_and_learn/{setId}/episodes` from the browser and
 * relied on a Firestore rule to append `status == 'published'` to every public
 * query. That rule is gone, and so is the class of bug it created — a public
 * query that forgot the constraint was rejected outright and rendered the
 * study-podcast section empty with no visible error.
 *
 * Here the server owns the filter. `fetchPublishedEpisodes` calls an anonymous
 * endpoint that returns approved episodes and nothing else; the admin reads are
 * separate functions against editor-gated routes. The scope is therefore
 * carried by *which function you call*, not by an argument you can forget.
 */
import { getJSON, postJSON } from '@/lib/api';
import { fetchPublicListenAndLearn } from '@/lib/publicApi';
import { runJob } from '@/lib/jobs';

/** `azure` + `AZ-104` → `azure_az-104`, matching the server's set id. */
export function setIdFor(platform, examCode) {
  return `${String(platform || '').toLowerCase()}_${String(examCode || '').toLowerCase()}`;
}

/**
 * The certification platforms with a working study-guide adapter.
 *
 * Mirrors SUPPORTED_PLATFORMS in functions/src/lib/listen-and-learn/generate.js
 * so a certification page can render "coming soon" rather than a generate
 * button it would be refused for. GitHub exams are hosted on Microsoft Learn
 * and parse with the same adapter.
 */
export const SUPPORTED_PLATFORMS = ['azure', 'github', 'aws'];

export function isSupportedPlatform(platform) {
  return SUPPORTED_PLATFORMS.includes(String(platform || '').toLowerCase());
}

// ── public ──────────────────────────────────────────────────────────────────

/**
 * Approved episodes for one certification, in study-guide order.
 *
 * Returns `null` when the certification has never been generated, which the
 * page renders differently from a generated set with nothing approved yet —
 * the latter comes back as an empty `episodes` array.
 *
 * @param {{platform: string, examCode: string}} params
 * @returns {Promise<{set: object, episodes: object[]}|null>}
 */
export async function fetchPublishedEpisodes({ platform, examCode } = {}) {
  return fetchPublicListenAndLearn({ platform, examCode });
}

// ── admin ───────────────────────────────────────────────────────────────────

/**
 * The two Gemini TTS models the owner may choose between, by their short
 * names — the owner's button (functions/src/lib/listen-and-learn/
 * speech-settings.js is the source; the server prices them). Used to name
 * the model on the queued line; the form's labels come from the server.
 */
export const GEMINI_TTS_MODEL_TIERS = Object.freeze({
  'gemini-3.1-flash-tts-preview': 'Best',
  'gemini-2.5-flash-preview-tts': 'Economy',
});

/**
 * The stored default model and the offered choices with their per-episode
 * ceiling, from the Platform settings route. The generation form defaults
 * its per-run choice to `geminiModel`.
 *
 * @returns {Promise<{geminiModel: string|null, options: Array<{id: string, tier: string, label: string, perEpisodeUsd: number|null}>}>}
 */
export async function fetchSpeechSettings() {
  const body = await getJSON('cms/platform-settings/listen-and-learn-speech');
  return {
    geminiModel: typeof body?.value?.geminiModel === 'string' ? body.value.geminiModel : null,
    options: Array.isArray(body?.options) ? body.options : [],
  };
}

/** Every generated set, newest generation first. */
export async function fetchSets() {
  const body = await getJSON('cms/listen-and-learn');
  return body?.items || [];
}

/**
 * One set with every episode — drafts and failures included. This is the
 * review view, and it deliberately shows what the public read hides.
 */
export async function fetchSetForReview({ platform, examCode }) {
  const body = await getJSON(
    `cms/listen-and-learn/${encodeURIComponent(platform)}/${encodeURIComponent(examCode)}`
  );
  return { set: body?.set || null, episodes: body?.episodes || [] };
}

/**
 * Approve or withdraw one episode.
 *
 * `status` is only ever 'published' or 'draft'. 'failed' is written by the
 * generator and the API refuses it here — withdrawing an episode means
 * returning it to draft, not marking it broken.
 */
export async function reviewEpisode({ platform, examCode, areaSlug, status }) {
  return postJSON('cms/listen-and-learn/review', { platform, examCode, areaSlug, status });
}

/**
 * Start a generation run and wait for it.
 *
 * Generation is a job rather than a request because a run takes minutes: five
 * areas means five model calls, five syntheses and five uploads, well past the
 * 230 seconds an HTTP response gets. Episodes are saved as each area
 * completes, so `onUpdate` is worth rendering — and so is a run that times
 * out, because the areas that finished are already stored.
 *
 * @param {object} params
 * @param {string} [params.ttsModel] the Gemini model for this run (one of
 *   GEMINI_TTS_MODEL_TIERS); omitted, the stored default reads
 * @param {(job: object) => void} [params.onUpdate]
 * @param {(accepted: {speech?: object}) => void} [params.onAccepted] the 202,
 *   which carries `speech: { provider, model, estimatedCostUsd, … }` — what
 *   the run is expected to spend on audio, stated before it starts
 * @param {AbortSignal} [params.signal]
 */
export async function generateEpisodes({
  platform,
  examCode,
  studyGuideUrl,
  certTitle,
  certSlug,
  areas,
  ttsModel,
  onUpdate,
  onAccepted,
  signal,
} = {}) {
  return runJob(
    'generate-listen-and-learn',
    {
      platform,
      examCode,
      studyGuideUrl,
      ...(certTitle ? { certTitle } : {}),
      ...(certSlug ? { certSlug } : {}),
      ...(areas?.length ? { areas } : {}),
      ...(ttsModel ? { ttsModel } : {}),
    },
    {
      onUpdate,
      onAccepted,
      signal,
      // A run is bounded server-side at 25 minutes; waiting slightly longer
      // means a timeout here reports the job's own outcome rather than
      // pre-empting it.
      maxWaitMs: 26 * 60 * 1000,
    }
  );
}
