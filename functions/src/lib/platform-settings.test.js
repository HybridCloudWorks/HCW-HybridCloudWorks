/**
 * Platform settings — the load-bearing assertions: every stored document is
 * exactly the shape its consumer reads (pinned by running the consumers'
 * own readers over what the normalizer produces), unknown keys are refused
 * rather than dropped, the setting segment is allowlisted, and neither a
 * log line nor an audit row ever carries a document's contents.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  HERO_PROVIDERS,
  MAX_SCHEDULE_DELAY_MINUTES,
  PLATFORM_SETTING_NAMES,
  PlatformSettingValidationError,
  createPlatformSettingsHandlers,
  isAcceptableHeroUrl,
  normalizeDefaultHeroes,
  normalizePodcastFeeds,
  normalizeSocialAutopost,
  presentSetting,
  resolveSetting,
} from './platform-settings.js';
import { pickDefaultHero, DEFAULT_HEROES_CONFIG_ID } from './triggers/ai-cover.js';
import { AUTOPOST_CONFIG_ID } from './triggers/social-caption-trigger.js';
import { PODCAST_FEEDS_CONFIG_ID, resolvePodcastFeeds } from './timers/podcasts.js';
import { ADMIN_CONFIG_PARTITION } from './cosmos-client.js';

const context = { log: vi.fn(), error: vi.fn() };

const allowGuard = {
  requireRole: vi.fn(async () => ({
    user: { oid: 'u1', email: 'owner@example.com' },
    role: 'editor',
    error: null,
  })),
};
const denyGuard = {
  requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })),
};

const makeRequest = ({ params = {}, body } = {}) => ({
  params,
  json: async () => {
    if (body === undefined) throw new SyntaxError('no body');
    return body;
  },
});

function makeStore(over = {}) {
  return {
    readDoc: vi.fn(async () => null),
    upsertDoc: vi.fn(async (_c, d) => d),
    ...over,
  };
}

const fixed = { now: () => new Date('2026-09-07T12:00:00.000Z'), uuid: () => 'fixed-uuid' };
const parse = (res) => JSON.parse(res.body);

const expectRejects = (fn, pattern) => {
  expect(fn).toThrow(PlatformSettingValidationError);
  expect(fn).toThrow(pattern);
};

describe('default heroes', () => {
  it('stores the canonical key for a case-insensitive provider, drops blanks, refuses unknown providers', () => {
    const out = normalizeDefaultHeroes({
      heroes: { azure: '/images/default-heroes/azure.png', AWS: '  ', gcp: '', Multi: '/m.png' },
    });
    expect(out).toEqual({
      heroes: { Azure: '/images/default-heroes/azure.png', Multi: '/m.png' },
    });
    expectRejects(
      () => normalizeDefaultHeroes({ heroes: { Oracle: '/o.png' } }),
      /Unknown hero provider "Oracle"/
    );
    expectRejects(
      () => normalizeDefaultHeroes({ heroes: {}, extra: 1 }),
      /Unknown field\(s\) in body/
    );
    expectRejects(() => normalizeDefaultHeroes({ heroes: [] }), /heroes must be an object/);
    expectRejects(
      () => normalizeDefaultHeroes({ heroes: { Azure: '/a.png', azure: '/b.png' } }),
      /given more than once/
    );
  });

  it('accepts same-origin paths, media routes and https; refuses everything else', () => {
    expect(isAcceptableHeroUrl('/images/default-heroes/azure.png')).toBe(true);
    expect(isAcceptableHeroUrl('/api/public/media/covers/azure.png')).toBe(true);
    expect(isAcceptableHeroUrl('https://cdn.example.com/a.png')).toBe(true);
    expect(isAcceptableHeroUrl('http://cdn.example.com/a.png')).toBe(false);
    expect(isAcceptableHeroUrl('//evil.example.com/a.png')).toBe(false);
    expect(isAcceptableHeroUrl('javascript:alert(1)')).toBe(false);
    expect(isAcceptableHeroUrl('/a b.png')).toBe(false);
    expect(isAcceptableHeroUrl('/a"onerror="x')).toBe(false);
    expect(isAcceptableHeroUrl(`/${'x'.repeat(2048)}`)).toBe(false);
    // A query string or fragment could carry a SAS token or signature, and
    // this value is copied onto published content documents.
    expect(isAcceptableHeroUrl('/api/public/media/covers/a.png?sv=2024&sig=abc')).toBe(false);
    expect(isAcceptableHeroUrl('/images/default-heroes/a.png#x')).toBe(false);
    expect(isAcceptableHeroUrl('https://cdn.example.com/a.png?sig=abc')).toBe(false);
    expect(isAcceptableHeroUrl('https://cdn.example.com/a.png#frag')).toBe(false);
    expectRejects(
      () => normalizeDefaultHeroes({ heroes: { AWS: 'https://cdn.example.com/a.png?sig=abc' } }),
      /no query string or fragment/
    );
    expectRejects(
      () => normalizeDefaultHeroes({ heroes: { Azure: 'http://x/a.png' } }),
      /heroes.Azure must be a same-origin path/
    );
    expectRejects(() => normalizeDefaultHeroes({ heroes: { Azure: 7 } }), /must be a string/);
  });

  it('produces exactly what pickDefaultHero reads', () => {
    const { heroes } = normalizeDefaultHeroes({
      heroes: Object.fromEntries(HERO_PROVIDERS.map((p) => [p, `/images/${p.toLowerCase()}.png`])),
    });
    expect(pickDefaultHero(heroes, 'Google Cloud')).toBe('/images/gcp.png');
    expect(pickDefaultHero(heroes, 'AWS')).toBe('/images/aws.png');
    expect(pickDefaultHero(heroes, 'unknown')).toBe('/images/multi.png');
    expect(pickDefaultHero(normalizeDefaultHeroes({ heroes: {} }).heroes, 'AWS')).toBeNull();
  });
});

describe('social autopost', () => {
  it('normalizes a good body and applies the consumer-facing defaults', () => {
    expect(
      normalizeSocialAutopost({
        enabled: true,
        accountIds: [
          { id: ' acc-1 ', provider: 'LinkedIn' },
          { id: 'acc-1', provider: 'linkedin' },
          { id: 'acc-2', provider: 'twitter' },
        ],
        scheduleDelayMinutes: '90',
      })
    ).toEqual({
      enabled: true,
      accountIds: [
        { id: 'acc-1', provider: 'linkedin' },
        { id: 'acc-2', provider: 'twitter' },
      ],
      scheduleDelayMinutes: 90,
    });
    expect(normalizeSocialAutopost({})).toEqual({
      enabled: false,
      accountIds: [],
      scheduleDelayMinutes: 60,
    });
  });

  it('refuses ambiguous booleans, bad delays, bad accounts and unknown keys', () => {
    expectRejects(
      () => normalizeSocialAutopost({ enabled: 'false' }),
      /enabled must be true or false/
    );
    expectRejects(
      () => normalizeSocialAutopost({ scheduleDelayMinutes: 0 }),
      /whole number from 1/
    );
    expectRejects(
      () => normalizeSocialAutopost({ scheduleDelayMinutes: 1.5 }),
      /whole number from 1/
    );
    expectRejects(
      () => normalizeSocialAutopost({ scheduleDelayMinutes: MAX_SCHEDULE_DELAY_MINUTES + 1 }),
      /whole number from 1/
    );
    expectRejects(
      () => normalizeSocialAutopost({ accountIds: 'x' }),
      /accountIds must be an array/
    );
    expectRejects(
      () => normalizeSocialAutopost({ accountIds: [{ provider: 'linkedin' }] }),
      /id is required/
    );
    expectRejects(
      () => normalizeSocialAutopost({ accountIds: [{ id: 'a', provider: 'myspace' }] }),
      /provider must be one of/
    );
    expectRejects(
      () =>
        normalizeSocialAutopost({ accountIds: [{ id: 'a', provider: 'linkedin', token: 'x' }] }),
      /Unknown field\(s\) in accountIds\[0\]/
    );
    expectRejects(
      () => normalizeSocialAutopost({ enabled: true, accountIds: [] }),
      /at least one account/
    );
    expectRejects(() => normalizeSocialAutopost({ foo: 1 }), /Unknown field\(s\) in body/);
  });
});

describe('podcast feeds', () => {
  it('drops blank rows, keeps rows the timer accepts, refuses the rest', () => {
    expect(
      normalizePodcastFeeds({
        feeds: [
          { provider: 'azure', url: 'https://feeds.example.com/azure.xml' },
          { provider: 'aws', url: '' },
          { provider: 'gcp', url: '   ' },
        ],
      })
    ).toEqual({ feeds: [{ provider: 'azure', url: 'https://feeds.example.com/azure.xml' }] });
    expectRejects(
      () => normalizePodcastFeeds({ feeds: [{ provider: 'azure', url: 'http://x.example/f' }] }),
      /must be an https URL/
    );
    expectRejects(
      () =>
        normalizePodcastFeeds({ feeds: [{ provider: 'Azure Cloud', url: 'https://x.example/f' }] }),
      /lowercase slug/
    );
    expectRejects(
      () =>
        normalizePodcastFeeds({
          feeds: [
            { provider: 'azure', url: 'https://x.example/a' },
            { provider: 'azure', url: 'https://x.example/b' },
          ],
        }),
      /only one feed/
    );
    expectRejects(
      () =>
        normalizePodcastFeeds({
          feeds: [{ provider: 'azure', url: 'https://x.example/f', extra: 1 }],
        }),
      /Unknown field/
    );
    expectRejects(() => normalizePodcastFeeds({ feeds: {} }), /feeds must be an array/);
  });

  it('produces exactly what resolvePodcastFeeds runs', async () => {
    const value = normalizePodcastFeeds({
      feeds: [{ provider: 'finops', url: 'https://x.example/finops.rss' }],
    });
    const store = { readDoc: vi.fn(async () => ({ id: PODCAST_FEEDS_CONFIG_ID, ...value })) };
    await expect(resolvePodcastFeeds(store)).resolves.toEqual({
      feeds: [{ provider: 'finops', url: 'https://x.example/finops.rss' }],
      source: 'admin_config',
    });
  });
});

describe('presentSetting', () => {
  it('names the three settings and nothing else', () => {
    expect(PLATFORM_SETTING_NAMES).toEqual(['default-heroes', 'social-autopost', 'podcast-feeds']);
  });

  it('shows an empty shape for a missing document and a repaired view for an invalid one', () => {
    expect(presentSetting('social-autopost', null)).toEqual({
      value: { enabled: false, accountIds: [], scheduleDelayMinutes: 60 },
      exists: false,
      stored: null,
      updatedAt: null,
    });
    const shown = presentSetting('social-autopost', {
      id: AUTOPOST_CONFIG_ID,
      configScope: ADMIN_CONFIG_PARTITION,
      _rid: 'x',
      _etag: 'y',
      enabled: 'yes',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    expect(shown.stored).toBe('invalid');
    expect(shown.exists).toBe(true);
    expect(shown.value).toEqual({ enabled: false, accountIds: [], scheduleDelayMinutes: 60 });
    expect(shown.problem).toMatch(/enabled must be true or false/);
  });

  it('a hand-seeded document with __proto__ or constructor keys is invalid, and nothing is polluted', () => {
    // An object literal `{ __proto__: … }` would set the prototype rather than
    // an own key; JSON.parse holds it as an ordinary own key, which is exactly
    // how a Cosmos document arrives.
    const poisoned = JSON.parse(
      '{"id":"default_heroes","configScope":"admin_config","heroes":{"Azure":"/a.png"},"__proto__":{"polluted":true}}'
    );
    expect(Object.keys(poisoned)).toContain('__proto__');
    const shown = presentSetting('default-heroes', poisoned);
    expect(shown.stored).toBe('invalid');
    expect(shown.problem).toMatch(/Unknown field\(s\) in body: __proto__/);
    expect(shown.value).toEqual({ heroes: {} });
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();

    const viaConstructor = JSON.parse(
      '{"id":"podcast_feeds","feeds":[],"constructor":{"prototype":{"polluted":true}}}'
    );
    expect(presentSetting('podcast-feeds', viaConstructor)).toMatchObject({
      stored: 'invalid',
      problem: expect.stringMatching(/Unknown field\(s\) in body: constructor/),
    });
    expect({}.polluted).toBeUndefined();
  });

  it('reports a stray underscore key rather than hiding it', () => {
    const shown = presentSetting('podcast-feeds', { id: 'podcast_feeds', feeds: [], _legacy: 1 });
    expect(shown.stored).toBe('invalid');
    expect(shown.problem).toMatch(/Unknown field\(s\) in body: _legacy/);
  });

  it('strips Cosmos system fields and the partition from a valid document', () => {
    const shown = presentSetting('default-heroes', {
      id: DEFAULT_HEROES_CONFIG_ID,
      configScope: ADMIN_CONFIG_PARTITION,
      _rid: 'x',
      _self: 'y',
      _etag: 'z',
      _attachments: 'a',
      _ts: 1,
      heroes: { Azure: '/a.png' },
      updatedAt: '2026-09-01T00:00:00.000Z',
      updatedBy: 'u1',
    });
    expect(shown).toEqual({
      value: { heroes: { Azure: '/a.png' } },
      exists: true,
      stored: 'valid',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
  });
});

describe('handlers', () => {
  it('passes guard denials through with zero store calls', async () => {
    const store = makeStore();
    const h = createPlatformSettingsHandlers({ guard: denyGuard, store, ...fixed });
    const get = await h.getSetting(makeRequest({ params: { setting: 'default-heroes' } }), context);
    const put = await h.putSetting(
      makeRequest({ params: { setting: 'default-heroes' }, body: { heroes: {} } }),
      context
    );
    expect(get.status).toBe(403);
    expect(put.status).toBe(403);
    expect(store.readDoc).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('404s an unknown setting segment before touching the store', async () => {
    const store = makeStore();
    const h = createPlatformSettingsHandlers({ guard: allowGuard, store, ...fixed });
    expect(
      (await h.getSetting(makeRequest({ params: { setting: 'forge-prompts' } }), context)).status
    ).toBe(404);
    expect(
      (await h.putSetting(makeRequest({ params: { setting: '../x' }, body: {} }), context)).status
    ).toBe(404);
    expect(store.readDoc).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('404s inherited-key segments (__proto__, constructor, prototype) with no store call or side effect', async () => {
    // On a plain object PLATFORM_SETTINGS['constructor'] is Object and
    // PLATFORM_SETTINGS['__proto__'] is Object.prototype — both truthy — so a
    // bare bracket lookup would have carried an undefined docId to Cosmos.
    expect(resolveSetting('__proto__')).toBeNull();
    expect(resolveSetting('constructor')).toBeNull();
    expect(resolveSetting('prototype')).toBeNull();
    expect(resolveSetting('default-heroes')).not.toBeNull();

    const store = makeStore();
    const h = createPlatformSettingsHandlers({ guard: allowGuard, store, ...fixed });
    for (const setting of ['__proto__', 'constructor', 'prototype']) {
      const get = await h.getSetting(makeRequest({ params: { setting } }), context);
      expect(get.status, `GET ${setting}`).toBe(404);
      const put = await h.putSetting(
        makeRequest({ params: { setting }, body: { polluted: true } }),
        context
      );
      expect(put.status, `PUT ${setting}`).toBe(404);
      expect(() => presentSetting(setting, { id: 'x' })).toThrow(/Unknown platform setting/);
    }
    expect(store.readDoc).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
    expect(typeof Object.prototype.docId).toBe('undefined');
  });

  it('GET reads the document at the admin_config partition', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({
        id: PODCAST_FEEDS_CONFIG_ID,
        configScope: ADMIN_CONFIG_PARTITION,
        feeds: [{ provider: 'azure', url: 'https://x.example/a' }],
      })),
    });
    const h = createPlatformSettingsHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.getSetting(makeRequest({ params: { setting: 'podcast-feeds' } }), context);
    expect(store.readDoc).toHaveBeenCalledWith(
      'admin_config',
      PODCAST_FEEDS_CONFIG_ID,
      ADMIN_CONFIG_PARTITION
    );
    expect(parse(res)).toEqual({
      success: true,
      setting: 'podcast-feeds',
      value: { feeds: [{ provider: 'azure', url: 'https://x.example/a' }] },
      exists: true,
      stored: 'valid',
      updatedAt: null,
    });
  });

  it('PUT replaces the document with the normalized shape, the partition and provenance, then audits counts only', async () => {
    const store = makeStore();
    const h = createPlatformSettingsHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.putSetting(
      makeRequest({
        params: { setting: 'social-autopost' },
        body: {
          enabled: true,
          accountIds: [{ id: 'acc-secret-looking-id', provider: 'linkedin' }],
          scheduleDelayMinutes: 45,
        },
      }),
      context
    );
    expect(res.status).toBe(200);
    expect(parse(res).value).toEqual({
      enabled: true,
      accountIds: [{ id: 'acc-secret-looking-id', provider: 'linkedin' }],
      scheduleDelayMinutes: 45,
    });

    const [configCall, auditCall] = store.upsertDoc.mock.calls;
    expect(configCall[0]).toBe('admin_config');
    expect(configCall[1]).toEqual({
      id: AUTOPOST_CONFIG_ID,
      configScope: ADMIN_CONFIG_PARTITION,
      enabled: true,
      accountIds: [{ id: 'acc-secret-looking-id', provider: 'linkedin' }],
      scheduleDelayMinutes: 45,
      updatedAt: '2026-09-07T12:00:00.000Z',
      updatedBy: 'u1',
    });

    expect(auditCall[0]).toBe('admin_audit_logs');
    expect(auditCall[1]).toEqual({
      id: 'fixed-uuid',
      action: 'platform_setting_updated',
      userId: 'u1',
      userEmail: 'owner@example.com',
      timestamp: '2026-09-07T12:00:00.000Z',
      details: { setting: 'social-autopost', enabled: true, accounts: 1, scheduleDelayMinutes: 45 },
    });
    expect(JSON.stringify(auditCall[1])).not.toContain('acc-secret-looking-id');
    expect(context.error).not.toHaveBeenCalled();
  });

  it('PUT answers 400 with the validation message and writes nothing', async () => {
    const store = makeStore();
    const h = createPlatformSettingsHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.putSetting(
      makeRequest({
        params: { setting: 'default-heroes' },
        body: { heroes: { Azure: 'ftp://x' } },
      }),
      context
    );
    expect(res.status).toBe(400);
    expect(parse(res).error).toMatch(/heroes.Azure must be/);
    expect(store.upsertDoc).not.toHaveBeenCalled();

    expect(
      (await h.putSetting(makeRequest({ params: { setting: 'default-heroes' } }), context)).status
    ).toBe(400);
    expect(
      (
        await h.putSetting(
          makeRequest({ params: { setting: 'default-heroes' }, body: [] }),
          context
        )
      ).status
    ).toBe(400);
  });

  it('a failed audit row is a warning, not a 500: the setting was saved', async () => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    // The config write (first upsert) succeeds; the audit write (second) fails.
    const store = makeStore({
      upsertDoc: vi.fn(async (container, doc) => {
        if (container === 'admin_audit_logs') throw new Error('audit container throttled');
        return doc;
      }),
    });
    const h = createPlatformSettingsHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.putSetting(
      makeRequest({
        params: { setting: 'podcast-feeds' },
        body: { feeds: [{ provider: 'azure', url: 'https://x.example/private-feed' }] },
      }),
      log
    );
    expect(res.status).toBe(200);
    expect(parse(res)).toMatchObject({
      success: true,
      setting: 'podcast-feeds',
      value: { feeds: [{ provider: 'azure', url: 'https://x.example/private-feed' }] },
      stored: 'valid',
    });
    expect(store.upsertDoc.mock.calls.map(([container]) => container)).toEqual([
      'admin_config',
      'admin_audit_logs',
    ]);
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
    const line = String(log.warn.mock.calls[0][0]);
    expect(line).toContain('"feeds":1');
    expect(line).toContain('audit container throttled');
    expect(line).not.toContain('private-feed');
  });

  it('a failed config write is a 500 whose log line names the setting, not the document', async () => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    // The first upsert is the config document itself; nothing was saved.
    const store = makeStore({
      upsertDoc: vi.fn(async () => {
        throw new Error('cosmos down');
      }),
    });
    const h = createPlatformSettingsHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.putSetting(
      makeRequest({
        params: { setting: 'podcast-feeds' },
        body: { feeds: [{ provider: 'azure', url: 'https://x.example/private-feed' }] },
      }),
      log
    );
    expect(res.status).toBe(500);
    expect(store.upsertDoc).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.error.mock.calls[0])).not.toContain('private-feed');
  });
});
