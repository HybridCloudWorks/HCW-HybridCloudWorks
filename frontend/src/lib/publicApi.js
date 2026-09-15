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

/** One uncached GET: the JSON body, null for a 404, a thrown Error otherwise. */
async function fetchPublicJSON(pathAndQuery) {
  const base = requireFunctionsBase(pathAndQuery);
  const res = await fetch(`${base}/${pathAndQuery}`, {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Public API request failed with HTTP ${res.status}`);
  }
  return res.json();
}

async function publicGet(pathAndQuery) {
  const cached = publicGetCache.get(pathAndQuery);
  // A pending entry is reused regardless of age: two components mounting in the
  // same tick must share one request, which is the concurrent half of the bug.
  if (cached && (cached.pending || Date.now() - cached.at < PUBLIC_GET_TTL_MS)) {
    return cached.promise;
  }

  const promise = fetchPublicJSON(pathAndQuery);

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
 * GET public/snapshots/{id} as a whole — `{ generatedAt, items }` — for the
 * Certifications Hub's Publishing tab, which has to say when the snapshot was
 * written and compare it with the admin rows. Unlike fetchPublicSnapshotItems
 * it throws on failure (the tab shows the error) and returns null when no
 * snapshot has been published. `fresh` bypasses this module's cache entirely
 * (never read, never written, so repeated fresh reads cannot grow it) and adds
 * a throwaway query value so an HTTP cache cannot answer with the copy from
 * before a publish either; the route ignores the value.
 */
export async function fetchPublicSnapshot(id, { fresh = false } = {}) {
  const path = `public/snapshots/${encodeURIComponent(id)}`;
  const body = fresh ? await fetchPublicJSON(`${path}?fresh=${Date.now()}`) : await publicGet(path);
  const snapshot = body?.snapshot;
  if (!snapshot) return null;
  return {
    generatedAt: typeof snapshot.generatedAt === 'string' ? snapshot.generatedAt : null,
    items: Array.isArray(snapshot.items) ? snapshot.items : [],
  };
}

/**
 * GET public/cloud-tools/pricing?region= — the cached price comparison for one
 * region (#613, Phase 1): `{ region, regions, refreshedAt, ttlMinutes,
 * ageMinutes, stale, counts, services }`, where each service carries one row
 * per provider that answered and a provider missing from `rows` is
 * "unavailable". Read by /tools/comparison and by the Integrations Hub's
 * "Cloud pricing cache" card.
 *
 * Throws on failure like `fetchPublicSnapshot`, so the page can show the
 * server's sentence — an unknown region is a 400 with one. A cache that has
 * never been filled is NOT a failure: the server answers 200 with
 * `refreshedAt: null` and no services, and the page renders that as its own
 * state. Returns null only when the route itself is missing (404).
 *
 * `fresh` is the same escape hatch `fetchPublicSnapshot` has, and it exists
 * for the same reason: the route answers with `Cache-Control: max-age=900`,
 * so after "Refresh now" the card would otherwise read the browser's copy
 * from before the refresh for up to fifteen minutes. The throwaway query
 * value defeats that cache and this module's; the route ignores it.
 *
 * @param {string} [region]
 * @param {{ fresh?: boolean }} [options]
 * @returns {Promise<object|null>}
 */
export async function fetchCloudPricing(region = 'us-east-1', { fresh = false } = {}) {
  const params = new URLSearchParams({ region: String(region || 'us-east-1') });
  if (fresh) params.set('fresh', String(Date.now()));
  const path = `public/cloud-tools/pricing?${params}`;
  const body = fresh ? await fetchPublicJSON(path) : await publicGet(path);
  if (!body) return null;
  if (!body.pricing || typeof body.pricing !== 'object') {
    throw new Error('Pricing response carried no pricing object');
  }
  return body.pricing;
}

/**
 * GET public/cloud-tools/price-changes?region= — what moved in the cached
 * prices of one region over the last week and month (#613, Phase 3):
 * `{ region, asOf, windows: { '7d': { since, sampleDay, items }, '30d': {…} },
 * sampleDays }`, each item `{ serviceId, label, provider, unit, sku, from,
 * to, deltaPct }` sorted by the size of the move. Until the daily refresh has
 * written more than one sample there is no history: the server answers 200
 * with `asOf: null` and empty windows, and the page renders that as its own
 * state. Returns null only when the route itself is missing (404); throws
 * with the server's sentence otherwise, as `fetchCloudPricing` does.
 *
 * @param {string} [region]
 * @returns {Promise<object|null>}
 */
export async function fetchPriceChanges(region = 'us-east-1') {
  const params = new URLSearchParams({ region: String(region || 'us-east-1') });
  const body = await publicGet(`public/cloud-tools/price-changes?${params}`);
  if (!body) return null;
  if (!body.changes || typeof body.changes !== 'object') {
    throw new Error('Price-changes response carried no changes object');
  }
  return body.changes;
}

/**
 * POST public/cloud-tools/explain — two paragraphs from the AI provider about
 * a scenario's numbers (#613, Phase 3). The body is the computed comparison
 * the page already shows: `{ region, scenarioId, scenarioLabel, extras,
 * egressGb, results: [{ provider, total, base, segments, unavailable }] }`;
 * the server caps it at 8 KB and answers `{ text, model, generatedAt,
 * cached }`.
 *
 * Never cached here and never deduplicated: it is a POST the reader asked for
 * by pressing a button, and the server owns both the per-client quota (429,
 * five an hour) and the "paused" state (503). The thrown Error carries
 * `status` so the button can say "try again in a while" for one and the
 * server's own sentence for the other, the way lib/api.js does for admin
 * calls.
 *
 * @param {object} body
 * @returns {Promise<{ text: string, model: string, generatedAt: string, cached: boolean }>}
 */
export async function requestPricingExplanation(body) {
  const base = requireFunctionsBase('public/cloud-tools/explain');
  const res = await fetch(`${base}/public/cloud-tools/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Explanation request failed with HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  if (!data.explanation || typeof data.explanation.text !== 'string') {
    throw new Error('Explanation response carried no text');
  }
  return data.explanation;
}

/**
 * GET public/newsletter/signup-config — where the newsletter signup box shows
 * and its heading and blurb (#557): `{ placement, heading, blurb }`. The
 * server answers its defaults rather than failing, so a throw here is a
 * network or configuration problem; hooks/useNewsletterSignupConfig.js turns
 * it into the built-in defaults.
 */
export async function fetchNewsletterSignupConfig() {
  return publicGet('public/newsletter/signup-config');
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

/**
 * GET public/podcasts — a provider's host-ingested episodes and the site's
 * own show, plus the feeds they were ingested from (#349).
 *
 * `feedUrl` is the provider's row in `admin_config/podcast_feeds` and
 * `mainFeedUrl` is the site's show in the same document — the one the ingest
 * timer reads — so the RSS subscribe button and the list it sits beside
 * cannot name two different feeds. Either is null until the owner seeds it.
 *
 * @returns {Promise<{items: object[], feedUrl: string|null, mainFeedUrl: string|null}>}
 */
export async function fetchPublicPodcastListing({ provider, limit } = {}) {
  const params = new URLSearchParams();
  if (provider) params.set('provider', provider);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  const body = await publicGet(`public/podcasts${qs ? `?${qs}` : ''}`);
  return {
    items: body?.items || [],
    feedUrl: body?.feedUrl || null,
    mainFeedUrl: body?.mainFeedUrl || null,
  };
}

/** GET public/podcasts — episodes only. Kept for callers that never needed the feed. */
export async function fetchPublicPodcasts(options = {}) {
  return (await fetchPublicPodcastListing(options)).items;
}

/**
 * GET public/listen-and-learn/episodes — every approved Listen & Learn
 * episode with audio across a provider's certifications, newest first, for
 * the provider's podcast page (#349).
 *
 * The same `status === 'published'` gate as `fetchPublicListenAndLearn`,
 * applied server-side; rows are a listing projection (no transcript, no
 * videos) joined to their certification's title and slug.
 *
 * @param {{platform: string}} params
 * @returns {Promise<object[]>}
 */
export async function fetchPublicListenAndLearnEpisodes({ platform } = {}) {
  if (!platform) return [];
  const params = new URLSearchParams({ platform });
  const body = await publicGet(`public/listen-and-learn/episodes?${params}`);
  return body?.items || [];
}

/**
 * GET public/cert-events?platform= — the certification lifecycle events the
 * Friday Skills Hub scraper has recorded for a provider, newest first, for
 * the education timeline (#461 item 4; lib/certEvents.js merges them over
 * the static entries). Empty when nothing has been scraped for the provider.
 */
export async function fetchPublicCertEvents({ platform } = {}) {
  if (!platform) return [];
  const params = new URLSearchParams({ platform });
  const body = await publicGet(`public/cert-events?${params}`);
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
