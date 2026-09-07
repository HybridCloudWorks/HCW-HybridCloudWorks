/**
 * `useAudioEpisodes` — the two audio sources as one list, and which feed the
 * page's RSS button is allowed to name.
 *
 * The subscribe button is the assertion worth having here. A reader on a
 * provider page whose provider has no feed of its own is looking at the site's
 * show, so the button must reach the site's show; before the main feed existed
 * there was nothing to fall back to and the button simply disappeared.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/functionsBase', () => ({
  resolveMediaUrl: (url) => url,
}));

vi.mock('@/lib/publicApi', () => ({
  fetchPublicPodcastListing: vi.fn(),
  fetchPublicListenAndLearnEpisodes: vi.fn(),
}));

import { fetchPublicListenAndLearnEpisodes, fetchPublicPodcastListing } from '@/lib/publicApi';
import { useAudioEpisodes } from './useAudioEpisodes';

const MAIN_FEED = 'https://media.rss.com/hybrid-cloud-insights/feed.xml';

/** Resolve the hook for one podcasts response, with no Listen & Learn rows. */
async function load(listing) {
  fetchPublicPodcastListing.mockResolvedValue(listing);
  fetchPublicListenAndLearnEpisodes.mockResolvedValue([]);
  const { result } = renderHook(() => useAudioEpisodes('aws'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAudioEpisodes', () => {
  it("names the provider's own feed when it has one", async () => {
    const result = await load({
      items: [{ id: 'a', provider: 'aws' }],
      feedUrl: 'https://feeds.example/aws.xml',
      mainFeedUrl: MAIN_FEED,
    });
    expect(result.current.feedUrl).toBe('https://feeds.example/aws.xml');
  });

  it("falls back to the site's show where the provider has no feed", async () => {
    const result = await load({
      items: [{ id: 'show-1', provider: 'main' }],
      feedUrl: null,
      mainFeedUrl: MAIN_FEED,
    });
    expect(result.current.feedUrl).toBe(MAIN_FEED);
    // And the rows are the show's, labelled as the show rather than as this
    // provider's feed.
    expect(result.current.episodes.map((e) => e.source)).toEqual(['main']);
  });

  it('has no feed to name when neither is configured', async () => {
    const result = await load({ items: [], feedUrl: null, mainFeedUrl: null });
    expect(result.current.feedUrl).toBeNull();
    expect(result.current.episodes).toEqual([]);
  });

  it('leads with the show and keeps the provider rows below it', async () => {
    fetchPublicPodcastListing.mockResolvedValue({
      items: [
        { id: 'aws-1', provider: 'aws', publishedAt: '2026-09-05T00:00:00Z' },
        { id: 'show-1', provider: 'main', publishedAt: '2026-06-01T00:00:00Z' },
      ],
      feedUrl: null,
      mainFeedUrl: MAIN_FEED,
    });
    fetchPublicListenAndLearnEpisodes.mockResolvedValue([
      { id: 'll', setId: 's', provider: 'aws', audioUrl: '/x.mp3', approvedAt: '2026-09-09Z' },
    ]);
    const { result } = renderHook(() => useAudioEpisodes('aws'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.episodes.map((e) => e.id)).toEqual([
      'host:show-1',
      'listen-and-learn:s/ll',
      'host:aws-1',
    ]);
  });
});
