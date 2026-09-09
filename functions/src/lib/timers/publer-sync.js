/**
 * publer-sync.js — `syncSocialCalendarScheduled`, every 5 minutes: reconcile
 * `social_posts` with Publer's scheduled/published/failed posts.
 *
 * Ported from Site-Main `cms/social.js` `reconcilePublerCalendar` and its
 * helpers (088f458). Three outcomes per run: a social post that matches a
 * Publer post (by `publerPostIds` or `publerJobId`) takes Publer's state; a
 * post that once had Publer ids but no longer matches anything is marked
 * deleted (unless Publer itself created it); a Publer post nothing matches
 * becomes `social_posts/publer_<id>`, unlinked from the calendar.
 *
 * This is D12's live writer: on Site-Main it runs every five minutes, so the
 * cutover delta import happens with it paused there and this flag still off
 * here (Migration-Plan §6). The API key and workspace id come from app
 * settings (Key Vault references); a missing key skips the run.
 *
 * So does a REJECTED one (#358). A 401 or 403 from Publer is a configuration
 * state — the key is stale, revoked, or valid for another workspace — not a
 * transient fault, and a timer that throws on it every five minutes turns
 * one fact into 288 exceptions a day that no alert reads. Measured on
 * 2026-09-09: 429 failed invocations in 36 hours, 0 successes. The run now
 * skips with one warning naming the pair, and the client reports the verdict
 * to the API-keys page through `lib/key-verdict.js`, the same path the AI
 * router uses — the red light `secrets-health.js` says only the upstream
 * service can switch on. A 500 or a timeout still throws: those ARE transient,
 * and a failed invocation is the right record of them.
 *
 * WHAT THE API ACTUALLY LOOKS LIKE (#463, read against Publer's own docs on
 * 2026-09-09 — every one of these was wrong here, and none could be caught by
 * a test because the 401 had kept the code paths dark since the port):
 *
 *   - `GET /posts` takes `state[]` as an array, so the three reconciled states
 *     travel in ONE request rather than three loops. `per_page` is a field of
 *     the response, not a parameter of the request; sending it did nothing.
 *   - The rate limit is **100 requests per two minutes per user account,
 *     across every API key it holds** — shared with the owner's browser and
 *     the admin pages, which is why paging stops early on
 *     `X-RateLimit-Remaining` rather than spending the whole window here.
 *   - Deleting is `DELETE /posts?post_ids[]=…`, answering `{ deleted_ids }`.
 *     `DELETE /posts/{id}` was invented. Omitting `post_ids` deletes every
 *     non-published post in the workspace, so the empty list is refused before
 *     the request rather than sent.
 *   - Errors arrive as `{ "errors": [...] }`, and that sentence is the whole
 *     difference between a malformed header and a revoked key. It is now on
 *     the thrown message and on the key verdict.
 */
import { readKey } from '../ai/router.js';
import { fetchWithTimeout } from '../http/fetch-with-timeout.js';
import { createKeyVerdictReporter, isCredentialRejected } from '../key-verdict.js';
import { describeUpstreamFailure, readUpstreamError } from '../integrations/upstream-error.js';

// Outbound deadline (T-712): Node's fetch has none, and these calls are
// reached from change-feed handlers where a hung socket holds the lease.
const PUBLER_TIMEOUT_MS = 20_000;

export const PUBLER_API_BASE_URL = 'https://app.publer.com/api/v1';

// The three states the calendar reconciles against, sent as one `state[]`
// array rather than looped over. `GET /posts` documents `state[]` for exactly
// this, and the three separate passes it replaces cost three times the
// requests against a limit of 100 per two minutes, shared across every key on
// the account (#463 item 5).
const SYNC_STATES = ['scheduled', 'published', 'failed'];
const MAX_PAGES = 10;

// Publer's page size is its own; `per_page` is a field of the RESPONSE and not
// a parameter of the request, so the `per_page=100` this used to send was
// ignored on the way out and misread the account's real paging on the way
// back. Pages are followed with `total_pages`, which is documented.
//
// Stop paging with this much of the window left. `X-RateLimit-Remaining`
// counts down from 100 per two minutes PER USER ACCOUNT across all of its API
// keys — so the budget is shared with the owner's browser, the Social Hub and
// anything else holding a key. A five-minute reconcile that drains it would
// take the admin pages down with it, and a partial reconcile is corrected on
// the next run five minutes later.
const RATE_LIMIT_FLOOR = 10;

