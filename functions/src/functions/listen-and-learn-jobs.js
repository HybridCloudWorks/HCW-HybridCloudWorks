/**
 * listen-and-learn-jobs.js — episode generation as a platform job.
 *
 * Site-Main exposed this as `generateListenAndLearn`, a 540-second HTTP
 * handler. That shape does not survive the port: an Azure Functions HTTP
 * response is bounded at 230 seconds by the load balancer regardless of the
 * host's `functionTimeout`, and one certification is five model calls, five
 * syntheses and five multi-megabyte uploads. So the admin page enqueues
 * `generate-listen-and-learn` and polls (frontend/src/lib/jobs.js), exactly as
 * the RSS ingest does.
 *
 * The run still saves area by area, so a timeout leaves the finished episodes
 * behind as drafts rather than losing the work and the spend.
 *
 * The same job runs a source-grounded episode (#433): a payload carrying
 * `sources` is one episode built from the owner's pages and videos, parsed by
 * `parseSourceEpisodePayload` and run by `generateSourceEpisode`, and needs no
 * study guide URL. The admin page queues it through
 * `POST cms/listen-and-learn/source-episode` (listen-and-learn/handlers.js), which
 * validates the list before the job exists; the worker validates it again.
 */
import { generateGroundedJsonResponse } from '../lib/ai/router.js';
import {
  generateSourceEpisode,
  parseSourceEpisodePayload,
} from '../lib/listen-and-learn/source-episode.js';
import { readDoc, upsertDoc, patchDoc } from '../lib/cosmos-client.js';
import { uploadBlob } from '../lib/blob-storage.js';
import { generateJsonResponse, getActiveAiProvider, getCostEstimate } from '../lib/ai/router.js';
import { registerJobType } from '../lib/jobs.js';
import { generateEpisodes, isSupportedPlatform, SUPPORTED_PLATFORMS } from '../lib/listen-and-learn/generate.js';
import { MAX_SCRIPT_BYTES } from '../lib/listen-and-learn/script.js';
import { estimateSpeechCostUsd } from '../lib/listen-and-learn/speech/index.js';

/**
 * Bound so a single run cannot spend an unbounded amount: the largest real
 * guide is 6 areas, and a request asking for more is a bug or abuse.
 */
export const MAX_AREAS_PER_RUN = 8;

/**
 * What the speech for this run is expected to cost, stated in the 202 before
 * the run starts (ADR 0029 §2a).
 *
 * A ceiling, not a forecast: no script exists yet, so each episode is priced
 * at `MAX_SCRIPT_BYTES` — the most UTF-8 BYTES a script may hold, which
 * `estimateSpeechCostUsd` treats as bytes. That is an over-estimate for both
 * providers: ElevenLabs bills characters, and a script's character count is
 * never more than its byte count (lower, for anything non-ASCII); Gemini's
 * duration is derived from bytes at a deliberately slow speaking rate. The
 * episode count is the areas requested or, when the guide has not been parsed
 * to know, the most a run may generate. The run cannot spend more than this
 * figure on speech; it usually spends less. `provider` is null when no speech
 * key is configured, which is the transcript-only state rather than an error.
 *
 * @param {object} payload the raw enqueue payload
 * @param {object} [env]
 * @returns {{provider: string|null, model: string|null, episodes: number, perEpisodeUsd: number|null, estimatedCostUsd: number|null}}
 */
export function speechEstimateForRun(payload, env = process.env) {
  const areas = Array.isArray(payload?.areas) ? payload.areas.length : 0;
  const episodes = areas > 0 ? Math.min(areas, MAX_AREAS_PER_RUN) : MAX_AREAS_PER_RUN;
  const perEpisode = estimateSpeechCostUsd({ characters: MAX_SCRIPT_BYTES, env });
  if (!perEpisode) {
    return { provider: null, model: null, episodes, perEpisodeUsd: null, estimatedCostUsd: null };
  }
  const perEpisodeUsd = perEpisode.estimatedCostUsd;
  return {
    provider: perEpisode.provider,
    model: perEpisode.model,
    episodes,
    perEpisodeUsd,
    estimatedCostUsd:
      typeof perEpisodeUsd === 'number' ? parseFloat((perEpisodeUsd * episodes).toFixed(6)) : null,
  };
}

/**
 * Validate a generate payload. Returns `{ value }` or `{ error }` so the rules
 * are testable on their own and the job worker stays a thin adapter.
 */
