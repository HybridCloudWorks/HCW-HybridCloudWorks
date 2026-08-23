import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router';
import { useBlogData } from '@/hooks/useBlogData';
import { Skeleton } from '@/components/performance/Skeleton';
import { resolveMediaUrl } from '../../lib/functionsBase';

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = ['All', 'Architecture', 'Security', 'Cost Optimization', 'Hybrid Cloud', 'AI'];

const CATEGORY_STYLES = {
  Architecture: {
    badge: 'bg-blue-500/20 border-blue-500/30 text-blue-800 dark:text-blue-300',
    card: 'border-blue-700/40 hover:border-blue-500/50',
  },
  Security: {
    badge: 'bg-rose-500/20 border-rose-500/30 text-rose-800 dark:text-rose-300',
    card: 'border-rose-700/40 hover:border-rose-500/50',
  },
  'Cost Optimization': {
    badge: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-800 dark:text-emerald-300',
    card: 'border-emerald-700/40 hover:border-emerald-500/50',
  },
  'Hybrid Cloud': {
    badge: 'bg-purple-500/20 border-purple-500/30 text-purple-800 dark:text-purple-300',
    card: 'border-purple-700/40 hover:border-purple-500/50',
  },
  AI: {
    badge: 'bg-amber-500/20 border-amber-500/30 text-amber-800 dark:text-amber-300',
    card: 'border-amber-700/40 hover:border-amber-500/50',
  },
  General: {
    badge: 'bg-slate-500/20 border-slate-500/30 text-slate-800 dark:text-slate-300',
    card: 'border-slate-700/40 hover:border-slate-500/50',
  },
};

// ── Category classifier ──────────────────────────────────────────────────────

const KEYWORD_MAP = {
  Architecture: [
    'architecture',
    'design',
    'landing zone',
    'well-architected',
    'waf',
    'pattern',
    'microservice',
    'serverless',
    'event-driven',
    'blueprint',
    'reference architecture',
    'infrastructure',
    'network',
    'vpc',
    'subnet',
    'topology',
    'diagram',
  ],
  Security: [
    'security',
    'zero trust',
    'iam',
    'identity',
    'compliance',
    'governance',
    'encryption',
    'siem',
    'soc',
    'threat',
    'vulnerability',
    'pen test',
    'audit',
    'defender',
    'sentinel',
    'shield',
    'waf',
    'policy',
    'rbac',
    'mfa',
    'oauth',
    'jwt',
  ],
  'Cost Optimization': [
    'cost',
    'finops',
    'budget',
    'savings',
    'optimization',
    'pricing',
    'billing',
    'rightsizing',
    'reserved',
    'spot',
    'commitment',
    'waste',
    'spend',
    'roi',
    'chargeback',
    'showback',
    'tagging',
    'allocation',
  ],
  'Hybrid Cloud': [
    'hybrid',
    'multi-cloud',
    'multicloud',
    'on-premises',
    'on-prem',
    'arc',
    'anthos',
    'outposts',
    'edge',
    'connectivity',
    'vpn',
    'expressroute',
    'direct connect',
    'migration',
    'lift and shift',
    'datacenter',
  ],
  AI: [
    'ai',
    'ml',
    'machine learning',
    'deep learning',
    'llm',
    'gpt',
    'openai',
    'copilot',
    'vertex',
    'sagemaker',
    'bedrock',
    'cognitive',
    'nlp',
    'neural',
    'generative',
    'vector',
    'embedding',
    'rag',
    'inference',
    'model',
    'automation',
    'container',
    'kubernetes',
    'k8s',
    'docker',
    'aks',
    'eks',
    'gke',
    'helm',
    'devops',
    'ci/cd',
    'pipeline',
    'devsecops',
  ],
};

function classifyCategory(tags = [], title = '', existingCategory = '') {
  // If the doc already carries one of our 5 canonical categories, honour it
  if (CATEGORIES.slice(1).includes(existingCategory)) return existingCategory;

  const haystack = [
    ...tags.map((t) => String(t).toLowerCase()),
    String(title).toLowerCase(),
    String(existingCategory).toLowerCase(),
  ].join(' ');

  const scores = {};
  for (const [cat, keywords] of Object.entries(KEYWORD_MAP)) {
    scores[cat] = keywords.filter((kw) => haystack.includes(kw)).length;
  }

  const [bestCat, bestScore] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0] || [];
  return bestScore > 0 ? bestCat : 'Architecture';
}

