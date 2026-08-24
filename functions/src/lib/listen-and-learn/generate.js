/**
 * Orchestrates one Listen & Learn generation run.
 *
 *   study guide → skill areas → videos per area → dialogue → MP3 → draft doc
 *
 * Every stage is injected so the whole pipeline is testable without touching
 * a speech provider, YouTube or Cosmos. The run is deliberately area-by-area and
 * saves as it goes: a worker that times out on area 4 must leave areas 1-3
 * saved as drafts rather than losing the work and the spend.
 *
 * Ported from Site-Main `functions/listen-and-learn/generate.js` (088f458),
 * with one behavioural change worth stating plainly:
 *
 *   **A missing speech key degrades; a broken one fails.** Upstream treated
 *   any synthesis failure as a failed area. Here, `SpeechNotConfiguredError`
 *   — no speech provider configured yet — still saves the episode with its transcript,
 *   takeaways and videos, and records `audioError` so the admin page can say
 *   why there is no player. Every other synthesis failure (a rejected key, a
 *   400 on the request, a 5xx) still fails the area, because those are faults to
 *   fix rather than a state to ship in. The feature is therefore useful the
 *   day it deploys and gains audio the day the key lands, without a code
 *   change or a regeneration of anything but the audio.
 */
import { fetchStudyGuide } from './studyguide.js';
import { findVideosForAreas } from './videos.js';
import { generateEpisodeScript } from './script.js';
import { synthesizeDialogue, SpeechNotConfiguredError } from './speech/index.js';
import { saveEpisode, saveEpisodeFailure, saveSet, uploadEpisodeAudio, STATUS } from './publish.js';
import { recordAiUsageBatch, totalCostUsd, USAGE_SOURCES } from '../ai/usage.js';

/**
 * Site platform → study-guide provider.
 *
 * Only platforms with a working adapter appear here; the certification pages
 * read the same list to decide between rendering episodes and rendering a
 * "coming soon" banner, so the two can never drift apart. GitHub exams are
 * hosted on Microsoft Learn and parse with the same adapter.
 */
export const SUPPORTED_PLATFORMS = {
  azure: 'microsoft',
  github: 'microsoft',
  aws: 'aws',
};

export function isSupportedPlatform(platform) {
  return Object.hasOwn(SUPPORTED_PLATFORMS, String(platform || '').toLowerCase());
}

export class GenerateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GenerateError';
  }
}

/** Real implementations unless a caller (or a test) supplies its own. */
function resolveDeps(deps = {}) {
  return {
    fetchGuide: deps.fetchGuide || fetchStudyGuide,
    findVideos: deps.findVideos || findVideosForAreas,
    writeScript: deps.writeScript || generateEpisodeScript,
    synthesize: deps.synthesize || synthesizeDialogue,
    uploadAudio: deps.uploadAudio || uploadEpisodeAudio,
    persistEpisode: deps.persistEpisode || saveEpisode,
    persistFailure: deps.persistFailure || saveEpisodeFailure,
    persistSet: deps.persistSet || saveSet,
    recordUsage: deps.recordUsage || null,
  };
}

/**
 * Synthesise and upload, or explain why there is no audio.
 *
 * Returns `{ error }` only for the not-configured case; everything else
 * throws, which fails the area. See the module header for why the two are
 * treated differently.
 */
async function renderAudio({
  script,
  platform,
  examCode,
  areaSlug,
  storage,
  env,
  synthesize,
  uploadAudio,
}) {
  let rendered;
  try {
    rendered = await synthesize({ dialogue: script.dialogue, env });
  } catch (err) {
    if (err instanceof SpeechNotConfiguredError || err?.name === 'SpeechNotConfiguredError') {
      return { error: err.message };
    }
    throw err;
  }

  const uploaded = await uploadAudio({
    storage,
    provider: platform,
    examCode,
    areaSlug,
    audio: rendered.audio,
    contentType: rendered.contentType,
  });

  // Which voice read it, kept for the same reason the approver is kept: for
  // AI-generated study content the provenance is the point. It also answers
  // "why does this episode sound different from that one" after a provider or
  // model change, which is otherwise unanswerable once the audio is a blob.
  return {
    ...uploaded,
    speechProvider: rendered.provider || null,
    speechModel: rendered.model || null,
    durationSeconds: rendered.estimatedSeconds ?? null,
    // What the synthesis is billed on. TTS prices audio output an order of
    // magnitude above text, so this is the number that decides an episode's
    // cost — see the COST_TABLE note in ai/router.js.
    promptTokens: rendered.promptTokens ?? 0,
    completionTokens: rendered.completionTokens ?? 0,
    estimatedTokens: rendered.estimatedTokens === true,
  };
}

/**
 * Script → synthesize → upload → save, for a single skill area.
 *
 * Throws on any failure so the caller owns the decision to record a gap and
 * carry on; keeping that policy in one place is what makes a partial run
 * predictable.
 */
