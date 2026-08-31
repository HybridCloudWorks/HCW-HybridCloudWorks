/* eslint-disable complexity, no-nested-ternary */
import React, { useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { useParams, Link } from 'react-router';
import ReactMarkdown from 'react-markdown';
import CoderCornerSnippet from '@/components/shared/CoderCornerSnippet';
import { markdownCodeComponents } from '@/components/shared/CodeBlock';
import remarkGfm from 'remark-gfm';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchPublicContentItem } from '@/lib/publicApi';
import { Separator } from '@/components/ui/separator';
import { Calendar, User, Clock, ArrowLeft, Tag } from 'lucide-react';
import { Skeleton } from '@/components/performance/Skeleton';
import { ModuleContainer } from '@/components/modules/InlineModules';
import { parseModulesFromMarkdown } from '@/lib/moduleParser';
import { canPairModules, isHeadingOnlyTextSegment } from '@/lib/modulePairing';
import { ARTICLE_PROSE_CLASS, HEADING_PROSE_CLASS } from '@/lib/articleStyles';
import ShareVia from '@/components/shared/ShareVia';
import ResponsiveCoverImage from '@/components/shared/ResponsiveCoverImage';
import NewsletterSignup from '@/components/shared/NewsletterSignup';
import { normalizePublicImageUrl } from '@/lib/blogUtils';
import { resolveMediaUrl } from '../../lib/functionsBase';

/**
 * Blog/news article detail page.
 * Resolution (id → slug → Slug, content then legacy blogs, public-only) is
 * folded into GET public/content/{slugOrId} server-side — one fetch replaces
 * the six Firestore lookups and candidate-ranking this component carried.
 * - Displays: hero image, title, meta, AI summary, full content, source link.
 */
