import { useMemo } from 'react';
import { useFirestoreCollection } from './useFirestore';

export function usePodcastData(provider, options = {}) {
  const limit = options.limit || 50;

  const {
    data: raw,
    loading,
    error,
  } = useFirestoreCollection('podcasts', {
    where: ['provider', '==', provider],
    orderBy: ['publishedAt', 'desc'],
    limit,
  });

  const episodes = useMemo(() => {
    if (!raw || raw.length === 0) return [];
    return raw
      .map((doc) => {
        const item = { id: doc.id, ...doc };
        if (item.publishedAt && item.publishedAt.toDate) {
          item.publishedAtISO = item.publishedAt.toDate().toISOString();
          item.publishedAtString = new Date(item.publishedAt.toDate()).toLocaleDateString();
        }
        return item;
      })
      .sort((a, b) => {
        const ta = a.publishedAtISO ? new Date(a.publishedAtISO).getTime() : 0;
        const tb = b.publishedAtISO ? new Date(b.publishedAtISO).getTime() : 0;
        return tb - ta;
      });
  }, [raw]);

  return { episodes, loading, error };
}

export default usePodcastData;