async function generateOneArea({
  area,
  order,
  cert,
  platform,
  examCode,
  videos,
  store,
  storage,
  env,
  now,
  ai,
  writeScript,
  synthesize,
  uploadAudio,
  persistEpisode,
  recordUsage,
}) {
  const scriptUsage = [];
  const script = await writeScript({
    cert,
    area,
    generate: ai.generateJsonResponse,
    usageOut: scriptUsage,
  });

  const audio = await renderAudio({
    script,
    platform,
    examCode,
    areaSlug: area.slug,
    storage,
    env,
    synthesize,
    uploadAudio,
  });

  const saved = await persistEpisode(store, {
    provider: platform,
    examCode,
    area,
    script,
    audio,
    videos,
    order,
    now,
  });

  // Recorded after the episode is saved, never before: a usage row for work
  // that was then lost would overstate spend, and the write is deliberately
  // best-effort (ai/usage.js) so it cannot fail an episode that succeeded.
  const usage = await recordUsage([
    ...scriptUsage.map((u) => ({ ...u, source: USAGE_SOURCES.listenAndLearnScript })),
    ...(audio.speechProvider
      ? [
          {
            provider: audio.speechProvider,
            model: audio.speechModel,
            promptTokens: audio.promptTokens,
            completionTokens: audio.completionTokens,
            estimatedTokens: audio.estimatedTokens,
            source: USAGE_SOURCES.listenAndLearnAudio,
          },
        ]
      : []),
  ]);

  return {
    areaSlug: area.slug,
    areaName: area.name,
    status: STATUS.draft,
    audioBytes: audio.bytes || 0,
    audioError: audio.error || null,
    transcriptBytes: script.byteLength,
    trimmedTurns: script.trimmedTurns,
    videoCount: saved.videos.length,
    costUsd: totalCostUsd(usage),
  };
}

/**
 * Generate every episode for one certification.
 *
 * Returns a per-area report rather than throwing on the first failure —
 * partial success is the normal outcome when a quota runs out mid-run, and
 * the admin page needs to show which areas are missing and why.
 */
export async function generateEpisodes({
  platform,
  examCode,
  studyGuideUrl,
  cert = {},
  store,
  storage,
  ai,
  env = process.env,
  youtubeApiKey,
  actorId = null,
  onlyAreas = null,
  now = new Date().toISOString(),
  deps = {},
}) {
  const provider = SUPPORTED_PLATFORMS[String(platform || '').toLowerCase()];
  if (!provider) {
    const supported = Object.keys(SUPPORTED_PLATFORMS).join(', ');
    throw new GenerateError(
      `Listen & Learn is not available for "${platform}". Supported platforms: ${supported}.`
    );
  }
  if (!examCode) throw new GenerateError('examCode is required');
  if (!studyGuideUrl) throw new GenerateError(`No study guide URL for ${examCode}`);

  const {
    fetchGuide,
    findVideos,
    writeScript,
    synthesize,
    uploadAudio,
    persistEpisode,
    persistFailure,
    persistSet,
    recordUsage: injectedRecordUsage,
  } = resolveDeps(deps);

  // Spend is recorded against the same container the portal's Usage tab reads,
  // so a Listen & Learn run appears next to every other model call rather than
  // in a second place nobody looks. Needs the cost table, hence `ai`.
  const recordUsage =
    injectedRecordUsage ||
    ((records) => recordAiUsageBatch({ store, ai: { getCostEstimate: ai.getCostEstimate } }, records));

  const guide = await fetchGuide({ provider, examCode, sourceUrl: studyGuideUrl });

  // Filtered after parsing, not before: regenerating one area must still be
  // checked against the current guide, which is how a re-scoped exam gets
  // noticed instead of quietly regenerating a stale area.
  const areas = onlyAreas?.length
    ? guide.areas.filter((a) => onlyAreas.includes(a.slug))
    : guide.areas;

  if (areas.length === 0) {
    throw new GenerateError(
      `None of the requested areas (${onlyAreas?.join(', ')}) exist in the current ${examCode} study guide`
    );
  }

  await persistSet(store, { provider: platform, examCode, guide, cert, now, actorId });

  // Videos are gathered for all areas up front so cross-area deduping works;
  // a total failure here is survivable, the episodes just ship without links.
  let videosByArea = new Map();
  let videoError = null;
  try {
    const found = await findVideos(areas, { examCode, apiKey: youtubeApiKey });
    videosByArea = new Map(found.map((r) => [r.areaSlug, r]));
  } catch (err) {
    videoError = err.message;
  }

  const results = [];
  const certForScript = { examCode: guide.examCode, title: cert.title || guide.title };

  for (const [order, area] of areas.entries()) {
    try {
      results.push(
        await generateOneArea({
          area,
          order,
          cert: certForScript,
          platform,
          examCode,
          videos: videosByArea.get(area.slug)?.videos || [],
          store,
          storage,
          env,
          now,
          ai,
          writeScript,
          synthesize,
          uploadAudio,
          persistEpisode,
          recordUsage,
        })
      );
    } catch (err) {
      // One area failing must not abandon the rest — the spend on the areas
      // that already succeeded is real, and a gap is more useful than nothing.
      await persistFailure(store, {
        provider: platform,
        examCode,
        area,
        error: err.message,
        order,
        now,
      });
      results.push({
        areaSlug: area.slug,
        areaName: area.name,
        status: STATUS.failed,
        error: err.message,
      });
    }
  }

  const generated = results.filter((r) => r.status === STATUS.draft);

  return {
    examCode: guide.examCode,
    platform,
    provider,
    studyGuideUrl: guide.sourceUrl,
    areaCount: areas.length,
    generated: generated.length,
    failed: results.filter((r) => r.status === STATUS.failed).length,
    // Reported once at the top rather than only per area, because "no speech
    // key" is one configuration fact about the whole run, not five failures.
    withoutAudio: generated.filter((r) => r.audioError).length,
    // What the run cost, summed from the rows actually written. The admin page
    // shows it when the job finishes, which is the moment it is worth knowing.
    costUsd: parseFloat(results.reduce((sum, r) => sum + (r.costUsd || 0), 0).toFixed(6)),
    videoError,
    results,
  };
}
