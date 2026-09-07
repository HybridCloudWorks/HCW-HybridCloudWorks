/**
 * Every audio episode a provider has, from both systems, as one list (#349).
 *
 * The host's feed ingest (`GET public/podcasts`) and Listen & Learn
 * (`GET public/listen-and-learn/episodes`) are fetched side by side and merged
 * through lib/audioEpisodes.js. Either request failing leaves the other's
 * rows on the page: the two sources are independent, and a Cosmos hiccup on
 * one must not blank a list the other can still fill.
 *
 * `feedUrl` rides along from the podcasts response so the page's RSS button
 * names the feed the timer actually ingests: the provider's own feed when it
 * has one, and otherwise the site's show. A reader subscribing from a page
 * whose provider has no feed should reach the show whose episodes they are
 * looking at, not nothing at all — and on those pages the show is the whole
 * list.
 */
import { useMemo } from 'react';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchPublicListenAndLearnEpisodes, fetchPublicPodcastListing } from '@/lib/publicApi';
import { mergeAudioEpisodes } from '@/lib/audioEpisodes';

const HOST_LIMIT = 50;

export function useAudioEpisodes(provider) {
  const host = usePublicData(
    () => fetchPublicPodcastListing({ provider, limit: HOST_LIMIT }),
    provider ? `podcasts:${provider}:${HOST_LIMIT}` : ''
  );
  const listenAndLearn = usePublicData(
    () => fetchPublicListenAndLearnEpisodes({ platform: provider }),
    provider ? `listen-and-learn-episodes:${provider}` : ''
  );

  const episodes = useMemo(
    () =>
      mergeAudioEpisodes({
        host: host.data?.items || [],
        listenAndLearn: listenAndLearn.data || [],
      }),
    [host.data, listenAndLearn.data]
  );

  return {
    episodes,
    feedUrl: host.data?.feedUrl || host.data?.mainFeedUrl || null,
    loading: host.loading || listenAndLearn.loading,
    error: host.error || listenAndLearn.error || null,
  };
}

export default useAudioEpisodes;
