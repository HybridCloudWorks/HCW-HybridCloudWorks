export const CONTENT_TYPES = new Set(['blog', 'framework', 'architecture', 'coder_corner', 'news']);

export function normalizeContentType(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return CONTENT_TYPES.has(normalized) ? normalized : 'blog';
}

export function getPublishTargetForType(value) {
  const type = normalizeContentType(value);
  if (type === 'news') return 'blog';
  return type;
}

export function getPublicSectionForTarget(value) {
  switch (getPublishTargetForType(value)) {
    case 'framework':
      return 'frameworks';
    case 'architecture':
      return 'architecture-designs';
    case 'coder_corner':
      return 'code';
    case 'news':
      return 'news';
    case 'blog':
    default:
      return 'blog';
  }
}

export function getCanonicalContentType(item = {}) {
  const explicitType = normalizeContentType(item.contentType || item.type);
  if (explicitType !== 'blog') return explicitType;

  const target = String(item.publishTarget || '')
    .trim()
    .toLowerCase();

  if (target === 'framework' || target === 'architecture' || target === 'coder_corner') {
    return target;
  }
  if (target === 'news' || target === 'rss') {
    return 'news';
  }
  return explicitType;
}

export function getPublishTargetForItem(item = {}) {
  return getPublishTargetForType(item.publishTarget || getCanonicalContentType(item));
}

export function normalizeContentProvider(value = '') {
  const aliases = {
    amazon: 'aws',
    'amazon web services': 'aws',
    'google cloud': 'gcp',
    google: 'gcp',
    microsoft: 'azure',
  };

  const key = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim();

  return aliases[key] || key.replace(/\s+/g, '') || '';
}

export function getContentPublicPath(item = {}) {
  const provider = normalizeContentProvider(
    item['Cloud Provider'] || item.cloudProvider || item.provider || ''
  );
  const slug = item.slug || item.Slug || '';

  if (!provider || !slug) return '';

  return `/${provider}/${getPublicSectionForTarget(getPublishTargetForItem(item))}/${slug}`;
}
