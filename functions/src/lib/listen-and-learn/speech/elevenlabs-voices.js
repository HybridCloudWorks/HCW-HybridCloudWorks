/**
 * The ElevenLabs voices this key may use, and their previews, for the owner
 * to pick the two podcast hosts by ear (#725; ADR 0029 §2a, amended
 * 2026-09-26 twice).
 *
 * Written after the owner's first live check on the free plan was refused:
 * "Free users cannot use library voices via the API" (402
 * `paid_plan_required`). The code's defaults, Sarah and Aria, are Default and
 * Legacy voices that an account created in March 2026 or later does not have,
 * so for that account they are library voices. Choosing voices by id from a
 * help page is what went wrong; this module lists what the account itself
 * says it has, and says which of those the plan allows.
 *
 * ## The listing
 *
 * `GET https://api.elevenlabs.io/v2/voices`
 * (https://elevenlabs.io/docs/api-reference/voices/search, read 2026-09-26).
 * `/v1/voices` is filed under "Legacy" in the same reference, so v2 it is.
 * Paginated with `page_size` (at most 100) and the `next_page_token` /
 * `has_more` pair, which the reference says to rely on rather than
 * `total_count`; `include_total_count=false` because that count "incurs a
 * performance cost" and nothing here shows it.
 *
 * **The rule.** "Voice Library voices are not available via the API to free
 * tier users" (https://elevenlabs.io/docs/overview/capabilities/voices, read
 * 2026-09-26). So on the free plan a key may use the account's own voices and
 * its default voices, and not library copies.
 *
 * **What tells them apart.** The voice object carries no single "type" field.
 * The listing's `voice_type` filter is the documented classifier: `default`,
 * `personal`, `workspace` and `community`, where "'non-community' is equal to
 * 'personal' and 'workspace' combined (excludes library copies)" (the search
 * reference above; the filter value was added 2026-04-13,
 * https://elevenlabs.io/docs/changelog/2026/4/13). So the account is listed
 * three times, `default`, `non-community` and `community`, and each voice is
 * labelled by the listing that returned it rather than guessed from
 * `category` or `is_owner`. A voice in the first two is usable on any plan;
 * one in the third needs a paid plan for API use.
 *
 * Two more fields narrow it: `is_legacy` (a Legacy id "will automatically
 * route to" a replacement,
 * https://elevenlabs.io/docs/help-center/product/voices/my-voices/what-are-legacy-voices,
 * so it would not sound like its preview) and `available_for_tiers`, "the
 * tiers the voice is available for", read as a restriction only when it
 * names some.
 *
 * **Permission.** A restricted key needs **Voices → Read** (`voices_read`,
 * named in https://elevenlabs.io/docs/api-reference/service-accounts/api-keys/list)
 * for the listing. It is a third permission beside the two the podcast
 * already needed; without it the listing answers 401 or 403 and the sentence
 * says which permission to add, and where.
 *
 * ## The preview
 *
 * Each voice has a `preview_url` on a third-party host. The site's CSP
 * (`frontend/staticwebapp.config.json`) allows media from 'self' only, and it
 * is not widened for this. So the preview is fetched here and handed to the
 * page by an editor route, and the page decodes it with Web Audio.
 *
 * That route must not be an open proxy, so a URL is fetched only when
 *
 *   - it came from the account's own listing, never from the caller: the
 *     route takes a voice id and looks its preview up;
 *   - it is `https://storage.googleapis.com/eleven-public-prod/…`, the host
 *     and bucket every `preview_url` in ElevenLabs's reference carries
 *     (https://elevenlabs.io/docs/api-reference/legacy/voices/get-all for a
 *     premade voice, https://elevenlabs.io/docs/api-reference/voices/voice-library/get-shared
 *     for a library one). The host alone would not do: that host serves every
 *     public bucket on Google Cloud, so the bucket prefix is part of the
 *     allowlist, checked on the parsed, dot-segment-normalised path;
 *   - it carries no port, credentials, query or fragment.
 *
 * The fetch sends no key (the preview host is public and is not ElevenLabs's
 * API), refuses redirects, stops reading past `MAX_PREVIEW_BYTES`, and hands
 * back the bytes only if they begin like an MP3.
 *
 * ## The cache
 *
 * One listing per key for `VOICES_CACHE_TTL_MS`, in process memory, keyed the
 * way the subscription cache is (see "Cache keying" in elevenlabs-account.js).
 * A picker that plays a dozen previews reads the account once. Which voices
 * are usable is worked out per request from the plan, so an upgrade shows at
 * once. The preview URLs stay server-side; the page only learns whether a
 * voice has one.
 */
