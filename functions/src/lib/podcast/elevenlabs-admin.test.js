/**
 * The Audio tab's ElevenLabs card and the owner's live check (#432,
 * 2026-09-26).
 *
 * Pinned: both routes are gated; an unseeded key is a 200 "not configured"
 * on the status route and a 503 that sends nothing on the sample route; the
 * sample is fixed, two turns, under 300 characters, and goes through the same
 * path an episode takes; a refusal is reported with its own sentence and
 * spends nothing; and "credits left" can never read as unspent because a
 * fresh read lagged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NOT_CONFIGURED_REASON,
  SAMPLE_AUDIO_PATH,
  SAMPLE_CHARACTERS,
  SAMPLE_DIALOGUE,
  SAMPLE_MAX_CHARACTERS,
  SEED_KEY_PAGE,
  createElevenLabsHandlers,
} from './elevenlabs-admin.js';
import { USAGE_CONTAINER, USAGE_SOURCES } from '../ai/usage.js';
import {
  SUBSCRIPTION_URL,
  clearSubscriptionCache,
  normalizeSubscription,
} from '../listen-and-learn/speech/elevenlabs-account.js';
import { SpeechError, SpeechNotConfiguredError } from '../listen-and-learn/speech/index.js';

const NOW = new Date('2026-09-26T12:00:00.000Z');
const KEY_ENV = { ELEVENLABS_API_KEY: 'xi-test-key' };
const context = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

const USER = { oid: 'oid-1' };
const allowGuard = { requireRole: vi.fn(async (_req, role) => ({ user: USER, role, error: null })) };
const denyGuard = {
  requireRole: vi.fn(async () => ({ user: null, error: { status: 403, body: '{}' } })),
};

const FREE_BODY = {
  tier: 'free',
  status: 'free',
  character_count: 0,
  character_limit: 10000,
  next_character_count_reset_unix: 1792972800,
  can_extend_character_limit: false,
  max_credit_limit_extension: 0,
};
const FREE = normalizeSubscription(FREE_BODY);

const USAGE_ROW = {
  completionTokens: 8912,
  estimatedTokens: false,
  timestamp: '2026-09-26T10:00:00.000Z',
  source: 'podcast:audio',
  model: 'eleven_v3',
};

const makeStore = (over = {}) => ({
  queryDocs: vi.fn(async () => [USAGE_ROW]),
  upsertDoc: vi.fn(async (_c, doc) => doc),
  ...over,
});
const makeStorage = (over = {}) => ({ uploadBlob: vi.fn(async () => undefined), ...over });
const ai = { getCostEstimate: vi.fn(() => 0.0257) };

const request = () => ({ json: vi.fn(async () => ({ dialogue: [{ speaker: 'Maya', text: 'x'.repeat(9000) }] })) });

const handlers = ({
  guard = allowGuard,
  store = makeStore(),
  storage = makeStorage(),
  env = KEY_ENV,
  synthesize,
  readAccount,
  fetchImpl,
} = {}) =>
  createElevenLabsHandlers({
    guard,
    store,
    storage,
    ai,
    env,
    now: () => NOW,
    ...(synthesize ? { synthesize } : {}),
    ...(readAccount ? { readAccount } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
  });

const body = (res) => JSON.parse(res.body);

/** What `synthesizeDialogue` returns for the sample on a fresh free month. */
const rendered = (over = {}) => ({
  audio: Buffer.from([0xff, 0xfb, 1, 2]),
  contentType: 'audio/mpeg',
  bytes: 4,
  provider: 'elevenlabs',
  model: 'eleven_v3',
  requests: 1,
  estimatedSeconds: 16,
  promptTokens: 0,
  completionTokens: SAMPLE_CHARACTERS,
  estimatedTokens: false,
  characters: SAMPLE_CHARACTERS,
  subscription: FREE,
  ...over,
});

beforeEach(() => {
  clearSubscriptionCache();
  context.log.mockClear();
});

describe('the sample', () => {
  it('is two turns, one per host, under the owner’s 300-character ceiling', () => {
    expect(SAMPLE_DIALOGUE).toHaveLength(2);
    expect(SAMPLE_DIALOGUE.map((t) => t.speaker)).toEqual(['Maya', 'Elena']);
    expect(SAMPLE_CHARACTERS).toBeLessThanOrEqual(SAMPLE_MAX_CHARACTERS);
    expect(SAMPLE_MAX_CHARACTERS).toBe(300);
    expect(SAMPLE_CHARACTERS).toBe(257);
    expect(Object.isFrozen(SAMPLE_DIALOGUE)).toBe(true);
    expect(Object.isFrozen(SAMPLE_DIALOGUE[0])).toBe(true);
  });
});

