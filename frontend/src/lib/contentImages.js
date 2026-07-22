const SLOT_KEYS = ['hero', 'secondary1', 'secondary2', 'secondary3'];

function normalizeUrl(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getOrderedContentImageUrls(item = {}) {
  const seen = new Set();
  const urls = [];
  const secondary = Array.isArray(item.secondaryImageUrls) ? item.secondaryImageUrls : [];
  const aiMap = item.aiImageUrls || {};

  const candidates = [
    item.heroImageUrl,
    item.altCoverImage,
    item.contentImageUrl,
    ...secondary,
    aiMap.hero,
    aiMap.secondary1,
    aiMap.secondary2,
    aiMap.secondary3,
    aiMap.content,
  ];

  candidates.forEach((candidate) => {
    const url = normalizeUrl(candidate);
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  });

  return urls;
}

export function getOrderedContentImages(item = {}) {
  return getOrderedContentImageUrls(item).map((url, index) => ({
    id: `${index}-${url}`,
    url,
    position: index,
    label: index === 0 ? 'Hero' : `Secondary ${index}`,
  }));
}

export function buildAiImageUrlsFromOrderedUrls(urls = []) {
  const next = {};
  SLOT_KEYS.forEach((slot, index) => {
    if (urls[index]) next[slot] = urls[index];
  });
  return next;
}

export function buildContentImageFieldsFromOrderedUrls(urls = [], existing = {}) {
  const normalized = urls.map(normalizeUrl).filter(Boolean);
  const heroImageUrl = normalized[0] || '';
  const secondaryImageUrls = normalized.slice(1, 4);
  const nextAiImageUrls = buildAiImageUrlsFromOrderedUrls(normalized);
  const existingAiImageUrls = existing.aiImageUrls || {};

  if (existingAiImageUrls.content && normalized.includes(existingAiImageUrls.content)) {
    nextAiImageUrls.content = existingAiImageUrls.content;
  }

  return {
    heroImageUrl,
    contentImageUrl: heroImageUrl,
    altCoverImage: heroImageUrl,
    secondaryImageUrls,
    aiImageUrls: nextAiImageUrls,
  };
}

export function buildContentImageDocUpdate(urls = [], existing = {}, deleteFieldValue) {
  const fields = buildContentImageFieldsFromOrderedUrls(urls, existing);
  const updates = {};

  if (fields.heroImageUrl) {
    updates.heroImageUrl = fields.heroImageUrl;
    updates.contentImageUrl = fields.contentImageUrl;
    updates.altCoverImage = fields.altCoverImage;
  } else if (deleteFieldValue) {
    updates.heroImageUrl = deleteFieldValue();
    updates.contentImageUrl = deleteFieldValue();
    updates.altCoverImage = deleteFieldValue();
  }

  if (fields.secondaryImageUrls.length > 0) {
    updates.secondaryImageUrls = fields.secondaryImageUrls;
  } else if (deleteFieldValue) {
    updates.secondaryImageUrls = deleteFieldValue();
  }

  updates.aiImageUrls = fields.aiImageUrls;
  return updates;
}
