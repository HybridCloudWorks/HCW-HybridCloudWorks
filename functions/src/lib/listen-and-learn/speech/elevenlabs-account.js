/**
 * The ElevenLabs account: which plan the key is on and how many credits it
 * has left, read before a render spends any of them (#432; ADR 0029 §2a,
 * amended 2026-09-26).
 *
 * Written when the owner chose to start the podcast voice on the FREE plan:
 * 10,000 credits a month with full API access
 * (https://join.elevenlabs.io/api/developer-api, https://elevenlabs.io/pricing).
 * One 9,000-character episode is nearly the whole month, and two things
 * follow. This module holds the facts both need.
 *
 *   - **A pre-flight.** `synthesizeWithElevenLabs` reads the subscription
 *     before its first dialogue request and refuses the job outright when the
 *     credits left do not cover all of it. A render that runs dry after three
 *     of five requests has spent most of the month on audio that is thrown
 *     away. Refusing up front spends nothing.
 *   - **The plan the audio was rendered on.** The free plan "does not include
 *     a commercial license and cannot be used for any commercial purpose"
 *     (https://help.elevenlabs.io/hc/en-us/articles/13313564601361). So the
 *     podcast pipeline records the plan on the transcript, and approval refuses
 *     a free-plan render (podcast/speech-licence.js).
 *
 * ## The endpoint
 *
 * `GET https://api.elevenlabs.io/v1/user/subscription` with `xi-api-key`
 * (https://elevenlabs.io/docs/api-reference/user/subscription/get, read
 * 2026-09-26). The fields used here:
 *
 *   tier                              the plan, e.g. "free", "starter"
 *   status                            trialing | active | incomplete |
 *                                     past_due | free | free_disabled
 *   character_count                   credits used this period
 *   character_limit                   credits allowed this period
 *   next_character_count_reset_unix   when the allowance resets
 *   can_extend_character_limit        entitled to usage-based billing
 *   max_credit_limit_extension        an integer or "unlimited"; 0 means
 *                                     usage-based billing is disabled
 *
 * "Character" and "credit" are the same number under two names: "Credits
 * were previously referred to as 'characters' … the value remains
 * unchanged" (https://elevenlabs.io/docs/overview/administration/billing).
 *
 * **Permission.** A restricted key needs **User → Read** (`user_read`, one of
 * the permission names in
 * https://elevenlabs.io/docs/api-reference/service-accounts/api-keys/list) for
 * this read. ElevenLabs's reference does not say which permission each
 * endpoint checks. That this one checks `user_read` comes from clients that
 * call it, not from ElevenLabs (for example
 * https://github.com/steipete/CodexBar/blob/main/docs/elevenlabs.md). A key
 * without it is refused with 401 or 403, and the code names missing or
 * insufficient permissions (https://elevenlabs.io/docs/eleven-api/resources/errors).
 *
 * ## Credits a job needs
 *
 * Eleven v3 bills one credit per character: "1 text character equals 1
 * credit" for Multilingual v2/v3, and Flash/Turbo bill between 0.5 and 1
 * (https://elevenlabs.io/pricing). Text to Dialogue serves only v3
 * (https://elevenlabs.io/docs/overview/capabilities/text-to-dialogue). So one
 * credit per character is exact for the default model and an upper bound for
 * any other, which is the safe direction for a figure that gates spending. A
 * Voice Library voice with a credit multiplier would bill more. The voices
 * this provider uses are not library voices, and a free-plan key cannot use
 * library voices through the API at all
 * (https://elevenlabs.io/docs/overview/capabilities/voices).
 *
 * ## Why a failed read fails CLOSED
 *
 * If the subscription cannot be read, the render is refused with
 * `code: 'subscription_unavailable'` and nothing is sent. That covers a
 * network failure that survived its retries, a key without `user_read`, and
 * an answer without the credit figures. Proceeding blind was the alternative,
 * and it is rejected on purpose:
 *
 *   1. The check exists to protect a 10,000-credit month, and "could not
 *      check" is exactly the case where a half-spent render can happen.
 *   2. The plan is what the publish rule is decided from. Audio rendered
 *      without it would have an unknown licence.
 *   3. The failure is cheap and loud. The podcast saves a transcript-only
 *      draft whose `audioError` names the cause (podcast/generate.js), and the
 *      fix is a permission on the key, not a change to code.
 *
 * ## The cache
 *
 * A successful read is kept for `SUBSCRIPTION_CACHE_TTL_MS` per key, keyed by
 * a SHA-256 of the key and never by the key itself. The Audio tab, the live
 * check and a job that start within the same few seconds then read the
 * account once. Every render drops the entry when it finishes, whether or not
 * it spent anything, so the next pre-flight sees what that render cost. Two
 * renders racing each other can both pass a pre-flight, cache or no cache;
 * the per-request out-of-credit error in elevenlabs.js is the backstop there.
 */
