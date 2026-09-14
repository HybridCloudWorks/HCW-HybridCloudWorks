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
  PLATFORM_SETTINGS,
  PLATFORM_SETTING_NAMES,
  PlatformSettingValidationError,
  createPlatformSettingsHandlers,
  isAcceptableHeroUrl,
  normalizeDefaultHeroes,
  normalizeListenAndLearnSpeech,
  normalizeNewsletterSettings,
  normalizePodcastFeeds,
  normalizeSocialAutopost,
  presentSetting,
  resolveSetting,
} from './platform-settings.js';
import {
  LISTEN_AND_LEARN_SPEECH_CONFIG_ID,
  listenAndLearnModelOptions,
  readStoredListenAndLearnModel,
} from './listen-and-learn/speech-settings.js';
import { pickDefaultHero, DEFAULT_HEROES_CONFIG_ID } from './triggers/ai-cover.js';
import { AUTOPOST_CONFIG_ID } from './triggers/social-caption-trigger.js';
import {
  MAIN_FEED_PROVIDER,
  PODCAST_FEEDS_CONFIG_ID,
  resolvePodcastFeeds,
} from './timers/podcasts.js';
import { ADMIN_CONFIG_PARTITION } from './cosmos-client.js';
import { MAX_ITEMS_PER_SECTION, SECTIONS } from './newsletter/sections.js';

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

  it('keeps the main feed beside the provider rows, and omits it when blank', () => {
    // The compatibility rule this shape exists for: a document stored before
    // the field existed still normalizes, unchanged, and is not reported as
    // drifted.
    expect(
      normalizePodcastFeeds({
        mainFeedUrl: '  https://media.rss.com/hybrid-cloud-insights/feed.xml  ',
        feeds: [{ provider: 'azure', url: 'https://x.example/azure.xml' }],
      })
    ).toEqual({
      mainFeedUrl: 'https://media.rss.com/hybrid-cloud-insights/feed.xml',
      feeds: [{ provider: 'azure', url: 'https://x.example/azure.xml' }],
    });
    expect(normalizePodcastFeeds({ mainFeedUrl: '   ', feeds: [] })).toEqual({ feeds: [] });
    expect(normalizePodcastFeeds({ feeds: [] })).toEqual({ feeds: [] });
    expectRejects(
      () => normalizePodcastFeeds({ mainFeedUrl: 'http://insecure.example/feed.xml' }),
      /mainFeedUrl must be an https URL/
    );
    expectRejects(() => normalizePodcastFeeds({ mainFeedUrl: 7 }), /mainFeedUrl must be a string/);
  });

  it('refuses the two ways one feed could become two shows', () => {
    // `main` as a provider row: two places to say the same thing, one of
    // which the page cannot edit.
    expectRejects(
      () => normalizePodcastFeeds({ feeds: [{ provider: 'main', url: 'https://x.example/f' }] }),
      /reserved/
    );
    // The same URL in both: both ingests build the same episode ids from the
    // same guids, so each run would overwrite the other's `provider` and the
    // episode would flip between the show and a provider every two hours.
    expectRejects(
      () =>
        normalizePodcastFeeds({
          mainFeedUrl: 'https://x.example/f',
          feeds: [{ provider: 'azure', url: 'https://x.example/f' }],
        }),
      /already the main feed/
    );
  });

  it('runs the main feed as an ordinary entry under the reserved provider', async () => {
    const value = normalizePodcastFeeds({
      mainFeedUrl: 'https://media.rss.com/hybrid-cloud-insights/feed.xml',
      feeds: [{ provider: 'finops', url: 'https://x.example/finops.rss' }],
    });
    const store = { readDoc: vi.fn(async () => ({ id: PODCAST_FEEDS_CONFIG_ID, ...value })) };
    await expect(resolvePodcastFeeds(store)).resolves.toEqual({
      feeds: [
        {
          provider: MAIN_FEED_PROVIDER,
          url: 'https://media.rss.com/hybrid-cloud-insights/feed.xml',
        },
        { provider: 'finops', url: 'https://x.example/finops.rss' },
      ],
      source: 'admin_config',
    });
  });
});

