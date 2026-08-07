/**
 * Admin dashboard/queue/publish snapshot RPCs — getQueueSnapshot,
 * getPublishSnapshot, getAdminDashboardSnapshot, recalculateDashboardStats.
 *
 * Ported from Site-Main cms-functions.js (:6038-6170, :6300-6470) with the
 * classification helpers (:88-110, :2000-2130, :2273-2320) verbatim.
 *
 * Cosmos adaptations, each deliberate:
 *   - Firestore `where('x','in',[...])` -> ARRAY_CONTAINS(@list, c.x);
 *     `count()` aggregations -> SELECT VALUE COUNT(1) with the same WHERE.
 *   - Sorting happens in memory on the resolved field. Firestore's orderBy
 *     silently HID documents missing the sort field; here they sort last
 *     instead of vanishing — for an admin queue, showing an item with a
 *     missing timestamp beats hiding it, and the source itself shipped an
 *     unsorted-fetch + JS-sort fallback path accepting these semantics.
 *   - The dashboard stats doc (Firestore `dashboard_stats/v1`) lives in the
 *     existing `system` container as `dashboard_stats_v1`. No container was
 *     migrated for it because it is derived data — recalculateDashboardStats
 *     rebuilds it from a full scan, and the dashboard self-seeds on first
 *     load exactly as the source did.
 */
import { ADMIN_CONTENT_SNAPSHOT_FIELDS } from './cms-content.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const PROJECTION = ['c.id', ...ADMIN_CONTENT_SNAPSHOT_FIELDS.map((f) => `c["${f}"]`)].join(', ');

// ── classification helpers (verbatim) ──────────────────────────────────────

const BLOCKED_CONTENT_HOSTS = new Set(['stackfeed.io']);

