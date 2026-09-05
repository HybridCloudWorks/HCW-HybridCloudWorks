/**
 * Anonymous public API client — plain fetch against the Azure Functions
 * public endpoints (routes in functions/src/functions/public-reads.js).
 *
 * No auth and no MSAL on purpose: these are the reads the browser used to
 * make directly against Firestore under public security rules. The server
 * now owns the public filter (drafts and soft-deleted documents never appear
 * in responses) and strips internal review/audit fields, so consumers can
 * render what they receive without re-checking visibility.
 */
import { requireFunctionsBase } from '@/lib/functionsBase';

/**
 * Rows requested when a caller wants "the published corpus" (T-716).
 *
 * The three hooks that do this asked for 200, 250 and 150 — three DIFFERENT
 * urls for one intent, which defeats any sharing between them. One constant
 * means one url, so the dedupe below actually applies; 250 is the largest of
 * the previous values, so no caller loses rows.
 */
export const PUBLIC_CORPUS_LIMIT = 250;

/**
 * In-flight and recently-resolved GETs, keyed by full path+query (T-716).
 *
 * Three hooks — useBlogData, useProviderLandingContent and useFrameworkData —
 * each request the published corpus under its own `usePublicData` cache key,
 * and `usePublicData` holds state per hook instance, so identical requests were
 * never shared. Walking /aws -> /aws/blog -> /aws/frameworks downloaded the
 * whole corpus three times, bodies included.
 *
 * Deduplicating at the request layer fixes it for every caller at once and
 * changes no filtering semantics, which matters here: the client-side provider
 * matching includes text inference the server does not perform, so pushing the
 * filter server-side would silently drop posts (see T-738).
 *
 * The TTL is deliberately short. This is a read-through convenience for one
 * navigation session, not a cache with an invalidation story: published content
 * changes rarely, and 30 seconds is far below the window in which a visitor
 * would notice.
 */
const PUBLIC_GET_TTL_MS = 30_000;
const publicGetCache = new Map();

/** Exposed for tests; also the honest escape hatch if a caller needs freshness. */
export function clearPublicGetCache() {
  publicGetCache.clear();
}

async function publicGet(pathAndQuery) {
  const cached = publicGetCache.get(pathAndQuery);
  // A pending entry is reused regardless of age: two components mounting in the
  // same tick must share one request, which is the concurrent half of the bug.
  if (cached && (cached.pending || Date.now() - cached.at < PUBLIC_GET_TTL_MS)) {
    return cached.promise;
  }

  const base = requireFunctionsBase(pathAndQuery);
  const promise = (async () => {
    const res = await fetch(`${base}/${pathAndQuery}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Public API request failed with HTTP ${res.status}`);
    }
    return res.json();
  })();

  const entry = { promise, pending: true, at: Date.now() };
  publicGetCache.set(pathAndQuery, entry);
  try {
    const body = await promise;
    entry.pending = false;
    entry.at = Date.now();
    return body;
  } catch (err) {
    // A failure must not be cached: the next caller has to be able to retry.
    publicGetCache.delete(pathAndQuery);
    throw err;
  }
}

/**
 * GET public/content — published documents, newest first.
 * @param {object} [options]
 * @param {string} [options.type] - canonical content type (e.g. 'architecture')
 * @param {string} [options.provider] - provider key; the server expands the
 *   spelling aliases ('gcp' matches 'Google Cloud', etc.)
 * @param {number} [options.limit]
 * @param {number} [options.offset]
 * @param {string} [options.source] - 'blogs' for the legacy fallback container
 * @returns {Promise<object[]>} full documents, internal fields stripped
 */
export async function fetchPublicContentList({ type, provider, limit, offset, source } = {}) {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (provider) params.set('provider', provider);
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  if (source) params.set('source', source);
  const qs = params.toString();
  const body = await publicGet(`public/content${qs ? `?${qs}` : ''}`);
  return body?.items || [];
}

/**
 * GET public/content/{slugOrId} — the server folds the whole client-side
 * fallback chain (id → slug → Slug, content then legacy blogs) and 404s
 * anything non-public. Returns null when not found.
 */
export async function fetchPublicContentItem(slugOrId) {
  if (!slugOrId) return null;
  const body = await publicGet(`public/content/${encodeURIComponent(slugOrId)}`);
  return body?.item || null;
}

/**
 * GET public/preview/{contentId}?t={token} — the signed staging preview
 * (T-606). The HMAC token is the whole authorization; the server answers an
 * identical 404 for anything invalid, so null covers bad token, expiry and
 * missing document alike.
 */
export async function fetchPreviewContentItem(contentId, token) {
  if (!contentId || !token) return null;
  const body = await publicGet(
    `public/preview/${encodeURIComponent(contentId)}?t=${encodeURIComponent(token)}`
  );
  return body?.item || null;
}

/**
 * GET public/snapshots/{id} — items from a build-time snapshot document
 * ('certifications' | 'speakerevents'). Returns [] when missing or on error,
 * matching the quiet-fallback contract of loadPublicDataSnapshot.
 */
