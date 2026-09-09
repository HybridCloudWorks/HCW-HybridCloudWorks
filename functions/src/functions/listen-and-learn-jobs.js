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
import {
  estimateSpeechCostUsd,
  resolveSpeechProvider,
} from '../lib/listen-and-learn/speech/index.js';
import {
  listenAndLearnModelOptions,
  parseTtsModel,
  readStoredListenAndLearnModel,
  resolveListenAndLearnModel,
} from '../lib/listen-and-learn/speech-settings.js';

/** Every synthesis and estimate here is for this product, never the podcast's. */
const PRODUCT = 'listenAndLearn';

/**
 * A USD figure to six decimals that never sits below the exact value. The
 * run total is a ceiling, and `toFixed` rounds to nearest, so the trimmed
 * figure is nudged up by one micro-dollar whenever trimming lowered it.
 */
export function roundUpUsd(usd) {
  const trimmed = parseFloat(usd.toFixed(6));
  return trimmed < usd ? parseFloat((trimmed + 1e-6).toFixed(6)) : trimmed;
}

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
 * `estimateSpeechCostUsd` treats as bytes; Gemini's duration is derived from
 * bytes at a deliberately slow speaking rate, so this over-estimates. The
 * episode count is the areas requested or, when the guide has not been parsed
 * to know, the most a run may generate. The run cannot spend more than this
 * figure on speech; it usually spends less.
 *
 * The Listen & Learn product only — Gemini or Azure AI Speech, never
 * ElevenLabs, whatever keys are present (speech/index.js). `provider` is null
 * when no speech provider will run, and `reason` says why, because the two
 * causes call for different actions: `not_configured` (no key at all — the
 * transcript-only state, not an error) or `pin_unavailable`
 * (`LISTEN_AND_LEARN_TTS_PROVIDER` names a provider that is not configured,
 * not known, or not this product's — the run will still go ahead, and its
 * audio step will fail with a sentence naming the pin).
 *
 * `model` is the Gemini model the run will read with when the payload names
 * a valid `ttsModel` (`modelSource: 'run'`). When it names none — the
 * generation form sends none when the operator leaves "Stored default" or
 * when the settings failed to load, and any other caller may omit it — the
 * worker will read the stored default from `admin_config`, and this hook is
 * synchronous and sees only the payload, so it cannot know which model that
 * is. It does not guess: `model` is null, `modelSource` is `'stored'`,
 * `modelNote` says where the default lives, and the ceiling is priced at
 * the DEARER of the two offered models so that it is still a ceiling
 * whichever one is stored (Copilot on #462).
 *
 * @param {object} payload the raw enqueue payload
 * @param {object} [env]
 * @returns {{provider: string|null, model: string|null, modelSource: 'run'|'stored'|null, modelNote?: string, episodes: number, perEpisodeUsd: number|null, estimatedCostUsd: number|null, reason?: 'not_configured'|'pin_unavailable'}}
 */
export function speechEstimateForRun(payload, env = process.env) {
  const areas = Array.isArray(payload?.areas) ? payload.areas.length : 0;
  const episodes = areas > 0 ? Math.min(areas, MAX_AREAS_PER_RUN) : MAX_AREAS_PER_RUN;
  // An allowlist lookup: a value that is not one of the two ids is treated as
  // absent here (the worker refuses it by sentence), never echoed back.
  const requested = parseTtsModel(payload?.ttsModel).value ?? null;
  const perEpisode = estimateSpeechCostUsd({
    product: PRODUCT,
    ceilingBytes: MAX_SCRIPT_BYTES,
    model: requested || dearestOfferedModel(),
    env,
  });
  if (!perEpisode) {
    return {
      provider: null,
      model: null,
      modelSource: null,
      episodes,
      perEpisodeUsd: null,
      estimatedCostUsd: null,
      reason: noProviderReason(env),
    };
  }
  const perEpisodeUsd = perEpisode.estimatedCostUsd;
  // Only Gemini has a model to name; Azure's is null with nothing to say.
  const unknownStored = perEpisode.provider === 'gemini' && !requested;
  return {
    provider: perEpisode.provider,
    model: unknownStored ? null : perEpisode.model,
    modelSource: perEpisode.model ? (requested ? 'run' : 'stored') : null,
    ...(unknownStored ? { modelNote: STORED_MODEL_NOTE } : {}),
    episodes,
    perEpisodeUsd,
    estimatedCostUsd: typeof perEpisodeUsd === 'number' ? roundUpUsd(perEpisodeUsd * episodes) : null,
  };
}

/** What the 202 says in place of a model it cannot know. */
export const STORED_MODEL_NOTE = 'the stored default applies; see Platform settings';

/**
 * The offered model with the highest per-episode ceiling, so an estimate made
 * without knowing which is stored is never below the one that will run.
 */
function dearestOfferedModel() {
  return listenAndLearnModelOptions().reduce((dearest, option) =>
    (option.perEpisodeUsd ?? -1) > (dearest.perEpisodeUsd ?? -1) ? option : dearest
  ).id;
}

/**
 * Why no speech provider will run: the switch returns null for "nothing is
 * configured" and throws for "the pin is unusable", and only the first of
 * those is the normal transcript-only state.
 */
function noProviderReason(env) {
  try {
    return resolveSpeechProvider(env, { product: PRODUCT }) ? null : 'not_configured';
  } catch (err) {
    if (err?.name === 'SpeechNotConfiguredError') return 'pin_unavailable';
    throw err;
  }
}

/**
 * Validate a generate payload. Returns `{ value }` or `{ error }` so the rules
 * are testable on their own and the job worker stays a thin adapter.
 *
 * `ttsModel` is checked first and for both kinds of run: an id that is not
 * one of the two offered is refused by sentence before anything is spent,
 * and an absent one is null — "the stored default" — in the value.
 */
export function parseGeneratePayload(payload) {
  const model = parseTtsModel(payload?.ttsModel);
  if (model.error) return { error: model.error };

  // A source list makes this a source-grounded episode, whatever else the
  // payload carries: the presence of the field is the switch, not its
  // length, so an empty list is refused by the source rules ("needs at least
  // one source") rather than silently becoming a guide run.
  if (payload && typeof payload === 'object' && payload.sources !== undefined) {
    const parsed = parseSourceEpisodePayload(payload);
    return parsed.error ? parsed : { value: { ...parsed.value, ttsModel: model.value } };
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
      ttsModel: model.value,
      cert: {
        title: String(payload?.certTitle || '').trim() || null,
        slug: String(payload?.certSlug || '').trim() || null,
      },
    },
  };
}