describe('listen & learn speech', () => {
  const BEST = 'gemini-3.1-flash-tts-preview';
  const ECONOMY = 'gemini-2.5-flash-preview-tts';

  it('stores exactly one of the two offered Gemini models, matched exactly', () => {
    expect(normalizeListenAndLearnSpeech({ geminiModel: BEST })).toEqual({ geminiModel: BEST });
    expect(normalizeListenAndLearnSpeech({ geminiModel: ECONOMY })).toEqual({ geminiModel: ECONOMY });
    const rule = new RegExp(`geminiModel must be one of ${BEST}, ${ECONOMY}`);
    // The id is sent to a paid API as the model name: no near-misses, no
    // third model, no trimming to a match.
    for (const geminiModel of ['gemini-2.5-pro-preview-tts', 'eleven_v3', ` ${BEST}`, 'best', '']) {
      expectRejects(() => normalizeListenAndLearnSpeech({ geminiModel }), rule);
    }
    expectRejects(() => normalizeListenAndLearnSpeech({}), /geminiModel must be a string/);
    expectRejects(() => normalizeListenAndLearnSpeech({ geminiModel: 7 }), /must be a string/);
    expectRejects(
      () => normalizeListenAndLearnSpeech({ geminiModel: BEST, provider: 'gemini' }),
      /Unknown field\(s\) in body: provider/
    );
  });

  it('produces exactly what the job reads back as the stored default', async () => {
    const { geminiModel } = normalizeListenAndLearnSpeech({ geminiModel: ECONOMY });
    const readDoc = vi.fn(async () => ({
      id: LISTEN_AND_LEARN_SPEECH_CONFIG_ID,
      configScope: ADMIN_CONFIG_PARTITION,
      geminiModel,
    }));
    expect(await readStoredListenAndLearnModel(readDoc)).toBe(ECONOMY);
  });

  it('shows the module default selected when nothing is stored — that is what will run', () => {
    expect(presentSetting('listen-and-learn-speech', null)).toEqual({
      value: { geminiModel: BEST },
      exists: false,
      stored: null,
      updatedAt: null,
    });
  });

  it('GET carries the two choices with their per-episode ceiling beside the value', async () => {
    const store = makeStore();
    const h = createPlatformSettingsHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.getSetting(
      makeRequest({ params: { setting: 'listen-and-learn-speech' } }),
      context
    );
    expect(store.readDoc).toHaveBeenCalledWith(
      'admin_config',
      LISTEN_AND_LEARN_SPEECH_CONFIG_ID,
      ADMIN_CONFIG_PARTITION
    );
    const body = parse(res);
    expect(body.value).toEqual({ geminiModel: BEST });
    expect(body.options).toEqual(listenAndLearnModelOptions());
    expect(body.options.map((o) => [o.id, o.tier])).toEqual([
      [BEST, 'best'],
      [ECONOMY, 'economy'],
    ]);
    expect(body.options[0].label).toBe('Best — newest voice, about twice the cost');
    expect(body.options[1].label).toBe('Economy — cheaper');
    expect(body.options[0].perEpisodeUsd).toBeGreaterThan(0);
    expect(body.options[1].perEpisodeUsd).toBeCloseTo(body.options[0].perEpisodeUsd / 2, 6);
    // The other settings offer nothing to choose from, and say nothing.
    const feeds = await h.getSetting(makeRequest({ params: { setting: 'podcast-feeds' } }), context);
    expect(parse(feeds)).not.toHaveProperty('options');
  });

  it('PUT stores the choice, answers with the options, and audits the model id', async () => {
    const store = makeStore();
    const h = createPlatformSettingsHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.putSetting(
      makeRequest({ params: { setting: 'listen-and-learn-speech' }, body: { geminiModel: ECONOMY } }),
      context
    );
    expect(res.status).toBe(200);
    expect(parse(res)).toMatchObject({
      value: { geminiModel: ECONOMY },
      stored: 'valid',
      options: listenAndLearnModelOptions(),
    });
    const [configCall, auditCall] = store.upsertDoc.mock.calls;
    expect(configCall[1]).toEqual({
      id: LISTEN_AND_LEARN_SPEECH_CONFIG_ID,
      configScope: ADMIN_CONFIG_PARTITION,
      geminiModel: ECONOMY,
      updatedAt: '2026-09-07T12:00:00.000Z',
      updatedBy: 'u1',
    });
    expect(auditCall[1].details).toEqual({
      setting: 'listen-and-learn-speech',
      geminiModel: ECONOMY,
    });
  });

  it('PUT answers 400 for any other model id and writes nothing', async () => {
    const store = makeStore();
    const h = createPlatformSettingsHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.putSetting(
      makeRequest({
        params: { setting: 'listen-and-learn-speech' },
        body: { geminiModel: 'gemini-2.5-pro-preview-tts' },
      }),
      context
    );
    expect(res.status).toBe(400);
    expect(parse(res).error).toBe(`geminiModel must be one of ${BEST}, ${ECONOMY}`);
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });
});