import {
  API_KEYS_PAGE,
  ElevenLabsSpeechError,
  errorCode,
  isPermissionRefusal,
  isRetryableStatus,
} from './elevenlabs-account.js';

export const VOICES_URL = 'https://api.elevenlabs.io/v2/voices';

/** The permission a restricted key needs to list voices. */
export const VOICES_PERMISSION = 'voices_read';

/** Long enough for a picking session; short enough that a new voice shows soon. */
export const VOICES_CACHE_TTL_MS = 5 * 60_000;

/** The documented maximum page size. */
export const VOICES_PAGE_SIZE = 100;

/** Pages per listing. 500 voices of one type is more than any account here holds. */
export const MAX_VOICE_PAGES = 5;

/**
 * `voice_type` → how the page names it. In this order: a voice that somehow
 * came back from two listings keeps the first, most permissive label.
 */
export const VOICE_LISTINGS = Object.freeze([
  Object.freeze({ voiceType: 'default', type: 'default' }),
  Object.freeze({ voiceType: 'non-community', type: 'own' }),
  Object.freeze({ voiceType: 'community', type: 'library' }),
]);

/**
 * An ElevenLabs voice id as every documented one is: twenty letters and
 * digits (`EXAVITQu4vr4xnSDxMaL`, `9BWtsMINqrJLrRacOk9x` in the Legacy
 * listing, `sB1b5zUrxQVAFl2PhZFp` in the shared-voice listing). A Gemini name
 * (`Kore`) or an Azure one (`en-US-AvaMultilingualNeural`) fails it, which is
 * the mistake the shared `LISTEN_AND_LEARN_VOICE_*` settings invited.
 */
export const VOICE_ID_PATTERN = /^[A-Za-z0-9]{20}$/;

export const isElevenLabsVoiceId = (value) =>
  typeof value === 'string' && VOICE_ID_PATTERN.test(value);

/** The preview allowlist: exactly this host, and inside this bucket. */
export const PREVIEW_HOST = 'storage.googleapis.com';
export const PREVIEW_PATH_PREFIX = '/eleven-public-prod/';

/** A preview is a few seconds of MP3, a few hundred kilobytes. */
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

/** `code` values the routes map to statuses. */
export const VOICES_UNAVAILABLE = 'voices_unavailable';
export const VOICE_NOT_LISTED = 'voice_not_listed';
export const PREVIEW_UNAVAILABLE = 'preview_unavailable';
export const PREVIEW_FAILED = 'preview_failed';

/** The rule, as the page states it above the list. */
export const FREE_PLAN_RULE =
  'On the free plan ElevenLabs lets the API use your own voices and its default voices, not Voice Library voices.';

const MAX_ATTEMPTS = 3;
const MAX_LABEL_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 300;
const PREVIEW_CONTENT_TYPES = [
  /^audio\//i,
  /^application\/octet-stream/i,
  /^binary\/octet-stream/i,
];

const voicesError = (reason, status = null) =>
  new ElevenLabsSpeechError(`Could not list the ElevenLabs voices (${reason}).`, {
    status,
    code: VOICES_UNAVAILABLE,
  });

const snippet = (text) => String(text || '').slice(0, 300) || 'no detail';