// ── Sub-components ───────────────────────────────────────────────────────────

function CategoryBadge({ category }) {
  const style = CATEGORY_STYLES[category] || CATEGORY_STYLES.General;
  return (
    <span className={`px-3 py-1 border rounded text-xs font-bold ${style.badge}`}>{category}</span>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-card/40 border border-border rounded-xl p-6 space-y-3">
          <Skeleton variant="rect" className="h-4 w-24" />
          <Skeleton variant="heading" />
          <Skeleton variant="text" />
          <Skeleton variant="text" className="w-4/5" />
          <Skeleton variant="text" className="w-3/5" />
        </div>
      ))}
    </div>
  );
}

function HeroCarousel({ posts, provider, accentColor, accentBorder }) {
  const [active, setActive] = useState(0);
  const timerRef = useRef(null);

  const advance = useCallback(() => {
    setActive((prev) => (prev + 1) % posts.length);
  }, [posts.length]);

  useEffect(() => {
    if (posts.length < 2) return;
    timerRef.current = setInterval(advance, 5000);
    return () => clearInterval(timerRef.current);
  }, [advance, posts.length]);

  const goTo = (index) => {
    setActive(index);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(advance, 5000);
  };

  if (!posts.length) return null;

  const post = posts[active];
  const cardStyle = CATEGORY_STYLES[post.classifiedCategory] || CATEGORY_STYLES.General;

  return (
    <section className="mb-12">
      <div className="relative group bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-[0_0_30px_rgba(var(--primary-rgb),0.15)]">
        {/* Image strip */}
        <div className="relative h-64 bg-gradient-to-br from-slate-800 to-slate-900 overflow-hidden flex items-center justify-center">
          {post.imageUrl ? (
            <div
              className="absolute inset-0 bg-cover bg-center transition-all duration-700"
              style={{ backgroundImage: `url('${resolveMediaUrl(post.imageUrl)}')` }}
            />
          ) : (
            <span className="text-7xl material-symbols-outlined text-slate-600">article</span>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent" />

          {/* Dot nav */}
          {posts.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
              {posts.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  aria-label={`Go to article ${i + 1}`}
                  className={`w-2.5 h-2.5 rounded-full transition-all ${
                    i === active ? `${accentColor} scale-125` : 'bg-white/30 hover:bg-white/60'
                  }`}
                />
              ))}
            </div>
          )}

          {/* Newest badge */}
          {active === 0 && (
            <span
              className={`absolute top-4 right-4 px-3 py-1 text-xs font-bold rounded border ${accentBorder} bg-black/40 text-white z-10`}
            >
              Latest
            </span>
          )}
        </div>

        {/* Content */}
        <div className="p-8">
          <div className="mb-4 flex items-center gap-3 flex-wrap">
            <CategoryBadge category={post.classifiedCategory} />
            <span className={`px-3 py-1 text-xs font-bold rounded border ${cardStyle.badge}`}>
              Featured
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-3 leading-snug">
            {post.title}
          </h2>
          <p className="text-foreground mb-6 line-clamp-2">{post.description}</p>
          <div className="flex flex-wrap gap-2 mb-6">
            {(post.tags || []).slice(0, 4).map((tag, i) => (
              <span key={i} className="px-3 py-1 bg-card/50 text-foreground text-xs rounded-full">
                {tag}
              </span>
            ))}
          </div>
          <div className="flex items-center justify-between pt-5 border-t border-slate-700 flex-wrap gap-3">
            <div className="flex items-center gap-3 text-sm text-foreground flex-wrap">
              <span>{post.author}</span>
              <span>•</span>
              <span>{post.date}</span>
              {post.readTime && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">schedule</span>
                    {post.readTime}
                  </span>
                </>
              )}
            </div>
            <Link
              to={`/${provider}/blog/${post.slug}`}
              className="px-5 h-11 bg-primary hover:bg-primary/80 text-white font-bold rounded-lg transition-colors text-sm flex items-center gap-2"
            >
              Read Article
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function BlogCard({ post, provider, accentHover }) {
  const cardStyle = CATEGORY_STYLES[post.classifiedCategory] || CATEGORY_STYLES.General;
  return (
    <article
      className={`group bg-card/40 backdrop-blur-md border border-card/50 rounded-2xl overflow-hidden transition-all duration-300 flex flex-col ${cardStyle.card} hover:shadow-[0_0_20px_rgba(var(--primary-rgb),0.12)]`}
    >
      <div className="relative h-44 bg-gradient-to-br from-slate-800 to-slate-900 overflow-hidden flex items-center justify-center">
        {post.imageUrl ? (
          <div
            className="absolute inset-0 bg-cover bg-center group-hover:scale-105 transition-transform duration-500 opacity-80"
            style={{ backgroundImage: `url('${resolveMediaUrl(post.imageUrl)}')` }}
          />
        ) : (
          <span className="text-4xl material-symbols-outlined text-slate-600 group-hover:scale-110 transition-transform duration-300">
            article
          </span>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 to-transparent" />
      </div>
      <div className="p-5 flex flex-col flex-grow">
        <div className="mb-3">
          <CategoryBadge category={post.classifiedCategory} />
        </div>
        <h3
          className={`text-base font-bold text-slate-900 dark:text-white mb-2 line-clamp-2 ${accentHover} transition-colors`}
        >
          {post.title}
        </h3>
        <p className="text-sm text-foreground mb-4 line-clamp-3 flex-grow">{post.description}</p>
        <div className="flex flex-wrap gap-1 mb-4">
          {(post.tags || []).slice(0, 2).map((tag, i) => (
            <span key={i} className="px-2 py-1 bg-card/50 text-foreground text-xs rounded-full">
              {tag}
            </span>
          ))}
        </div>
        <div className="pt-4 border-t border-slate-700 flex items-center justify-between">
          <div className="text-xs text-foreground">
            <span>{post.date}</span>
            {post.readTime && <span className="ml-2 text-foreground/60">· {post.readTime}</span>}
          </div>
          <Link
            to={`/${provider}/blog/${post.slug}`}
            className="px-3 py-1.5 bg-card/60 hover:bg-primary hover:text-white text-foreground rounded text-xs font-semibold transition-colors flex items-center gap-1"
          >
            Read
            <span className="material-symbols-outlined text-[12px]">arrow_forward</span>
          </Link>
        </div>
      </div>
    </article>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

/**
 * Shared blog listing page used by all 6 providers.
 *
 * Props:
 *  provider      – 'aws' | 'azure' | 'gcp' | 'github' | 'terraform' | 'finops'
 *  title         – Page hero heading
 *  subtitle      – Page hero subheading
 *  metaTitle     – <title> tag text
 *  metaDesc      – <meta description> content
 *  gradientFrom  – Tailwind from-* class for hero gradient (e.g. 'from-blue-400')
 *  gradientTo    – Tailwind to-* class for hero gradient
 *  accentColor   – Tailwind bg-* class for active carousel dot (e.g. 'bg-blue-400')
 *  accentBorder  – Tailwind border+text classes for 'Latest' badge
 *  accentHover   – Tailwind group-hover text class for card titles
 *  glowColor     – Tailwind bg-color/opacity class for hero glow blob
 */
export default function ProviderBlogPage({
  provider,
  title,
  subtitle,
  metaTitle,
  metaDesc,
  gradientFrom = 'from-blue-400',
  gradientTo = 'to-blue-300',
  accentColor = 'bg-blue-400',
  accentBorder = 'border-blue-400/60 text-blue-200',
  accentHover = 'group-hover:text-primary',
  glowColor = 'bg-primary/5',
}) {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const { posts: rawPosts, loading } = useBlogData(provider);

  // Classify every post into one of the 5 canonical categories
  const posts = rawPosts.map((post) => ({
    ...post,
    classifiedCategory: classifyCategory(post.tags, post.title, post.category),
  }));

  // Sort newest-first by date string (ISO or formatted)
  const sorted = [...posts].sort((a, b) => {
    const aMs = a.date ? new Date(a.date).getTime() : 0;
    const bMs = b.date ? new Date(b.date).getTime() : 0;
    return bMs - aMs;
  });

  // Hero: newest 5
  const heroPosts = sorted.slice(0, 5);

  // Grid pool: last 20 (by recency)
  const poolPosts = sorted.slice(0, 20);

  // Filtered grid
  const gridPosts =
    selectedCategory === 'All'
      ? poolPosts
      : poolPosts.filter((p) => p.classifiedCategory === selectedCategory);

  const showGridSkeleton = loading && rawPosts.length === 0;
  const hasGridPosts = gridPosts.length > 0;
  const gridTitle = selectedCategory === 'All' ? 'Latest Articles' : `${selectedCategory} Articles`;

  function renderGridContent() {
    if (showGridSkeleton) {
      return <SkeletonGrid />;
    }

    if (hasGridPosts) {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {gridPosts.map((post) => (
            <BlogCard key={post.id} post={post} provider={provider} accentHover={accentHover} />
          ))}
        </div>
      );
    }

    return (
      <div className="text-center py-16">
        <span className="text-5xl material-symbols-outlined text-slate-600 block mb-4">
          article
        </span>
        <p className="text-slate-700 dark:text-slate-400 text-lg">
          No articles in this category yet.
        </p>
        <button
          onClick={() => setSelectedCategory('All')}
          className="mt-4 px-4 py-2 bg-primary/20 hover:bg-primary/30 text-primary rounded-lg text-sm font-semibold transition-colors"
        >
          View all articles
        </button>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{metaTitle}</title>
        <meta name="description" content={metaDesc} />
        <meta property="og:title" content={metaTitle} />
        <meta property="og:description" content={metaDesc} />
      </Helmet>

      <main className="flex-grow pt-28 pb-20 px-4 md:px-8 max-w-[1440px] mx-auto w-full">
        {/* Hero heading */}
        <section className="mb-12 relative">
          <div
            className={`absolute -top-10 -left-10 w-96 h-96 ${glowColor} blur-3xl rounded-full pointer-events-none`}
          />
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold text-slate-900 dark:text-white mb-4 relative z-10">
            <span
              className={`bg-clip-text text-transparent bg-gradient-to-r ${gradientFrom} via-slate-900 dark:via-white ${gradientTo}`}
            >
              {title}
            </span>
          </h1>
          <p className="text-base sm:text-lg text-foreground max-w-3xl relative z-10">{subtitle}</p>
        </section>

        {/* Hero carousel — newest 5, cycles every 5s */}
        {loading && rawPosts.length === 0 ? (
          <div className="mb-12">
            <div className="bg-card/40 border border-border rounded-2xl overflow-hidden">
              <Skeleton variant="rect" className="h-64 w-full rounded-none" />
              <div className="p-8 space-y-4">
                <Skeleton variant="heading" className="w-3/4" />
                <Skeleton variant="text" />
                <Skeleton variant="text" className="w-2/3" />
              </div>
            </div>
          </div>
        ) : (
          <HeroCarousel
            posts={heroPosts}
            provider={provider}
            accentColor={accentColor}
            accentBorder={accentBorder}
          />
        )}

        {/* Category filter bar */}
        <section className="mb-8">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4">
            Filter by Category
          </h3>
          <div className="flex flex-wrap gap-3">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 h-11 rounded-lg font-semibold transition-all text-sm ${
                  selectedCategory === cat
                    ? 'bg-primary text-white shadow-lg shadow-primary/25'
                    : 'bg-card/40 border border-card/50 text-foreground hover:border-primary/50'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </section>

        {/* Grid — 3 per row, last 20 (filtered) */}
        <section className="mb-16">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">article</span>
            {gridTitle}
            <span className="text-sm font-normal text-foreground ml-1">({gridPosts.length})</span>
          </h3>

          {renderGridContent()}
        </section>
      </main>
    </>
  );
}
