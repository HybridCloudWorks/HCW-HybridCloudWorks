import { useMemo } from 'react';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchPublicPodcasts } from '@/lib/publicApi';

export function usePodcastData(provider, options = {}) {
  const limit = options.limit || 50;

  const {
    data: raw,
    loading,
    error,
  } = usePublicData(
    () => fetchPublicPodcasts({ provider, limit }),
    provider ? `podcasts:${provider}:${limit}` : ''
  );

  const episodes = useMemo(() => {
    if (!raw || raw.length === 0) return [];
    return raw
      .map((doc) => {
        const item = { ...doc };
        // publishedAt arrives as an ISO string from the API (it was a
        // Firestore Timestamp before) — derive the display fields from either.
        const rawDate = item.publishedAt?.toDate ? item.publishedAt.toDate() : item.publishedAt;
        const parsed = rawDate ? new Date(rawDate) : null;
        if (parsed && !Number.isNaN(parsed.getTime())) {
          item.publishedAtISO = parsed.toISOString();
          item.publishedAtString = parsed.toLocaleDateString();
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
