/**
 * Orchestrates one podcast transcript from one published article (#435).
 *
 *   article → dialogue → MP3 → draft transcript
 *
 * The shape is `listen-and-learn/generate.js` with the study guide, the
 * videos and the per-area loop removed: one article is one transcript. Every
 * stage is injected so the pipeline is testable without a model, a speech
 * provider, blob storage or Cosmos.
 *
 * Two policies differ from the Learn pipeline, and both are deliberate.
 *
 * **Publication is checked before anything is spent.** `isPublicDocument` —
 * the same predicate the anonymous reads use — gates the run before the model
 * is called. `generateArticleScript` checks it again, as the guard for a
 * caller that forgot; here it is checked first so a refusal costs nothing and
 * writes nothing. A draft article is not audio material, and a soft-deleted
 * one must not be resurrected as speech.
 *
 * **Every audio failure degrades; none fails the run.** The Learn pipeline
 * degrades only on a missing key and fails the area on anything else. Here
 * the transcript is the artefact — it is what the hub reviews against the
 * article, and #436 will re-voice it anyway — so throwing away a paid script
 * because the voice or the upload failed is the worse outcome. Every failure
 * in the audio stage is recorded in `audioError`, on the document, in the
 * job result and in the log, and the transcript is still saved as a draft.
 * That includes the blob container not existing yet: `podcast` is declared
 * in infra/storage.tf, and until that apply runs the upload answers 404. The
 * Cosmos container is different — see `saveTranscript` — because a transcript
 * that cannot be saved is a run that produced nothing.
 */
import { isPublicDocument } from '../public-reads.js';
import { generateArticleScript } from '../listen-and-learn/article-script.js';
import { synthesizeDialogue } from '../listen-and-learn/speech/index.js';
import {
  STATUS,
  describeArticleSource,
  markTranscriptFailedFor,
  saveTranscriptFor,
  uploadSourceAudio,
} from './store.js';
import { recordAiUsageBatch, totalCostUsd, USAGE_SOURCES } from '../ai/usage.js';

/** Where articles live. The same container `GET /api/cms/content/item` reads. */
export const ARTICLE_CONTAINER = 'content';

/** The platform job that runs this. Shared with the handler that enqueues it. */
export const TRANSCRIPT_JOB_TYPE = 'generate-podcast-transcript';

export class TranscriptError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TranscriptError';
  }
}

/** Cosmos ids are bounded at 255 bytes; an article id longer than this is not one. */
export const MAX_ARTICLE_ID_CHARS = 200;

/**
 * The one validator for an `articleId`, shared by the route that enqueues
 * and the worker that runs, so the two answer the same sentence for the
 * same input. Returns `{ value }` or `{ error }`.
 */
export function parseArticleId(raw) {
  const articleId = typeof raw === 'string' ? raw.trim() : '';
  if (!articleId) return { error: 'articleId is required' };
  if (articleId.length > MAX_ARTICLE_ID_CHARS) return { error: 'articleId is too long' };
  return { value: articleId };
}

/**
 * The refusal, in one place, so the handler that enqueues and the job that
 * runs give the same sentence for the same article.
 *
 * @returns {string|null} the reason, or null when the article may be scripted
 */
export function refusalFor(article, articleId) {
  if (!article) return `Article ${articleId} was not found`;
  if (!isPublicDocument(article)) {
    return `Article ${article.id || articleId} is not published; only published articles produce a podcast transcript`;
  }
  return null;
}

/**
 * Real implementations unless a caller (or a test) supplies its own.
 *
 * Shared with the recording pipeline (recording-generate.js), which passes
 * its own `writeScript` default; everything after the script — the voice,
 * the upload, the save, the usage rows — is the same for every kind of
 * source, and lives once in `finishTranscript` below.
 */
export function resolvePipelineDeps(deps = {}, { writeScript = generateArticleScript } = {}) {
  return {
    writeScript: deps.writeScript || writeScript,
    synthesize: deps.synthesize || synthesizeDialogue,
    uploadAudio: deps.uploadAudio || uploadSourceAudio,
    persistTranscript: deps.persistTranscript || saveTranscriptFor,
    persistFailure: deps.persistFailure || markTranscriptFailedFor,
    recordUsage: deps.recordUsage || null,
  };
}

/**
 * Synthesise and upload, or explain why there is no audio. Never throws —
 * see the module header.
 *
 * Always the `podcast` product: ElevenLabs, and only ElevenLabs
 * (speech/index.js, ADR 0029 §2b). With no `ELEVENLABS_API_KEY` the switch
 * reports itself not configured rather than reaching for Gemini, and that
 * sentence is the draft's `audioError`.
 */
async function renderAudio({ script, source, storage, env, synthesize, uploadAudio }) {
  let rendered;
  try {
    rendered = await synthesize({ product: 'podcast', dialogue: script.dialogue, env });
  } catch (err) {
    return { error: err?.message || String(err) };
  }

  let uploaded;
  try {
    uploaded = await uploadAudio({
      storage,
      source,
      audio: rendered.audio,
      contentType: rendered.contentType,
    });
  } catch (err) {
    return {
      error: `Audio was synthesised but not stored: ${err?.message || err}`,
      speechProvider: rendered.provider || null,
      speechModel: rendered.model || null,
      promptTokens: rendered.promptTokens ?? 0,
      completionTokens: rendered.completionTokens ?? 0,
      estimatedTokens: rendered.estimatedTokens === true,
    };
  }

  return {
    ...uploaded,
    speechProvider: rendered.provider || null,
    speechModel: rendered.model || null,
    durationSeconds: rendered.estimatedSeconds ?? null,
    promptTokens: rendered.promptTokens ?? 0,
    completionTokens: rendered.completionTokens ?? 0,
    estimatedTokens: rendered.estimatedTokens === true,
  };
}