import { createHash } from 'node:crypto';

export const SUBSCRIPTION_URL = 'https://api.elevenlabs.io/v1/user/subscription';

/** The permission a restricted key needs for the read above. */
export const SUBSCRIPTION_PERMISSION = 'user_read';

/** Where keys are created and their permissions and credit limits set. */
export const API_KEYS_PAGE = 'https://elevenlabs.io/app/developers/api-keys';

/** Seconds, not minutes: long enough to share one read, short enough to stay true. */
export const SUBSCRIPTION_CACHE_TTL_MS = 15_000;

/** Eleven v3's rate, and the ceiling for every other model (see the header). */
export const CREDITS_PER_CHARACTER = 1;

/** `code` for a subscription that could not be read. */
export const SUBSCRIPTION_UNAVAILABLE = 'subscription_unavailable';

/**
 * `code` for a job the account cannot pay for. The same code the per-request
 * out-of-credit error carries, so anything that recognises one recognises the
 * other. The pre-flight flavour is told apart by `details.preflight`.
 */
export const QUOTA_EXCEEDED = 'quota_exceeded';

const FREE_TIER = 'free';
const FREE_STATUSES = new Set(['free', 'free_disabled']);
const PERMISSION_CODES = new Set(['missing_permissions', 'insufficient_permissions']);
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const NOTHING_SENT = 'nothing was sent, so no credits were spent';

const numberFormat = new Intl.NumberFormat('en-US');

/**
 * The error every ElevenLabs failure is reported with.
 *
 * Defined here rather than in `./index.js`, which imports elevenlabs.js: a
 * cycle would make one of the two undefined at load. elevenlabs.js imports it
 * from here. `name`, `provider`, `status` and `code` are what callers key off,
 * and `name` is 'SpeechError' so they need not know which module threw.
 */
export class ElevenLabsSpeechError extends Error {
  constructor(message, { status = null, code = null, details = null } = {}) {
    super(message);
    this.name = 'SpeechError';
    this.status = status;
    this.provider = 'elevenlabs';
    this.code = code;
    if (details) this.details = details;
  }
}

/**
 * The code in an ElevenLabs error body, lowercased, or ''.
 *
 * `detail.code` is the current field; `detail.status` is "a legacy field that
 * is no longer used" but older answers still carry it
 * (https://elevenlabs.io/docs/eleven-api/resources/errors). Read as text
 * first, so a non-JSON error page cannot throw here.
 */
export function errorCode(bodyText) {
  try {
    const detail = JSON.parse(bodyText)?.detail;
    return String(detail?.code || detail?.status || '').toLowerCase();
  } catch {
    return '';
  }
}

/** Whether a plan is the free one, from what the subscription says. */
export function isFreePlan({ tier, status } = {}) {
  return (
    String(tier || '').toLowerCase() === FREE_TIER ||
    FREE_STATUSES.has(String(status || '').toLowerCase())
  );
}

const unavailable = (reason, status = null) =>
  new ElevenLabsSpeechError(`Could not read the ElevenLabs subscription (${reason}); ${NOTHING_SENT}.`, {
    status,
    code: SUBSCRIPTION_UNAVAILABLE,
  });