function normalizeHostname(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isBlockedContentSource(data = {}) {
  const fields = [
    data.sourceUrl,
    data.url,
    data.link,
    data['CD Url'],
    data.sourceFeed,
    ...(Array.isArray(data.sourceUrls) ? data.sourceUrls : []),
  ];
  return fields.some((value) => BLOCKED_CONTENT_HOSTS.has(normalizeHostname(value)));
}

export function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

const SUPPORTED_ADMIN_TYPES = new Set(['blog', 'framework', 'architecture', 'coder_corner']);

export function getCanonicalContentTypeForAdmin(data = {}) {
  const raw = data.type || data.contentType || data.publishTarget || 'blog';
  const normalized = String(raw || '')
    .trim()
    .toLowerCase();
  if (normalized === 'news' || normalized === 'rss') return 'news';
  if (SUPPORTED_ADMIN_TYPES.has(normalized)) return normalized;
  return 'blog';
}

export function matchesAdminContentType(item = {}, contentTypeFilter = 'all') {
  const canonical = getCanonicalContentTypeForAdmin(item);
  if (contentTypeFilter === 'all') return true;
  if (contentTypeFilter === 'blog') return canonical === 'blog' || canonical === 'news';
  return canonical === contentTypeFilter;
}

export function matchesQueueStatus(item = {}, statusFilter = 'needs_review') {
  const status = String(item.contentStatus || 'ingested');
  if (statusFilter === 'needs_review') {
    return status === 'draft' || status === 'ingested' || status === 'inspected';
  }
  if (statusFilter === 'ready_to_publish') {
    return ['approved', 'published'].includes(status) && item.Live !== true;
  }
  if (statusFilter === 'published_live') {
    return item.Live === true;
  }
  if (statusFilter === 'in_progress') {
    if (status === 'rejected' || status === 'archived') return false;
    if (item.Live === true) return false;
    if (status === 'ingested' || status === 'inspected' || status === 'needs_rework') return false;
    return true;
  }
  return status === statusFilter;
}

export const DASHBOARD_STATS_TYPES = ['blog', 'framework', 'architecture', 'coder_corner', 'news'];
export const DASHBOARD_STATS_DOC_ID = 'dashboard_stats_v1'; // in the `system` container

export function emptyDashboardStats() {
  const stats = { rejected: 0, totalDocs: 0, schemaVersion: 1 };
  DASHBOARD_STATS_TYPES.forEach((type) => {
    stats[type] = { needsReview: 0, inProgress: 0, published: 0, total: 0 };
  });
  return stats;
}

export function summarizeDashboardItems(items = []) {
  const summary = {
    blog: { needsReview: 0, inProgress: 0, published: 0, total: 0 },
    framework: { needsReview: 0, inProgress: 0, published: 0, total: 0 },
    architecture: { needsReview: 0, inProgress: 0, published: 0, total: 0 },
    coder_corner: { needsReview: 0, inProgress: 0, published: 0, total: 0 },
    news: { needsReview: 0, inProgress: 0, published: 0, total: 0 },
    rejected: 0,
  };

  items
    .filter((item) => !isBlockedContentSource(item))
    .forEach((item) => {
      const type = getCanonicalContentTypeForAdmin(item);
      const bucket = summary[type] || summary.blog;
      const status = String(item.contentStatus || 'ingested');

      if (status === 'rejected') {
        summary.rejected += 1;
        return;
      }

      bucket.total += 1;

      if (item.Live === true) {
        bucket.published += 1;
        return;
      }

      if (status === 'draft' || status === 'ingested' || status === 'inspected') {
        bucket.needsReview += 1;
      } else if (status !== 'archived') {
        // Everything else not-yet-Live (in_review, approved, editing,
        // published staged but Live=false) is in progress.
        bucket.inProgress += 1;
      }
    });

  return summary;
}

// ── query plumbing ──────────────────────────────────────────────────────────

/** statusFilter -> { where clause, params, sortField } (source :6333-6358). */
export function queueFilterFor(statusFilter) {
  const inList = (statuses) => ({
    where: 'ARRAY_CONTAINS(@statuses, c.contentStatus)',
    params: [{ name: '@statuses', value: statuses }],
  });
  if (statusFilter === 'needs_review') {
    return { ...inList(['draft', 'ingested', 'inspected']), sortField: 'fetchedAt' };
  }
  if (statusFilter === 'ready_to_publish') {
    return { ...inList(['approved', 'published']), sortField: 'updatedAt' };
  }
  if (statusFilter === 'published_live') {
    return { where: 'c.Live = true', params: [], sortField: 'publishedAt' };
  }
  if (statusFilter === 'in_progress') {
    return { ...inList(['approved', 'in_review', 'editing']), sortField: 'updatedAt' };
  }
  if (statusFilter === 'soft_deleted') {
    return {
      where: 'c.contentStatus = @status',
      params: [{ name: '@status', value: 'rejected' }],
      sortField: 'fetchedAt',
    };
  }
  return {
    where: 'c.contentStatus = @status',
    params: [{ name: '@status', value: String(statusFilter) }],
    sortField: 'fetchedAt',
  };
}

const sortDescBy = (field) => (a, b) => toMillis(b[field]) - toMillis(a[field]);

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 */
export function createAdminSnapshotHandlers({ guard, store, now = () => new Date() }) {
  const countWhere = async (where, params) => {
    const rows = await store.queryDocs(
      'content',
      `SELECT VALUE COUNT(1) FROM c WHERE ${where}`,
      params
    );
    return Number(rows[0]) || 0;
  };

  const fetchProjected = (where, params, top) =>
    store.queryDocs('content', `SELECT TOP ${top} ${PROJECTION} FROM c WHERE ${where}`, params);

  async function recentNeedsReviewItems(limit = 10) {
    const { where, params } = queueFilterFor('needs_review');
    const rows = await fetchProjected(where, params, limit * 3);
    return rows
      .filter((item) => !isBlockedContentSource(item))
      .sort((a, b) => {
        const aMs = toMillis(a.fetchedAt || a.updatedAt || a.createdAt);
        const bMs = toMillis(b.fetchedAt || b.updatedAt || b.createdAt);
        return bMs - aMs;
      })
      .slice(0, limit);
  }

  const FULL_SCAN_TOP = 5000; // content is ~1k docs; bounded, not unbounded

  async function fullScanStats() {
    const rows = await store.queryDocs(
      'content',
      `SELECT TOP ${FULL_SCAN_TOP} c.id, c["contentStatus"], c["Live"], c["type"], c["contentType"], c["publishTarget"], c["targetLandingZone"], c["sourceUrl"], c["sourceUrls"], c["sourceFeed"], c["CD Url"] FROM c`,
      []
    );
    return { items: rows, stats: summarizeDashboardItems(rows) };
  }

  const seedFromStats = (stats, totalDocs) => {
    const seed = emptyDashboardStats();
    seed.rejected = stats.rejected;
    DASHBOARD_STATS_TYPES.forEach((t) => {
      if (stats[t]) seed[t] = { ...stats[t] };
    });
    seed.totalDocs = totalDocs;
    return seed;
  };

  return {
    /** POST /api/getQueueSnapshot — source :6300. */
    async getQueueSnapshot(request, context) {
      const auth = await guard.requireRole(request, 'viewer');
      if (auth.error) return auth.error;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const {
          statusFilter = 'needs_review',
          contentTypeFilter = 'all',
          itemLimit = 100,
        } = body;
        // 1000 cap supports the queue's "All" view (content queue runs 200+).
        const normalizedLimit = Math.min(Math.max(Number(itemLimit) || 100, 1), 1000);
        // Content-type filtering happens in JS (derived from 3 fallback
        // fields); fetch a 3x buffer to survive the discard, as the source did.
        const fetchSize = contentTypeFilter === 'all' ? normalizedLimit : normalizedLimit * 3;

        const { where, params, sortField } = queueFilterFor(statusFilter);
        const [totalCount, rawItems] = await Promise.all([
          countWhere(where, params),
          fetchProjected(where, params, fetchSize),
        ]);

        const blockedInPage = rawItems.filter(isBlockedContentSource).length;
        let items = rawItems.filter((item) => !isBlockedContentSource(item));

        if (statusFilter === 'ready_to_publish' || statusFilter === 'in_progress') {
          items = items.filter((item) => matchesQueueStatus(item, statusFilter));
        } else if (statusFilter === 'rejected') {
          items = items.filter((item) => !item.softDeletedAt);
        } else if (statusFilter === 'soft_deleted') {
          items = items.filter((item) => Boolean(item.softDeletedAt));
        }

        if (contentTypeFilter !== 'all') {
          items = items.filter((item) => matchesAdminContentType(item, contentTypeFilter));
        }

        items.sort(sortDescBy(sortField));

        return json(200, {
          success: true,
          generatedAt: now().toISOString(),
          totalCount: Math.max(0, totalCount - blockedInPage),
          items: items.slice(0, normalizedLimit),
        });
      } catch (error) {
        context.error('getQueueSnapshot failed:', error);
        return json(500, {
          error: 'Failed to generate queue snapshot',
          message: error?.message || 'Unknown error',
        });
      }
    },

    /** POST /api/getPublishSnapshot — source :6405. */
    async getPublishSnapshot(request, context) {
      const auth = await guard.requireRole(request, 'viewer');
      if (auth.error) return auth.error;

      try {
        const ready = queueFilterFor('ready_to_publish');
        const publishedWhere = "c.Live = true AND c.contentStatus = 'published'";

        const [readyTotal, readyRows, publishedTotal, publishedRows] = await Promise.all([
          countWhere(ready.where, ready.params),
          fetchProjected(ready.where, ready.params, 150),
          countWhere(publishedWhere, []),
          fetchProjected(publishedWhere, [], 100),
        ]);

        const readyCandidates = readyRows
          .filter((item) => item.Live !== true)
          .sort(sortDescBy('updatedAt'))
          .slice(0, 100);
        const publishedItems = [...publishedRows].sort(sortDescBy('publishedAt'));

        return json(200, {
          success: true,
          generatedAt: now().toISOString(),
          readyTotal,
          publishedTotal,
          readyCandidates,
          publishedItems,
        });
      } catch (error) {
        context.error('getPublishSnapshot failed:', error);
        return json(500, {
          error: 'Failed to generate publish snapshot',
          message: error?.message || 'Unknown error',
        });
      }
    },

    /** POST /api/getAdminDashboardSnapshot — source :6038. */
    async getAdminDashboardSnapshot(request, context) {
      const auth = await guard.requireRole(request, 'viewer');
      if (auth.error) return auth.error;

      try {
        const [statsDoc, recentNeedsReview] = await Promise.all([
          store.readDoc('system', DASHBOARD_STATS_DOC_ID, DASHBOARD_STATS_DOC_ID),
          recentNeedsReviewItems(10),
        ]);

        let stats;
        if (statsDoc) {
          // Project to the shape summarizeDashboardItems returned so the
          // DashboardPage UI needs no changes.
          stats = emptyDashboardStats();
          delete stats.totalDocs;
          delete stats.schemaVersion;
          DASHBOARD_STATS_TYPES.forEach((t) => {
            if (statsDoc[t]) stats[t] = { ...stats[t], ...statsDoc[t] };
          });
          stats.rejected = statsDoc.rejected || 0;
        } else {
          // Not yet seeded (first deploy): live aggregation + fire-and-forget
          // seed so subsequent loads take the fast path.
          const scan = await fullScanStats();
          stats = scan.stats;
          const seed = seedFromStats(stats, scan.items.length);
          seed.id = DASHBOARD_STATS_DOC_ID;
          seed.updatedAt = now().toISOString();
          store
            .upsertDoc('system', seed)
            .catch((err) => context.warn?.('[dashboard-stats] seed write failed:', err?.message));
        }

        return json(200, {
          success: true,
          generatedAt: now().toISOString(),
          stats,
          recentNeedsReview,
        });
      } catch (error) {
        context.error('getAdminDashboardSnapshot failed:', error);
        return json(500, {
          error: 'Failed to generate dashboard snapshot',
          message: error?.message || 'Unknown error',
        });
      }
    },

    /** POST /api/recalculateDashboardStats — source :6109; full overwrite. */
    async recalculateDashboardStats(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      try {
        const { user } = auth;
        const scan = await fullScanStats();
        const seed = seedFromStats(scan.stats, scan.items.length);
        seed.id = DASHBOARD_STATS_DOC_ID;
        const nowIso = now().toISOString();
        seed.updatedAt = nowIso;
        seed.recalculatedAt = nowIso;
        seed.recalculatedBy = user.email || user.preferred_username || user.oid || 'admin';

        // Deliberate full replace (source used .set() without merge): a
        // recalculation must clear drifted keys, not merge over them.
        await store.upsertDoc('system', seed);

        return json(200, {
          success: true,
          totalDocs: scan.items.length,
          stats: scan.stats,
        });
      } catch (error) {
        context.error('recalculateDashboardStats failed:', error);
        return json(500, {
          error: 'Failed to recalculate dashboard stats',
          message: error?.message || 'Unknown error',
        });
      }
    },
  };
}