describe('newsletter settings', () => {
  const DEFAULT_CONTENT = {
    sections: [
      { id: 'articles', enabled: true, maxItems: 12 },
      { id: 'certification-news', enabled: true, maxItems: 12 },
      { id: 'episodes', enabled: true, maxItems: 12 },
    ],
    windowDays: 7,
    introEnabled: true,
    introTone: 'professional',
  };

  const DEFAULT_SIGNUP = {
    signupPlacement: 'both',
    signupHeading: 'Stay ahead of the cloud curve.',
    signupBlurb:
      'Practical hybrid & multi-cloud insights, straight to your inbox. No spam — unsubscribe anytime.',
    // The built-in design (#557): no Resend template chosen.
    templateId: '',
  };

  it('defaults to Tuesday 09:00 Central with nothing personal filled in, and every section', () => {
    expect(normalizeNewsletterSettings({})).toEqual({
      postalAddress: '',
      replyTo: '',
      sendDay: 'tuesday',
      sendTime: '09:00',
      timeZone: 'America/Chicago',
      ...DEFAULT_CONTENT,
      ...DEFAULT_SIGNUP,
    });
  });

  it('defaults the content to every registered section in registry order at the builder limit', () => {
    expect(DEFAULT_CONTENT.sections.map((s) => s.id)).toEqual(SECTIONS.map((s) => s.id));
    expect(DEFAULT_CONTENT.sections.every((s) => s.maxItems === MAX_ITEMS_PER_SECTION)).toBe(true);
  });

  it('reads a document saved before the content fields existed as the defaults, with no migration', () => {
    const legacy = {
      id: 'newsletter_settings',
      configScope: ADMIN_CONFIG_PARTITION,
      postalAddress: 'PO Box 1',
      replyTo: 'owner@example.com',
      sendDay: 'thursday',
      sendTime: '07:30',
      timeZone: 'Europe/London',
      updatedAt: '2026-09-01T00:00:00Z',
    };
    const shown = presentSetting('newsletter-settings', legacy);
    expect(shown.stored).toBe('valid');
    expect(shown.value).toMatchObject(DEFAULT_CONTENT);
    expect(shown.value).toMatchObject(DEFAULT_SIGNUP);
    expect(shown.value.postalAddress).toBe('PO Box 1');
  });

  it('keeps a saved order, on/off and item counts', () => {
    const value = normalizeNewsletterSettings({
      sections: [
        { id: 'episodes', enabled: true, maxItems: 3 },
        { id: 'articles', enabled: false, maxItems: 5 },
        { id: 'certification-news', enabled: true, maxItems: 20 },
      ],
      windowDays: 14,
      introEnabled: false,
      introTone: 'concise',
    });
    expect(value).toMatchObject({
      sections: [
        { id: 'episodes', enabled: true, maxItems: 3 },
        { id: 'articles', enabled: false, maxItems: 5 },
        { id: 'certification-news', enabled: true, maxItems: 20 },
      ],
      windowDays: 14,
      introEnabled: false,
      introTone: 'concise',
    });
  });

  it('drops unknown and repeated section ids, and appends missing ones enabled at the default', () => {
    expect(
      normalizeNewsletterSettings({
        sections: [
          { id: 'retired-section', enabled: true, maxItems: 4 },
          { id: 'episodes', enabled: false, maxItems: 2 },
          { id: 'episodes', enabled: true, maxItems: 9 },
          { id: 'articles', enabled: true, maxItems: 6 },
        ],
      }).sections
    ).toEqual([
      { id: 'episodes', enabled: false, maxItems: 2 },
      { id: 'articles', enabled: true, maxItems: 6 },
      { id: 'certification-news', enabled: true, maxItems: 12 },
    ]);
  });

  it('drops a retired section row before validating it, so its extra keys never invalidate the document', () => {
    expect(
      normalizeNewsletterSettings({
        sections: [
          { id: 'retired-section', enabled: null, maxItems: 'lots', legacyFlag: true },
          { id: 'articles', enabled: true, maxItems: 5 },
          { id: 'articles', enabled: 'yes', extra: 1 },
        ],
      }).sections
    ).toEqual([
      { id: 'articles', enabled: true, maxItems: 5 },
      { id: 'certification-news', enabled: true, maxItems: 12 },
      { id: 'episodes', enabled: true, maxItems: 12 },
    ]);
  });

  it('refuses enabled: null on a known section rather than treating it as on', () => {
    expect(() =>
      normalizeNewsletterSettings({ sections: [{ id: 'articles', enabled: null, maxItems: 5 }] })
    ).toThrow(/enabled must be true or false/);
  });

  it('clamps item counts to 1..20 and the window to 1..31', () => {
    const value = normalizeNewsletterSettings({
      sections: [
        { id: 'articles', enabled: true, maxItems: 0 },
        { id: 'certification-news', enabled: true, maxItems: 99 },
        { id: 'episodes', enabled: true, maxItems: '7.8' },
      ],
      windowDays: 400,
    });
    expect(value.sections.map((s) => s.maxItems)).toEqual([1, 20, 7]);
    expect(value.windowDays).toBe(31);
    expect(normalizeNewsletterSettings({ windowDays: -3 }).windowDays).toBe(1);
    expect(normalizeNewsletterSettings({ windowDays: '10' }).windowDays).toBe(10);
  });

  it('requires at least one section to be on, counting the appended ones', () => {
    expect(() =>
      normalizeNewsletterSettings({
        sections: [
          { id: 'articles', enabled: false },
          { id: 'certification-news', enabled: false },
          { id: 'episodes', enabled: false },
        ],
      })
    ).toThrow(/at least one section/);
    // A list naming only one section, turned off, still has the other two appended on.
    expect(
      normalizeNewsletterSettings({ sections: [{ id: 'articles', enabled: false }] }).sections.filter(
        (s) => s.enabled
      )
    ).toHaveLength(2);
  });

  it('refuses content values that cannot be read', () => {
    for (const bad of [
      { sections: 'articles' },
      { sections: [{ id: 'articles', enabled: 'yes' }] },
      { sections: [{ id: 'articles', maxItems: 'lots' }] },
      { sections: [{ id: 'articles', colour: 'red' }] },
      { sections: [{ id: 7 }] },
      { windowDays: 'a week' },
      { introEnabled: 'false' },
      { introTone: 'sarcastic' },
    ]) {
      expect(() => normalizeNewsletterSettings(bad), JSON.stringify(bad)).toThrow(
        PlatformSettingValidationError
      );
    }
  });

  it('accepts exactly the offered tones', () => {
    for (const tone of ['professional', 'friendly', 'concise', 'enthusiastic']) {
      expect(normalizeNewsletterSettings({ introTone: tone }).introTone).toBe(tone);
    }
    expect(() => normalizeNewsletterSettings({ introTone: 'Professional' })).toThrow(/introTone/);
  });

  it('offers the section titles, tones and bounds beside the value', () => {
    expect(PLATFORM_SETTINGS['newsletter-settings'].options()).toEqual({
      sections: SECTIONS.map((s) => ({ id: s.id, title: s.title })),
      introTones: ['professional', 'friendly', 'concise', 'enthusiastic'],
      windowDays: { min: 1, max: 31 },
      maxItems: { min: 1, max: 20 },
      signupPlacements: ['footer', 'blogEnd', 'both', 'none'],
      signupHeading: { maxLength: 80 },
      signupBlurb: { maxLength: 240 },
    });
  });

  describe('template', () => {
    it('defaults to the built-in design, including for a document saved before the field existed', () => {
      expect(normalizeNewsletterSettings({}).templateId).toBe('');
      const legacy = { id: 'newsletter_settings', postalAddress: 'PO Box 1', signupPlacement: 'footer' };
      const shown = presentSetting('newsletter-settings', legacy);
      expect(shown.stored).toBe('valid');
      expect(shown.value.templateId).toBe('');
    });

    it('keeps a Resend template id, trimmed, and an explicit empty string', () => {
      expect(normalizeNewsletterSettings({ templateId: ' 34a080c9-b17d-4187-ad80-5af20266e535 ' }).templateId).toBe(
        '34a080c9-b17d-4187-ad80-5af20266e535'
      );
      expect(normalizeNewsletterSettings({ templateId: 'x'.repeat(64) }).templateId).toBe('x'.repeat(64));
      expect(normalizeNewsletterSettings({ templateId: '   ' }).templateId).toBe('');
    });

    it('refuses anything that is not an id or not a string', () => {
      for (const bad of ['a/b', '../templates', 'a.b', 'a b', 'x'.repeat(65), 'id?x=1']) {
        expectRejects(() => normalizeNewsletterSettings({ templateId: bad }), /templateId must be empty/);
      }
      expectRejects(() => normalizeNewsletterSettings({ templateId: 7 }), /templateId must be a string/);
      expectRejects(() => normalizeNewsletterSettings({ templateId: null }), /templateId must be a string/);
    });
  });

  describe('signup form', () => {
    it('defaults to the box in both places with the wording the site carried before', () => {
      expect(normalizeNewsletterSettings({})).toMatchObject(DEFAULT_SIGNUP);
    });

    it('keeps each placement it offers', () => {
      for (const placement of ['footer', 'blogEnd', 'both', 'none']) {
        expect(normalizeNewsletterSettings({ signupPlacement: placement }).signupPlacement).toBe(
          placement
        );
      }
    });

    it('refuses a placement it does not offer, by name, before reading the wording', () => {
      for (const bad of ['Footer', 'sidebar', '', null, 1, ['footer']]) {
        expectRejects(
          () =>
            normalizeNewsletterSettings({ signupPlacement: bad, signupHeading: 42, signupBlurb: {} }),
          /signupPlacement must be one of footer, blogEnd, both, none/
        );
      }
    });

    it('trims the heading and blurb and folds line breaks and runs of spaces into one space', () => {
      const value = normalizeNewsletterSettings({
        signupHeading: '  Get the\r\nweekly   brief  ',
        signupBlurb: '\tOne email.\n\nEvery Tuesday. \u0007',
      });
      expect(value.signupHeading).toBe('Get the weekly brief');
      expect(value.signupBlurb).toBe('One email. Every Tuesday.');
    });

    it('keeps markup as the literal text it is', () => {
      expect(normalizeNewsletterSettings({ signupHeading: '<b>Bold</b> & more' }).signupHeading).toBe(
        '<b>Bold</b> & more'
      );
    });

    it('accepts the heading at 80 characters and the blurb at 240, measured after trimming', () => {
      const value = normalizeNewsletterSettings({
        signupHeading: ` ${'h'.repeat(80)} `,
        signupBlurb: ` ${'b'.repeat(240)} `,
      });
      expect(value.signupHeading).toHaveLength(80);
      expect(value.signupBlurb).toHaveLength(240);
    });

    it('refuses a heading over 80 characters or a blurb over 240', () => {
      expectRejects(
        () => normalizeNewsletterSettings({ signupHeading: 'h'.repeat(81) }),
        /signupHeading must be at most 80 characters/
      );
      expectRejects(
        () => normalizeNewsletterSettings({ signupBlurb: 'b'.repeat(241) }),
        /signupBlurb must be at most 240 characters/
      );
    });

    it('refuses a blank heading but allows a blank blurb', () => {
      expectRejects(() => normalizeNewsletterSettings({ signupHeading: '  \n ' }), /must not be blank/);
      expect(normalizeNewsletterSettings({ signupBlurb: '   ' }).signupBlurb).toBe('');
    });

    it('refuses wording that is not a string', () => {
      expectRejects(() => normalizeNewsletterSettings({ signupHeading: 7 }), /signupHeading must be a string/);
      expectRejects(() => normalizeNewsletterSettings({ signupBlurb: null }), /signupBlurb must be a string/);
    });
  });

  it('keeps a multi-line postal address and a real reply-to', () => {
    expect(
      normalizeNewsletterSettings({
        postalAddress: ' PO Box 1\r\nAustin, TX 78701 ',
        replyTo: 'owner@example.com',
        sendDay: 'thursday',
        sendTime: '07:30',
        timeZone: 'Europe/London',
      })
    ).toEqual({
      postalAddress: 'PO Box 1\nAustin, TX 78701',
      replyTo: 'owner@example.com',
      sendDay: 'thursday',
      sendTime: '07:30',
      timeZone: 'Europe/London',
      ...DEFAULT_CONTENT,
      ...DEFAULT_SIGNUP,
    });
  });

  it('refuses a reply-to on the sending subdomain, which receives no mail', () => {
    expect(() => normalizeNewsletterSettings({ replyTo: 'hello@news.hybridcloudworks.com' })).toThrow(
      /does not/
    );
  });

  it('refuses what cannot describe a send', () => {
    for (const bad of [
      { replyTo: 'not an address' },
      { sendDay: 'someday' },
      { sendTime: '9am' },
      { timeZone: 'Central' },
      { postalAddress: 'x'.repeat(301) },
      { unexpected: true },
    ]) {
      expect(() => normalizeNewsletterSettings(bad), JSON.stringify(bad)).toThrow(PlatformSettingValidationError);
    }
  });
});

describe('presentSetting', () => {
  it('names the five settings and nothing else', () => {
    expect(PLATFORM_SETTING_NAMES).toEqual([
      'default-heroes',
      'social-autopost',
      'podcast-feeds',
      'listen-and-learn-speech',
      'newsletter-settings',
    ]);
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

  it('selects the saved newsletter template in the template cache, so a different one shows on the next preview', async () => {
    const templateCache = { select: vi.fn() };
    const h = createPlatformSettingsHandlers({ guard: allowGuard, store: makeStore(), ...fixed, templateCache });
    const put = await h.putSetting(
      makeRequest({ params: { setting: 'newsletter-settings' }, body: { templateId: 'tpl-1' } }),
      context
    );
    expect(put.status).toBe(200);
    expect(templateCache.select).toHaveBeenCalledWith('tpl-1');
    await h.putSetting(makeRequest({ params: { setting: 'podcast-feeds' }, body: { feeds: [] } }), context);
    expect(templateCache.select).toHaveBeenCalledTimes(1);
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
