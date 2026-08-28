/**
 * Forge Studio (Blog Machine T-604): the whitelist is the contract — an
 * update stores only known fields, values pass through the pipeline's own
 * normalizers, and the calibration job writes suggestions and nothing else.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createForgeStudioHandlers,
  runVoiceCalibration,
  normalizeSuggestions,
  MAX_WORD_SOUP_CHARS,
} from './forge-studio.js';
import { DEFAULT_MASTER_PROMPT } from './forge-config.js';

const okGuard = (user = { oid: 'o1', email: 'owner@hcw' }) => ({
  requireRole: vi.fn(async () => ({ user, role: 'editor', error: null })),
});

const request = (body) => ({ json: async () => body });

function makeStore(docs = {}) {
  const state = { ...docs };
  return {
    state,
    readDoc: vi.fn(async (container, id) => state[`${container}/${id}`] || null),
    upsertDoc: vi.fn(async (container, doc) => {
      state[`${container}/${doc.id}`] = doc;
      return doc;
    }),
  };
}

describe('getForgeConfig', () => {
  it('refuses without the editor role', async () => {
    const guard = { requireRole: vi.fn(async () => ({ error: { status: 403 } })) };
    const { getForgeConfig } = createForgeStudioHandlers({ guard, store: makeStore() });
    const res = await getForgeConfig(request({}));
    expect(res).toEqual({ status: 403 });
  });

  it('returns normalized defaults when the documents are missing', async () => {
    const { getForgeConfig } = createForgeStudioHandlers({ guard: okGuard(), store: makeStore() });
    const res = await getForgeConfig(request({}));
    const body = JSON.parse(res.body);
    expect(res.status).toBe(200);
    expect(body.prompts.masterPrompt).toBe(DEFAULT_MASTER_PROMPT);
    expect(body.prompts.publishThreshold).toBe(80);
    expect(body.profile.interestAreas.length).toBeGreaterThan(0);
    expect(body.formats.map((f) => f.key)).toContain('comparison');
    expect(body.stats).toMatchObject({ totals: {}, formats: {} });
  });
});

describe('updateForgeConfig', () => {
  it('stores whitelisted fields, drops unknown ones, and audits', async () => {
    const store = makeStore();
    const { updateForgeConfig } = createForgeStudioHandlers({
      guard: okGuard(),
      store,
      now: () => new Date('2026-08-28T00:00:00Z'),
      uuid: () => 'audit-1',
    });
    const res = await updateForgeConfig(
      request({
        profile: { wordSoup: 'I build hybrid clouds.', hacker: 'field', Live: true },
        prompts: { publishThreshold: 85, evil: 'x' },
      })
    );
    expect(res.status).toBe(200);

    const profile = store.state['admin_config/forge_profile'];
    expect(profile.wordSoup).toBe('I build hybrid clouds.');
    expect(profile.configScope).toBe('admin_config');
    expect(profile).not.toHaveProperty('hacker');
    expect(profile).not.toHaveProperty('Live');

    const prompts = store.state['admin_config/forge_prompts'];
    expect(prompts.publishThreshold).toBe(85);
    expect(prompts.version).toBe(1);
    expect(prompts).not.toHaveProperty('evil');

    const auditRow = store.state['admin_audit_logs/audit-1'];
    expect(auditRow).toMatchObject({
      action: 'forge_config_updated',
      userEmail: 'owner@hcw',
      details: { profile: ['wordSoup'], prompts: ['publishThreshold'] },
    });
  });

  it('runs values through the pipeline normalizers (clamps, list cleaning)', async () => {
    const store = makeStore();
    const { updateForgeConfig } = createForgeStudioHandlers({ guard: okGuard(), store });
    await updateForgeConfig(
      request({
        prompts: {
          publishThreshold: 250,
          autoForge: { enabled: true, dailyLimit: 99 },
          extraBannedPhrases: [' delve ', '', 'in this article'],
        },
      })
    );
    const prompts = store.state['admin_config/forge_prompts'];
    expect(prompts.publishThreshold).toBe(100);
    expect(prompts.autoForge).toEqual({ enabled: true, dailyLimit: 10 });
    expect(prompts.extraBannedPhrases).toEqual(['delve', 'in this article']);
  });

  it('caps wordSoup and preserves existing suggestions unless told otherwise', async () => {
    const store = makeStore({
      'admin_config/forge_profile': {
        id: 'forge_profile',
        wordSoup: 'old',
        suggestions: { wordSoupAdditions: ['keep me'] },
      },
    });
    const { updateForgeConfig } = createForgeStudioHandlers({ guard: okGuard(), store });
    await updateForgeConfig(request({ profile: { wordSoup: 'x'.repeat(MAX_WORD_SOUP_CHARS + 50) } }));
    const profile = store.state['admin_config/forge_profile'];
    expect(profile.wordSoup).toHaveLength(MAX_WORD_SOUP_CHARS);
    expect(profile.suggestions.wordSoupAdditions).toEqual(['keep me']);
  });

  it('clears suggestions on request, and version keeps counting', async () => {
    const store = makeStore({
      'admin_config/forge_profile': { id: 'forge_profile', suggestions: { styleHints: ['h'] } },
      'admin_config/forge_prompts': { id: 'forge_prompts', version: 4 },
    });
    const { updateForgeConfig } = createForgeStudioHandlers({ guard: okGuard(), store });
    await updateForgeConfig(
      request({ profile: { wordSoup: 'w' }, prompts: { masterPrompt: 'MP' }, clearSuggestions: true })
    );
    expect(store.state['admin_config/forge_profile'].suggestions).toBeNull();
    expect(store.state['admin_config/forge_prompts'].version).toBe(5);
    expect(store.state['admin_config/forge_prompts'].masterPrompt).toBe('MP');
  });

  it('rejects an empty body without writing', async () => {
    const store = makeStore();
    const { updateForgeConfig } = createForgeStudioHandlers({ guard: okGuard(), store });
    const res = await updateForgeConfig(request({}));
    expect(res.status).toBe(400);
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('clears the pipeline config cache after a write', async () => {
    const config = { clearForgeConfigCache: vi.fn() };
    const { updateForgeConfig } = createForgeStudioHandlers({
      guard: okGuard(),
      store: makeStore(),
      config,
    });
    await updateForgeConfig(request({ prompts: { publishThreshold: 82 } }));
    expect(config.clearForgeConfigCache).toHaveBeenCalled();
  });
});

describe('runVoiceCalibration', () => {
  const posts = [
    { Title: 'A', content: 'Body A '.repeat(20) },
    { Title: 'B', blogDraft: 'Body B '.repeat(20) },
  ];

  it('suggests from published posts and writes ONLY suggestions onto the profile', async () => {
    const store = makeStore({
      'admin_config/forge_profile': { id: 'forge_profile', wordSoup: 'HANDS OFF' },
    });
    store.queryDocs = vi.fn(async () => posts);
    const ai = {
      generateJsonResponse: vi.fn(async () => ({
        wordSoupAdditions: ['Runs a homelab'],
        styleHints: ['Short sentences'],
        recurringPhrases: ['blast radius'],
      })),
    };
    const out = await runVoiceCalibration(
      { postCount: 5 },
      { store, ai, now: () => new Date('2026-08-28T00:00:00Z') }
    );
    expect(out.wordSoupAdditions).toEqual(['Runs a homelab']);
    expect(ai.generateJsonResponse).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'voiceCalibration', purpose: 'analysis' })
    );
    const profile = store.state['admin_config/forge_profile'];
    // The invariant the design hangs on: the job never touches the voice itself.
    expect(profile.wordSoup).toBe('HANDS OFF');
    expect(profile.suggestions.wordSoupAdditions).toEqual(['Runs a homelab']);
    expect(profile.suggestions.postCount).toBe(2);
    expect(profile.configScope).toBe('admin_config');
  });

  it('fails loudly when there is nothing published to learn from', async () => {
    const store = makeStore();
    store.queryDocs = vi.fn(async () => []);
    await expect(
      runVoiceCalibration({}, { store, ai: { generateJsonResponse: vi.fn() } })
    ).rejects.toThrow(/No published posts/);
  });
});

describe('normalizeSuggestions', () => {
  it('caps counts and lengths and drops empties', () => {
    const out = normalizeSuggestions({
      wordSoupAdditions: Array.from({ length: 30 }, (_, i) => ` s${i} `),
      styleHints: ['', null, 'x'.repeat(500)],
      recurringPhrases: 'not-an-array',
    });
    expect(out.wordSoupAdditions).toHaveLength(20);
    expect(out.wordSoupAdditions[0]).toBe('s0');
    expect(out.styleHints).toEqual(['x'.repeat(300)]);
    expect(out.recurringPhrases).toEqual([]);
  });
});
