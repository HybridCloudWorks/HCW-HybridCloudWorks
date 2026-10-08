/**
 * The pipeline counts, computed once (ADR 0033 §2).
 *
 * The sidebar and the dashboard each fetched `getAdminDashboardSnapshot` and
 * each summed the same buckets, and the sidebar never asked again, so the
 * dashboard's Recalculate left the badges stale. This hook owns the snapshot,
 * the formula and the refresh: the sidebar refetches on every route change
 * (cheap: one point read of a maintained counter document) and anyone may
 * call `refresh()` after a write that moves content.
 *
 * The buckets come from functions/src/lib/triggers/dashboard-stats.js:
 *   needsReview  draft / ingested / inspected / in_review  → Review Queue badge
 *   inProgress   everything else not live                  → Editor badge
 *   published    Live === true                              → live pages
 *
 * And one count beside them, `readyToPublish` (approved / forge_ready /
 * published, not live → Publish badge). The stats document has no bucket for
 * it, so the snapshot runs the COUNT getPublishSnapshot's readyTotal runs
 * (functions/src/lib/admin-snapshots.js `readyToPublishWhere`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { postJSON } from '@/lib/api';

export const COUNT_TYPES = Object.freeze([
  'blog',
  'news',
  'architecture',
  'framework',
  'coder_corner',
]);

/** Sum a bucket across the types the dashboard reports. */
export function sumBucket(stats, bucket, types = COUNT_TYPES) {
  return types.reduce((total, type) => total + (Number(stats?.[type]?.[bucket]) || 0), 0);
}

/** The counts every surface shows, from one snapshot. */
export function countsFromSnapshot(snapshot) {
  const stats = snapshot?.stats || {};
  return {
    queue: sumBucket(stats, 'needsReview'),
    editor: sumBucket(stats, 'inProgress'),
    live: sumBucket(stats, 'published'),
    publish: Number(snapshot?.readyToPublish) || 0,
    rejected: Number(stats.rejected) || 0,
    byType: Object.fromEntries(
      COUNT_TYPES.map((type) => [
        type,
        {
          needsReview: Number(stats?.[type]?.needsReview) || 0,
          inProgress: Number(stats?.[type]?.inProgress) || 0,
          published: Number(stats?.[type]?.published) || 0,
          total: Number(stats?.[type]?.total) || 0,
        },
      ])
    ),
  };
}

const EMPTY = Object.freeze(countsFromSnapshot(null));

/**
 * @param {{ enabled?: boolean, refetchOnNavigate?: boolean }} options
 */
export default function useDashboardCounts({ enabled = true, refetchOnNavigate = true } = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const [counts, setCounts] = useState(EMPTY);
  // "Loading" means no snapshot yet: a refresh keeps the counts on screen
  // rather than flashing zeros, the way useGuardedLoad keeps its rows.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const { pathname } = useLocation();

  // One read, guarded by generation so a slow older answer never lands over
  // a newer one. No synchronous state write: the effect starts the request
  // and state follows in its callbacks.
  const read = useCallback((mine) => {
    const current = () => mine === generation.current;
    return postJSON('getAdminDashboardSnapshot', {})
      .then((result) => {
        if (!current()) return null;
        setSnapshot(result);
        setCounts(countsFromSnapshot(result));
        setError('');
        return result;
      })
      .catch((err) => {
        if (current()) setError(err?.message || 'Could not load the pipeline counts.');
        return null;
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
  }, []);

  const refresh = useCallback(() => read(++generation.current), [read]);

  const recalculate = useCallback(async () => {
    await postJSON('recalculateDashboardStats', {});
    return refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    read(++generation.current);
    return () => {
      generation.current += 1;
    };
    // Re-read on navigation when asked: a page the user just left may have
    // moved content, and the counter read is one point lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, read, refetchOnNavigate ? pathname : null]);

  return { snapshot, counts, loading, error, refresh, recalculate };
}
