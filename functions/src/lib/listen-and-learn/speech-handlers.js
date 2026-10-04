/**
 * The speech-side routes (PR #841 split of handlers.js): the options the
 * Settings tab offers, the cost estimate, the source-grounded episode
 * enqueue (#433), and the review decision. Each is a function of `ctx`
 * answering the handler.
 *
 * ROLES. Every read and every edit is editor-gated. Publishing — setting a
 * chapter's status to `published` — is publisher-gated (ADR 0033 §4), the
 * same floor as `publish-content`; withdrawing to draft stays editor.
 */
import { isPlainObject } from '../cms/content-update-validation.js';
import { SET_CONTAINER, STATUS, setId, setEpisodeStatus } from './publish.js';
import { LISTEN_AND_LEARN_JOB_TYPE, parseSourceEpisodePayload } from './source-episode.js';
import { firstError } from './validate.js';
import {
  AZURE_VOICES,
  GEMINI_VOICES,
  SPEAKING_RATE,
  VOICE_PROVIDERS,
  listenAndLearnModelOptions,
  LISTEN_AND_LEARN_DEFAULT_MODEL,
  parseTtsModel,
  readStoredListenAndLearnModel,
} from './speech-settings.js';
import { describeSpeechProviders } from './speech/index.js';
import { PRODUCT, json, parseBody } from './handlers-shared.js';

/** UTF-8 bytes of `text`, else the non-negative `bytes` given, else null. */
function speechBytesOf(body) {
  if (typeof body.text === 'string') return Buffer.byteLength(body.text, 'utf8');
  const bytes = Number(body.bytes);
  return Number.isFinite(bytes) && bytes >= 0 ? Math.ceil(bytes) : null;
}

/** `{ bytes? | text?, ttsModel?, platform?, examCode? }` for the estimate. */
function parseEstimateBody(body) {
  const model = parseTtsModel(body.ttsModel);
  if (model.error) return { error: model.error };
  const bytes = speechBytesOf(body);
  if (bytes === null) return { error: 'Give text or a byte count to price' };
  return {
    value: { bytes, ttsModel: model.value, platform: body.platform, examCode: body.examCode },
  };
}

/**
 * `{ platform, examCode, areaSlug, status }` for the review. 'failed' is
 * written by the generator, never chosen by a reviewer: marking a working
 * episode failed would hide it from the site with no record of why, which
 * is what `draft` is for. 'archived' has its own control on the chapter.
 */
function parseReviewBody(body) {
  const platform = String(body.platform || '')
    .trim()
    .toLowerCase();
  const examCode = String(body.examCode || '').trim();
  const areaSlug = String(body.areaSlug || '').trim();
  const status = String(body.status || '').trim();
  const error = firstError([
    [
      status !== STATUS.published && status !== STATUS.draft,
      `status must be "${STATUS.published}" or "${STATUS.draft}"`,
    ],
    [!platform || !examCode || !areaSlug, 'platform, examCode and areaSlug are required'],
  ]);
  return error ? { error } : { value: { platform, examCode, areaSlug, status } };
}

/**
 * GET /api/cms/listen-and-learn/speech-options — what the Settings tab
 * and the book voice dialog offer: the models with their ceilings and
 * which is the default, the voices per provider, the providers with
 * their configuration state and the one that would run, the pin, and
 * the speaking-rate bounds. Read from the server so the page cannot
 * describe a fallback the code does not have.
 */
export const speechOptions = ({ store, env, guarded }) =>
  guarded(
    'editor',
    'listenAndLearnSpeechOptions',
    'Failed to read the speech options',
    async () => {
      const stored = await readStoredListenAndLearnModel(store.readDoc).catch(() => null);
      return json(200, {
        success: true,
        models: listenAndLearnModelOptions(),
        defaultModel: LISTEN_AND_LEARN_DEFAULT_MODEL,
        storedModel: stored,
        effectiveModel: stored || LISTEN_AND_LEARN_DEFAULT_MODEL,
        voices: { gemini: GEMINI_VOICES, azure: AZURE_VOICES },
        voiceProviders: VOICE_PROVIDERS,
        speakingRate: SPEAKING_RATE,
        speech: describeSpeechProviders(env, { product: PRODUCT }),
      });
    }
  );

