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
 */
import { readKey } from '../ai/router.js';
import { fetchWithTimeout } from '../http/fetch-with-timeout.js';
import { createKeyVerdictReporter, isCredentialRejected } from '../key-verdict.js';

// Outbound deadline (T-712): Node's fetch has none, and these calls are
// reached from change-feed handlers where a hung socket holds the lease.
const PUBLER_TIMEOUT_MS = 20_000;

export const PUBLER_API_BASE_URL = 'https://app.publer.com/api/v1';
const SYNC_STATES = ['scheduled', 'published', 'failed'];
const MAX_PAGES_PER_STATE = 10;

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

  async function request(path, method = 'GET', body) {
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
    if (!response.ok) {
      // Only a 401/403 is a verdict on the key. A 404 is a wrong path, a 429
      // a busy account, a 5xx Publer's problem — none of them says the
      // credential is bad, and the light stays as it was.
      if (isCredentialRejected(response.status)) {
        await reportVerdict('PUBLER_API_KEY', { ok: false, status: response.status });
      }
      const error = new Error(`Publer ${method} ${path} failed with HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    await reportVerdict('PUBLER_API_KEY', { ok: true });
    return data;
  }

  async function listPostsForSync() {
    const results = [];
    for (const state of SYNC_STATES) {
      let page = 0;
      // Assigned from the first response before the while condition reads it;
      // the do-while guarantees one pass, so there is no initial value to seed.
      let totalPages;
      do {
        const response = await request(`/posts?state=${state}&per_page=100&page=${page}`);
        results.push(...extractPublerList(response));
        totalPages = Number(response?.total_pages || 1);
        page += 1;
      } while (page < Math.min(totalPages, MAX_PAGES_PER_STATE));
    }
    return results.map(normalizePublerPost).filter((post) => post.id);
  }

  return { configured: Boolean(apiKey && workspaceId), request, listPostsForSync };
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