describe('auth', () => {
  it('passes a guard denial through on both routes, touching nothing', async () => {
    const store = makeStore();
    const storage = makeStorage();
    const synthesize = vi.fn();
    const readAccount = vi.fn();
    const h = handlers({ guard: denyGuard, store, storage, synthesize, readAccount });
    expect((await h.getStatus(request(), context)).status).toBe(403);
    expect((await h.renderSample(request(), context)).status).toBe(403);
    expect(store.queryDocs).not.toHaveBeenCalled();
    expect(readAccount).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
    expect(storage.uploadBlob).not.toHaveBeenCalled();
  });

  it('gates both at editor, the level of the routes that generate podcast audio', async () => {
    const guard = { requireRole: vi.fn(async () => ({ user: USER, error: null })) };
    const h = handlers({ guard, env: {} });
    await h.getStatus(request(), context);
    await h.renderSample(request(), context);
    expect(guard.requireRole.mock.calls.map(([, role]) => role)).toEqual(['editor', 'editor']);
  });
});

describe('getStatus', () => {
  it('answers "not configured" as a 200 naming the secret and where to seed it, calling nothing upstream', async () => {
    const readAccount = vi.fn();
    for (const env of [{}, { ELEVENLABS_API_KEY: '@Microsoft.KeyVault(SecretUri=https://v/s/1)' }]) {
      const res = await handlers({ env, readAccount }).getStatus(request(), context);
      expect(res.status).toBe(200);
      expect(body(res)).toMatchObject({
        success: true,
        configured: false,
        reason: NOT_CONFIGURED_REASON,
        subscription: null,
        lastRender: { characters: 8912 },
      });
    }
    expect(readAccount).not.toHaveBeenCalled();
    expect(NOT_CONFIGURED_REASON).toMatch(/ELEVENLABS_API_KEY is not configured/);
    expect(NOT_CONFIGURED_REASON).toContain('ELEVENLABS-API-KEY');
    expect(NOT_CONFIGURED_REASON).toContain('https://elevenlabs.io/app/developers/api-keys');
    expect(SEED_KEY_PAGE).toBe('https://hybridcloudworks.com/admin/integrations?tab=keys');
  });

  it('reports the plan, the credits and the reset date, and what the last render billed', async () => {
    const store = makeStore();
    const readAccount = vi.fn(async () => ({ ...FREE, creditsUsed: 8912, creditsLeft: 1088 }));
    const res = await handlers({ store, readAccount }).getStatus(request(), context);

    expect(res.status).toBe(200);
    expect(body(res)).toEqual({
      success: true,
      configured: true,
      reason: null,
      subscription: {
        tier: 'free',
        status: 'free',
        freePlan: true,
        creditsUsed: 8912,
        creditLimit: 10000,
        creditsLeft: 1088,
        overageCredits: 0,
        resetAt: '2026-10-26T00:00:00.000Z',
      },
      subscriptionError: null,
      lastRender: {
        characters: 8912,
        estimated: false,
        at: '2026-09-26T10:00:00.000Z',
        source: 'podcast:audio',
        model: 'eleven_v3',
      },
      lastRenderError: null,
      sample: { characters: SAMPLE_CHARACTERS, turns: 2 },
    });
    expect(readAccount).toHaveBeenCalledWith(expect.objectContaining({ key: 'xi-test-key' }));
    const [container, query, params] = store.queryDocs.mock.calls[0];
    expect(container).toBe(USAGE_CONTAINER);
    expect(query).toMatch(/SELECT TOP 1 .* WHERE c\.provider = @provider ORDER BY c\.timestamp DESC/);
    expect(params).toEqual([{ name: '@provider', value: 'elevenlabs' }]);
  });

  it('says there is no render yet only when the usage read worked', async () => {
    let res = await handlers({
      store: makeStore({ queryDocs: vi.fn(async () => []) }),
      readAccount: vi.fn(async () => FREE),
    }).getStatus(request(), context);
    expect(body(res)).toMatchObject({ lastRender: null, lastRenderError: null });

    res = await handlers({
      store: makeStore({
        queryDocs: vi.fn(async () => {
          throw Object.assign(new Error('cosmos down'), { code: 503 });
        }),
      }),
      readAccount: vi.fn(async () => FREE),
    }).getStatus(request(), context);
    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({
      lastRender: null,
      lastRenderError: 'The usage table could not be read.',
      subscription: { tier: 'free' },
    });
    expect(res.body).not.toContain('cosmos down');
  });

  it('keeps answering when the subscription cannot be read, with the sentence that names the fix', async () => {
    const readAccount = vi.fn(async () => {
      throw new SpeechError(
        'Could not read the ElevenLabs subscription (HTTP 403 insufficient_permissions: the key needs the User → Read permission (user_read), set at https://elevenlabs.io/app/developers/api-keys); nothing was sent, so no credits were spent.'
      );
    });
    const res = await handlers({ readAccount }).getStatus(request(), context);
    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({
      configured: true,
      subscription: null,
      subscriptionError: expect.stringMatching(/User → Read permission \(user_read\)/),
    });
    expect(res.body).not.toContain('xi-test-key');
  });
});