/**
 * The Gemini model this run reads with: the run's choice, else the stored
 * default, else null for `LISTEN_AND_LEARN_TTS_MODEL` and the module default
 * (speech-settings.js). Read once per run, before anything is spent.
 *
 * @param {string|null} requested the validated `ttsModel` from the payload
 * @param {{ readDoc: Function }} store
 */
export async function resolveRunModel(requested, store) {
  if (requested) return requested;
  return resolveListenAndLearnModel({ stored: await readStoredListenAndLearnModel(store.readDoc) });
}

/** One generation run against production dependencies. */
export async function runListenAndLearnGeneration(payload, { context, job } = {}) {
  const parsed = parseGeneratePayload(payload);
  if (parsed.error) throw new Error(parsed.error);

  const store = { readDoc, upsertDoc, patchDoc };
  const ttsModel = await resolveRunModel(parsed.value.ttsModel, store);

  if (parsed.value.kind === 'source') {
    const source = parsed.value;
    const report = await generateSourceEpisode({
      platform: source.platform,
      examCode: source.examCode,
      title: source.title,
      sources: source.sources,
      cert: source.cert,
      store,
      storage: { uploadBlob },
      ai: { generateGroundedJsonResponse, getCostEstimate },
      ttsModel,
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
    store,
    storage: { uploadBlob },
    ai: { generateJsonResponse, getActiveAiProvider, getCostEstimate },
    ttsModel,
    youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
    actorId: job?.requestedBy?.oid || null,
    onlyAreas: areas,
  });

  // The model id is a setting, not content; naming it is what answers "why
  // does this run sound different" from the log alone.
  context?.log?.(
    `generate-listen-and-learn: ${report.examCode} — ${report.generated} drafted, ${report.failed} failed, ${report.withoutAudio} without audio, $${report.costUsd} spent (speech model ${ttsModel || 'default'})`
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