/** The sentence for a non-2xx listing answer. Names the fix; never the key. */
function listingRefusal(status, text) {
  const code = errorCode(text);
  const label = `HTTP ${status}${code ? ` ${code}` : ''}`;
  if (isPermissionRefusal(status, code)) {
    return voicesError(
      `${label}: the key needs the Voices → Read permission (${VOICES_PERMISSION}), set at ${API_KEYS_PAGE}`,
      status
    );
  }
  if (status === 401) return voicesError(`${label}: ElevenLabs rejected the key`, status);
  return voicesError(`${label}: ${snippet(text)}`, status);
}

function pageUrl(voiceType, pageToken) {
  const params = new URLSearchParams({
    page_size: String(VOICES_PAGE_SIZE),
    voice_type: voiceType,
    include_total_count: 'false',
  });
  if (pageToken) params.set('next_page_token', pageToken);
  return `${VOICES_URL}?${params.toString()}`;
}

/** One page, retried on 429 and 5xx as every other ElevenLabs read here is. */
async function fetchPage({ key, voiceType, pageToken, fetchImpl, sleep }) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(pageUrl(voiceType, pageToken), {
        method: 'GET',
        headers: { 'xi-api-key': key, Accept: 'application/json' },
      });
    } catch (err) {
      lastError = voicesError(`could not reach ElevenLabs: ${err?.message || err}`);
      if (attempt === MAX_ATTEMPTS) throw lastError;
      await sleep(attempt * 500);
      continue;
    }
    const text = await response.text().catch(() => '');
    if (response.ok) {
      try {
        return JSON.parse(text);
      } catch {
        throw voicesError('the answer was not JSON', response.status);
      }
    }
    lastError = listingRefusal(response.status, text);
    if (!isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS) throw lastError;
    await sleep(attempt * 500);
  }
  throw lastError;
}

/** Every page of one `voice_type`, up to MAX_VOICE_PAGES; `truncated` when more remained. */
async function fetchListing({ key, voiceType, fetchImpl, sleep }) {
  const voices = [];
  let pageToken = null;
  for (let page = 0; page < MAX_VOICE_PAGES; page += 1) {
    const body = await fetchPage({ key, voiceType, pageToken, fetchImpl, sleep });
    if (!Array.isArray(body?.voices)) throw voicesError('the answer carried no voices list');
    voices.push(...body.voices);
    pageToken = typeof body.next_page_token === 'string' ? body.next_page_token : null;
    if (body.has_more !== true || !pageToken) return { voices, truncated: false };
  }
  return { voices, truncated: true };
}

const boundedText = (value, max) => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
};

/**
 * The labels the page shows. ElevenLabs's labels are free-form strings; older
 * voices spell the use case `use case`, newer ones `use_case`.
 */
function presentLabels(labels) {
  const raw = labels && typeof labels === 'object' && !Array.isArray(labels) ? labels : {};
  const read = (...names) => {
    for (const name of names) {
      const value = boundedText(raw[name], MAX_LABEL_LENGTH);
      if (value) return value;
    }
    return null;
  };
  return {
    gender: read('gender'),
    accent: read('accent'),
    age: read('age'),
    description: read('description', 'descriptive'),
    useCase: read('use_case', 'use case'),
  };
}

/**
 * Whether `value` is a preview URL this module will fetch: https, exactly
 * PREVIEW_HOST on the default port, inside PREVIEW_PATH_PREFIX after the URL
 * parser has resolved `.` and `..` segments (percent-encoded ones included),
 * and nothing else — no credentials, no query, no fragment.
 */
export function isAllowedPreviewUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.hostname === PREVIEW_HOST &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '' &&
    url.pathname.startsWith(PREVIEW_PATH_PREFIX) &&
    url.pathname.length > PREVIEW_PATH_PREFIX.length
  );
}

