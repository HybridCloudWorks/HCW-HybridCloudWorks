import { useMemo } from 'react';
import { useFirestoreCollection } from '@/hooks/useFirestore';
import { formatPostDate, normalizePublicImageUrl } from '@/lib/blogUtils';

// Canonical governance source is `content`.
// `blogs` is retained as a legacy read fallback for older migrated content.

const normalizeProvider = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const canonicalizeProvider = (value) => {
  const normalized = normalizeProvider(value);
  if (!normalized) return '';

  if (normalized.includes('github')) return 'github';
  if (normalized.includes('terraform')) return 'terraform';
  if (normalized.includes('finops')) return 'finops';
  if (normalized.includes('azure') || normalized.includes('microsoft')) return 'azure';
  if (normalized.includes('gcp') || normalized.includes('googlecloud')) return 'gcp';
  if (normalized.includes('aws') || normalized.includes('amazon')) return 'aws';

  return normalized;
};

const EXCLUDED_TYPES = new Set(['architecture', 'framework']);

const firstPresent = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
};

const inferProviderFromText = (value) => {
  const text = String(value || '').toLowerCase();
  if (!text) return '';

  if (text.includes('github')) return 'github';
  if (text.includes('terraform')) return 'terraform';
  if (text.includes('finops')) return 'finops';
  if (text.includes('azure') || text.includes('microsoft')) return 'azure';
  if (text.includes('gcp') || text.includes('google cloud') || text.includes('cloud.google'))
    return 'gcp';
  if (text.includes('aws') || text.includes('amazon web services') || text.includes('amazon'))
    return 'aws';

  return '';
};

const inferProviderFromUrlFields = (doc = {}) => {
  const urlFields = [
    doc.slugPageUrl,
    doc.expectedPublicUrl,
    doc.publishedUrl,
    doc.publicUrl,
    doc.blogUrl,
    doc.curatedSubpagePath,
    doc.sourceUrl,
    doc.url,
    doc['CD Url'],
  ];

  for (const value of urlFields) {
    const inferred = inferProviderFromText(value);
    if (inferred) return inferred;
  }

  return '';
};

const inferProviderFromDoc = (doc) => {
  const explicit =
    doc['Cloud Provider'] ||
    doc.cloudProvider ||
    doc.provider ||
    doc.Provider ||
    doc.primaryProvider;
  const explicitNormalized = canonicalizeProvider(explicit);
  if (explicitNormalized) return explicitNormalized;

  const pathNormalized = canonicalizeProvider(String(doc.curatedSubpagePath || '').split('/')[1]);
  if (pathNormalized) return pathNormalized;

  const urlProvider = inferProviderFromUrlFields(doc);
  if (urlProvider) return urlProvider;

  return (
    inferProviderFromText(doc.Title) ||
    inferProviderFromText(doc.title) ||
    inferProviderFromText(doc.Summary) ||
    inferProviderFromText(doc.summary) ||
    ''
  );
};

const getReadTime = (doc) => {
  if (doc.readTime) return doc.readTime;
  if (doc.ReadTime) return doc.ReadTime;
  const wordCount = doc.wordCount || doc.WordCount || doc.words;
  if (typeof wordCount === 'number' && wordCount > 0) {
    const minutes = Math.max(3, Math.round(wordCount / 200));
    return `${minutes} min`;
  }
  return null;
};

const isPublishedDocument = (doc) => {
  const contentStatus = String(doc.contentStatus || '');
  if (doc.softDeletedAt || doc.softDeleteExpiresAt) return false;
  return contentStatus.startsWith('published') || doc.Live === true || doc.Status === 'Live';
};

const isBlogDocument = (doc) => !EXCLUDED_TYPES.has(String(doc.type || '').toLowerCase());

const matchesProvider = (doc, providerKey) => {
  if (!providerKey) return true;
  return inferProviderFromDoc(doc) === providerKey;
};

const isValidPost = (post) => post.title && post.title !== 'Untitled';