describe('renderSample', () => {
  it('503s without a key, naming it, and sends nothing', async () => {
    const synthesize = vi.fn();
    const storage = makeStorage();
    const res = await handlers({ env: {}, synthesize, storage }).renderSample(request(), context);
    expect(res.status).toBe(503);
    expect(body(res)).toEqual({ error: NOT_CONFIGURED_REASON, code: 'NOT_CONFIGURED' });
    expect(synthesize).not.toHaveBeenCalled();
    expect(storage.uploadBlob).not.toHaveBeenCalled();
  });

  it('renders the fixed sample through the podcast product, ignoring anything the caller sends', async () => {
    const synthesize = vi.fn(async () => rendered());
    const req = request();
    await handlers({ synthesize, readAccount: vi.fn(async () => FREE) }).renderSample(req, context);
    expect(req.json).not.toHaveBeenCalled();
    expect(synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ product: 'podcast', dialogue: SAMPLE_DIALOGUE, env: KEY_ENV })
    );
  });

  it('stores the MP3, records a podcast:sample usage row and returns the audio, the billing and the credits', async () => {
    const store = makeStore();
    const storage = makeStorage();
    const after = { ...FREE, creditsUsed: 257, creditsLeft: 9743 };
    const readAccount = vi.fn(async () => after);
    const res = await handlers({
      store,
      storage,
      synthesize: vi.fn(async () => rendered()),
      readAccount,
    }).renderSample(request(), context);

    expect(res.status).toBe(200);
    expect(body(res)).toEqual({
      ok: true,
      audioUrl: `/api/public/media/podcast/sample/elevenlabs-live-check.mp3?v=${NOW.getTime()}`,
      audioError: null,
      contentType: 'audio/mpeg',
      bytes: 4,
      durationSeconds: 16,
      requests: 1,
      model: 'eleven_v3',
      characters: 257,
      charactersBilled: 257,
      billedEstimated: false,
      creditsLeftBefore: 10000,
      creditsLeft: 9743,
      creditLimit: 10000,
      tier: 'free',
      freePlan: true,
      resetAt: '2026-10-26T00:00:00.000Z',
    });

    const [container, path, audio, contentType] = storage.uploadBlob.mock.calls[0];
    expect([container, path, contentType]).toEqual(['podcast', SAMPLE_AUDIO_PATH, 'audio/mpeg']);
    expect(Buffer.isBuffer(audio)).toBe(true);

    const [usageContainer, row] = store.upsertDoc.mock.calls[0];
    expect(usageContainer).toBe(USAGE_CONTAINER);
    expect(row).toMatchObject({
      provider: 'elevenlabs',
      model: 'eleven_v3',
      promptTokens: 0,
      completionTokens: 257,
      source: USAGE_SOURCES.podcastSample,
    });
    expect(USAGE_SOURCES.podcastSample).toBe('podcast:sample');
    // The credits after are a FRESH read, not the cached one the render used.
    expect(readAccount).toHaveBeenCalledWith(expect.objectContaining({ useCache: false }));
  });

  it('never reports the credits as unspent because the fresh read lagged', async () => {
    // ElevenLabs had not yet counted the sample: the read still says 10,000.
    const res = await handlers({
      synthesize: vi.fn(async () => rendered()),
      readAccount: vi.fn(async () => FREE),
    }).renderSample(request(), context);
    expect(body(res).creditsLeft).toBe(10000 - 257);
  });

  it('falls back to before-minus-billed when the fresh read fails', async () => {
    const res = await handlers({
      synthesize: vi.fn(async () => rendered()),
      readAccount: vi.fn(async () => {
        throw new SpeechError('offline');
      }),
    }).renderSample(request(), context);
    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({ creditsLeft: 9743, creditLimit: 10000, tier: 'free' });
  });

  it('reports a pre-flight refusal as 409 with its sentence, storing and recording nothing', async () => {
    const sentence =
      'ElevenLabs has 100 credits left of 10,000, this episode needs 257; the allowance resets on 2026-10-26 (UTC). Nothing was sent, so no credits were spent.';
    const store = makeStore();
    const storage = makeStorage();
    const res = await handlers({
      store,
      storage,
      synthesize: vi.fn(async () => {
        throw Object.assign(new SpeechError(sentence, { provider: 'elevenlabs' }), {
          code: 'quota_exceeded',
        });
      }),
    }).renderSample(request(), context);
    expect(res.status).toBe(409);
    expect(body(res)).toEqual({ error: sentence, code: 'quota_exceeded' });
    expect(storage.uploadBlob).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('maps the other refusals: a paid-only voice 409, a pin 503, an unreadable account 502', async () => {
    const cases = [
      [Object.assign(new SpeechError('paid only'), { code: 'paid_plan_required' }), 409],
      [new SpeechNotConfiguredError('PODCAST_TTS_PROVIDER pins "elevenlabs", which is not configured'), 503],
      [Object.assign(new SpeechError('Could not read the ElevenLabs subscription'), { code: 'subscription_unavailable' }), 502],
      [new SpeechError('ElevenLabs HTTP 500: boom'), 502],
    ];
    for (const [error, status] of cases) {
      const res = await handlers({
        synthesize: vi.fn(async () => {
          throw error;
        }),
      }).renderSample(request(), context);
      expect(res.status).toBe(status);
      expect(body(res).error).toBe(error.message);
    }
  });

  it('still reports the billing, and records it, when the MP3 could not be stored', async () => {
    const store = makeStore();
    const res = await handlers({
      store,
      storage: makeStorage({
        uploadBlob: vi.fn(async () => {
          throw new Error('container missing');
        }),
      }),
      synthesize: vi.fn(async () => rendered()),
      readAccount: vi.fn(async () => FREE),
    }).renderSample(request(), context);
    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({
      ok: true,
      audioUrl: null,
      audioError: expect.stringMatching(/rendered and billed but not stored: container missing/),
      charactersBilled: 257,
    });
    expect(store.upsertDoc).toHaveBeenCalledTimes(1);
  });
});

