/**
 * The two reads the queue page makes, as hooks out of QueuePage.jsx
 * (PR #841): the queue snapshot for the current filters, and the forged-today
 * meter.
 */
import { useEffect, useState } from 'react';
import { postJSON } from '@/lib/api';
import { forgedTodayFromStats, sortQueueItems } from './itemHelpers';

/**
 * The items and total for the current filters, refetched whenever one
 * changes. Nothing is requested until auth is ready, because the snapshot
 * route is authenticated.
 */
export function useQueueSnapshot({
  authReady,
  statusFilter,
  contentTypeFilter,
  kindFilter,
  ideaOriginFilter,
  pageSize,
}) {
  const [items, setItems] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!authReady) return;
    async function loadItems() {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await postJSON('getQueueSnapshot', {
          statusFilter,
          contentTypeFilter,
          kindFilter,
          ideaOriginFilter,
          itemLimit: pageSize,
        });
        setItems((result.items || []).sort(sortQueueItems));
        setTotalCount(result.totalCount || 0);
      } catch (err) {
        console.error('Error loading queue:', err);
        setLoadError(err.message || 'Failed to load queue items.');
      } finally {
        setLoading(false);
      }
    }
    loadItems();
  }, [authReady, statusFilter, contentTypeFilter, kindFilter, ideaOriginFilter, pageSize]);

  return { items, setItems, totalCount, loading, loadError };
}

/** The meter's reading from a getForgeConfig answer. */
export function forgeMeterFromConfig(config) {
  return {
    forged: forgedTodayFromStats(config.stats),
    limit: Number(config.prompts?.autoForge?.dailyLimit) || 0,
    enabled: Boolean(config.prompts?.autoForge?.enabled),
  };
}

/**
 * The forged-today meter (T-607). Best effort: a failed read leaves the
 * header without a meter rather than without a queue, so this is null until
 * getForgeConfig answers and stays null if it never does.
 */
export function useForgeMeter(authReady) {
  const [forgeMeter, setForgeMeter] = useState(null);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    (async () => {
      try {
        const config = await postJSON('getForgeConfig', {});
        if (!cancelled && config?.ok) setForgeMeter(forgeMeterFromConfig(config));
      } catch {
        // No meter; the queue itself is unaffected.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  return forgeMeter;
}