/** One raw voice → what the page is told, plus the preview URL kept here. */
function presentVoice(raw, type) {
  const voiceId = typeof raw?.voice_id === 'string' ? raw.voice_id.trim() : '';
  const previewUrl = isAllowedPreviewUrl(raw?.preview_url) ? raw.preview_url : null;
  return {
    voice: {
      voiceId,
      name: boundedText(raw?.name, MAX_LABEL_LENGTH) || voiceId,
      category: boundedText(raw?.category, MAX_LABEL_LENGTH),
      type,
      labels: presentLabels(raw?.labels),
      description: boundedText(raw?.description, MAX_DESCRIPTION_LENGTH),
      legacy: raw?.is_legacy === true,
      tiers: Array.isArray(raw?.available_for_tiers)
        ? raw.available_for_tiers
            .filter((t) => typeof t === 'string' && t.trim())
            .map((t) => t.trim())
        : [],
      hasPreview: previewUrl !== null,
    },
    previewUrl,
  };
}

/** key → { voices, previews, truncated, expiresAt }. */
const cache = new Map();

/** Drop every cached listing. For tests. */
export function clearVoicesCache() {
  cache.clear();
}

/**
 * The account's voices, labelled by type, from the three listings. Cached.
 *
 * @returns {Promise<{ voices: object[], previews: Map<string,string>, truncated: boolean }>}
 */
export async function readVoices({
  key,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  useCache = true,
} = {}) {
  if (!key) throw voicesError('ELEVENLABS_API_KEY is not configured');
  if (useCache) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) return hit;
  }

  const seen = new Set();
  const voices = [];
  const previews = new Map();
  let truncated = false;
  // Sequential, like the dialogue requests: three small reads, and a burst
  // is the reliable way to meet the per-account 429.
  for (const { voiceType, type } of VOICE_LISTINGS) {
    const listing = await fetchListing({ key, voiceType, fetchImpl, sleep });
    truncated ||= listing.truncated;
    for (const raw of listing.voices) {
      const { voice, previewUrl } = presentVoice(raw, type);
      if (!voice.voiceId || seen.has(voice.voiceId)) continue;
      seen.add(voice.voiceId);
      voices.push(voice);
      if (previewUrl) previews.set(voice.voiceId, previewUrl);
    }
  }

  const value = { voices, previews, truncated, expiresAt: now() + VOICES_CACHE_TTL_MS };
  cache.set(key, value);
  return value;
}

const lower = (value) => String(value || '').toLowerCase();

/**
 * Whether one voice can be used through the API on this plan, and if not,
 * why, in a sentence the page shows beside it. `subscription` is the
 * normalised account (elevenlabs-account.js) or null when it could not be
 * read, in which case a library voice is treated as the free plan treats it:
 * the pre-flight would refuse the render anyway, and the page must not offer
 * a voice it cannot vouch for.
 */
export function voiceUsability(voice, subscription) {
  if (!isElevenLabsVoiceId(voice.voiceId)) {
    return { usable: false, reason: 'Its id is not the 20-character shape this page saves.' };
  }
  if (voice.legacy) {
    return {
      usable: false,
      reason:
        'Legacy voice: ElevenLabs routes its id to a replacement, so it would not sound like this preview.',
    };
  }
  if (voice.type === 'library' && (!subscription || subscription.freePlan)) {
    return {
      usable: false,
      reason: subscription
        ? 'Voice Library voice: the free plan cannot use it through the API (HTTP 402 paid_plan_required).'
        : 'Voice Library voice, and the plan could not be read: the free plan cannot use these through the API.',
    };
  }
  const tiers = voice.tiers.map(lower);
  if (tiers.length > 0 && !(subscription && tiers.includes(lower(subscription.tier)))) {
    return {
      usable: false,
      reason: `ElevenLabs offers it on the ${voice.tiers.join(', ')} plan${voice.tiers.length > 1 ? 's' : ''} only.`,
    };
  }
  return { usable: true, reason: null };
}

