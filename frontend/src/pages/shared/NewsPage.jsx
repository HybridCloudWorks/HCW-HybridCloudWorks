import React from 'react';
import { Helmet } from 'react-helmet-async';
import { useProvider, useProviderConfig } from '@/context/ProviderContext';
import { useNewsData } from '@/hooks/useNewsData';
import { ScrollTrigger } from '@/components/animations';
import CuratedArticlesGrid from '@/components/news/CuratedArticlesGrid';
import RssFeedTimeline from '@/components/news/RssFeedTimeline';
import AiInsightsPanel from '@/components/news/AiInsightsPanel';

const NEWS_META = {
  azure: {
    title: 'Azure Platform News',
    subtitle: 'Latest from Microsoft Azure — announcements, architecture insights, and AI updates.',
    gradientFrom: 'from-azure-primary',
    gradientTo: 'to-azure-primary',
    glowColor: 'rgba(var(--primary-rgb,0,120,212),0.3)',
    bgGlow: 'bg-blue-500/10',
  },
  aws: {
    title: 'AWS Cloud News',
    subtitle: 'Amazon Web Services updates — all day, everyday.',
    gradientFrom: 'from-aws-primary',
    gradientTo: 'to-aws-primary',
    glowColor: 'rgba(var(--primary-rgb,255,153,0),0.3)',
    bgGlow: 'bg-orange-500/10',
  },
  gcp: {
    title: 'Google Cloud News',
    subtitle:
      'Google Cloud Platform updates — Vertex AI, GKE, BigQuery, and infrastructure innovations.',
    gradientFrom: 'from-gcp-primary',
    gradientTo: 'to-gcp-primary',
    glowColor: 'rgba(var(--primary-rgb,66,133,244),0.3)',
    bgGlow: 'bg-blue-500/10',
  },
  github: {
    title: 'GitHub News',
    subtitle: 'GitHub updates — Copilot, Actions, security features, and developer tooling.',
    gradientFrom: 'from-slate-700 dark:from-slate-300',
    gradientTo: 'to-slate-700 dark:to-slate-100',
    glowColor: 'rgba(var(--primary-rgb,110,118,129),0.3)',
    bgGlow: 'bg-slate-400/10',
  },
  terraform: {
    title: 'Terraform News',
    subtitle:
      'HashiCorp Terraform updates — IaC best practices, module releases, and cloud automation.',
    gradientFrom: 'from-terraform-primary',
    gradientTo: 'to-terraform-primary',
    glowColor: 'rgba(var(--primary-rgb,123,66,188),0.3)',
    bgGlow: 'bg-purple-500/10',
  },
  finops: {
    title: 'FinOps News',
    subtitle:
      'FinOps Foundation updates — cloud cost optimization, frameworks, and financial operations.',
    gradientFrom: 'from-finops-primary',
    gradientTo: 'to-finops-primary',
    glowColor: 'rgba(var(--primary-rgb,30,164,130),0.3)',
    bgGlow: 'bg-emerald-500/10',
  },
};