export default function BlogDetailTemplate({
  provider = 'aws',
  section = 'blog',
  // Staging preview (T-606): when previewItem is set the template renders it
  // instead of fetching by slug, and previewMode swaps the public chrome
  // (canonical/OG, back link) for a noindex meta and a status banner.
  previewItem = null,
  previewMode = false,
}) {
  const backPath =
    section === 'news'
      ? `/${provider}/rss`
      : section === 'code'
        ? `/${provider}/code`
        : section === 'coder-corner'
          ? `/${provider}/coder-corner`
          : `/${provider}/blog`;

  const backLabel =
    section === 'news'
      ? 'Back to News'
      : section === 'code'
        ? 'Back to Code'
        : section === 'coder-corner'
          ? 'Back to Coder Corner'
          : 'Back to Blog';

  const { slug } = useParams();

  // A falsy key disables usePublicData's fetch (its documented contract), so
  // preview renders never hit the public content route.
  const { data: fetchedArticle, loading: fetchLoading } = usePublicData(
    () => fetchPublicContentItem(slug),
    slug && !previewItem ? `article:${slug}` : ''
  );
  const article = previewItem || fetchedArticle;
  const loading = previewItem ? false : fetchLoading;

  // Normalize field names across blogs/content documents
  const post = useMemo(() => {
    if (!article) return null;
    const tags = article.Tags || article.tags || article.keyTopics || [];
    const date = (() => {
      const raw =
        article.publishedDate ||
        article.datePublished ||
        article['Published At'] ||
        article.blogPublishedAt ||
        article.publishedAt;
      if (!raw) return null;
      try {
        const d = raw?.toDate ? raw.toDate() : new Date(raw);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      } catch {
        return null;
      }
    })();
    // Pick the imageUrl from the first non-empty source, then surface the
    // matching responsive variants from the same source (F9 — see
    // Firebase-GCP-Cost-Inventory.md). Falls back to null variants when
    // the chosen source doesn't have them, in which case the consumer
    // renders the plain PNG.
    const resolvedImageUrl = normalizePublicImageUrl(
      article.contentImageUrl ||
        article.heroImageUrl ||
        article.altCoverImage ||
        article.imageUrl ||
        null
    );
    let resolvedImageVariants = null;
    if (resolvedImageUrl === article.altCoverImage && article.altCoverImageVariants) {
      resolvedImageVariants = article.altCoverImageVariants;
    } else if (article.aiImageVariants?.hero && resolvedImageUrl === article.aiImageUrls?.hero) {
      resolvedImageVariants = article.aiImageVariants.hero;
    }
    return {
      // Coder Corner: the fields the publish contract requires but nothing
      // rendered (components/shared/CoderCornerSnippet.jsx).
      codeSnippet: article.codeSnippet || article.code || article.terraformCode || '',
      language: article.language || article.codeLanguage || '',
      repoUrl: article.repoUrl || null,
      title: article.Title || article.title || 'Untitled',
      summary: article.Summary || article.summary || article.description || article.excerpt || '',
      // Body: prefer editor draft → raw content → summary fallback
      body: article.blogDraft || article.Content || article.content || '',
      imageUrl: resolvedImageUrl,
      imageVariants: resolvedImageVariants,
      category:
        article.category || article.Category || (Array.isArray(tags) ? tags[0] : null) || 'General',
      tags: Array.isArray(tags) ? tags : [],
      author:
        article.editorAuthor ||
        article.siteAuthor ||
        article.publishedByName ||
        article.createdByName ||
        'Hybrid Cloud Works',
      date,
      readTime: article.readTime || article.ReadTime || null,
      sourceUrl:
        article.sourceUrl || article.url || article['CD Url'] || article['Source URL'] || null,
    };
  }, [article]);

  if (loading) {
    return (
      <div className="pt-28 pb-20 px-4 md:px-8 max-w-[1200px] mx-auto w-full">
        <Skeleton variant="button" className="mb-8 w-32" />
        <Skeleton variant="rect" className="mb-8 h-64 rounded-2xl" />
        <Skeleton variant="heading" className="mb-4 w-3/4" />
        <Skeleton variant="heading" className="mb-8 w-1/2" />
        <div className="flex gap-6 mb-8">
          <Skeleton variant="text" className="w-32" />
          <Skeleton variant="text" className="w-24" />
          <Skeleton variant="text" className="w-20" />
        </div>
        <div className="space-y-3">
          <Skeleton variant="text" />
          <Skeleton variant="text" />
          <Skeleton variant="text" className="w-5/6" />
          <Skeleton variant="text" />
          <Skeleton variant="text" className="w-4/5" />
          <Skeleton variant="text" />
          <Skeleton variant="text" className="w-3/4" />
        </div>
      </div>
    );
  }

  if (!article || !post) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <span className="text-6xl material-symbols-outlined text-slate-600 block mb-4">
          article
        </span>
        <h1 className="text-3xl font-bold mb-4 text-slate-900 dark:text-white">
          Article Not Found
        </h1>
        <p className="text-slate-700 dark:text-slate-400 mb-6">
          This article doesn&apos;t exist or hasn&apos;t been published yet.
        </p>
        <Link
          to={backPath}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/80 text-white font-bold rounded-lg transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </Link>
      </div>
    );
  }

  return (
    <div className="pt-28 pb-20 px-4 md:px-8 max-w-[1200px] mx-auto w-full">
      {previewMode ? (
        <Helmet>
          <title>{`Preview: ${post.title} | HCW`}</title>
          {/* A preview URL is semi-secret and temporary — never indexed. */}
          <meta name="robots" content="noindex, nofollow" />
        </Helmet>
      ) : (
        <Helmet>
          <title>{`${post.title} | HCW`}</title>
          <meta name="description" content={post.summary} />
          <link
            rel="canonical"
            href={`https://hybridcloudworks.com/${provider}/${section}/${slug}`}
          />
          {/* Open Graph */}
          <meta property="og:type" content="article" />
          <meta property="og:title" content={`${post.title} | HCW`} />
          <meta property="og:description" content={post.summary} />
          <meta
            property="og:url"
            content={`https://hybridcloudworks.com/${provider}/${section}/${slug}`}
          />
          {post.imageUrl && <meta property="og:image" content={resolveMediaUrl(post.imageUrl)} />}
          {/* Twitter Card */}
          <meta name="twitter:card" content={post.imageUrl ? 'summary_large_image' : 'summary'} />
          <meta name="twitter:title" content={`${post.title} | HCW`} />
          <meta name="twitter:description" content={post.summary} />
          {post.imageUrl && <meta name="twitter:image" content={resolveMediaUrl(post.imageUrl)} />}
        </Helmet>
      )}

      {/* Back link (not in preview — the preview URL stands alone) */}
      {!previewMode && (
        <Link
          to={backPath}
          className="inline-flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors mb-8 group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          {backLabel}
        </Link>
      )}

      {/* Preview banner: what this is and where it stands */}
      {previewMode && (
        <div className="mb-8 rounded-xl border border-amber-400/50 bg-amber-500/10 px-5 py-4">
          <p className="eyebrow-label text-amber-700 dark:text-amber-300">Preview — not live</p>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
            Status: <span className="font-medium">{article.contentStatus || 'unknown'}</span>
            {typeof article.forgeGrade?.overall === 'number' && (
              <>
                {' · '}Forge grade:{' '}
                <span className="font-medium">
                  {article.forgeGrade.overall}
                  {typeof article.forgeGrade.threshold === 'number'
                    ? ` / threshold ${article.forgeGrade.threshold}`
                    : ''}
                </span>
              </>
            )}
          </p>
          {/* SEO advisories: informational only — they never gate approval */}
          {Array.isArray(article.forgeGrade?.seo?.findings) &&
            article.forgeGrade.seo.findings.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-slate-700 dark:text-slate-300">
                {article.forgeGrade.seo.findings.map((finding) => (
                  <li key={finding.key}>{finding.message}</li>
                ))}
              </ul>
            )}
        </div>
      )}

      <article className="blog-detail-article">
        {/* Hero Image */}
        {post.imageUrl && (
          <div className="relative w-full h-72 sm:h-96 rounded-2xl overflow-hidden mb-8 bg-card/40">
            <ResponsiveCoverImage
              src={resolveMediaUrl(post.imageUrl)}
              variants={post.imageVariants}
              alt={post.title}
              width="1200"
              height="630"
              fetchPriority="high"
              loading="eager"
              decoding="async"
              sizes="(max-width: 768px) 100vw, 1200px"
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/20 to-transparent" />
          </div>
        )}

        {/* Header */}
        <header className="mb-12">
          <div className="mb-6 flex justify-end">
            <ShareVia title={post.title} summary={post.summary} />
          </div>

          {/* Title */}
          <h1 className="text-5xl md:text-6xl font-bold text-slate-900 dark:text-white mb-8 leading-tight">
            {post.title}
          </h1>

          {/* Metadata Row: Author (left) + Date/ReadTime (right) */}
          <div className="blog-detail-meta flex items-baseline justify-between gap-6 mb-8 text-sm">
            <div className="blog-detail-author flex items-center gap-2 !text-slate-900 dark:text-slate-400">
              <User className="h-4 w-4 text-primary" />
              <span className="!text-slate-900 dark:text-white font-medium">
                {post.author || 'HCW Team'}
              </span>
            </div>
            <div className="blog-detail-date flex items-center gap-4 !text-slate-900 dark:text-slate-400 ml-auto">
              {post.date && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span>{post.date}</span>
                </div>
              )}
              {post.readTime && (
                <div className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-primary" />
                  <span>{post.readTime}</span>
                </div>
              )}
            </div>
          </div>

          {/* Spacer Bar */}
          <div className="w-16 h-1 bg-gradient-to-r from-primary via-primary/60 to-transparent rounded-full mb-8" />
        </header>

        {/* Body content with inline modules */}
        {post.body ? (
          <div className="mb-12">
            {(() => {
              const { text: bodyWithPlaceholders, modules } = parseModulesFromMarkdown(post.body);
              const contentToRender = bodyWithPlaceholders
                .replace(/<!-- MODULE_\d+ -->/g, '\n\n')
                .trim();
              // Only treat as raw HTML if the stripped content has actual block-level HTML tags.
              // This prevents <module> tags in blogDraft from wrongly triggering the HTML path
              // and rendering markdown as plain text.
              const bodyIsHtml =
                /<\s*(p|div|span|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|section|article|blockquote)\b[^>]*>/i.test(
                  contentToRender
                );
              const orderedItems = bodyWithPlaceholders
                .split(/(<!-- MODULE_\d+ -->)/g)
                .map((segment, index) => {
                  const placeholderMatch = segment.match(/^<!-- MODULE_(\d+) -->$/);
                  if (placeholderMatch) {
                    const moduleIndex = Number.parseInt(placeholderMatch[1], 10);
                    const moduleData = modules[moduleIndex];
                    if (!moduleData) return null;
                    return {
                      kind: 'module',
                      key: `module-${moduleIndex}-${index}`,
                      moduleData,
                    };
                  }

                  if (!segment.trim()) return null;
                  return {
                    kind: 'text',
                    key: `text-${index}`,
                    text: segment,
                  };
                })
                .filter(Boolean);

              return (
                <div className="relative">
                  {orderedItems.length ? (
                    (() => {
                      const rows = [];
                      for (let index = 0; index < orderedItems.length; index += 1) {
                        const item = orderedItems[index];
                        if (item.kind === 'text') {
                          rows.push(
                            bodyIsHtml ? (
                              <div
                                key={item.key}
                                className={ARTICLE_PROSE_CLASS}
                                dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.text) }}
                              />
                            ) : (
                              <div key={item.key} className={ARTICLE_PROSE_CLASS}>
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={markdownCodeComponents}
                                >
                                  {item.text}
                                </ReactMarkdown>
                              </div>
                            )
                          );
                          continue;
                        }

                        const nextItem = orderedItems[index + 1];
                        const textBetweenItem = orderedItems[index + 1];
                        const moduleAfterTextItem = orderedItems[index + 2];
                        const canPairWithNext =
                          nextItem?.kind === 'module' &&
                          canPairModules(item.moduleData, nextItem.moduleData);
                        const canPairAcrossHeading =
                          textBetweenItem?.kind === 'text' &&
                          isHeadingOnlyTextSegment(textBetweenItem.text) &&
                          moduleAfterTextItem?.kind === 'module' &&
                          canPairModules(item.moduleData, moduleAfterTextItem.moduleData);

                        if (canPairWithNext) {
                          rows.push(
                            <div
                              key={`${item.key}-${nextItem.key}-pair`}
                              className="grid gap-4 md:grid-cols-2 md:items-start"
                            >
                              <div className="min-w-0">
                                <ModuleContainer
                                  type={item.moduleData.type}
                                  data={item.moduleData}
                                  align={item.moduleData.align}
                                  paired
                                />
                              </div>
                              <div className="min-w-0">
                                <ModuleContainer
                                  type={nextItem.moduleData.type}
                                  data={nextItem.moduleData}
                                  align={nextItem.moduleData.align}
                                  paired
                                />
                              </div>
                            </div>
                          );
                          index += 1;
                          continue;
                        }

                        if (canPairAcrossHeading) {
                          rows.push(
                            <div
                              key={`${item.key}-${textBetweenItem.key}-${moduleAfterTextItem.key}-heading`}
                              className={HEADING_PROSE_CLASS}
                            >
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={markdownCodeComponents}
                              >
                                {textBetweenItem.text}
                              </ReactMarkdown>
                            </div>
                          );
                          rows.push(
                            <div
                              key={`${item.key}-${moduleAfterTextItem.key}-pair`}
                              className="grid gap-4 md:grid-cols-2 md:items-start"
                            >
                              <div className="min-w-0">
                                <ModuleContainer
                                  type={item.moduleData.type}
                                  data={item.moduleData}
                                  align={item.moduleData.align}
                                  paired
                                />
                              </div>
                              <div className="min-w-0">
                                <ModuleContainer
                                  type={moduleAfterTextItem.moduleData.type}
                                  data={moduleAfterTextItem.moduleData}
                                  align={moduleAfterTextItem.moduleData.align}
                                  paired
                                />
                              </div>
                            </div>
                          );
                          index += 2;
                          continue;
                        }

                        rows.push(
                          <div key={item.key} className="clear-both w-full">
                            <ModuleContainer
                              type={item.moduleData.type}
                              data={item.moduleData}
                              align={item.moduleData.align}
                            />
                          </div>
                        );
                      }
                      return rows;
                    })()
                  ) : bodyIsHtml ? (
                    <div
                      className={ARTICLE_PROSE_CLASS}
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(contentToRender) }}
                    />
                  ) : (
                    <div className={ARTICLE_PROSE_CLASS}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownCodeComponents}
                      >
                        {contentToRender}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="mb-12 py-10 text-center border border-dashed border-slate-700 rounded-xl">
            <span className="text-4xl material-symbols-outlined text-slate-600 block mb-3">
              draft
            </span>
            <p className="text-slate-700 dark:text-slate-400">
              Full article content will appear here once the pipeline processes this article.
            </p>
          </div>
        )}

        <CoderCornerSnippet
          codeSnippet={post.codeSnippet}
          language={post.language}
          repoUrl={post.repoUrl}
          body={post.body}
        />

        {/* Tags row */}
        {post.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-8">
            <Tag className="h-4 w-4 text-slate-500" />
            {post.tags.map((tag, i) => (
              <span
                key={i}
                className="px-3 py-1 bg-card/50 border border-card/80 text-slate-800 dark:text-slate-300 text-xs rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <Separator className="my-8 border-slate-700" />

        {/* Footer: back link only */}
        <div className="flex items-center gap-4">
          <Link
            to={backPath}
            className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-400 hover:text-primary transition-colors group"
          >
            <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
            {backLabel}
          </Link>
        </div>
        <div className="mt-10">
          <NewsletterSignup source="blog-post" />
        </div>
      </article>
    </div>
  );
}