/**
 * The listing as the picker shows it: every voice, usable ones first, each
 * with `usable` and, when not, `unavailableReason`. Nothing is hidden: a
 * voice the plan does not allow is shown with the reason, because "why is my
 * voice not here" is the question this page exists to answer.
 */
export function voicesForPlan(voices, subscription) {
  const rank = { default: 0, own: 1, library: 2 };
  return voices
    .map((voice) => {
      const { usable, reason } = voiceUsability(voice, subscription);
      return { ...voice, usable, unavailableReason: reason };
    })
    .sort(
      (a, b) =>
        Number(b.usable) - Number(a.usable) ||
        (rank[a.type] ?? 9) - (rank[b.type] ?? 9) ||
        a.name.localeCompare(b.name, 'en')
    );
}

const previewError = (message, code, status = null) =>
  new ElevenLabsSpeechError(message, { status, code });

/** Whether the first bytes are an ID3 tag or an MPEG audio frame sync. */
export function looksLikeMp3(bytes) {
  if (!bytes || bytes.length < 3) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true; // "ID3"
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

/** The body, read no further than `limit` bytes. */
async function readCapped(response, limit) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    throw previewError(
      `The preview is ${declared} bytes, over the ${limit}-byte cap.`,
      PREVIEW_FAILED,
      502
    );
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) {
      throw previewError(`The preview is over the ${limit}-byte cap.`, PREVIEW_FAILED, 502);
    }
    return bytes;
  }
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw previewError(`The preview is over the ${limit}-byte cap.`, PREVIEW_FAILED, 502);
    }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

/**
 * One voice's preview, as MP3 bytes. The voice must be in the account's
 * listing and its preview on the allowlisted host (see the header); the
 * caller supplies an id, never a URL.
 *
 * @returns {Promise<{ audio: Buffer, contentType: 'audio/mpeg' }>}
 */
export async function fetchVoicePreview({
  key,
  voiceId,
  fetchImpl = fetch,
  sleep,
  now,
  listVoices = readVoices,
}) {
  if (!isElevenLabsVoiceId(voiceId)) {
    throw previewError('That is not an ElevenLabs voice id.', VOICE_NOT_LISTED, 400);
  }
  const { voices, previews } = await listVoices({ key, fetchImpl, sleep, now });
  if (!voices.some((voice) => voice.voiceId === voiceId)) {
    throw previewError(
      'That voice is not one this ElevenLabs key can list.',
      VOICE_NOT_LISTED,
      404
    );
  }
  const previewUrl = previews.get(voiceId);
  // Checked again at the point of use: the allowlist is the reason this is
  // not an open proxy, and a cache entry is not where to trust it from.
  if (!isAllowedPreviewUrl(previewUrl)) {
    throw previewError(
      'ElevenLabs has no preview for this voice on its preview host.',
      PREVIEW_UNAVAILABLE,
      404
    );
  }

  let response;
  try {
    // No key: the preview host is public storage, not ElevenLabs's API, and
    // the key must never travel anywhere else. No redirects: one could leave
    // the allowlist.
    response = await fetchImpl(previewUrl, {
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'audio/mpeg' },
    });
  } catch (err) {
    throw previewError(`Could not fetch the preview: ${err?.message || err}`, PREVIEW_FAILED, 502);
  }
  if (!response.ok) {
    throw previewError(`The preview host answered HTTP ${response.status}.`, PREVIEW_FAILED, 502);
  }
  const type = String(response.headers?.get?.('content-type') || '');
  if (type && !PREVIEW_CONTENT_TYPES.some((pattern) => pattern.test(type))) {
    throw previewError(
      `The preview host answered ${type.slice(0, 60)}, not audio.`,
      PREVIEW_FAILED,
      502
    );
  }
  const audio = await readCapped(response, MAX_PREVIEW_BYTES);
  if (!looksLikeMp3(audio)) {
    throw previewError('The preview host answered something that is not MP3.', PREVIEW_FAILED, 502);
  }
  return { audio, contentType: 'audio/mpeg' };
}
