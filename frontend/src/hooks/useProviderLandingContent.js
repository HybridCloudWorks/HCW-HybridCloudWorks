import { useMemo } from 'react';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchPublicContentList } from '@/lib/publicApi';
import { formatPostDate } from '@/lib/blogUtils';
import { toMillis } from '@/lib/dateUtils';
import { getCanonicalContentType, getContentPublicPath } from '@/lib/contentModel';

const DISPLAY_TYPE_LABELS = {
  blog: 'Blog',
  news: 'News',
  framework: 'Framework',
  architecture: 'Architecture',
  coder_corner: 'Coder Corner',
};

const SUPPORTED_TYPES = new Set(Object.keys(DISPLAY_TYPE_LABELS));

function normalizeProvider(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function canonicalizeProvider(value) {
  const normalized = normalizeProvider(value);
  if (!normalized) return '';

  if (normalized.includes('github')) return 'github';
  if (normalized.includes('terraform')) return 'terraform';
  if (normalized.includes('finops')) return 'finops';
  if (normalized.includes('azure') || normalized.includes('microsoft')) return 'azure';
  if (normalized.includes('gcp') || normalized.includes('googlecloud')) return 'gcp';
  if (normalized.includes('aws') || normalized.includes('amazon')) return 'aws';
  if (normalized.includes('vmware') || normalized.includes('broadcom')) return 'vmware';
  if (normalized.includes('ansible') || normalized.includes('redhat')) return 'ansible';

  return normalized;
}

function inferProviderFromText(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return '';

  if (text.includes('github')) return 'github';
  if (text.includes('terraform')) return 'terraform';
  if (text.includes('finops')) return 'finops';
  if (text.includes('azure') || text.includes('microsoft')) return 'azure';
  if (text.includes('gcp') || text.includes('google cloud') || text.includes('cloud.google')) {
    return 'gcp';
  }
  if (text.includes('aws') || text.includes('amazon web services') || text.includes('amazon')) {
    return 'aws';
  }
  if (text.includes('vmware')) return 'vmware';
  if (text.includes('ansible')) return 'ansible';

  return '';
}

function inferProviderFromDoc(doc = {}) {
  const explicit = canonicalizeProvider(
    doc['Cloud Provider'] ||
      doc.cloudProvider ||
      doc.provider ||
      doc.Provider ||
      doc.primaryProvider
  );
  if (explicit) return explicit;

  const pathProvider = canonicalizeProvider(String(doc.curatedSubpagePath || '').split('/')[1]);
  if (pathProvider) return pathProvider;

  return (
    inferProviderFromText(doc.slugPageUrl) ||
    inferProviderFromText(doc.publishedUrl) ||
    inferProviderFromText(doc.publicUrl) ||
    inferProviderFromText(doc.blogUrl) ||
    inferProviderFromText(doc.curatedSubpagePath) ||
    inferProviderFromText(doc.url) ||
    inferProviderFromText(doc.sourceUrl) ||
    inferProviderFromText(doc.Title) ||
    inferProviderFromText(doc.title) ||
    ''
  );
}

function getPublicUrl(doc = {}) {
  const explicitUrl =
    doc.slugPageUrl ||
    doc.publishedUrl ||
    doc.blogUrl ||
    doc.publicUrl ||
    (doc.curatedSubpagePath
      ? `https://hybridcloudworks.com${String(doc.curatedSubpagePath).startsWith('/') ? doc.curatedSubpagePath : `/${doc.curatedSubpagePath}`}`
      : '');

  if (explicitUrl) return explicitUrl;

  const publicPath = getContentPublicPath(doc);
  return publicPath ? `https://hybridcloudworks.com${publicPath}` : '';
}

function getRecency(doc = {}) {
  return Math.max(
    toMillis(doc.publishedDate),
    toMillis(doc.datePublished),
    toMillis(doc['Published At']),
    toMillis(doc.blogPublishedAt),
    toMillis(doc.publishedAt),
    toMillis(doc.updatedAt),
    toMillis(doc.createdAt)
  );
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function normalizeTags(doc = {}) {
  const raw = firstPresent(doc.tags, doc.Tags, doc.keyTopics, []);
  return Array.isArray(raw) ? raw.filter(Boolean).slice(0, 3) : [];
}

function normalizeItem(doc = {}) {
  const contentType = getCanonicalContentType(doc);
  const publicUrl = getPublicUrl(doc);
  const title = firstPresent(doc.Title, doc.title, doc.name, 'Untitled');
  const summary = firstPresent(doc.Summary, doc.summary, doc.description, doc.excerpt, '');
  const publishedAt = firstPresent(
    doc.publishedDate,
    doc.datePublished,
    doc['Published At'],
    doc.blogPublishedAt,
    doc.publishedAt
  );

  return {
    id: doc.id,
    title,
    summary,
    publicUrl,
    contentType,
    contentTypeLabel: DISPLAY_TYPE_LABELS[contentType] || 'Content',
    tags: normalizeTags(doc),
    dateLabel: formatPostDate(publishedAt),
    recency: getRecency(doc),
  };
}

export function useProviderLandingContent(provider) {
  const providerKey = canonicalizeProvider(provider);
  // Visibility is enforced server-side — the public API only returns
  // published documents — so the client filters are scoped to provider/type.
  const { data: contentDocs, loading: contentLoading } = usePublicData(
    () => fetchPublicContentList({ limit: 250 }),
    'landing:content'
  );

  const contentItems = useMemo(() => {
    const seen = new Set();
    const merged = [];

    (contentDocs || []).forEach((doc) => {
      if (inferProviderFromDoc(doc) !== providerKey) return;

      const contentType = getCanonicalContentType(doc);
      if (!SUPPORTED_TYPES.has(contentType)) return;

      const normalized = normalizeItem(doc);
      if (!normalized.publicUrl || !normalized.title || normalized.title === 'Untitled') return;

      const dedupeKey = normalized.publicUrl.trim().toLowerCase();
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      merged.push(normalized);
    });

    return merged.sort((a, b) => b.recency - a.recency);
  }, [contentDocs, providerKey]);

  const shouldLoadLegacy = !contentLoading && contentItems.length === 0;
  const { data: blogDocs, loading: blogLoading } = usePublicData(
    () => fetchPublicContentList({ limit: 250, source: 'blogs' }),
    shouldLoadLegacy ? 'landing:legacy' : ''
  );

  const blogItems = useMemo(() => {
    const seen = new Set();
    const merged = [];

    (blogDocs || []).forEach((doc) => {
      if (inferProviderFromDoc(doc) !== providerKey) return;

      const contentType = getCanonicalContentType(doc);
      if (!SUPPORTED_TYPES.has(contentType)) return;

      const normalized = normalizeItem(doc);
      if (!normalized.publicUrl || !normalized.title || normalized.title === 'Untitled') return;

      const dedupeKey = normalized.publicUrl.trim().toLowerCase();
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      merged.push(normalized);
    });

    return merged.sort((a, b) => b.recency - a.recency);
  }, [blogDocs, providerKey]);

  const items = contentItems.length > 0 ? contentItems : blogItems;

  return {
    items,
    loading: contentLoading || (shouldLoadLegacy && blogLoading),
  };
}

export default useProviderLandingContent;
