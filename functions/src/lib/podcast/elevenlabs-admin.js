/**
 * elevenlabs-admin.js: the podcast voice's account, on the Audio tab of the
 * Platform settings page, and the owner's cheap live check (#432; ADR 0029
 * §2a, amended 2026-09-26).
 *
 * Two routes, both `editor`, the level of the routes that generate podcast
 * audio (which spend far more than either of these):
 *
 *   GET  cms/podcast/elevenlabs          the plan, credits used / limit, the
 *                                        reset date, and what the last render
 *                                        billed
 *   POST cms/podcast/elevenlabs/sample   renders SAMPLE_DIALOGUE, two turns
 *                                        and under 300 characters, through
 *                                        the real provider
 *
 * ## Not configured is an answer
 *
 * With no `ELEVENLABS_API_KEY` the status route answers 200 with
 * `configured: false` and the sentence naming the secret. It does not answer
 * with an error: an unseeded key is a state the page shows, the way the
 * Integrations page shows "Not configured". The sample route cannot do its
 * job without the key, so it answers 503 with the same sentence and sends
 * nothing.
 *
 * ## The live check spends about 300 credits, never more
 *
 * The sample is fixed here. The caller sends no text, so the route cannot be
 * used to spend the month. It goes through `synthesizeDialogue` with the
 * `podcast` product, which is the same path an episode takes: the product
 * switch, the pin, the credit pre-flight, the voices, the model and the
 * chunker. So a pass means an episode would reach ElevenLabs the same way.
 * Its MP3 is stored at one fixed path in the `podcast` container, overwritten
 * by the next check. It is served the way every transcript's audio is,
 * anonymously, through the media route. The URL carries a version because
 * that route answers `immutable`. The usage row is its own source,
 * `podcast:sample`, so the check never reads as episode spend.
 *
 * ## "Credits left" after the check
 *
 * ElevenLabs may update `character_count` a moment after the request that
 * spent it. So the figure reported is the lower of a fresh read and "before,
 * minus what the response said it billed". A lagging read then cannot report
 * the credits as unspent.
 */
import { readSetting, synthesizeDialogue } from '../listen-and-learn/speech/index.js';
import {
  API_KEYS_PAGE,
  readSubscription,
} from '../listen-and-learn/speech/elevenlabs-account.js';
import { characterCount } from '../listen-and-learn/speech/elevenlabs.js';
import { USAGE_CONTAINER, USAGE_SOURCES, recordAiUsage } from '../ai/usage.js';
import { mediaUrlFor } from '../blob-paths.js';
import { PODCAST_AUDIO_CONTAINER } from './store.js';

export const ELEVENLABS_KEY_SETTING = 'ELEVENLABS_API_KEY';

/** Where the owner seeds the key: the Integrations page's Keys tab. */
export const SEED_KEY_PAGE = 'https://hybridcloudworks.com/admin/integrations?tab=keys';

export const NOT_CONFIGURED_REASON =
  `${ELEVENLABS_KEY_SETTING} is not configured. Create a key at ${API_KEYS_PAGE} and seed it ` +
  `as the ELEVENLABS-API-KEY secret at ${SEED_KEY_PAGE}.`;

/** The live check's one blob, overwritten each run. */
export const SAMPLE_AUDIO_PATH = 'sample/elevenlabs-live-check.mp3';

/** The ceiling the owner set for the check; the sample is held under it by a test. */
export const SAMPLE_MAX_CHARACTERS = 300;

/**
 * Two turns, one per host, so the check proves both voices and the dialogue
 * endpoint's turn-taking. Fixed text: the caller cannot send its own.
 */
export const SAMPLE_DIALOGUE = Object.freeze([
  Object.freeze({
    speaker: 'Maya',
    text:
      'Welcome to a short sound check for the HybridCloudWorks podcast. I am Maya, ' +
      'and this sample is read through ElevenLabs so you can hear the voices and see what it cost.',
  }),
  Object.freeze({
    speaker: 'Elena',
    text: 'And I am Elena. If you can hear two different voices, a full episode will sound like this.',
  }),
]);

export const SAMPLE_CHARACTERS = SAMPLE_DIALOGUE.reduce(
  (total, turn) => total + characterCount(turn.text),
  0
);

/**
 * The newest ElevenLabs usage row, whatever wrote it: an episode or a live
 * check. `ai_usage` is partitioned on `/id` with every path indexed
 * (infra/cosmos-containers.json), so a single-property ORDER BY needs no
 * composite index.
 */
const LAST_RENDER_QUERY =
  'SELECT TOP 1 c.completionTokens, c.estimatedTokens, c.timestamp, c.source, c.model ' +
  'FROM c WHERE c.provider = @provider ORDER BY c.timestamp DESC';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** The HTTP status for a speech failure on the sample route. */
function statusFor(error) {
  if (error?.name === 'SpeechNotConfiguredError') return 503;
  if (error?.code === 'quota_exceeded' || error?.code === 'paid_plan_required') return 409;
  return 502;
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, upsertDoc: Function }} deps.store
 * @param {{ uploadBlob: Function }} deps.storage
 * @param {{ getCostEstimate: Function }} deps.ai
 * @param {object} [deps.env]
 * @param {Function} [deps.fetchImpl]
 * @param {Function} [deps.synthesize] `synthesizeDialogue`; injected for tests
 * @param {Function} [deps.readAccount] `readSubscription`; injected for tests
 * @param {() => Date} [deps.now]
 */