describe('end to end through the real provider, with fetch mocked', () => {
  it('reads the account, posts the sample once, and reports 257 billed and 9,743 left', async () => {
    let spent = 0;
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).startsWith(SUBSCRIPTION_URL)) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ...FREE_BODY, character_count: spent }),
        };
      }
      const posted = JSON.parse(init.body).inputs.reduce((n, i) => n + [...i.text].length, 0);
      spent += posted;
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => (name === 'character-cost' ? String(posted) : null) },
        arrayBuffer: async () => Uint8Array.from([0xff, 0xfb, 0x90, 0x64]).buffer,
        text: async () => '',
      };
    });
    const storage = makeStorage();
    const res = await handlers({ storage, fetchImpl }).renderSample(request(), context);

    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({
      ok: true,
      charactersBilled: 257,
      billedEstimated: false,
      creditsLeftBefore: 10000,
      creditsLeft: 9743,
      tier: 'free',
      freePlan: true,
    });
    const dialogueCalls = fetchImpl.mock.calls.filter(([url]) => String(url).includes('text-to-dialogue'));
    expect(dialogueCalls).toHaveLength(1);
    const inputs = JSON.parse(dialogueCalls[0][1].body).inputs;
    expect(inputs.map((i) => i.text)).toEqual(SAMPLE_DIALOGUE.map((t) => t.text));
    // The key travelled in the header only, and never came back out.
    expect(dialogueCalls[0][1].headers['xi-api-key']).toBe('xi-test-key');
    expect(res.body).not.toContain('xi-test-key');
  });
});