/**
 * POST /api/cms/listen-and-learn/estimate
 * `{ bytes? | text?, ttsModel?, platform?, examCode? }`
 *
 * What speaking this much text would cost, before it is spoken: by the
 * book's voice when one is named, else by the run's model or the stored
 * default. A ceiling, in the same arithmetic the 202 uses.
 */
export const estimateSpeech = ({ store, estimateFor, guarded }) =>
  guarded(
    'editor',
    'listenAndLearnEstimate',
    'Failed to estimate the speech cost',
    async ({ request }) => {
      const read = parseBody(await request.json().catch(() => null), parseEstimateBody);
      if (!read.ok) return json(read.status, { error: read.error });
      const { bytes, ttsModel, platform, examCode } = read.parsed;

      let set = null;
      if (platform && examCode) {
        const id = setId(String(platform), String(examCode));
        set = await store.readDoc(SET_CONTAINER, id, id);
      }
      return json(200, {
        success: true,
        ...(await estimateFor(set, { bytes, ttsModel })),
      });
    }
  );

/**
 * POST /api/cms/listen-and-learn/source-episode
 * `{ platform, examCode, title, sources: [{ kind, url, title? }], certTitle?, certSlug? }`
 *
 * Queues one source-grounded episode (#433) and answers 202 with the job
 * id, like `enqueueJob`; the episode appears in the set as a draft when
 * the job finishes. The list is validated here with the worker's own
 * validator — see the handlers.js header for why — and the payload written
 * to the job is the normalised one, so the worker cannot read a field the
 * route did not check.
 *
 * `io` is `{ enqueue: (message: {jobId: string, type: string}) => void }` — the queue output.
 */
export const generateSourceEpisode = ({ queueJob, guarded }) =>
  guarded(
    'editor',
    'generateSourceEpisode',
    'Failed to queue the source-grounded episode',
    async ({ request, context, auth, io }) => {
      const read = parseBody(await request.json().catch(() => null), parseSourceEpisodePayload);
      if (!read.ok) return json(read.status, { error: read.error });
      const { platform, examCode, title, areaSlug, sources, cert } = read.parsed;

      if (typeof io.enqueue !== 'function') {
        context.error?.('generateSourceEpisode: no queue output wired');
        return json(500, { error: 'Job queue is not configured' });
      }

      // The job id is the correlation key; the episode id would be the
      // owner's title, which is content and stays out of the log.
      const response = await queueJob({
        type: LISTEN_AND_LEARN_JOB_TYPE,
        payload: {
          platform,
          examCode,
          title,
          sources,
          ...(cert.title ? { certTitle: cert.title } : {}),
          ...(cert.slug ? { certSlug: cert.slug } : {}),
        },
        user: auth.user,
        enqueue: io.enqueue,
        extra: { areaSlug, sourceCount: sources.length },
      });
      context.log?.(
        `generateSourceEpisode: queued ${JSON.parse(response.body).jobId} for ${examCode} (${sources.length} sources)`
      );
      return response;
    }
  );

/**
 * POST /api/cms/listen-and-learn/review
 * `{ platform, examCode, areaSlug, status: 'published' | 'draft' }`
 *
 * Publishing is publisher-gated; withdrawing to draft is editor-gated
 * (ADR 0033 §4). The role is read from the body before the guard runs,
 * and an unreadable body is refused by the editor floor first.
 */
export const reviewEpisode =
  ({ store, stamp, actorOf, guarded }) =>
  async (request, context) => {
    const body = await request.json().catch(() => null);
    const wantsPublish =
      isPlainObject(body) && String(body.status || '').trim() === STATUS.published;
    const review = guarded(
      wantsPublish ? 'publisher' : 'editor',
      'reviewListenAndLearn',
      'Failed to update the episode',
      async ({ auth }) => {
        const read = parseBody(body, parseReviewBody);
        if (!read.ok) return json(read.status, { error: read.error });
        const { platform, examCode, areaSlug, status } = read.parsed;

        const updated = await setEpisodeStatus(store, {
          provider: platform,
          examCode,
          areaSlug,
          status,
          actorId: actorOf(auth),
          now: stamp(),
        });

        context.log?.(
          `reviewListenAndLearn: ${examCode}/${areaSlug} → ${status} by ${actorOf(auth) || 'unknown'}`
        );
        return json(200, { success: true, examCode, areaSlug, status, item: updated || null });
      }
    );
    return review(request, context);
  };
