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
 * @param {(job: object) => void} [params.onUpdate]
 * @param {AbortSignal} [params.signal]
 */
export async function generateEpisodes({
  platform,
  examCode,
  studyGuideUrl,
  certTitle,
  certSlug,
  areas,
  onUpdate,
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
    },
    {
      onUpdate,
      signal,
      // A run is bounded server-side at 25 minutes; waiting slightly longer
      // means a timeout here reports the job's own outcome rather than
      // pre-empting it.
      maxWaitMs: 26 * 60 * 1000,
    }
  );
}
