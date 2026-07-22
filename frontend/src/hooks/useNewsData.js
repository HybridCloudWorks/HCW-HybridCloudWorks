import { useMemo } from 'react';
import { useFirestoreCollection } from './useFirestore';

const SITE_RELEVANT_TAGS_BY_PROVIDER = {
  azure: [
    'AI/ML',
    'Security',
    'Architecture',
    'Containers',
    'Database',
    'DevOps',
    'Serverless',
    'Cost',
    'Networking',
    'GA',
    'Update',
    'Preview',
  ],
  aws: [
    'AI/ML',
    'Security',
    'Architecture',
    'Containers',
    'Database',
    'DevOps',
    'Serverless',
    'Cost',
    'Networking',
    'GA',
    'Update',
    'Preview',
  ],
  gcp: [
    'AI/ML',
    'Security',
    'Architecture',
    'Containers',
    'Database',
    'DevOps',
    'Serverless',
    'Cost',
    'Networking',
    'GA',
    'Update',
    'Preview',
  ],
  github: ['AI/ML', 'Security', 'DevOps', 'Copilot', 'Actions', 'Automation', 'GA', 'Update'],
  terraform: [
    'IaC',
    'DevOps',
    'Modules',
    'Cloud',
    'Architecture',
    'Best Practices',
    'Update',
    'GA',
  ],
  finops: [
    'Cost',
    'Optimization',
    'AI/ML',
    'FinOps',
    'Framework',
    'Cloud',
    'Efficiency',
    'Update',
    'GA',
  ],
};

function scoreRssItemForCuration(item, provider) {
  let score = 0;
  const relevantTags = SITE_RELEVANT_TAGS_BY_PROVIDER[provider] || [];

  if (item.tags || item.category) {
    const itemTags = (item.tags || []).concat(item.category || []).map((tag) => String(tag).trim());
    itemTags.forEach((tag) => {
      if (relevantTags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase())) {
        score += 5;
      }
    });
  }

  if (item.category && relevantTags.includes(item.category)) {
    score += 3;
  }

  if (item.pubDate) {
    const pubDate = new Date(item.pubDate);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (pubDate > sevenDaysAgo) {
      score += 2;
    }
  }

  if (item.title) {
    const titleLower = item.title.toLowerCase();
    const keywords = [
      'ai',
      'ml',
      'machine learning',
      'security',
      'architecture',
      'best practice',
      'new release',
      'announcement',
      'innovation',
      'optimization',
      'performance',
      'kubernetes',
      'container',
      'serverless',
      'database',
      'network',
    ];
    keywords.forEach((keyword) => {
      if (titleLower.includes(keyword)) score += 1;
    });
  }

  return Math.max(0, score);
}

function curateArticlesFromRss(rssItems, provider) {
  if (!rssItems || rssItems.length === 0) {
    return { curatedArticles: [], liveItems: [] };
  }

  const scoredItems = rssItems.map((item) => {
    // Derive a stable ID from the article URL so cache hits survive position changes on refresh.
    // Fall back to title-only slug if no URL is available.
    const stableKey =
      item.id ||
      (() => {
        const url = item.sourceUrl || item['CD Url'] || item.url || item.link || '';
        const slug = url
          ? url
              .replace(/^https?:\/\//, '')
              .replace(/[^a-z0-9]/gi, '')
              .slice(0, 60)
          : item.title?.replace(/[^a-z0-9]/gi, '').slice(0, 40) || '';
        return `rss-${provider}-${slug}`;
      })();
    return {
      ...item,
      id: stableKey,
      _curationScore: scoreRssItemForCuration(item, provider),
    };
  });

  const sorted = scoredItems.sort((a, b) => b._curationScore - a._curationScore);
  const maxCurated = 12;

  return {
    curatedArticles: sorted.slice(0, maxCurated).map(({ _curationScore, ...item }) => item),
    liveItems: sorted.slice(maxCurated).map(({ _curationScore, ...item }) => item),
  };
}

function getInsightsData(includeInsights, insightsFromFirestore) {
  if (!includeInsights) {
    return [];
  }
  return insightsFromFirestore || [];
}

function getLoadingState(includeInsights, rssLoading, insightsLoading) {
  if (includeInsights) {
    return rssLoading || insightsLoading;
  }
  return rssLoading;
}

function getErrorState(includeInsights, rssError, insightsError) {
  return rssError || (includeInsights ? insightsError : null);
}

export function useNewsData(provider, options = {}) {
  const includeInsights = options.includeInsights === true;

  const {
    data: rawRssCache,
    loading: rssLoading,
    error: rssError,
  } = useFirestoreCollection('rss_cache', {
    where: ['provider', '==', provider],
  });

  const {
    data: rawInsights,
    loading: insightsLoading,
    error: insightsError,
  } = useFirestoreCollection('ai_insights', {
    where: ['provider', '==', provider],
  });

  const rssFromFirestore = useMemo(() => {
    if (rawRssCache && rawRssCache.length > 0) {
      const allItems = rawRssCache.flatMap((cache) =>
        (cache.items || []).map((item) => ({
          item: {
            ...item,
            feedName: cache.feedName,
          },
          sortTime: new Date(item.pubDate).getTime(),
        }))
      );

      return allItems
        .sort((a, b) => b.sortTime - a.sortTime)
        .slice(0, 30)
        .map(({ item }) => item);
    }
    return null;
  }, [rawRssCache]);

  const insightsFromFirestore = useMemo(() => {
    if (rawInsights && rawInsights.length > 0) {
      const active = rawInsights.filter((item) => item.active !== false);
      if (active.length > 0) return active;
    }
    return null;
  }, [rawInsights]);

  const rssItemsFromProvider = useMemo(() => rssFromFirestore || [], [rssFromFirestore]);

  const { curatedArticles, liveItems } = useMemo(
    () => curateArticlesFromRss(rssItemsFromProvider, provider),
    [rssItemsFromProvider, provider]
  );

  const articles = curatedArticles;
  const rssItems = liveItems;
  const insights = getInsightsData(includeInsights, insightsFromFirestore);
  const loading = getLoadingState(includeInsights, rssLoading, insightsLoading);
  const error = getErrorState(includeInsights, rssError, insightsError);

  return { articles, rssItems, insights, loading, error };
}

export default useNewsData;