const snippet = (text) => String(text || '').slice(0, 300) || 'no detail';

/** The sentence for a non-2xx subscription answer. */
function refusalFor(status, text) {
  const code = errorCode(text);
  const label = `HTTP ${status}${code ? ` ${code}` : ''}`;
  if (PERMISSION_CODES.has(code) || (status === 403 && !code)) {
    return unavailable(
      `${label}: the key needs the User → Read permission (${SUBSCRIPTION_PERMISSION}), set at ${API_KEYS_PAGE}`,
      status
    );
  }
  if (status === 401) return unavailable(`${label}: ElevenLabs rejected the key`, status);
  return unavailable(`${label}: ${snippet(text)}`, status);
}

async function fetchSubscription({ key, fetchImpl, sleep }) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(SUBSCRIPTION_URL, {
        method: 'GET',
        headers: { 'xi-api-key': key, Accept: 'application/json' },
      });
    } catch (err) {
      lastError = unavailable(`could not reach ElevenLabs: ${err?.message || err}`);
      if (attempt === MAX_ATTEMPTS) throw lastError;
      await sleep(attempt * 500);
      continue;
    }

    const text = await response.text().catch(() => '');
    if (response.ok) {
      try {
        return JSON.parse(text);
      } catch {
        throw unavailable('the answer was not JSON', response.status);
      }
    }
    lastError = refusalFor(response.status, text);
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS) throw lastError;
    await sleep(attempt * 500);
  }

  throw lastError;
}

/**
 * What a render and the Audio tab need from the subscription body.
 *
 * `overageCredits` is how far past the allowance the account may go under
 * usage-based billing: 0 when it is not entitled or the extension is 0, a
 * number, or 'unlimited'. The free plan is never entitled.
 *
 * @param {object} body the JSON ElevenLabs returned
 * @returns {{ tier: string|null, status: string|null, freePlan: boolean,
 *   creditsUsed: number, creditLimit: number, creditsLeft: number,
 *   overageCredits: number|'unlimited', resetAt: string|null }}
 */
export function normalizeSubscription(body) {
  const used = Number(body?.character_count);
  const limit = Number(body?.character_limit);
  if (
    body?.character_count === null ||
    body?.character_limit === null ||
    !Number.isFinite(used) ||
    !Number.isFinite(limit)
  ) {
    throw unavailable('the answer carried no credit figures');
  }

  const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const tier = text(body.tier);
  const status = text(body.status);

  const resetUnix = Number(body.next_character_count_reset_unix);
  const resetAt =
    body.next_character_count_reset_unix !== null && Number.isFinite(resetUnix) && resetUnix > 0
      ? new Date(resetUnix * 1000).toISOString()
      : null;

  // `max_character_limit_extension` is the deprecated spelling of the same
  // figure; read it only when the current one is absent.
  const extension = body.max_credit_limit_extension ?? body.max_character_limit_extension ?? 0;
  let overageCredits = 0;
  if (body.can_extend_character_limit === true) {
    overageCredits = extension === 'unlimited' ? 'unlimited' : Math.max(0, Number(extension) || 0);
  }

  return {
    tier,
    status,
    freePlan: isFreePlan({ tier, status }),
    creditsUsed: used,
    creditLimit: limit,
    creditsLeft: Math.max(0, limit - used),
    overageCredits,
    resetAt,
  };
}

const cache = new Map();

/** A stable, non-reversible name for a key, so the cache never holds one. */
const fingerprint = (key) => createHash('sha256').update(String(key)).digest('hex');

/**
 * The account behind `key`, normalised. Throws an `ElevenLabsSpeechError`
 * with `code: 'subscription_unavailable'` when it cannot be read.
 *
 * 429 and 5xx are retried, as the dialogue requests are; a refused key or a
 * missing permission is not, because a retry cannot change it.
 *
 * @param {object} params
 * @param {string} params.key the ElevenLabs API key
 * @param {Function} [params.fetchImpl]
 * @param {(ms: number) => Promise<void>} [params.sleep]
 * @param {() => number} [params.now] epoch milliseconds, for the cache
 * @param {boolean} [params.useCache] false forces a fresh read
 */
