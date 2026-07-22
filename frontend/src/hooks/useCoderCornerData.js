import { useMemo } from 'react';
import { limit, where } from 'firebase/firestore';
import { useFirestoreQuery } from '@/hooks/useFirestore';
import { formatPostDate } from '@/lib/blogUtils';

const PROVIDER_ALIASES = {
  aws: ['AWS', 'Aws', 'aws'],
  azure: ['Azure', 'azure'],
  gcp: ['GCP', 'Gcp', 'gcp', 'Google Cloud'],
  finops: ['FinOps', 'Finops', 'finops'],
  github: ['Github', 'GitHub', 'github'],
  terraform: ['Terraform', 'terraform'],
  vmware: ['VMware', 'Vmware', 'vmware'],
  ansible: ['Ansible', 'ansible'],
};

const PUBLISHED_STATUSES = new Set(['published_blog']);

function isPublicDocument(doc = {}) {
  if (doc.softDeletedAt || doc.softDeleteExpiresAt) return false;
  return (
    doc.Live === true ||
    doc.Status === 'Live' ||
    PUBLISHED_STATUSES.has(String(doc.contentStatus || ''))
  );
}

function normalizeTags(doc = {}) {
  if (Array.isArray(doc.tags)) return doc.tags;
  if (Array.isArray(doc.Tags)) return doc.Tags;
  if (Array.isArray(doc.keyTopics)) return doc.keyTopics;
  return [];
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
}

function resolvePublishedDate(doc = {}) {
  return (
    doc.publishedDate ||
    doc.datePublished ||
    doc['Published At'] ||
    doc.blogPublishedAt ||
    doc.publishedAt ||
    null
  );
}

function normalizeItem(doc = {}) {
  const tags = normalizeTags(doc);
  const title = firstNonEmpty(doc.title, doc.Title, 'Untitled') || 'Untitled';
  const description =
    firstNonEmpty(doc.summary, doc.Summary, doc.explanation, doc.description, '') || '';
  const category = firstNonEmpty(doc.category, doc.Category, 'Coder Corner') || 'Coder Corner';
  const complexity =
    firstNonEmpty(doc.complexity, doc.Complexity, 'Intermediate') || 'Intermediate';
  const slug = firstNonEmpty(doc.slug, doc.Slug, doc.id);
  const language = firstNonEmpty(doc.language, doc.stack);
  const repoUrl = firstNonEmpty(doc.repoUrl, doc.sourceUrl, doc.url);

  return {
    id: doc.id,
    title,
    description,
    excerpt: firstNonEmpty(doc.summary, doc.Summary, doc.explanation, '') || '',
    category,
    complexity,
    tags,
    date: formatPostDate(resolvePublishedDate(doc)),
    slug,
    language,
    repoUrl,
  };
}

export function useCoderCornerData(provider) {
  const normalizedProvider = String(provider || '').toLowerCase();
  const providerLabels = PROVIDER_ALIASES[normalizedProvider] || [
    normalizedProvider,
    normalizedProvider.toUpperCase(),
  ];

  const { data: contentRecords, loading: contentLoading } = useFirestoreQuery(
    providerLabels.length > 0 ? 'content' : '',
    [where('Cloud Provider', 'in', providerLabels), where('type', '==', 'coder_corner'), limit(60)]
  );

  const contentItems = useMemo(
    () =>
      (contentRecords || [])
        .filter(isPublicDocument)
        .map(normalizeItem)
        .filter((item) => item.title && item.slug),
    [contentRecords]
  );
  const shouldLoadLegacy = !contentLoading && contentItems.length === 0;
  const { data: legacyBlogRecords, loading: blogsLoading } = useFirestoreQuery(
    shouldLoadLegacy ? 'blogs' : '',
    [where('Cloud Provider', 'in', providerLabels), where('type', '==', 'coder_corner'), limit(30)]
  );

  const items = useMemo(() => {
    if (contentItems.length > 0) {
      return contentItems;
    }

    return (legacyBlogRecords || [])
      .filter(isPublicDocument)
      .map(normalizeItem)
      .filter((item) => item.title && item.slug);
  }, [contentItems, legacyBlogRecords]);

  return {
    items,
    loading: contentLoading || (shouldLoadLegacy && blogsLoading),
    error: null,
  };
}

export default useCoderCornerData;