function asIsoString(value) {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizePublerPost(post = {}) {
  const id = post.id || post.post_id || null;
  const state = String(post.state || post.status || '').toLowerCase();
  return {
    ...post,
    id,
    state,
    text: post.text || post.caption || post.description || '',
    scheduledAt: asIsoString(post.scheduled_at || post.scheduledAt),
    updatedAt: asIsoString(post.updated_at || post.updatedAt),
    accountId: post.account_id || post.accountId || null,
    network: post.network || post.provider || null,
    jobId: post.job_id || post.jobId || null,
  };
}

export function publerStateToSocialStatus(state) {
  const normalized = String(state || '').toLowerCase();
  if (normalized.startsWith('published')) return 'published';
  if (normalized.startsWith('failed')) return 'failed';
  if (normalized.startsWith('scheduled')) return 'scheduled';
  if (normalized.startsWith('draft')) return 'draft';
  return normalized || 'unknown';
}

export function extractPublerList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.posts)) return data.posts;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export function findSocialPostForPublerPost(socialPosts, publerPost) {
  const normalized = normalizePublerPost(publerPost);
  return socialPosts.find((item) => {
    const ids = Array.isArray(item.publerPostIds) ? item.publerPostIds.map(String) : [];
    return (
      (normalized.id && ids.includes(String(normalized.id))) ||
      (normalized.jobId && String(item.publerJobId || '') === String(normalized.jobId))
    );
  });
}

/** The patch a matched social post takes from its Publer post(s). `syncError` is cleared. */
export function buildSocialPostSyncPatch(
  publerPost,
  existing = {},
  relatedPosts = [publerPost],
  stamp
) {
  const normalized = normalizePublerPost(publerPost);
  const existingIds = Array.isArray(existing.publerPostIds) ? existing.publerPostIds : [];
  const activePosts = relatedPosts.map(normalizePublerPost).filter((post) => post.id);
  const states = activePosts.map((post) => post.state);
  let aggregateStatus = publerStateToSocialStatus(normalized.state);
  if (states.some((state) => state.startsWith('scheduled'))) aggregateStatus = 'scheduled';
  else if (states.some((state) => state.startsWith('failed'))) aggregateStatus = 'failed';
  return {
    publerStatus:
      states.length > 1 && new Set(states).size > 1 ? 'mixed' : normalized.state || null,
    publerActivePostIds: activePosts.map((post) => post.id),
    publerScheduledAt:
      activePosts.find((post) => post.scheduledAt)?.scheduledAt || normalized.scheduledAt || null,
    publerUpdatedAt: normalized.updatedAt || null,
    publerPostIds: [...new Set([...existingIds, ...(normalized.id ? [normalized.id] : [])])],
    publerJobId: normalized.jobId || existing.publerJobId || null,
    status: aggregateStatus,
    syncStatus: 'synced',
    syncOrigin: 'publer',
    lastSyncedAt: stamp,
    syncError: null,
  };
}

/**
 * @param {object} [deps]
 * @param {object} [deps.env]
 * @param {typeof fetch} [deps.fetch]
 * @param {Function|null} [deps.onKeyVerdict] The API-keys page's verdict
 *   writer, in the shape `createAiRouter` takes it. `null` — every unit test —
 *   reports nothing.
 * @param {{ warn?: Function }} [deps.log]
 * @returns {{ configured: boolean, request: Function, listPostsForSync: Function }}
 */