export default function NewsPage({ provider: providerProp } = {}) {
  const ctxProvider = useProvider();
  const provider = providerProp || ctxProvider;
  const config = useProviderConfig();
  const showInsights = import.meta.env.VITE_NEWS_ENABLE_INSIGHTS === 'true';
  const { articles, rssItems, insights, loading } = useNewsData(provider || null, {
    includeInsights: showInsights,
  });

  const meta = NEWS_META[provider] || NEWS_META.azure;

  const articleCount = articles.length;
  const feedItemCount = rssItems.length;
  const insightCount = insights.length;
  let trendingCategory = 'Updates';
  if (articles.length > 0) {
    trendingCategory = getMostCommonCategory(articles);
  } else if (rssItems.length > 0) {
    trendingCategory = getMostCommonCategory(rssItems);
  }

  return (
    <>
      <Helmet>
        <title>{meta.title} | Hybrid Cloud Works</title>
        <meta name="description" content={meta.subtitle} />
        <meta property="og:title" content={meta.title} />
        <meta property="og:description" content={meta.subtitle} />
      </Helmet>

      <main className="flex-grow pt-28 pb-20 px-4 md:px-8 max-w-[1600px] mx-auto w-full">
        <section className="mb-8 relative">
          <div
            className={`absolute -top-10 -left-10 w-96 h-96 ${meta.bgGlow} blur-3xl rounded-full pointer-events-none`}
          />
          <div className="flex items-center gap-4 mb-4 relative z-10">
            <div
              className="bg-primary p-3 rounded-xl flex items-center justify-center"
              style={{ boxShadow: `0 0 20px ${meta.glowColor}` }}
            >
              <span className="material-symbols-outlined text-black dark:text-white text-2xl font-bold">
                newspaper
              </span>
            </div>
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold text-slate-900 dark:text-white">
              {config?.name}{' '}
              <span
                className={`bg-clip-text text-transparent bg-gradient-to-r ${meta.gradientFrom} ${meta.gradientTo}`}
              >
                Platform News
              </span>
            </h1>
          </div>
          <p className="text-base sm:text-lg text-slate-900 dark:text-white max-w-3xl relative z-10">
            {meta.subtitle}
          </p>
        </section>

        <ScrollTrigger animation="slideUp" duration={0.5}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <StatCard label="Curated Articles" value={articleCount} icon="article" />
            <StatCard label="Feed Items" value={feedItemCount} icon="rss_feed" />
            {showInsights ? (
              <StatCard label="AI Insights" value={insightCount} icon="auto_awesome" />
            ) : (
              <StatCard label="Status" value="Live Data" icon="tune" isText />
            )}
            <StatCard label="Trending" value={trendingCategory} icon="trending_up" isText />
          </div>
        </ScrollTrigger>

        <div
          className={`grid gap-6 items-start ${
            showInsights
              ? 'grid-cols-1 lg:grid-cols-[2fr_1fr_320px] xl:grid-cols-[2fr_1fr_350px]'
              : 'grid-cols-1 lg:grid-cols-[2fr_1fr]'
          }`}
        >
          <ScrollTrigger animation="slideUp" duration={0.6}>
            <CuratedArticlesGrid
              articles={articles}
              loading={loading}
              pagePath={`/${provider || ''}/news`}
              provider={(provider || '').toUpperCase()}
            />
          </ScrollTrigger>

          <ScrollTrigger animation="slideUp" duration={0.6} delay={0.1}>
            <h2 className="font-bold text-slate-900 dark:text-white text-lg uppercase tracking-wide flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-slate-900 dark:text-orange-300">
                rss_feed
              </span>
              Live Feed
            </h2>
            <RssFeedTimeline items={rssItems} loading={loading} />
          </ScrollTrigger>

          {showInsights && (
            <ScrollTrigger animation="slideUp" duration={0.6} delay={0.2}>
              <AiInsightsPanel insights={insights} loading={loading} />
            </ScrollTrigger>
          )}
        </div>

        <div className="mt-12 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 dark:bg-slate-800/30 border border-slate-200/10 dark:border-slate-700/30 backdrop-blur-sm">
            <span className="material-symbols-outlined text-primary text-sm">auto_awesome</span>
            <span className="text-xs text-slate-700 dark:text-slate-200">
              {showInsights
                ? `Content sourced from official ${config?.displayName || 'provider'} channels · AI insights by HCW Agents`
                : `Content sourced from official ${config?.displayName || 'provider'} channels`}
            </span>
          </div>
        </div>
      </main>
    </>
  );
}

function StatCard({ label, value, icon, isText = false }) {
  return (
    <div className="bg-gradient-to-br from-white/5 to-white/[0.02] dark:from-slate-800/40 dark:to-slate-900/40 backdrop-blur-md border border-slate-200/20 dark:border-slate-700/50 rounded-xl p-4 flex items-center justify-between hover:border-primary/30 transition-all group">
      <div>
        <p className="text-[10px] text-foreground uppercase tracking-wider mb-1">{label}</p>
        <h3
          className={`font-bold text-slate-900 dark:text-white ${isText ? 'text-sm' : 'text-xl'}`}
        >
          {value}
        </h3>
      </div>
      <span className="material-symbols-outlined text-slate-500 dark:text-slate-300 group-hover:text-primary transition-colors text-2xl">
        {icon}
      </span>
    </div>
  );
}

function getMostCommonCategory(items) {
  const counts = {};
  items.forEach((item) => {
    const cat = item.category || 'Update';
    counts[cat] = (counts[cat] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || 'Updates';
}