/**
 * Record that the script stage failed, then rethrow the original error.
 *
 * Best effort: the failure record must not mask the failure. If the container
 * is missing this write fails too, and the original error is still the one
 * worth reporting.
 */
export async function recordScriptFailure({ store, source, error, now, persistFailure }) {
  await persistFailure(store, { source, error: error?.message || String(error), now }).catch(
    () => {}
  );
  throw error;
}

/**
 * Everything after the script, for every kind of source: voice it, upload
 * it, save the draft, record the spend. Shared by the article pipeline here
 * and the recording pipeline in recording-generate.js, so the two cannot
 * drift on the policies the module header states — every audio failure
 * degrades, and usage is recorded only after the transcript is saved.
 *
 * @param {object} params
 * @param {object} params.source a descriptor from store.js (`describe*Source`)
 * @param {object} params.script the generator's result
 * @param {object[]} params.scriptUsage the router's usage rows for the script call
 * @param {{ upsertDoc: Function }} params.store
 * @param {{ uploadBlob: Function }} params.storage
 * @param {{ getCostEstimate: Function }} params.ai
 * @param {object} params.env
 * @param {string} params.now
 * @param {ReturnType<typeof resolvePipelineDeps>} params.deps resolved deps
 * @returns {Promise<object>} the common report; callers add their own ids
 */
export async function finishTranscript({
  source,
  script,
  scriptUsage,
  store,
  storage,
  ai,
  env,
  now,
  deps,
}) {
  const { synthesize, uploadAudio, persistTranscript, recordUsage } = deps;

  const audio = await renderAudio({ script, source, storage, env, synthesize, uploadAudio });

  const saved = await persistTranscript(store, { source, script, audio, now });

  // Recorded after the transcript is saved, never before: a usage row for
  // work that was then lost would overstate spend, and the write is
  // best-effort (ai/usage.js) so it cannot fail a run that succeeded.
  const record =
    recordUsage ||
    ((records) => recordAiUsageBatch({ store, ai: { getCostEstimate: ai.getCostEstimate } }, records));
  const usage = await record([
    ...scriptUsage.map((u) => ({ ...u, source: USAGE_SOURCES.podcastScript })),
    ...(audio.speechProvider
      ? [
          {
            provider: audio.speechProvider,
            model: audio.speechModel,
            promptTokens: audio.promptTokens,
            completionTokens: audio.completionTokens,
            estimatedTokens: audio.estimatedTokens,
            source: USAGE_SOURCES.podcastAudio,
          },
        ]
      : []),
  ]);

  return {
    id: saved.id,
    sourceKind: saved.sourceKind,
    sourceSlug: saved.sourceSlug,
    title: saved.title,
    status: STATUS.draft,
    audioBytes: audio.bytes || 0,
    audioError: audio.error || null,
    transcriptBytes: script.byteLength,
    trimmedTurns: script.trimmedTurns,
    truncated: script.truncated === true,
    costUsd: totalCostUsd(usage),
  };
}

/**
 * Generate the transcript for one article.
 *
 * @param {object} params
 * @param {string} params.articleId
 * @param {{ readDoc: Function, upsertDoc: Function }} params.store
 * @param {{ uploadBlob: Function }} params.storage
 * @param {{ generateJsonResponse: Function, getCostEstimate: Function }} params.ai
 * @param {object} [params.env]
 * @param {string} [params.now]
 * @param {object} [params.deps] test seams
 * @returns {Promise<object>} a small report; the document is the record
 */
export async function generateTranscriptFromArticle({
  articleId,
  store,
  storage,
  ai,
  env = process.env,
  now = new Date().toISOString(),
  deps = {},
}) {
  const parsedId = parseArticleId(articleId);
  if (parsedId.error) throw new TranscriptError(parsedId.error);
  const id = parsedId.value;

  const resolved = resolvePipelineDeps(deps);
  const { writeScript, persistFailure } = resolved;

  const article = await store.readDoc(ARTICLE_CONTAINER, id, id);
  const refusal = refusalFor(article, id);
  if (refusal) throw new TranscriptError(refusal);
  // Resolves the slug-or-id key, and throws by name if neither is usable —
  // before the model call, so an unkeyable article costs nothing.
  const source = describeArticleSource(article);

  // The product declares the feature, not the generator: `generateArticleScript`
  // is a rewrite of an article into dialogue and #433 will use it for other
  // products, so the portal toggle it answers to is decided here. A literal
  // call site, because ai-call-sites.test.js reads the source — a feature
  // declared behind an injected function is one the scan cannot see.
  const generate = (params) => ai.generateJsonResponse({ ...params, feature: 'podcastScript' });

  const scriptUsage = [];
  let script;
  try {
    script = await writeScript({
      article,
      generate,
      usageOut: scriptUsage,
    });
  } catch (err) {
    await recordScriptFailure({ store, source, error: err, now, persistFailure });
  }

  const report = await finishTranscript({
    source,
    script,
    scriptUsage,
    store,
    storage,
    ai,
    env,
    now,
    deps: resolved,
  });

  return { ...report, articleId: id };
}