export function createElevenLabsHandlers({
  guard,
  store,
  storage,
  ai,
  env = process.env,
  fetchImpl = fetch,
  synthesize = synthesizeDialogue,
  readAccount = readSubscription,
  now = () => new Date(),
}) {
  /** `{ lastRender, lastRenderError }`; a failed read is said, not shown as "none yet". */
  async function readLastRender(context) {
    try {
      const rows = await store.queryDocs(USAGE_CONTAINER, LAST_RENDER_QUERY, [
        { name: '@provider', value: 'elevenlabs' },
      ]);
      const row = rows?.[0];
      if (!row) return { lastRender: null, lastRenderError: null };
      return {
        lastRender: {
          characters: Number(row.completionTokens) || 0,
          estimated: row.estimatedTokens === true,
          at: row.timestamp || null,
          source: row.source || null,
          model: row.model || null,
        },
        lastRenderError: null,
      };
    } catch (error) {
      context.warn?.(`elevenLabsStatus: usage read failed (${error?.code ?? 'unknown'})`);
      return { lastRender: null, lastRenderError: 'The usage table could not be read.' };
    }
  }

  return {
    /** GET /api/cms/podcast/elevenlabs */
    async getStatus(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const sample = { characters: SAMPLE_CHARACTERS, turns: SAMPLE_DIALOGUE.length };
        const usage = await readLastRender(context);
        const key = readSetting(env, ELEVENLABS_KEY_SETTING);
        if (!key) {
          return json(200, {
            success: true,
            configured: false,
            reason: NOT_CONFIGURED_REASON,
            subscription: null,
            subscriptionError: null,
            ...usage,
            sample,
          });
        }

        let subscription = null;
        let subscriptionError = null;
        try {
          subscription = await readAccount({ key, fetchImpl });
        } catch (error) {
          // The sentence names the cause and the fix (a permission, a key);
          // it never carries the key.
          subscriptionError = error?.message || String(error);
        }
        return json(200, {
          success: true,
          configured: true,
          reason: null,
          subscription,
          subscriptionError,
          ...usage,
          sample,
        });
      } catch (error) {
        context.error('elevenLabsStatus failed:', error);
        return json(500, { error: 'Failed to read the ElevenLabs status' });
      }
    },

    /** POST /api/cms/podcast/elevenlabs/sample */
    async renderSample(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      const key = readSetting(env, ELEVENLABS_KEY_SETTING);
      if (!key) return json(503, { error: NOT_CONFIGURED_REASON, code: 'NOT_CONFIGURED' });

      let rendered;
      try {
        rendered = await synthesize({
          product: 'podcast',
          dialogue: SAMPLE_DIALOGUE,
          env,
          fetchImpl,
        });
      } catch (error) {
        context.log?.(`elevenLabsSample: refused (${error?.code || error?.name || 'error'})`);
        return json(statusFor(error), {
          error: error?.message || String(error),
          code: error?.code || error?.name || null,
        });
      }

      try {
        const billed = Number(rendered.completionTokens) || 0;
        let audioUrl = null;
        let audioError = null;
        try {
          await storage.uploadBlob(
            PODCAST_AUDIO_CONTAINER,
            SAMPLE_AUDIO_PATH,
            rendered.audio,
            rendered.contentType,
            { sourceKind: 'sample' }
          );
          audioUrl = `${mediaUrlFor(PODCAST_AUDIO_CONTAINER, SAMPLE_AUDIO_PATH)}?v=${now().getTime()}`;
        } catch (error) {
          audioError = `The sample was rendered and billed but not stored: ${error?.message || error}`;
        }

        // Credits were spent whether or not the upload worked, so the row is
        // written either way. Best-effort, like every usage row.
        await recordAiUsage(
          { store, ai },
          {
            provider: rendered.provider,
            model: rendered.model,
            promptTokens: 0,
            completionTokens: billed,
            estimatedTokens: rendered.estimatedTokens === true,
            source: USAGE_SOURCES.podcastSample,
          }
        );

        const before = rendered.subscription || null;
        let after = null;
        try {
          after = await readAccount({ key, fetchImpl, useCache: false });
        } catch {
          after = null;
        }
        const computed = before ? Math.max(0, before.creditsLeft - billed) : null;
        let creditsLeft = computed;
        if (after) creditsLeft = computed === null ? after.creditsLeft : Math.min(after.creditsLeft, computed);
        const account = after || before;

        context.log?.(`elevenLabsSample: rendered, ${billed} characters billed`);
        return json(200, {
          ok: true,
          audioUrl,
          audioError,
          contentType: rendered.contentType,
          bytes: rendered.bytes ?? rendered.audio?.length ?? 0,
          durationSeconds: rendered.estimatedSeconds ?? null,
          requests: rendered.requests ?? null,
          model: rendered.model ?? null,
          characters: rendered.characters ?? SAMPLE_CHARACTERS,
          charactersBilled: billed,
          billedEstimated: rendered.estimatedTokens === true,
          creditsLeftBefore: before?.creditsLeft ?? null,
          creditsLeft,
          creditLimit: account?.creditLimit ?? null,
          tier: account?.tier ?? null,
          freePlan: account?.freePlan ?? null,
          resetAt: account?.resetAt ?? null,
        });
      } catch (error) {
        context.error('elevenLabsSample failed after rendering:', error);
        return json(500, { error: 'The sample was rendered but the result could not be reported' });
      }
    },
  };
}