export async function fetchPublicSnapshotItems(id) {
  try {
    const body = await publicGet(`public/snapshots/${encodeURIComponent(id)}`);
    const items = body?.snapshot?.items;
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

/**
 * POST public/submissions — anonymous content submission. The server owns
 * validation, document composition, and the per-client hourly quota (429),
 * replacing the pages' direct addDoc writes into the content collection.
 * Resolves to { ok, id }; throws with the server's message on rejection.
 */
export async function submitPublicContent(body) {
  const base = requireFunctionsBase('public/submissions');
  const res = await fetch(`${base}/public/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.error ||
        (res.status === 429
          ? 'Submission rate limit exceeded — try again later.'
          : `Submission failed with HTTP ${res.status}`)
    );
  }
  return data;
}

/** GET public/podcasts — episodes for a provider, newest first. */
export async function fetchPublicPodcasts({ provider, limit } = {}) {
  const params = new URLSearchParams();
  if (provider) params.set('provider', provider);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  const body = await publicGet(`public/podcasts${qs ? `?${qs}` : ''}`);
  return body?.items || [];
}

/**
 * GET public/feed — rss_cache documents for one provider, in a single round
 * trip (the old code ran two Firestore queries; the second, `ai_insights`,
 * fed a panel retired on 2026-09-05 — T-765).
 */
export async function fetchPublicFeed(provider) {
  const body = await publicGet(`public/feed?provider=${encodeURIComponent(provider)}`);
  return {
    rssCache: body?.rssCache || [],
  };
}

/**
 * GET public/curated-image/{articleId} — the cached hero image for a curated
 * news article, or null when none has been generated.
 *
 * Anonymous on purpose. The equivalent admin route is editor-gated, and the
 * news pages that need this are public, so calling that one made every
 * anonymous visitor's lookup throw at token acquisition and left the grid with
 * no imagery (TODO.md T-210). The server returns only the URL — never the
 * document, which carries an internal blob path and prompt metadata.
 */
export async function fetchPublicCuratedImage(articleId) {
  if (!articleId) return null;
  const body = await publicGet(`public/curated-image/${encodeURIComponent(articleId)}`);
  return body?.imageUrl || null;
}

/**
 * Ids per batched curated-image request. Must not exceed the server's
 * `CURATED_IMAGE_BATCH_MAX`, which answers 400 above it.
 */
export const CURATED_IMAGE_BATCH_SIZE = 50;

/**
 * GET public/curated-images — covers for a whole grid in one round trip (T-739).
 *
 * The news grid issued one `public/curated-image/{id}` per card: twelve extra
 * round trips before any cover appeared, on a route that had already fetched
 * the feed.
 *
 * Returns a plain `{ id: url|null }` map covering every id asked for, so a
 * caller can tell "no cover" from "not asked about". A failed request resolves
 * to all-null rather than throwing: a missing cover is a degraded card, not a
 * broken page, which is the same contract `fetchPublicCuratedImage` has.
 *
 * @param {string[]} articleIds
 * @returns {Promise<Record<string, string|null>>}
 */
export async function fetchPublicCuratedImages(articleIds) {
  const ids = [...new Set((articleIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (ids.length === 0) return {};

  const result = Object.fromEntries(ids.map((id) => [id, null]));

  // Chunked so a longer grid cannot trip the server's cap. Sequential rather
  // than parallel: the point of this function is to stop hammering the API,
  // and a grid large enough to need two chunks is not latency-critical.
  for (let i = 0; i < ids.length; i += CURATED_IMAGE_BATCH_SIZE) {
    const chunk = ids.slice(i, i + CURATED_IMAGE_BATCH_SIZE);
    try {
      const body = await publicGet(
        `public/curated-images?ids=${chunk.map(encodeURIComponent).join(',')}`
      );
      for (const [id, url] of Object.entries(body?.images || {})) {
        if (id in result) result[id] = url || null;
      }
    } catch {
      // Leave this chunk null. Covers are decoration; the grid still renders.
    }
  }

  return result;
}

/**
 * GET public/listen-and-learn — the approved episodes of one certification.
 *
 * The server filters to `status === 'published'`, which is the whole review
 * gate: episodes are AI-written summaries of a paid exam's objectives,
 * generated as drafts and approved one at a time in the admin portal. There is
 * deliberately no way to ask this endpoint for anything else.
 *
 * Returns `null` for a certification that has never been generated, which the
 * page renders differently from a generated set with nothing approved yet —
 * that comes back with an empty `episodes` array.
 *
 * @param {{platform: string, examCode: string}} params
 * @returns {Promise<{set: object, episodes: object[]}|null>}
 */
export async function fetchPublicListenAndLearn({ platform, examCode } = {}) {
  if (!platform || !examCode) return null;
  const params = new URLSearchParams({ platform, examCode });
  const body = await publicGet(`public/listen-and-learn?${params}`);
  if (!body) return null;
  return { set: body.set || null, episodes: body.episodes || [] };
}
