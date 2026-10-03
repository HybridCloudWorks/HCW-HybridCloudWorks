/**
 * Listen & Learn data access — the Audio Library (ADR 0033 §4).
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
 *
 * The library model: a BOOK or COURSE (a `listen_and_learn` set, addressed by
 * `platform` + `examCode`, where a book's code is its title's slug) holds
 * CHAPTERS (episodes) and each chapter holds audio VERSIONS. The admin calls
 * below follow that shape; `setIdFor` builds the server's id for a key.
 */
import { getJSON, postJSON, sendJSON } from '@/lib/api';
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

/**
 * The platforms the Generate tab offers: the supported ones that also have a
 * public page to play a course on. GitHub parses (its guides are on Microsoft
 * Learn) but the site has no GitHub certification detail page, so a course
 * generated for it would be reachable only from the provider's audio page;
 * the tab says so rather than offering a button to nowhere (ADR 0033 §4).
 */
export const GENERATE_PLATFORMS = ['azure', 'aws'];

export const GITHUB_GENERATE_NOTE =
  'GitHub study guides parse, but the site has no GitHub certification page to play a course on, so GitHub is not offered here. A GitHub book can still be created in the Library and heard on /github/audio.';

/** The site providers a book may be filed under (its public audio page). */
export const BOOK_PROVIDERS = [
  'azure',
  'aws',
  'gcp',
  'github',
  'docker',
  'terraform',
  'ansible',
  'vmware',
  'finops',
];

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
 * @returns {Promise<{geminiModel: string|null, options: Array<{id: string, tier: string, label: string, perEpisodeUsd: number|null, isDefault?: boolean}>}>}
 */
export async function fetchSpeechSettings() {
  const body = await getJSON('cms/platform-settings/listen-and-learn-speech');
  return {
    geminiModel: typeof body?.value?.geminiModel === 'string' ? body.value.geminiModel : null,
    options: Array.isArray(body?.options) ? body.options : [],
  };
}

/**
 * What the Settings tab and the voice dialog offer: models with the default
 * marked, voices per provider, providers with their configuration state and
 * the one that would run, the pin, and the speaking-rate bounds.
 */
export async function fetchSpeechOptions() {
  return getJSON('cms/listen-and-learn/speech-options');
}

/**
 * What speaking this text (or this many bytes) would cost, before it is
 * spoken — by the book's voice when `platform` + `examCode` name one.
 *
 * @returns {Promise<{provider: string|null, model: string|null, bytes: number, estimatedCostUsd: number|null}>}
 */
export async function estimateSpeech({ text, bytes, ttsModel, platform, examCode } = {}) {
  return postJSON('cms/listen-and-learn/estimate', {
    ...(typeof text === 'string' ? { text } : { bytes }),
    ...(ttsModel ? { ttsModel } : {}),
    ...(platform && examCode ? { platform, examCode } : {}),
  });
}

const bookRoute = (platform, examCode) =>
  `cms/listen-and-learn/${encodeURIComponent(platform)}/${encodeURIComponent(examCode)}`;
const chaptersRoute = (platform, examCode) => `${bookRoute(platform, examCode)}/chapters`;
const chapterRoute = (platform, examCode, chapterId) =>
  `${chaptersRoute(platform, examCode)}/${encodeURIComponent(chapterId)}`;

/**
 * Every book and course, newest first, each with its chapter counts. Archived
 * books only when asked for; soft-deleted ones never.
 */
export async function fetchSets({ archived = false } = {}) {
  const body = await getJSON(`cms/listen-and-learn${archived ? '?archived=1' : ''}`);
  return body?.items || [];
}

/** Alias by the library's word for it. */
export const fetchBooks = fetchSets;

/**
 * One set with every episode — drafts, failures and archived included. This
 * is the review view, and it deliberately shows what the public read hides.
 */
export async function fetchSetForReview({ platform, examCode }) {
  const body = await getJSON(bookRoute(platform, examCode));
  return { set: body?.set || null, episodes: body?.episodes || [] };
}

/**
 * A new book (or a course shell for a certification). The server derives the
 * code from the title unless `examCode` is given, and answers 409 when it is
 * taken.
 */
export async function createBook(fields) {
  const body = await postJSON('cms/listen-and-learn', fields);
  return body?.item || null;
}

/** Metadata, cover, kind, voice; `archived: true|false` archives or restores. */
export async function patchBook({ platform, examCode }, fields) {
  const body = await sendJSON(bookRoute(platform, examCode), 'PATCH', fields);
  return body?.item || null;
}

/**
 * Soft-delete a book. Without `force` the server answers 409 with the
 * published chapters that would go off the site; the error carries them as
 * `published` for the confirm dialog.
 */
export async function deleteBook({ platform, examCode }, { force = false } = {}) {
  return sendJSON(`${bookRoute(platform, examCode)}${force ? '?force=1' : ''}`, 'DELETE');
}

/**
 * A hand-made chapter from pasted text or a content item. Unless
 * `speak: false`, the server queues its reading and returns the job in
 * `job`, which `followJob` can wait on.
 */
export async function createChapter({ platform, examCode }, fields) {
  return postJSON(chaptersRoute(platform, examCode), fields);
}

/** Rename, reposition, text, active version, archive/restore, clearError. */
export async function patchChapter({ platform, examCode, chapterId }, fields) {
  const body = await sendJSON(chapterRoute(platform, examCode, chapterId), 'PATCH', fields);
  return body?.item || null;
}

/** The whole order, first to last; one write per chapter that moved. */
export async function reorderChapters({ platform, examCode }, order) {
  return sendJSON(chaptersRoute(platform, examCode), 'PATCH', { order });
}

export async function deleteChapter({ platform, examCode, chapterId }, { force = false } = {}) {
  return sendJSON(
    `${chapterRoute(platform, examCode, chapterId)}${force ? '?force=1' : ''}`,
    'DELETE'
  );
}

/** One take's blob and entry; the server refuses the active one with 409. */
export async function deleteVersion({ platform, examCode, chapterId, versionId }) {
  return sendJSON(
    `${chapterRoute(platform, examCode, chapterId)}/versions/${encodeURIComponent(versionId)}`,
    'DELETE'
  );
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

/** A run is bounded server-side at 25 minutes; waiting slightly longer means a timeout reports the job's own outcome. */
const RUN_WAIT_MS = 26 * 60 * 1000;

/**
 * Regenerate ONE chapter and wait for the job: the server picks the job by
 * the chapter's kind (guide area, stored sources, or spoken text) and the
 * 202 carries `speech`, the expected spend, which `onAccepted` receives.
 */
export async function regenerateChapter(
  { platform, examCode, chapterId, ttsModel },
  { onUpdate, onAccepted, signal } = {}
) {
  return runJob('regenerate-chapter', ttsModel ? { ttsModel } : {}, {
    fetchers: {
      enqueue: ({ payload }) =>
        postJSON(`${chapterRoute(platform, examCode, chapterId)}/regenerate`, payload),
    },
    onUpdate,
    onAccepted,
    signal,
    maxWaitMs: RUN_WAIT_MS,
  });
}

/**
 * Wait for a job another call already queued — the reading a chapter create
 * started. The enqueue step is the 202 we already hold.
 */
export async function followJob(accepted, { onUpdate, signal } = {}) {
  return runJob(
    accepted?.type || 'queued',
    {},
    {
      fetchers: { enqueue: async () => accepted },
      onUpdate,
      signal,
      maxWaitMs: RUN_WAIT_MS,
    }
  );
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
      maxWaitMs: RUN_WAIT_MS,
    }
  );
}
