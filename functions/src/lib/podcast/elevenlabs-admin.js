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
 *
 * ## Shape
 *
 * Each route is a module-level function taking the resolved dependencies;
 * `createElevenLabsHandlers` only binds them. Small functions, each doing one
 * step, rather than one closure holding both routes.
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

const SAMPLE_INFO = Object.freeze({ characters: SAMPLE_CHARACTERS, turns: SAMPLE_DIALOGUE.length });

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

/** A usage row as the card shows it. */
const presentRender = (row) => ({
  characters: Number(row.completionTokens) || 0,
  estimated: row.estimatedTokens === true,
  at: row.timestamp || null,
  source: row.source || null,
  model: row.model || null,
});

/** `{ lastRender, lastRenderError }`; a failed read is said, not shown as "none yet". */
async function readLastRender({ store }, context) {
  try {
    const rows = await store.queryDocs(USAGE_CONTAINER, LAST_RENDER_QUERY, [
      { name: '@provider', value: 'elevenlabs' },
    ]);
    return { lastRender: rows?.[0] ? presentRender(rows[0]) : null, lastRenderError: null };
  } catch (error) {
    context.warn?.(`elevenLabsStatus: usage read failed (${error?.code ?? 'unknown'})`);
    return { lastRender: null, lastRenderError: 'The usage table could not be read.' };
  }
}

/**
 * `{ subscription, subscriptionError }`. The error sentence names the cause
 * and the fix (a permission, a key); it never carries the key.
 */
async function readAccountState({ readAccount, fetchImpl }, key) {
  try {
    return { subscription: await readAccount({ key, fetchImpl }), subscriptionError: null };
  } catch (error) {
    return { subscription: null, subscriptionError: error?.message || String(error) };
  }
}

/** GET /api/cms/podcast/elevenlabs */
async function getStatus(deps, request, context) {
  const auth = await deps.guard.requireRole(request, 'editor');
  if (auth.error) return auth.error;
  try {
    const usage = await readLastRender(deps, context);
    const key = readSetting(deps.env, ELEVENLABS_KEY_SETTING);
    const account = key
      ? await readAccountState(deps, key)
      : { subscription: null, subscriptionError: null };
    return json(200, {
      success: true,
      configured: Boolean(key),
      reason: key ? null : NOT_CONFIGURED_REASON,
      ...account,
      ...usage,
      sample: SAMPLE_INFO,
    });
  } catch (error) {
    context.error('elevenLabsStatus failed:', error);
    return json(500, { error: 'Failed to read the ElevenLabs status' });
  }
}

/** Store the sample's MP3; `{ audioUrl, audioError }`, never a throw. */
async function storeSample({ storage, now }, rendered) {
  try {
    await storage.uploadBlob(
      PODCAST_AUDIO_CONTAINER,
      SAMPLE_AUDIO_PATH,
      rendered.audio,
      rendered.contentType,
      { sourceKind: 'sample' }
    );
    return {
      audioUrl: `${mediaUrlFor(PODCAST_AUDIO_CONTAINER, SAMPLE_AUDIO_PATH)}?v=${now().getTime()}`,
      audioError: null,
    };
  } catch (error) {
    return {
      audioUrl: null,
      audioError: `The sample was rendered and billed but not stored: ${error?.message || error}`,
    };
  }
}

/**
 * The account after the check: `{ account, creditsLeft }`, where creditsLeft
 * is the lower of a fresh read and "before minus billed" (see the header).
 */
async function creditsAfter({ readAccount, fetchImpl }, key, before, billed) {
  const after = await readAccount({ key, fetchImpl, useCache: false }).catch(() => null);
  const computed = before ? Math.max(0, before.creditsLeft - billed) : null;
  const fresh = after ? after.creditsLeft : null;
  const known = [computed, fresh].filter((n) => typeof n === 'number');
  return { account: after || before, creditsLeft: known.length ? Math.min(...known) : null };
}

/** The live check's answer, from what was rendered, stored and read. */
function sampleReport(rendered, stored, { account, creditsLeft }, before, billed) {
  return {
    ok: true,
    ...stored,
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
  };
}

/**
 * Everything after a successful render: store the MP3, record the usage row
 * (credits were spent whether or not the upload worked), read the account
 * again, and report.
 */
async function reportSample(deps, key, rendered) {
  const billed = Number(rendered.completionTokens) || 0;
  const before = rendered.subscription || null;
  const stored = await storeSample(deps, rendered);
  await recordAiUsage(
    { store: deps.store, ai: deps.ai },
    {
      provider: rendered.provider,
      model: rendered.model,
      promptTokens: 0,
      completionTokens: billed,
      estimatedTokens: rendered.estimatedTokens === true,
      source: USAGE_SOURCES.podcastSample,
    }
  );
  const credits = await creditsAfter(deps, key, before, billed);
  return sampleReport(rendered, stored, credits, before, billed);
}

/** POST /api/cms/podcast/elevenlabs/sample */
async function renderSample(deps, request, context) {
  const auth = await deps.guard.requireRole(request, 'editor');
  if (auth.error) return auth.error;

  const key = readSetting(deps.env, ELEVENLABS_KEY_SETTING);
  if (!key) return json(503, { error: NOT_CONFIGURED_REASON, code: 'NOT_CONFIGURED' });

  let rendered;
  try {
    rendered = await deps.synthesize({
      product: 'podcast',
      dialogue: SAMPLE_DIALOGUE,
      env: deps.env,
      fetchImpl: deps.fetchImpl,
    });
  } catch (error) {
    context.log?.(`elevenLabsSample: refused (${error?.code || error?.name || 'error'})`);
    return json(statusFor(error), {
      error: error?.message || String(error),
      code: error?.code || error?.name || null,
    });
  }

  try {
    const report = await reportSample(deps, key, rendered);
    context.log?.(`elevenLabsSample: rendered, ${report.charactersBilled} characters billed`);
    return json(200, report);
  } catch (error) {
    context.error('elevenLabsSample failed after rendering:', error);
    return json(500, { error: 'The sample was rendered but the result could not be reported' });
  }
}

/**
 * @param {object} options
 * @param {{ requireRole: Function }} options.guard
 * @param {{ queryDocs: Function, upsertDoc: Function }} options.store
 * @param {{ uploadBlob: Function }} options.storage
 * @param {{ getCostEstimate: Function }} options.ai
 * @param {object} [options.env]
 * @param {Function} [options.fetchImpl]
 * @param {Function} [options.synthesize] `synthesizeDialogue`; injected for tests
 * @param {Function} [options.readAccount] `readSubscription`; injected for tests
 * @param {() => Date} [options.now]
 */
export function createElevenLabsHandlers(options) {
  const deps = {
    ...options,
    env: options.env ?? process.env,
    fetchImpl: options.fetchImpl ?? fetch,
    synthesize: options.synthesize ?? synthesizeDialogue,
    readAccount: options.readAccount ?? readSubscription,
    now: options.now ?? (() => new Date()),
  };
  return {
    getStatus: (request, context) => getStatus(deps, request, context),
    renderSample: (request, context) => renderSample(deps, request, context),
  };
}