export function parseGeneratePayload(payload) {
  // A source list makes this a source-grounded episode, whatever else the
  // payload carries: the presence of the field is the switch, not its
  // length, so an empty list is refused by the source rules ("needs at least
  // one source") rather than silently becoming a guide run.
  if (payload && typeof payload === 'object' && payload.sources !== undefined) {
    return parseSourceEpisodePayload(payload);
  }

  const platform = String(payload?.platform || '').toLowerCase();
  const examCode = String(payload?.examCode || '').trim();
  const studyGuideUrl = String(payload?.studyGuideUrl || '').trim();
  const areas = Array.isArray(payload?.areas) ? payload.areas.map(String) : null;

  if (!isSupportedPlatform(platform)) {
    return {
      error: `Listen & Learn is not available for "${platform}". Supported platforms: ${Object.keys(SUPPORTED_PLATFORMS).join(', ')}.`,
    };
  }
  if (!examCode) return { error: 'examCode is required' };
  // https only: the URL is fetched server-side, so a plain-http, file or
  // localhost URL here would be an SSRF foothold rather than a typo.
  if (!/^https:\/\//.test(studyGuideUrl)) {
    return { error: 'studyGuideUrl must be an https URL' };
  }
  if (areas && areas.length > MAX_AREAS_PER_RUN) {
    return { error: `At most ${MAX_AREAS_PER_RUN} areas can be generated per request` };
  }

  return {
    value: {
      platform,
      examCode,
      studyGuideUrl,
      areas,
      cert: {
        title: String(payload?.certTitle || '').trim() || null,
        slug: String(payload?.certSlug || '').trim() || null,
      },
    },
  };
}

/** One generation run against production dependencies. */
export async function runListenAndLearnGeneration(payload, { context, job } = {}) {
  const parsed = parseGeneratePayload(payload);
  if (parsed.error) throw new Error(parsed.error);

  if (parsed.value.kind === 'source') {
    const source = parsed.value;
    const report = await generateSourceEpisode({
      platform: source.platform,
      examCode: source.examCode,
      title: source.title,
      sources: source.sources,
      cert: source.cert,
      store: { readDoc, upsertDoc, patchDoc },
      storage: { uploadBlob },
      ai: { generateGroundedJsonResponse, getCostEstimate },
      actorId: job?.requestedBy?.oid || null,
    });
    // Exam code and counts only: the episode id is derived from the owner's
    // title, which is content, and the log line is not the place for it.
    context?.log?.(
      `generate-listen-and-learn: ${report.examCode} — source-grounded episode drafted from ${report.sourceCount} sources${report.audioError ? ', without audio' : ''}, $${report.costUsd} spent`
    );
    return report;
  }

  const { platform, examCode, studyGuideUrl, areas, cert } = parsed.value;

  const report = await generateEpisodes({
    platform,
    examCode,
    studyGuideUrl,
    cert,
    store: { readDoc, upsertDoc, patchDoc },
    storage: { uploadBlob },
    ai: { generateJsonResponse, getActiveAiProvider, getCostEstimate },
    youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
    actorId: job?.requestedBy?.oid || null,
    onlyAreas: areas,
  });

  context?.log?.(
    `generate-listen-and-learn: ${report.examCode} — ${report.generated} drafted, ${report.failed} failed, ${report.withoutAudio} without audio, $${report.costUsd} spent`
  );

  return report;
}

registerJobType('generate-listen-and-learn', {
  // Generates and stores an episode; publishing it is a separate action.
  role: 'editor',
  description:
    'Parse a certification study guide, script one episode per skill area, synthesise the audio and save every episode as a draft for review.',
  // Enough for the URL, the exam code and up to eight area slugs — or, for a
  // source-grounded episode, twenty page URLs and ten video URLs with a title
  // each (#433): the router's caps, which the route refuses over rather than
  // this limit truncating.
  maxPayloadBytes: 16384,
  // Five areas at roughly two minutes each — one model call plus one or two
  // synthesis requests plus an upload — with headroom for a slow guide fetch.
  timeoutMs: 25 * 60 * 1000,
  // The expected speech spend, in the 202, so the admin page can show it at
  // the moment the run is requested rather than after the usage rows land.
  acceptedDetails: (payload) => ({ speech: speechEstimateForRun(payload) }),
  worker: runListenAndLearnGeneration,
});
