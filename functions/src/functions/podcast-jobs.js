/**
 * podcast-jobs.js — podcast transcript generation as a platform job (#435).
 *
 * One article is one model call, one or two synthesis requests and one
 * upload — minutes, not seconds — so the Publish page enqueues
 * `generate-podcast-transcript` through `POST /api/cms/podcast/transcripts/generate`
 * and the worker runs here under the non-HTTP timeout, exactly as
 * `generate-listen-and-learn` does. The document in `podcast_transcripts` is
 * the record; the job result is a small report of it.
 */
import { readDoc, upsertDoc, patchDoc } from '../lib/cosmos-client.js';
import { uploadBlob } from '../lib/blob-storage.js';
import { generateJsonResponse, getCostEstimate } from '../lib/ai/router.js';
import { registerJobType } from '../lib/jobs.js';
import {
  TRANSCRIPT_JOB_TYPE,
  generateTranscriptFromArticle,
  parseArticleId,
} from '../lib/podcast/generate.js';

/**
 * Validate a generate payload. Returns `{ value }` or `{ error }` so the rule
 * is testable on its own and the worker stays a thin adapter. The rule
 * itself is `parseArticleId`, shared with the route that enqueues, so a
 * refusal reads the same whichever door it came through.
 */
export function parseTranscriptPayload(payload) {
  const parsed = parseArticleId(payload?.articleId);
  if (parsed.error) return { error: parsed.error };
  return { value: { articleId: parsed.value } };
}

/** One generation run against production dependencies. */
export async function runTranscriptGeneration(payload, { context } = {}) {
  const parsed = parseTranscriptPayload(payload);
  if (parsed.error) throw new Error(parsed.error);

  const report = await generateTranscriptFromArticle({
    articleId: parsed.value.articleId,
    store: { readDoc, upsertDoc, patchDoc },
    storage: { uploadBlob },
    ai: { generateJsonResponse, getCostEstimate },
  });

  context?.log?.(
    `${TRANSCRIPT_JOB_TYPE}: ${report.id} drafted` +
      (report.audioError ? ` without audio (${report.audioError})` : ` with ${report.audioBytes} B of audio`) +
      `, $${report.costUsd} spent`
  );

  return report;
}

registerJobType(TRANSCRIPT_JOB_TYPE, {
  // Generates and stores a draft; approving it is a separate, publisher-gated
  // action. Same level as the route that enqueues it and as
  // generate-listen-and-learn, which does the same kind of work.
  role: 'editor',
  description:
    'Script a two-host podcast episode from one published article, synthesise the audio and save the transcript as a draft for review on the Recording Hub.',
  // One article id.
  maxPayloadBytes: 512,
  // One model call plus one or two synthesis requests plus an upload, with
  // headroom for a slow provider.
  timeoutMs: 10 * 60 * 1000,
  worker: runTranscriptGeneration,
});
