/**
 * platform-settings.js — the Admin → Platform settings page's read and write
 * of three `admin_config` documents that until now could only be seeded by an
 * operator holding a Cosmos data-plane role (#351, #352, and the feed list
 * from #348/#349):
 *
 *   default-heroes  → admin_config/default_heroes   read by triggers/ai-cover.js
 *   social-autopost → admin_config/social_autopost  read by triggers/social-caption-trigger.js
 *   podcast-feeds   → admin_config/podcast_feeds    read by timers/podcasts.js
 *
 * Every write is normalized to EXACTLY the shape its consumer reads — the
 * whole point of a screen over a hand-seeded document is that the shape can
 * no longer drift from the code that reads it. Unknown keys are refused, not
 * dropped, so a typo in a hand-made request is a 400 rather than a document
 * that silently governs nothing. The podcast rows are validated with the
 * timer's own `isValidFeedEntry`, so a row this module accepts is a row the
 * timer will fetch.
 *
 * The write is a full replace (`upsertDoc`): each document is owned entirely
 * by this page, so replacing it is also how a drifted document gets repaired.
 * Nothing here logs document contents; the audit row carries counts only.
 */
import { ADMIN_CONFIG_PARTITION } from './cosmos-client.js';
import { DEFAULT_HEROES_CONFIG_ID } from './triggers/ai-cover.js';
import { AUTOPOST_CONFIG_ID } from './triggers/social-caption-trigger.js';
import {
  MAIN_FEED_PROVIDER,
  PODCAST_FEEDS_CONFIG_ID,
  dedupeFeedsByProvider,
  isValidFeedEntry,
} from './timers/podcasts.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const MAX_BODY_JSON = 60_000;

/** Thrown by a normalizer; the handler turns it into a 400 with the message. */
export class PlatformSettingValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlatformSettingValidationError';
  }
}

const fail = (message) => {
  throw new PlatformSettingValidationError(message);
};

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Refuse keys outside `allowed` — an allowlisted shape, not a filtered one. */
function assertOnlyKeys(object, allowed, where) {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    fail(`Unknown field(s) in ${where}: ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}`);
  }
}

// ── default heroes ─────────────────────────────────────────────────────────

/**
 * The provider keys ai-cover.js's PROVIDER_STYLES knows, in the casing the
 * hand-seeded document used. `pickDefaultHero` matches case-insensitively and
 * maps Google → GCP, so these are the canonical spellings, not a constraint
 * on the lookup.
 */
export const HERO_PROVIDERS = Object.freeze([
  'Azure',
  'AWS',
  'GCP',
  'GitHub',
  'Terraform',
  'Ansible',
  'VMware',
  'Multi',
]);

const MAX_URL_LENGTH = 2048;

/**
 * A hero URL: a same-origin path (`/images/…`, `/api/public/media/…`) or an
 * https URL. `//host/path` is protocol-relative — an off-origin reference in
 * a path's clothing — and is refused with the rest. No query string or
 * fragment on either form: this value is copied onto content documents and
 * served publicly (ai-cover.js writes it to `altCoverImage` and
 * `contentImageUrl`), so a SAS token or signature in a `?` would be
 * published with the post.
 */
