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
const API_BASE = import.meta.env.VITE_GCP_FUNCTIONS_URL || '';

async function publicGet(pathAndQuery) {
  if (!API_BASE) {
    throw new Error(
      'VITE_GCP_FUNCTIONS_URL is not set. Add it to your .env file before loading public data.'
    );
  }
  const res = await fetch(`${API_BASE}/${pathAndQuery}`, {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Public API request failed with HTTP ${res.status}`);
  }
  return res.json();
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
  if (!API_BASE) {
    throw new Error(
      'VITE_GCP_FUNCTIONS_URL is not set. Add it to your .env file before submitting.'
    );
  }
  const res = await fetch(`${API_BASE}/public/submissions`, {
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
 * GET public/feed — rss_cache documents plus active ai_insights for one
 * provider, in a single round trip (the old code ran two Firestore queries).
 */
export async function fetchPublicFeed(provider) {
  const body = await publicGet(`public/feed?provider=${encodeURIComponent(provider)}`);
  return {
    rssCache: body?.rssCache || [],
    insights: body?.insights || [],
  };
}