export async function readSubscription({
  key,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  useCache = true,
} = {}) {
  if (!key) throw unavailable('ELEVENLABS_API_KEY is not configured');
  const name = fingerprint(key);

  if (useCache) {
    const hit = cache.get(name);
    if (hit && hit.expiresAt > now()) return hit.value;
  }

  const value = normalizeSubscription(await fetchSubscription({ key, fetchImpl, sleep }));
  cache.set(name, { value, expiresAt: now() + SUBSCRIPTION_CACHE_TTL_MS });
  return value;
}

/** Drop the cached read for one key, so the next read sees what a render spent. */
export function invalidateSubscription(key) {
  if (key) cache.delete(fingerprint(key));
}

/** Drop every cached read. For tests, which must not see each other's accounts. */
export function clearSubscriptionCache() {
  cache.clear();
}

/** Credits a job of `characters` code points will be charged, rounded up. */
export function creditsNeeded(characters) {
  return Math.ceil(Math.max(0, Number(characters) || 0) * CREDITS_PER_CHARACTER);
}

/**
 * Null when the account can pay for `needed` credits, else what it is short.
 *
 * Usage-based billing counts as headroom, but only when the account is
 * entitled to it AND an admin has set an extension above 0. That is an opt-in
 * made in ElevenLabs's own settings. The free plan has neither, so on it this
 * compares the allowance left with the job.
 *
 * @param {ReturnType<typeof normalizeSubscription>} subscription
 * @param {number} needed credits
 */
export function creditShortfall(subscription, needed) {
  const overage =
    subscription.overageCredits === 'unlimited'
      ? Number.POSITIVE_INFINITY
      : Number(subscription.overageCredits) || 0;
  const available = subscription.creditLimit - subscription.creditsUsed + overage;
  if (needed <= available) return null;
  return {
    needed,
    left: subscription.creditsLeft,
    limit: subscription.creditLimit,
    overage,
    resetAt: subscription.resetAt,
    tier: subscription.tier,
  };
}

/**
 * "ElevenLabs has 1,000 credits left of 10,000, this episode needs 9,000; the
 * allowance resets on 2026-10-26 (UTC). Nothing was sent, …"
 */
export function describeShortfall({ needed, left, limit, overage, resetAt }) {
  const extra = overage > 0 ? ` (plus ${numberFormat.format(overage)} of usage-based billing)` : '';
  const reset = resetAt
    ? `the allowance resets on ${resetAt.slice(0, 10)} (UTC)`
    : 'ElevenLabs did not say when the allowance resets';
  return (
    `ElevenLabs has ${numberFormat.format(left)} credits left of ${numberFormat.format(limit)}${extra}, ` +
    `this episode needs ${numberFormat.format(needed)}; ${reset}. ` +
    `Nothing was sent, so no credits were spent.`
  );
}

/**
 * The pre-flight, in one call: read the account and refuse a job it cannot
 * pay for in full. Returns the subscription the job was cleared against.
 *
 * @param {object} params
 * @param {string} params.key
 * @param {number} params.characters code points the job will post
 * @param {Function} [params.fetchImpl]
 * @param {(ms: number) => Promise<void>} [params.sleep]
 * @returns {Promise<ReturnType<typeof normalizeSubscription>>}
 */
export async function assertCreditsCover({ key, characters, fetchImpl, sleep }) {
  const subscription = await readSubscription({ key, fetchImpl, sleep });
  const needed = creditsNeeded(characters);
  const shortfall = creditShortfall(subscription, needed);
  if (shortfall) {
    throw new ElevenLabsSpeechError(describeShortfall(shortfall), {
      status: null,
      code: QUOTA_EXCEEDED,
      details: { preflight: true, ...shortfall },
    });
  }
  return subscription;
}