export function createPublerClient({
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  onKeyVerdict = null,
  log = console,
} = {}) {
  const apiKey = readKey(env, 'PUBLER_API_KEY');
  const workspaceId = readKey(env, 'PUBLER_WORKSPACE_ID');
  // The verdict is recorded against the key, not the workspace id: the id is
  // an identifier rather than a credential, and the catalogue maps one setting
  // to one secret. The warning in `createPublerReconcile` names both, because
  // a key valid for a different workspace answers 401 exactly like a stale one.
  const reportVerdict = createKeyVerdictReporter({ onKeyVerdict, log, source: 'publer' });

  /**
   * One call, with the rate-limit budget the response reported.
   *
   * `request` below is the same thing with the metadata dropped; it is what
   * the change-feed handlers have always called and its signature does not
   * move. Only the paging loop needs the header, and only the paging loop
   * takes this.
   */
  async function requestWithMeta(path, method = 'GET', body) {
    const options = {
      method,
      headers: {
        Authorization: `Bearer-API ${apiKey}`,
        'Publer-Workspace-Id': workspaceId,
        'Content-Type': 'application/json',
      },
    };
    if (body && !['GET', 'HEAD'].includes(method)) options.body = JSON.stringify(body);
    // Reached from the social_posts change-feed handler as well as this
    // timer, so an unbounded call holds a lease (T-712).
    const response = await fetchWithTimeout(fetchImpl, `${PUBLER_API_BASE_URL}${path}`, {
      ...options,
      timeoutMs: PUBLER_TIMEOUT_MS,
    });
    const data = await response.json().catch(() => ({}));
    // Absent on a mocked response and on any answer Publer serves without it;
    // `null` means "unknown", which the caller must not read as "exhausted".
    const remainingHeader = response.headers?.get?.('X-RateLimit-Remaining');
    const rateLimitRemaining =
      remainingHeader !== null && remainingHeader !== undefined && remainingHeader !== ''
        ? Number(remainingHeader)
        : null;

    if (!response.ok) {
      // Publer's own sentence, not just the number. `{"errors":[...]}` is
      // what separates "Missing or invalid Authorization header" — our
      // request is malformed — from a key that is revoked or on an account
      // without API entitlement. #358 spent two days on that distinction with
      // only `HTTP 401` to go on, because this line threw the status alone.
      const detail = readUpstreamError(data);
      // Only a 401/403 is a verdict on the key. A 404 is a wrong path, a 429
      // a busy account, a 5xx Publer's problem — none of them says the
      // credential is bad, and the light stays as it was.
      if (isCredentialRejected(response.status)) {
        await reportVerdict('PUBLER_API_KEY', { ok: false, status: response.status, detail });
      }
      const error = new Error(
        `Publer ${method} ${path} failed with ${describeUpstreamFailure(response.status, data)}`
      );
      error.status = response.status;
      error.detail = detail;
      throw error;
    }
    await reportVerdict('PUBLER_API_KEY', { ok: true });
    return { data, rateLimitRemaining: Number.isFinite(rateLimitRemaining) ? rateLimitRemaining : null };
  }

  async function request(path, method = 'GET', body) {
    const { data } = await requestWithMeta(path, method, body);
    return data;
  }

  /**
   * Every post in the three reconciled states, in one paged pass.
   *
   * Was three passes of up to ten pages each — thirty requests against a
   * hundred-per-two-minutes budget shared with the admin pages — because
   * `state` was sent singular in a loop. `state[]` takes all three at once
   * (#463 item 5).
   */
  async function listPostsForSync() {
    const states = SYNC_STATES.map((state) => `state[]=${encodeURIComponent(state)}`).join('&');
    const results = [];
    let page = 0;
    // Assigned from the first response before the while condition reads it;
    // the do-while guarantees one pass, so there is no initial value to seed.
    let totalPages;
    do {
      const response = await requestWithMeta(`/posts?${states}&page=${page}`);
      results.push(...extractPublerList(response.data));
      totalPages = Number(response.data?.total_pages || 1);
      page += 1;
      // A null reading is unknown, not exhausted: an upstream that stops
      // sending the header must not stop the reconcile at page one.
      const remaining = response.rateLimitRemaining;
      if (remaining !== null && remaining <= RATE_LIMIT_FLOOR) {
        log.warn?.(
          `[syncSocialCalendar] stopping after page ${page} of ${totalPages}: ` +
            `${remaining} Publer requests left in the window`
        );
        break;
      }
    } while (page < Math.min(totalPages, MAX_PAGES));
    return results.map(normalizePublerPost).filter((post) => post.id);
  }

  /**
   * Delete posts by id, in the one form Publer documents.
   *
   * `DELETE /posts/{id}` was invented; the API takes `DELETE /posts` with a
   * `post_ids[]` query array and answers `{ deleted_ids }`. The undocumented
   * per-id path is not merely wrong, it is wrong in a dangerous direction —
   * **omitting `post_ids` deletes every non-published post in the workspace**,
   * so a call built by dropping an id from the path is a workspace wipe. This
   * function refuses an empty list for that reason, and refuses it before the
   * request rather than after (#463 item 2).
   *
   * An id absent from `deleted_ids` was NOT deleted. Publer reports that in a
   * 200, so a caller that only checks for a thrown error records a post as
   * removed while it is still scheduled to publish.
   *
   * @param {Array<string|number>} ids
   * @returns {Promise<{ deletedIds: string[], missingIds: string[] }>}
   */
  async function deletePosts(ids) {
    // Nullish is dropped BEFORE stringifying: `String(null)` is the truthy
    // string 'null', so filtering after the map would send `post_ids[]=null`
    // — a request Publer would answer, for a post that does not exist, from a
    // caller that meant to send nothing.
    const wanted = [
      ...new Set(
        (Array.isArray(ids) ? ids : [])
          .filter((id) => id !== null && id !== undefined)
          .map((id) => String(id).trim())
          .filter(Boolean)
      ),
    ];
    if (!wanted.length) {
      // Not a silent return: the caller believed it had something to delete,
      // and the alternative reading of an empty list is the bulk wipe above.
      throw new Error('Publer deletePosts called with no post ids — refusing to delete');
    }
    const query = wanted.map((id) => `post_ids[]=${encodeURIComponent(id)}`).join('&');
    const data = await request(`/posts?${query}`, 'DELETE');
    const deletedIds = (Array.isArray(data?.deleted_ids) ? data.deleted_ids : []).map(String);
    return { deletedIds, missingIds: wanted.filter((id) => !deletedIds.includes(id)) };
  }

  return {
    configured: Boolean(apiKey && workspaceId),
    request,
    listPostsForSync,
    deletePosts,
  };
}

