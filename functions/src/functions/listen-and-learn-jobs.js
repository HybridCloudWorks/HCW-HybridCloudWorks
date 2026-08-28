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
 */
import { readDoc, upsertDoc, patchDoc } from '../lib/cosmos-client.js';
import { uploadBlob } from '../lib/blob-storage.js';
import { generateJsonResponse, getActiveAiProvider, getCostEstimate } from '../lib/ai/router.js';
import { registerJobType } from '../lib/jobs.js';
import { generateEpisodes, isSupportedPlatform, SUPPORTED_PLATFORMS } from '../lib/listen-and-learn/generate.js';

/**
 * Bound so a single run cannot spend an unbounded amount: the largest real
 * guide is 6 areas, and a request asking for more is a bug or abuse.
 */
export const MAX_AREAS_PER_RUN = 8;

/**
 * Validate a generate payload. Returns `{ value }` or `{ error }` so the rules
 * are testable on their own and the job worker stays a thin adapter.
 */
export function parseGeneratePayload(payload) {
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
  // Enough for the URL, the exam code and up to eight area slugs.
  maxPayloadBytes: 2048,
  // Five areas at roughly two minutes each — one model call plus one or two
  // synthesis requests plus an upload — with headroom for a slow guide fetch.
  timeoutMs: 25 * 60 * 1000,
  worker: runListenAndLearnGeneration,
});