export function isAcceptableHeroUrl(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  if (/[\s<>"'`\\?#]/.test(value)) return false;
  if (value.startsWith('/')) return !value.startsWith('//');
  return /^https:\/\/[^/]+/.test(value);
}

/**
 * `{ heroes: { <Provider>: url } }` → the document body ai-cover.js reads.
 * Keys are matched case-insensitively to HERO_PROVIDERS and stored under the
 * canonical spelling; a blank value means "no default for this provider" and
 * the key is omitted, which is what `pickDefaultHero` treats as no fallback.
 */
export function normalizeDefaultHeroes(body) {
  if (!isPlainObject(body)) fail('Body must be a JSON object');
  assertOnlyKeys(body, ['heroes'], 'body');
  const heroes = body.heroes ?? {};
  if (!isPlainObject(heroes)) fail('heroes must be an object keyed by provider');

  const out = {};
  for (const [rawKey, rawValue] of Object.entries(heroes)) {
    const canonical = HERO_PROVIDERS.find((p) => p.toLowerCase() === String(rawKey).toLowerCase());
    if (!canonical) {
      fail(`Unknown hero provider "${rawKey}". Allowed: ${HERO_PROVIDERS.join(', ')}`);
    }
    if (rawValue === null || rawValue === undefined) continue;
    if (typeof rawValue !== 'string') fail(`heroes.${canonical} must be a string`);
    const value = rawValue.trim();
    if (value === '') continue;
    if (!isAcceptableHeroUrl(value)) {
      fail(
        `heroes.${canonical} must be a same-origin path (/images/… or /api/public/media/…) or an https URL, with no query string or fragment`
      );
    }
    if (canonical in out) fail(`heroes.${canonical} given more than once`);
    out[canonical] = value;
  }
  return { heroes: out };
}

// ── social autopost ────────────────────────────────────────────────────────

/** The networks the Social Hub composes to (SocialHubPage PLATFORM_META). */
export const SOCIAL_PROVIDERS = Object.freeze([
  'linkedin',
  'twitter',
  'facebook',
  'instagram',
  'youtube',
]);

export const DEFAULT_SCHEDULE_DELAY_MINUTES = 60;
/** One week. Anything longer is a scheduling mistake, not an undo window. */
export const MAX_SCHEDULE_DELAY_MINUTES = 7 * 24 * 60;
const MAX_ACCOUNTS = 20;
const MAX_ACCOUNT_ID_LENGTH = 200;

/**
 * `{ enabled, accountIds: [{ id, provider }], scheduleDelayMinutes }` → the
 * document social-caption-trigger.js reads. `enabled` must be a real boolean
 * (the consumer tests truthiness, so "false" would read as ON); the delay is
 * a whole number of minutes from 1 to a week (the consumer treats 0 as
 * "use the default", which is not something a form should be able to say by
 * accident); accounts are deduplicated by id.
 */
export function normalizeSocialAutopost(body) {
  if (!isPlainObject(body)) fail('Body must be a JSON object');
  assertOnlyKeys(body, ['enabled', 'accountIds', 'scheduleDelayMinutes'], 'body');

  const enabled = body.enabled ?? false;
  if (typeof enabled !== 'boolean') fail('enabled must be true or false');

  const delayRaw = body.scheduleDelayMinutes ?? DEFAULT_SCHEDULE_DELAY_MINUTES;
  const delay =
    typeof delayRaw === 'string' && delayRaw.trim() !== '' ? Number(delayRaw) : delayRaw;
  if (!Number.isInteger(delay) || delay < 1 || delay > MAX_SCHEDULE_DELAY_MINUTES) {
    fail(`scheduleDelayMinutes must be a whole number from 1 to ${MAX_SCHEDULE_DELAY_MINUTES}`);
  }

  const accountsRaw = body.accountIds ?? [];
  if (!Array.isArray(accountsRaw)) fail('accountIds must be an array of { id, provider }');
  if (accountsRaw.length > MAX_ACCOUNTS)
    fail(`accountIds may hold at most ${MAX_ACCOUNTS} entries`);

  const seen = new Set();
  const accountIds = [];
  accountsRaw.forEach((entry, index) => {
    if (!isPlainObject(entry)) fail(`accountIds[${index}] must be an object`);
    assertOnlyKeys(entry, ['id', 'provider'], `accountIds[${index}]`);
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (id === '') fail(`accountIds[${index}].id is required`);
    if (id.length > MAX_ACCOUNT_ID_LENGTH || /[\s]/.test(id)) {
      fail(`accountIds[${index}].id is not a valid account id`);
    }
    const provider = String(entry.provider ?? '')
      .trim()
      .toLowerCase();
    if (!SOCIAL_PROVIDERS.includes(provider)) {
      fail(`accountIds[${index}].provider must be one of ${SOCIAL_PROVIDERS.join(', ')}`);
    }
    if (seen.has(id)) return;
    seen.add(id);
    accountIds.push({ id, provider });
  });

  if (enabled && accountIds.length === 0) {
    fail('Add at least one account before enabling autoposting');
  }

  return { enabled, accountIds, scheduleDelayMinutes: delay };
}

// ── podcast feeds ──────────────────────────────────────────────────────────

/** The rows the page always shows; the document may carry others. */
export const PODCAST_PROVIDERS = Object.freeze([
  'azure',
  'aws',
  'gcp',
  'github',
  'terraform',
  'finops',
  'vmware',
  'ansible',
]);

const MAX_FEEDS = 50;

/**
 * `{ mainFeedUrl, feeds: [{ provider, url }] }` → the document
 * timers/podcasts.js reads.
 *
 * `mainFeedUrl` is the site's own show — one feed that belongs to the site
 * rather than to a provider, ingested under the reserved provider `main` and
 * shown on every provider's audio page. Blank means the site has no show yet
 * and the key is omitted, which is what `resolveMainFeedEntry` treats as none.
 *
 * A `feeds` row with a blank URL means "no feed for this provider" and is
 * dropped. Every kept row passes the timer's own `isValidFeedEntry` (lowercase
 * slug provider, https URL) and the list is deduplicated the way the timer
 * would dedupe it, so what is stored is exactly what will run.
 *
 * Two rules exist only because the main feed does:
 *
 *   - `main` is not accepted as a provider row. There is one way to name the
 *     site's show, so the page cannot write a document that says it twice.
 *   - No provider row may repeat the main feed's URL. Both ingests would build
 *     the same episode ids from the same guids and each run would overwrite
 *     the other's `provider`, so the same episode would flip between the show
 *     and a provider from one firing to the next — a duplicate that never
 *     appears as two rows, only as a page that changes under the reader.
 */
export function normalizePodcastFeeds(body) {
  if (!isPlainObject(body)) fail('Body must be a JSON object');
  assertOnlyKeys(body, ['mainFeedUrl', 'feeds'], 'body');

  const mainRaw = body.mainFeedUrl ?? '';
  if (typeof mainRaw !== 'string') fail('mainFeedUrl must be a string');
  const mainFeedUrl = mainRaw.trim();
  if (mainFeedUrl !== '') {
    if (mainFeedUrl.length > MAX_URL_LENGTH || /[\s<>"'`\\]/.test(mainFeedUrl)) {
      fail('mainFeedUrl is not a valid URL');
    }
    if (!isValidFeedEntry({ provider: MAIN_FEED_PROVIDER, url: mainFeedUrl })) {
      fail('mainFeedUrl must be an https URL');
    }
  }

  const feedsRaw = body.feeds ?? [];
  if (!Array.isArray(feedsRaw)) fail('feeds must be an array of { provider, url }');
  if (feedsRaw.length > MAX_FEEDS) fail(`feeds may hold at most ${MAX_FEEDS} entries`);

  const feeds = [];
  feedsRaw.forEach((entry, index) => {
    if (!isPlainObject(entry)) fail(`feeds[${index}] must be an object`);
    assertOnlyKeys(entry, ['provider', 'url'], `feeds[${index}]`);
    const provider = String(entry.provider ?? '')
      .trim()
      .toLowerCase();
    const url = typeof entry.url === 'string' ? entry.url.trim() : '';
    if (url === '') return;
    if (!/^[a-z0-9-]+$/.test(provider)) {
      fail(`feeds[${index}].provider must be a lowercase slug (letters, digits, dashes)`);
    }
    if (provider === MAIN_FEED_PROVIDER) {
      fail(`feeds[${index}].provider is reserved — the site's show is the Main feed field`);
    }
    if (url.length > MAX_URL_LENGTH || /[\s<>"'`\\]/.test(url)) {
      fail(`feeds[${index}].url is not a valid URL`);
    }
    if (mainFeedUrl !== '' && url === mainFeedUrl) {
      fail(`feeds[${index}].url is already the main feed — one feed cannot be both`);
    }
    const row = { provider, url };
    if (!isValidFeedEntry(row)) fail(`feeds[${index}].url must be an https URL`);
    feeds.push(row);
  });

  const deduped = dedupeFeedsByProvider(feeds);
  if (deduped.length !== feeds.length) {
    fail('Each provider may have only one feed');
  }
  return mainFeedUrl === '' ? { feeds: deduped } : { mainFeedUrl, feeds: deduped };
}

// ── the catalogue ──────────────────────────────────────────────────────────

/**
 * Route segment → document. The segment is the only caller-chosen part of the
 * path and it resolves here or 404s before Cosmos is touched, the same
 * pattern admin-integrations.js uses for cms/config/{collection}.
 */
export const PLATFORM_SETTINGS = Object.freeze({
  'default-heroes': Object.freeze({
    docId: DEFAULT_HEROES_CONFIG_ID,
    normalize: normalizeDefaultHeroes,
    empty: () => ({ heroes: {} }),
  }),
  'social-autopost': Object.freeze({
    docId: AUTOPOST_CONFIG_ID,
    normalize: normalizeSocialAutopost,
    empty: () => ({
      enabled: false,
      accountIds: [],
      scheduleDelayMinutes: DEFAULT_SCHEDULE_DELAY_MINUTES,
    }),
  }),
  'podcast-feeds': Object.freeze({
    docId: PODCAST_FEEDS_CONFIG_ID,
    normalize: normalizePodcastFeeds,
    empty: () => ({ feeds: [] }),
  }),
});

export const PLATFORM_SETTING_NAMES = Object.freeze(Object.keys(PLATFORM_SETTINGS));

/**
 * The setting spec for a route segment, or null. An OWN-key lookup: on a
 * plain object, `PLATFORM_SETTINGS['constructor']` is `Object` and
 * `PLATFORM_SETTINGS['__proto__']` is `Object.prototype` — both truthy — so a
 * bracket lookup alone would treat those segments as known settings and
 * carry an undefined docId to Cosmos. Frozen, so nothing can be written
 * through it either; this is the read-side half of that.
 */
export function resolveSetting(name) {
  const key = String(name ?? '');
  return Object.hasOwn(PLATFORM_SETTINGS, key) ? PLATFORM_SETTINGS[key] : null;
}

/** Keys this module writes beside the value; not part of the shape. */
const PRESENTATION_METADATA = new Set(['id', 'configScope', 'updatedAt', 'updatedBy']);
/** Cosmos's own fields, by exact name (the set jobs.js strips too). */
const COSMOS_SYSTEM_FIELDS = new Set(['_rid', '_self', '_etag', '_attachments', '_ts']);

/**
 * What a stored document looks like through this page: the normalized shape
 * when it normalizes, else the empty shape. A hand-seeded document that does
 * not validate is shown empty rather than failing the read — the page's job
 * is to let the owner write a good one, and the consumer will keep reading
 * whatever is there until they do. `stored` says which happened.
 */
export function presentSetting(name, doc) {
  const spec = resolveSetting(name);
  if (!spec) throw new Error(`Unknown platform setting: ${name}`);
  if (!doc) return { value: spec.empty(), exists: false, stored: null, updatedAt: null };
  const updatedAt = doc.updatedAt;
  // A null-prototype object, filled by defineProperty from the document's OWN
  // keys: a hand-seeded document carrying `__proto__` or `constructor` (a
  // JSON.parse'd document holds those as ordinary own keys) becomes an own
  // key here too — never a prototype write — and is then refused by the
  // normalizer as unknown, the same as any other key the shape does not name.
  // Only Cosmos's own system fields are stripped, by exact name; a stray
  // `_foo` is reported, not hidden.
  const candidate = Object.create(null);
  for (const key of Object.keys(doc)) {
    if (PRESENTATION_METADATA.has(key) || COSMOS_SYSTEM_FIELDS.has(key)) continue;
    Object.defineProperty(candidate, key, {
      value: doc[key],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  try {
    return {
      value: spec.normalize(candidate),
      exists: true,
      stored: 'valid',
      updatedAt: updatedAt ?? null,
    };
  } catch (error) {
    if (error instanceof PlatformSettingValidationError) {
      return {
        value: spec.empty(),
        exists: true,
        stored: 'invalid',
        updatedAt: updatedAt ?? null,
        problem: error.message,
      };
    }
    throw error;
  }
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function, upsertDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createPlatformSettingsHandlers({
  guard,
  store,
  now = () => new Date(),
  uuid = () => crypto.randomUUID(),
}) {
  const resolve = (request) => resolveSetting(request.params?.setting);

  async function audit(action, user, details) {
    await store.upsertDoc('admin_audit_logs', {
      id: uuid(),
      action,
      userId: user?.oid || user?.sub || null,
      userEmail: user?.email || user?.preferred_username || null,
      timestamp: now().toISOString(),
      details,
    });
  }

  /** What the audit row records: counts, never contents. */
  const summarize = (name, value) => {
    switch (name) {
      case 'default-heroes':
        return { providers: Object.keys(value.heroes).length };
      case 'social-autopost':
        return {
          enabled: value.enabled,
          accounts: value.accountIds.length,
          scheduleDelayMinutes: value.scheduleDelayMinutes,
        };
      case 'podcast-feeds':
        // Whether a main feed is set, never which one: the audit row records
        // counts, and a URL is content.
        return { feeds: value.feeds.length, mainFeed: Boolean(value.mainFeedUrl) };
      default:
        return {};
    }
  };

  return {
    /** GET /api/cms/platform-settings/{setting} */
    async getSetting(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const name = String(request.params?.setting || '');
      const spec = resolve(request);
      if (!spec) return json(404, { error: 'Unknown platform setting' });
      try {
        const doc = await store.readDoc('admin_config', spec.docId, ADMIN_CONFIG_PARTITION);
        return json(200, { success: true, setting: name, ...presentSetting(name, doc) });
      } catch (error) {
        context.error(`getPlatformSetting(${name}) failed:`, error);
        return json(500, { error: 'Failed to read platform setting' });
      }
    },

    /** PUT /api/cms/platform-settings/{setting} — body is the value itself. */
    async putSetting(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const name = String(request.params?.setting || '');
      const spec = resolve(request);
      if (!spec) return json(404, { error: 'Unknown platform setting' });

      const body = await request.json().catch(() => null);
      if (!isPlainObject(body) || JSON.stringify(body).length > MAX_BODY_JSON) {
        return json(400, { error: 'Body must be a JSON object' });
      }

      let value;
      try {
        value = spec.normalize(body);
      } catch (error) {
        if (error instanceof PlatformSettingValidationError) {
          return json(400, { error: error.message });
        }
        throw error;
      }

      try {
        const updatedAt = now().toISOString();
        await store.upsertDoc('admin_config', {
          id: spec.docId,
          configScope: ADMIN_CONFIG_PARTITION,
          ...value,
          updatedAt,
          updatedBy: auth.user?.oid || auth.user?.sub || null,
        });
        // Best effort, like forge-stats bumps: the setting is already saved,
        // so a failed audit row must not turn into a 500 that makes the page
        // report a failure (and the owner retry) for a write that took.
        const details = { setting: name, ...summarize(name, value) };
        try {
          await audit('platform_setting_updated', auth.user, details);
        } catch (auditError) {
          context.warn?.(
            `putPlatformSetting(${name}) saved but the audit row failed (${JSON.stringify(details)}): ${auditError?.message || auditError}`
          );
        }
        return json(200, {
          success: true,
          setting: name,
          value,
          exists: true,
          stored: 'valid',
          updatedAt,
        });
      } catch (error) {
        context.error(`putPlatformSetting(${name}) failed:`, error);
        return json(500, { error: 'Failed to save platform setting' });
      }
    },
  };
}