const mapToPublicPosts = (docs, providerKey) =>
  (docs || [])
    .filter((doc) => matchesProvider(doc, providerKey))
    .filter(isBlogDocument)
    .filter(isPublishedDocument)
    .map(normalizePost)
    .filter(isValidPost);

const normalizePost = (doc) => {
  const rawTags = firstPresent(doc.Tags, doc.tags, doc.keyTopics, []);
  const tags = Array.isArray(rawTags) ? rawTags : [];
  const category = firstPresent(
    doc.category,
    doc.Category,
    doc.primaryCategory,
    tags[0],
    'General'
  );
  const title = firstPresent(doc.Title, doc.title, doc.name, 'Untitled');
  const summary = firstPresent(doc.Summary, doc.summary, doc.description, doc.excerpt, '');
  const author = firstPresent(
    doc.editorAuthor,
    doc.siteAuthor,
    doc.publishedByName,
    doc.createdByName,
    'Hybrid Cloud Works'
  );
  const publishedAt = firstPresent(
    doc.publishedDate,
    doc.datePublished,
    doc['Published At'],
    doc.blogPublishedAt,
    doc.publishedAt
  );
  const complexity = firstPresent(doc.technicalLevel, doc.complexity, doc.TechnicalLevel, null);
  const slug = firstPresent(doc.slug, doc.Slug, doc.id);
  const imageUrl = normalizePublicImageUrl(
    firstPresent(
      doc.contentImageUrl,
      doc.altCoverImage,
      doc.imageUrl,
      doc.ImageUrl,
      doc.coverImage,
      doc.thumbnail,
      null
    )
  );
  // F9 — surface WebP variants when the chosen imageUrl comes from
  // altCoverImage (the only field that currently has matching variants).
  // Consumers fall back to plain PNG when imageVariants is null.
  let imageVariants = null;
  if (
    doc.altCoverImage &&
    imageUrl === normalizePublicImageUrl(doc.altCoverImage) &&
    doc.altCoverImageVariants
  ) {
    imageVariants = doc.altCoverImageVariants;
  }
  const url = firstPresent(
    doc.sourceUrl,
    doc.url,
    doc['CD Url'],
    doc['Source URL'],
    doc.link,
    null
  );

  return {
    id: firstPresent(doc.id, doc.slug, doc.Slug),
    title,
    description: summary,
    excerpt: summary,
    author,
    date: formatPostDate(publishedAt),
    category,
    tags,
    readTime: getReadTime(doc),
    featured: doc.featured === true || doc.Featured === true,
    complexity,
    slug,
    // Cover image — AI pipeline stores result in altCoverImage; fall back to common field names
    // contentImageUrl is set on content collection docs (pipeline + admin-published articles)
    imageUrl,
    imageVariants,
    // Article URL for "Read Article" links
    url,
  };
};

export function useBlogData(provider) {
  const providerKey = normalizeProvider(provider);

  // Canonical source — content collection (pipeline + admin published)
  const { data: contentData, loading: contentLoading } = useFirestoreCollection('content', {
    limit: 200,
  });
  const contentPosts = useMemo(
    () =>
      mapToPublicPosts(
        (contentData || []).map((d) => ({ ...d, __source: 'content' })),
        providerKey
      ),
    [contentData, providerKey]
  );
  const shouldLoadLegacy = !contentLoading && contentPosts.length === 0;

  // Legacy source — blogs collection (older migrated content + republished docs)
  const { data: blogsData, loading: blogsLoading } = useFirestoreCollection(
    shouldLoadLegacy ? 'blogs' : '',
    {
      limit: 200,
    }
  );

  const blogsPosts = useMemo(
    () =>
      mapToPublicPosts(
        (blogsData || []).map((d) => ({ ...d, __source: 'blogs' })),
        providerKey
      ),
    [blogsData, providerKey]
  );

  const loading = contentLoading || (shouldLoadLegacy && blogsLoading);

  const posts = useMemo(() => {
    if (contentPosts.length > 0) {
      return contentPosts;
    }

    return blogsPosts;
  }, [blogsPosts, contentPosts]);

  return { posts, loading, error: null };
}

export default useBlogData;