export function createPublerReconcile({ store, client, now = () => new Date(), log = {} }) {
  async function run() {
    if (!client.configured) {
      log.warn?.(
        '[syncSocialCalendar] PUBLER_API_KEY / PUBLER_WORKSPACE_ID not configured; skipping'
      );
      return { skipped: true, reason: 'not_configured', fetched: 0, updated: 0, created: 0 };
    }
    // Publer first, then Cosmos — no longer in parallel. The list is the gate:
    // a rejected credential fails on its first page, and there is nothing to
    // reconcile 500 social posts against when it does. Only Publer's own
    // status is read here; a Cosmos error carries `code`, not `status`, and
    // still throws as it always did.
    let publerPosts;
    try {
      publerPosts = await client.listPostsForSync();
    } catch (error) {
      if (!isCredentialRejected(error?.status)) throw error;
      log.warn?.(
        `[syncSocialCalendar] Publer rejected the credential (HTTP ${error.status}); ` +
          'PUBLER_API_KEY / PUBLER_WORKSPACE_ID need rotating together — skipping until they are'
      );
      return {
        skipped: true,
        reason: 'credential_rejected',
        status: error.status,
        fetched: 0,
        updated: 0,
        created: 0,
      };
    }
    const socialPosts = await store.queryDocs('social_posts', 'SELECT TOP 500 * FROM c', []);
    const publerById = new Map(publerPosts.map((post) => [String(post.id), post]));
    const matchedIds = new Set();
    const stamp = now().toISOString();
    let updated = 0;
    let created = 0;

    for (const item of socialPosts || []) {
      const ids = Array.isArray(item.publerPostIds) ? item.publerPostIds.map(String) : [];
      const matchingPost =
        ids.map((id) => publerById.get(id)).find(Boolean) ||
        publerPosts.find(
          (post) => post.jobId && String(item.publerJobId || '') === String(post.jobId)
        );
      if (matchingPost) {
        matchedIds.add(String(matchingPost.id));
        const relatedPosts = publerPosts.filter(
          (post) =>
            (post.jobId && String(item.publerJobId || '') === String(post.jobId)) ||
            ids.includes(String(post.id))
        );
        relatedPosts.forEach((post) => matchedIds.add(String(post.id)));
        await store.patchDoc(
          'social_posts',
          item.id,
          buildSocialPostSyncPatch(
            matchingPost,
            item,
            relatedPosts.length ? relatedPosts : [matchingPost],
            stamp
          )
        );
        updated += 1;
      } else if (ids.length > 0 && item.syncOrigin !== 'publer' && item.status !== 'deleted') {
        await store.patchDoc('social_posts', item.id, {
          publerStatus: 'deleted',
          status: 'deleted',
          syncStatus: 'synced',
          syncOrigin: 'publer',
          lastSyncedAt: stamp,
        });
        updated += 1;
      }
    }

    for (const post of publerPosts) {
      if (matchedIds.has(String(post.id)) || findSocialPostForPublerPost(socialPosts || [], post))
        continue;
      await store.upsertDoc('social_posts', {
        id: `publer_${post.id}`,
        caption: post.text || '',
        url: post.url || null,
        accountIds: post.accountId ? [post.accountId] : [],
        platforms: post.network ? [post.network] : [],
        scheduledAt: post.scheduledAt,
        publerPostIds: [post.id],
        publerJobId: post.jobId,
        publerStatus: post.state,
        status: publerStateToSocialStatus(post.state),
        source: 'publer',
        unlinkedFromCalendar: true,
        syncStatus: 'synced',
        syncOrigin: 'publer',
        createdAt: stamp,
        lastSyncedAt: stamp,
      });
      created += 1;
    }

    log.log?.(
      `[syncSocialCalendar] fetched=${publerPosts.length} updated=${updated} created=${created}`
    );
    return { skipped: false, fetched: publerPosts.length, updated, created };
  }
  return { run };
}
