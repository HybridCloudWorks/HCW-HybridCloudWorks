/**
 * CMS Content Workflow Functions
 *
 * These functions extend the existing blog pipeline with editorial workflow:
 * - submitContentUrls: HTTP endpoint for manual URL ingestion
 * - transitionContentStatus: HTTP endpoint for status state machine + audit
 * - batchInspect: HTTP endpoint to trigger inspection on uninspected docs
 *
 * Import and re-export these from index.js
 */

const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');

const admin = require('./lib/firebase-admin');
const axios = require('axios');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const Replicate = require('replicate');
const crypto = require('crypto');
const {
  generateJsonResponse,
  getActiveAiProvider,
  defaultModelFor,
} = require('./lib/ai-model-router');
const { getVertexReadiness } = require('./lib/vertex-readiness');
const {
  requireAdminClaims,
  getCurrentAdminStatus: getCurrentAdminStatusHandler,
  setAdminRole,
  ADMIN_ROLES,
} = require('./lib/admin-auth');

const replicateApiKey = defineSecret('REPLICATE_API_KEY');
const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');
const openaiApiKey = defineSecret('OPENAI_API_KEY');
const perplexityApiKey = defineSecret('PERPLEXITY_API_KEY');
const geminiApiKey = defineSecret('GEMINI_API_KEY');
// FINDING-04 (HIGH): Publer API key moved from VITE_ client env to Secret Manager.
// The VITE_ prefix caused it to be bundled into the production JS build, exposing
// it to any visitor who inspects the network tab or source files.
const publerApiKeySecret = defineSecret('PUBLER_API_KEY');
const publerWorkspaceIdSecret = defineSecret('PUBLER_WORKSPACE_ID');
const aiSecrets = [anthropicApiKey, openaiApiKey, perplexityApiKey, geminiApiKey];

const ADMIN_ALLOWED_ORIGINS = (process.env.CMS_ADMIN_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://hybridcloudworks.com',
  'https://www.hybridcloudworks.com',
  ...ADMIN_ALLOWED_ORIGINS,
];

function applyCors(req, res, allowedMethods = 'POST, OPTIONS') {
  const { origin } = req.headers;
  if (origin) {
    const normalizedOrigin = String(origin).trim().replace(/\/$/, '');
    const allowOrigin =
      ALLOWED_ORIGINS.includes(normalizedOrigin) ||
      /^https:\/\/(www|admin)\.hybridcloudworks\.com$/.test(normalizedOrigin) ||
      /^http:\/\/localhost(?::\d+)?$/i.test(normalizedOrigin);

    if (!allowOrigin) {
      res.status(403).json({ error: 'Origin not allowed' });
      return false;
    }
    res.set('Access-Control-Allow-Origin', normalizedOrigin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', allowedMethods);
  res.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Accept, Origin'
  );
  res.set('Access-Control-Max-Age', '3600');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return false;
  }
  return true;
}

function slugify(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function uniqueSlug(baseSlug, id = '') {
  const suffix = id ? String(id).slice(0, 6) : Date.now().toString(36).slice(-6);
  if (!baseSlug) return suffix;
  return `${baseSlug}-${suffix}`;
}

function normalizeProviderName(value) {
  const key = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (key === 'aws') return 'Aws';
  if (key === 'azure') return 'Azure';
  if (key === 'gcp' || key === 'googlecloud') return 'Gcp';
  if (key === 'github') return 'Github';
  if (key === 'terraform') return 'Terraform';
  if (key === 'finops') return 'Finops';
  return '';
}

const SUPPORTED_PUBLISH_TARGETS = new Set(['blog', 'framework', 'architecture', 'coder_corner']);

function normalizeContentType(type) {
  const normalized = String(type || '')
    .trim()
    .toLowerCase();
  return SUPPORTED_PUBLISH_TARGETS.has(normalized) ? normalized : 'blog';
}

function normalizePublishTarget(value, fallbackType = 'blog') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  if (normalized === 'published_news' || normalized === 'approved_news') {
    return 'blog';
  }

  if (normalized === 'news' || normalized === 'rss' || normalized === 'both') {
    return 'blog';
  }

  if (SUPPORTED_PUBLISH_TARGETS.has(normalized)) {
    return normalized;
  }

  return normalizeContentType(fallbackType);
}

function getPublicSectionForPublishTarget(publishTarget) {
  switch (normalizePublishTarget(publishTarget)) {
    case 'framework':
      return 'frameworks';
    case 'architecture':
      return 'architecture-designs';
    case 'coder_corner':
      return 'code';
    case 'blog':
    default:
      return 'blog';
  }
}

function normalizeStatusForBlogOnly(status) {
  if (status === 'published_news' || status === 'published_both') {
    return 'published_blog';
  }
  if (status === 'approved_news') {
    return 'approved_blog';
  }
  return status;
}

function normalizeCurrentStatusForBlogOnly(status) {
  return normalizeStatusForBlogOnly(status || 'ingested');
}

function normalizeContentUpdatesForBlogOnly(updates = {}) {
  const normalized = { ...updates };

  if (Object.prototype.hasOwnProperty.call(normalized, 'publishTarget')) {
    normalized.publishTarget = normalizePublishTarget(
      normalized.publishTarget,
      normalized.type || normalized.contentType
    );
  }

  if (typeof normalized.contentStatus === 'string') {
    normalized.contentStatus = normalizeStatusForBlogOnly(normalized.contentStatus);
  }

  if (normalized.approvedForNews === true) {
    normalized.approvedForNews = false;
  }

  return normalized;
}

function getDocDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  return null;
}

function getRejectionReferenceDate(data) {
  return (
    getDocDateValue(data?.rejectedAt) ||
    getDocDateValue(data?.reviewedAt) ||
    getDocDateValue(data?.updatedAt) ||
    null
  );
}

function isValidDateValue(value) {
  if (!value) return true;
  const parsed = value?.toDate ? value.toDate() : new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function toValidDate(value) {
  if (!value) return null;
  const parsed = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolvePreferredPublishedDate(data = {}) {
  const candidates = [
    data.publishedDate,
    data.datePublished,
    data['Published At'],
    data.blogPublishedAt,
    data.publishedAt,
  ];

  for (const candidate of candidates) {
    const parsed = toValidDate(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function validatePublishMetadata({ contentData = {}, publishTarget, cloudProvider, slug }) {
  const errors = [];

  if (!SUPPORTED_PUBLISH_TARGETS.has(normalizePublishTarget(publishTarget))) {
    errors.push(`Invalid publishTarget: ${publishTarget}`);
  }

  if (!normalizeProviderName(cloudProvider)) {
    errors.push('Missing or invalid cloud provider');
  }

  if (!slug || typeof slug !== 'string' || !slug.trim()) {
    errors.push('Missing slug for publish path');
  }

  if (
    !isValidDateValue(
      contentData.publishedDate ||
        contentData.datePublished ||
        contentData['Published At'] ||
        contentData.publishedAt
    )
  ) {
    errors.push('Invalid Published At timestamp');
  }

  if (!isValidDateValue(contentData.scheduledPublishDate)) {
    errors.push('Invalid scheduledPublishDate timestamp');
  }

  return errors;
}

const BUCKET = 'hybridcloudworks-61e8d.appspot.com';

// Lightweight logger wrapper — normalize logging and satisfy eslint console rules
const logger = {
  warn: (...args) => console.warn('[cms-functions]', ...args),
  error: (...args) => console.error('[cms-functions]', ...args),
  info: (...args) => console.warn('[cms-functions]', ...args),
};

const DEFAULT_DRAFT_INSTRUCTION_PROMPT = `You are generating a high-quality technical draft article for Hybrid Cloud Works. Use the source URL as the primary source. If supporting documents are provided, incorporate them as additional context. Produce a publication-ready title, concise editorial summary, a structured markdown article draft around 2500-3200 words, and image prompts tailored to the article.`;
const MAX_SUPPORTING_DOCUMENTS = 5;
const MAX_REMOTE_SUPPORTING_DOCUMENT_BYTES = 15 * 1024 * 1024;

function getHeadingMatch(line = '') {
  const match = String(line).match(/^(#{1,6})\s+(.+?)\s*$/);
  if (!match) return null;

  return {
    level: match[1].length,
    title: match[2].trim(),
  };
}

function moveTldrSectionToEnd(markdown = '') {
  const source = String(markdown || '');
  if (!source.trim()) return source;

  const lines = source.split('\n');
  let startIndex = -1;
  let headingLevel = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const heading = getHeadingMatch(lines[index]);
    if (heading && /^tl;?dr\b/i.test(heading.title)) {
      startIndex = index;
      headingLevel = heading.level;
      break;
    }
  }

  if (startIndex < 0) return source;

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const heading = getHeadingMatch(lines[index]);
    if (heading && heading.level <= headingLevel) {
      endIndex = index;
      break;
    }
  }

  const before = lines.slice(0, startIndex).join('\n').trimEnd();
  const section = lines.slice(startIndex, endIndex).join('\n').trim();
  const after = lines.slice(endIndex).join('\n').trim();

  if (!section) return source;

  return [before, after, section].filter(Boolean).join('\n\n').trim();
}

function ensureTldrSectionAtEnd(markdown = '') {
  const source = String(markdown || '').trim();
  if (!source) return '## TL;DR :)\n\n- Add the final takeaway summary here.';

  const normalized = moveTldrSectionToEnd(source);
  const hasTldr = normalized.split('\n').some((line) => {
    const heading = getHeadingMatch(line);
    return heading && /^tl;?dr\b/i.test(heading.title);
  });

  if (hasTldr) return normalized;
  return `${normalized}\n\n## TL;DR :)\n\n- Add the final takeaway summary here.`.trim();
}

function normalizeContentBodyFields(data = {}) {
  const normalized = { ...data };
  ['Content', 'content', 'postContent', 'blogDraft'].forEach((key) => {
    if (typeof normalized[key] === 'string') {
      normalized[key] = ensureTldrSectionAtEnd(normalized[key]);
    }
  });
  return normalized;
}

function buildPreviewSlotPrompt({
  target,
  summaryPrompt,
  detailsPrompt,
  slotTemplates = {},
  title,
  summary,
}) {
  const slotConfig = {
    hero: {
      slotLabel: 'Hero cover image',
      instruction:
        'Create the strongest cover composition for the article. One dominant focal subject, editorial framing, no collage layout, and no unrelated symbols.',
    },
    secondary1: {
      slotLabel: 'Supporting image 1',
      instruction:
        'Stay on the same article subject while focusing on architecture, platform components, or technical environment details.',
    },
    secondary2: {
      slotLabel: 'Supporting image 2',
      instruction:
        'Stay on the same article subject while focusing on implementation flow, operational motion, or team interaction with the system.',
    },
    secondary3: {
      slotLabel: 'Supporting image 3',
      instruction:
        'Stay on the same article subject while focusing on business outcome, governance, resilience, or production-readiness details.',
    },
  }[target] || {
    slotLabel: `Image slot ${target}`,
    instruction:
      'Stay on the same article subject and visual style. Only vary composition and supporting details.',
  };

  const prompt = [
    'Template version: preview-slot-v2',
    `Requested slot: ${slotConfig.slotLabel}`,
    `Article title: ${title}`,
    `Article summary: ${summary}`,
    `Primary prompt: ${summaryPrompt}`.trim(),
    `Additional parameters: ${detailsPrompt}`.trim(),
    `Slot template override: ${String(slotTemplates?.[target] || '').trim()}`.trim(),
    slotConfig.instruction,
    'All images in this request must depict the same core subject, same provider context, and same article narrative.',
    'Do not drift into unrelated scenery, mascots, toys, logos, or abstract art unless the prompt explicitly requires them.',
    'Do not add text, watermarks, UI screenshots, or multi-panel collage layouts.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    slotLabel: slotConfig.slotLabel,
    templateVersion: 'preview-slot-v2',
    prompt,
  };
}

// Helper: build content document payload for ingestion
function buildContentDoc({
  url,
  title = '',
  publishedDate,
  imageUrl,
  heroImageUrl,
  secondaryImageUrls,
  generateAiCover,
  aiImageTargets,
  imagePromptSeed,
  imagePromptDetails,
  cloudProvider,
  publishTarget,
  type = 'blog',
  autoInspect = true,
}) {
  const combinedPrompt = [imagePromptSeed, imagePromptDetails]
    .filter((part) => typeof part === 'string' && part.trim().length > 0)
    .join('\n\n')
    .trim();

  return {
    url,
    sourceUrl: url,
    'CD Url': url,
    source: 'manual_url',
    contentStatus: 'ingested',
    storageCollection: 'content',
    'Created At': admin.firestore.FieldValue.serverTimestamp(),
    fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
    Status: 'Draft',
    Live: false,
    approvedForNews: false,
    approvedForBlog: false,
    inspectTrigger: autoInspect,
    Title: title || '',
    Content: '',
    Summary: '',
    Tags: [],
    type,
    ...(publishedDate && { 'Published At': new Date(publishedDate) }),
    ...(imageUrl && { imageUrl, contentImageUrl: imageUrl }),
    ...(heroImageUrl && { heroImageUrl, contentImageUrl: heroImageUrl }),
    ...(Array.isArray(secondaryImageUrls) &&
      secondaryImageUrls.length > 0 && {
        secondaryImageUrls: secondaryImageUrls.slice(0, 3).filter(Boolean),
      }),
    ...(generateAiCover && {
      altCoverImageTrigger: true,
      aiImageTargets:
        Array.isArray(aiImageTargets) && aiImageTargets.length > 0
          ? aiImageTargets.slice(0, 4)
          : ['hero'],
      ...(combinedPrompt && { altCoverImagePrompt: combinedPrompt }),
      ...(imagePromptSeed && { imagePromptSeed }),
      ...(imagePromptDetails && { imagePromptDetails }),
    }),
    ...(cloudProvider && { 'Cloud Provider': cloudProvider, cloudProvider }),
    ...(publishTarget && { publishTarget }),
  };
}

// Helper: build blog payload when publishing from content
function buildBlogData({
  contentData,
  contentId,
  user,
  publishTarget,
  cloudProvider,
  landingProvider,
  markLive,
  createSlugPageTrigger,
  addToCurated,
  slug,
  curatedSubpagePath,
}) {
  const normalizedPublishTarget = normalizePublishTarget(publishTarget, contentData?.type);
  const section = getPublicSectionForPublishTarget(normalizedPublishTarget);
  const inferredProvider =
    normalizeProviderName(cloudProvider) ||
    normalizeProviderName(
      contentData?.['Cloud Provider'] ||
        contentData?.cloudProvider ||
        contentData?.provider ||
        contentData?.Provider
    );
  const publicUrl = toPublicUrl(curatedSubpagePath);
  const resolvedPublishedDate = resolvePreferredPublishedDate(contentData) || new Date();

  return {
    ...contentData,
    sourceContentId: contentId,
    contentOriginCollection: 'content',
    contentStatus: 'published_blog',
    publishTarget: normalizedPublishTarget,
    slug,
    Slug: slug,
    curatedSubpagePath,
    slugPageUrl: publicUrl,
    publishedUrl: publicUrl,
    publicUrl,
    blogUrl: publicUrl,
    Live: Boolean(markLive),
    ...(inferredProvider && {
      'Cloud Provider': inferredProvider,
      cloudProvider: inferredProvider,
    }),
    ...(landingProvider && {
      landingProvider,
      targetLandingZone: `/${String(landingProvider).toLowerCase()}/${section}`,
    }),
    approvedForBlog: true,
    createSlugPageTrigger: createSlugPageTrigger === true,
    createdFromContentAt: admin.firestore.FieldValue.serverTimestamp(),
    publishedBy: user.email || user.uid || 'admin',
    publishedAt: resolvedPublishedDate,
    blogPublishedAt: resolvedPublishedDate,
    'Published At': resolvedPublishedDate,
    publishedDate: resolvedPublishedDate,
    datePublished: resolvedPublishedDate,
    ...(addToCurated
      ? {
          curatedParent: 'Curated Articles',
          curatedSubpage: true,
        }
      : {}),
  };
}

function toPublicUrl(pathValue) {
  if (!pathValue) return null;
  const path = String(pathValue).startsWith('/') ? String(pathValue) : `/${String(pathValue)}`;
  return `https://hybridcloudworks.com${path}`;
}

// Helper: build status update payload for transitionContentStatus
// Per-status mutators for buildStatusUpdateData. Each takes the existing
// `updateData` (already populated with status / reviewedBy / reviewedAt /
// reviewNotes) and the resolution context, and applies status-specific
// fields. Kept as a dispatch table to keep the parent function flat.
function applyStatusApprovedBlog(updateData, data, ctx) {
  updateData.approvedForBlog = true;
  updateData.approvedForNews = false;
  updateData.publishTarget = ctx.resolvedPublishTarget;
  if (!data.blogDraft) {
    updateData.blogDraft = data.content || data.Content || '';
  }
}

function applyStatusEditing(updateData, data) {
  if (!data.blogDraft) {
    updateData.blogDraft = data.content || data.Content || '';
  }
}

function applyStatusPublishedBlog(updateData, data, ctx) {
  const fallbackTimestamp = admin.firestore.FieldValue.serverTimestamp();
  updateData.blogPublishedAt = ctx.resolvedPublishedDate || fallbackTimestamp;
  updateData.publishedAt = ctx.resolvedPublishedDate || fallbackTimestamp;
  if (ctx.resolvedPublishedDate) {
    updateData['Published At'] = ctx.resolvedPublishedDate;
    updateData.publishedDate = ctx.resolvedPublishedDate;
    updateData.datePublished = ctx.resolvedPublishedDate;
  }
  updateData.publishTarget = ctx.resolvedPublishTarget;
  updateData.Live = ctx.markLive === null ? true : Boolean(ctx.markLive);
  updateData.approvedForNews = false;
  updateData.approvedForBlog = true;
}

function applyStatusRejected(updateData) {
  updateData.Live = false;
  updateData.rejectedAt = admin.firestore.FieldValue.serverTimestamp();
}

function applyStatusArchived(updateData) {
  updateData.Live = false;
}

const STATUS_APPLIERS = {
  approved_blog: applyStatusApprovedBlog,
  editing: applyStatusEditing,
  published_blog: applyStatusPublishedBlog,
  rejected: applyStatusRejected,
  archived: applyStatusArchived,
};

function buildStatusUpdateData(data, newStatus, reviewedBy, reviewNotes, options = {}) {
  const { publishTarget = null, markLive = null } = options;
  const ctx = {
    resolvedPublishTarget: normalizePublishTarget(
      publishTarget,
      data.publishTarget || data.type || data.contentType
    ),
    resolvedPublishedDate: resolvePreferredPublishedDate(data),
    markLive,
  };
  const updateData = {
    contentStatus: newStatus,
    reviewedBy,
    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewNotes,
  };

  const applier = STATUS_APPLIERS[newStatus];
  if (applier) applier(updateData, data, ctx);

  return updateData;
}

function buildContentImageUpdates(urls = [], existing = {}) {
  const normalized = (Array.isArray(urls) ? urls : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, 4);

  const heroImageUrl = normalized[0] || null;
  const secondaryImageUrls = normalized.slice(1, 4);
  const nextAiImageUrls = {};
  ['hero', 'secondary1', 'secondary2', 'secondary3'].forEach((slot, index) => {
    if (normalized[index]) {
      nextAiImageUrls[slot] = normalized[index];
    }
  });

  if (existing?.aiImageUrls?.content && normalized.includes(existing.aiImageUrls.content)) {
    nextAiImageUrls.content = existing.aiImageUrls.content;
  }

  return {
    heroImageUrl,
    contentImageUrl: heroImageUrl,
    altCoverImage: heroImageUrl,
    secondaryImageUrls,
    aiImageUrls: nextAiImageUrls,
  };
}

function buildContentImageFieldUpdates(imageUpdates = {}) {
  return {
    heroImageUrl: imageUpdates.heroImageUrl || admin.firestore.FieldValue.delete(),
    contentImageUrl: imageUpdates.contentImageUrl || admin.firestore.FieldValue.delete(),
    altCoverImage: imageUpdates.altCoverImage || admin.firestore.FieldValue.delete(),
    secondaryImageUrls:
      Array.isArray(imageUpdates.secondaryImageUrls) && imageUpdates.secondaryImageUrls.length > 0
        ? imageUpdates.secondaryImageUrls
        : admin.firestore.FieldValue.delete(),
    aiImageUrls: imageUpdates.aiImageUrls || {},
  };
}

function buildAdminAuditLogData({
  action,
  user,
  req = null,
  details = {},
  contentId = null,
  contentTitle = '',
}) {
  const safeDetails = details || {};
  const userAgent = req?.headers?.['user-agent'] || safeDetails.userAgent || null;
  const base = {
    action: String(action || 'admin_action'),
    userId: user?.uid || null,
    userEmail: user?.email || null,
    route: safeDetails.route || null,
    sessionId: safeDetails.sessionId || null,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    clientTimestamp: safeDetails.clientTimestamp || null,
    details: safeDetails,
    userAgent,
    compliance: {
      schemaVersion: 1,
      detailsSanitized: true,
      identityVerified: true,
    },
  };
  if (contentId) base.contentId = contentId;
  if (contentTitle) base.contentTitle = contentTitle;
  return base;
}

function createAdminAuditRef(db) {
  return db.collection('admin_audit_logs').doc();
}

/**
 * Audit-log entry for actions taken by scheduled functions (no end-user
 * present). Schema mirrors `buildAdminAuditLogData` with `actor: 'system'`
 * so forensic queries can union end-user and system actions.
 */
function buildSystemAuditLogData({ action, source, details = {} }) {
  return {
    action: String(action || 'system_action'),
    actor: 'system',
    source: String(source || 'cron'),
    userId: null,
    userEmail: null,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    details,
    compliance: {
      schemaVersion: 1,
      detailsSanitized: true,
      identityVerified: true,
    },
  };
}

function normalizePromptConfigKey(value = '') {
  return String(value || '').trim();
}

function pathToPromptPageDocId(pagePath = '') {
  return String(pagePath || '')
    .replace(/\//g, '_')
    .replace(/^_/, '');
}

function hasLegacyPromptFields(data = {}) {
  return Boolean(data?.primaryPrompt || data?.secondaryPrompt || data?.title);
}

function normalizeSlotTemplates(slotTemplates = {}) {
  const keys = ['hero', 'secondary1', 'secondary2', 'secondary3'];
  return keys.reduce((acc, key) => {
    const value = String(slotTemplates?.[key] || '').trim();
    if (value) acc[key] = value;
    return acc;
  }, {});
}

const ADMIN_PROMPT_PAGE_ALLOWLIST = new Set([
  '/aws',
  '/aws/news',
  '/aws/blog',
  '/aws/architecture-designs',
  '/aws/frameworks',
  '/aws/education',
  '/aws/audio-architecture',
  '/azure',
  '/azure/news',
  '/azure/blog',
  '/azure/architecture-designs',
  '/azure/frameworks',
  '/azure/education',
  '/azure/audio-architecture',
  '/gcp',
  '/gcp/news',
  '/gcp/blog',
  '/gcp/architecture-designs',
  '/gcp/frameworks',
  '/gcp/education',
  '/gcp/audio-architecture',
  '/finops',
  '/finops/news',
  '/finops/blog',
  '/finops/architecture-designs',
  '/finops/frameworks',
  '/finops/education',
  '/finops/tools',
  '/finops/focus',
  '/terraform',
  '/terraform/news',
  '/terraform/blog',
  '/terraform/code',
  '/terraform/modules',
  '/terraform/tools',
  '/github',
  '/github/news',
  '/github/blog',
  '/github/workflows',
  '/github/code',
  '/github/tools',
]);

function assertStringLength(value, fieldName, maxLength, { allowEmpty = true } = {}) {
  const normalized = String(value || '');
  if (!allowEmpty && !normalized.trim()) {
    throw new Error(`${fieldName} is required`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${fieldName} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function assertOptionalDateString(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid date`);
  }
  return parsed;
}

function assertImageUrlList(urls = []) {
  if (!Array.isArray(urls)) {
    throw new Error('orderedImageUrls must be an array');
  }
  return urls.map((value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return normalized;
    if (!/^https?:\/\//i.test(normalized)) {
      throw new Error('orderedImageUrls must contain absolute http(s) URLs');
    }
    if (normalized.length > 2048) {
      throw new Error('orderedImageUrls contains an entry that exceeds 2048 characters');
    }
    return normalized;
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertOptionalHttpUrl(value, fieldName, { allowEmpty = true } = {}) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    if (!allowEmpty) throw new Error(`${fieldName} is required`);
    return '';
  }
  if (normalized.length > 2048) {
    throw new Error(`${fieldName} exceeds 2048 characters`);
  }
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${fieldName} must be a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${fieldName} must be an http(s) URL`);
  }
  return normalized;
}

function assertStringArray(value, fieldName, { maxItems = 50, maxItemLength = 120 } = {}) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  if (value.length > maxItems) {
    throw new Error(`${fieldName} exceeds ${maxItems} items`);
  }
  return value.map((entry) => {
    const normalized = String(entry || '').trim();
    if (normalized.length > maxItemLength) {
      throw new Error(`${fieldName} contains an entry that exceeds ${maxItemLength} characters`);
    }
    return normalized;
  });
}

function assertJsonSize(value, fieldName, maxChars = 120_000) {
  if (value === null || value === undefined) return value;
  // Defensive: only JSON-friendly values should be stored.
  const serialized = JSON.stringify(value);
  if (serialized.length > maxChars) {
    throw new Error(`${fieldName} payload exceeds ${maxChars} characters`);
  }
  return value;
}

const FORBIDDEN_CONTENT_UPDATE_KEYS = new Set([
  // Workflow/state machine is authoritative via transition handlers.
  'contentStatus',
  'Status',
  'Live',
  'approvedForBlog',
  'approvedForNews',
  'reviewedAt',
  'reviewedBy',
  'reviewNotes',
  'publishedToBlogs',
  'publishedBlogId',
  'movedToBlogsAt',
  // Timestamps/identity are backend-owned.
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'publishedAt',
  'blogPublishedAt',
  'Published At',
]);

// Per-field-type normalizers used by validateAndNormalizeUpdateContentItemUpdates.
// Each tries to handle the field; returns true if it consumed the entry,
// false to fall through to the next normalizer.
function isUrlField(field) {
  return (
    /Url$/i.test(field) ||
    /URL$/i.test(field) ||
    field === 'url' ||
    field === 'sourceUrl' ||
    field === 'docLink' ||
    field === 'diagramUrl'
  );
}

function isDateLikeField(field) {
  return /At$/.test(field) || /Date$/.test(field) || field === 'publishedDate';
}

function tryNormalizeKnownField(normalized, field, value) {
  if (isUrlField(field)) {
    normalized[field] = assertOptionalHttpUrl(value, field, { allowEmpty: true });
    return true;
  }
  if (isDateLikeField(field)) {
    if (typeof value === 'string') {
      normalized[field] = assertOptionalDateString(value, field);
      return true;
    }
    if (value instanceof Date) {
      normalized[field] = value;
      return true;
    }
  }
  if (field === 'title' || field === 'Title') {
    const t = assertStringLength(value, 'title', 240, { allowEmpty: true }).trim();
    normalized.title = t;
    normalized.Title = t;
    return true;
  }
  if (field === 'summary' || field === 'Summary') {
    const s = assertStringLength(value, 'summary', 10_000, { allowEmpty: true }).trim();
    normalized.summary = s;
    normalized.Summary = s;
    return true;
  }
  if (field === 'cloudProvider' || field === 'Cloud Provider') {
    const provider = normalizeProviderName(value);
    if (!provider) {
      throw new Error(`cloudProvider must be one of: Aws, Azure, Gcp, Github, Terraform, Finops`);
    }
    normalized.cloudProvider = provider;
    normalized['Cloud Provider'] = provider;
    return true;
  }
  if (field === 'publishTarget') {
    normalized.publishTarget = normalizePublishTarget(value);
    return true;
  }
  return tryNormalizeArrayField(normalized, field, value);
}

function tryNormalizeArrayField(normalized, field, value) {
  if (field === 'tags' || field === 'Tags') {
    const tags = assertStringArray(value, 'tags', { maxItems: 60, maxItemLength: 60 }) || [];
    const cleaned = tags.map((t) => String(t || '').trim()).filter(Boolean);
    normalized.tags = cleaned;
    normalized.Tags = cleaned;
    return true;
  }
  if (field === 'keyTopics') {
    const topics =
      assertStringArray(value, 'keyTopics', { maxItems: 40, maxItemLength: 120 }) || [];
    normalized.keyTopics = topics.map((t) => String(t || '').trim()).filter(Boolean);
    return true;
  }
  if (field === 'frameworkSourceUrls') {
    const urls =
      assertStringArray(value, 'frameworkSourceUrls', { maxItems: 30, maxItemLength: 2048 }) || [];
    urls.forEach((u) => {
      if (u) assertOptionalHttpUrl(u, 'frameworkSourceUrls', { allowEmpty: true });
    });
    normalized.frameworkSourceUrls = urls.filter(Boolean);
    return true;
  }
  return false;
}

const MAX_STRING_DEFAULT = 12_000;
const MAX_STRING_LARGE = 120_000;

function isLargeStringField(field) {
  return (
    /Html$/i.test(field) ||
    /Code$/i.test(field) ||
    /Draft$/i.test(field) ||
    field === 'overviewHtml' ||
    field === 'terraformCode'
  );
}

function normalizeGenericField(normalized, field, value) {
  if (typeof value === 'boolean' || typeof value === 'number') {
    normalized[field] = value;
    return;
  }
  if (typeof value === 'string') {
    const max = isLargeStringField(field) ? MAX_STRING_LARGE : MAX_STRING_DEFAULT;
    normalized[field] = assertStringLength(value, field, max, { allowEmpty: true });
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 500) {
      throw new Error(`${field} exceeds 500 items`);
    }
    normalized[field] = assertJsonSize(value, field);
    return;
  }
  if (isPlainObject(value)) {
    normalized[field] = assertJsonSize(value, field);
    return;
  }
  throw new Error(`Unsupported value type for ${field}`);
}

function validateAndNormalizeUpdateContentItemUpdates(updates = {}) {
  if (!isPlainObject(updates)) {
    throw new Error('updates must be an object');
  }
  const entries = Object.entries(updates);
  if (entries.length === 0) {
    throw new Error('updates must include at least one field');
  }
  if (entries.length > 80) {
    throw new Error('updates exceeds 80 fields');
  }

  const normalized = {};
  for (const [key, value] of entries) {
    const field = String(key || '').trim();
    if (!field) continue;
    if (field.length > 120) {
      throw new Error(`updates contains a field name that exceeds 120 characters`);
    }
    if (FORBIDDEN_CONTENT_UPDATE_KEYS.has(field)) {
      throw new Error(`updates cannot modify protected field: ${field}`);
    }
    if (value === undefined) continue;
    if (value === null) {
      normalized[field] = null;
      continue;
    }
    if (tryNormalizeKnownField(normalized, field, value)) continue;
    normalizeGenericField(normalized, field, value);
  }
  return normalized;
}

function assertAllowedPromptPage(pagePath) {
  const normalized = String(pagePath || '').trim();
  if (!normalized) {
    throw new Error('pagePath is required');
  }
  if (!ADMIN_PROMPT_PAGE_ALLOWLIST.has(normalized)) {
    throw new Error(`pagePath is not allowed: ${normalized}`);
  }
  return normalized;
}

async function clearImagePromptAssignmentsForSet(db, setName) {
  const normalizedSetName = normalizePromptConfigKey(setName);
  if (!normalizedSetName) return;

  const assignmentsSnapshot = await db.collection('image_prompt_pages').get();
  if (assignmentsSnapshot.empty) return;

  const batch = db.batch();
  assignmentsSnapshot.docs.forEach((entry) => {
    const data = entry.data() || {};
    if (normalizePromptConfigKey(data.setName) !== normalizedSetName) return;
    batch.set(
      entry.ref,
      {
        setName: '',
        promptName: '',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
  await batch.commit();
}

async function deleteImagePromptSetArtifacts(db, setName) {
  const normalizedSetName = normalizePromptConfigKey(setName);
  if (!normalizedSetName) return;

  const promptsSnapshot = await db
    .collection('image_prompt_sets')
    .doc(normalizedSetName)
    .collection('prompts')
    .get();

  const batch = db.batch();
  promptsSnapshot.docs.forEach((promptDoc) => batch.delete(promptDoc.ref));
  batch.delete(db.collection('image_prompt_sets').doc(normalizedSetName));
  await batch.commit();

  const legacyPages = await db.collection('image_prompts').get();
  for (const pageDoc of legacyPages.docs) {
    const data = pageDoc.data() || {};
    const legacySetRef = pageDoc.ref.collection('sets').doc(normalizedSetName);
    const legacySetSnap = await legacySetRef.get();
    if (legacySetSnap.exists) {
      await legacySetRef.delete();
    }

    if (
      hasLegacyPromptFields(data) &&
      normalizePromptConfigKey(data.title || normalizedSetName) === normalizedSetName
    ) {
      await pageDoc.ref.delete();
    }
  }

  await clearImagePromptAssignmentsForSet(db, normalizedSetName);
}

async function deleteLegacyImagePromptIfNeeded(db, setName, promptName) {
  const normalizedSetName = normalizePromptConfigKey(setName);
  const normalizedPromptName = normalizePromptConfigKey(promptName);
  if (!normalizedSetName || !normalizedPromptName) return;

  const legacyPages = await db.collection('image_prompts').get();
  for (const pageDoc of legacyPages.docs) {
    const data = pageDoc.data() || {};
    const legacySetRef = pageDoc.ref.collection('sets').doc(normalizedSetName);
    const legacySetSnap = await legacySetRef.get();
    if (legacySetSnap.exists) {
      const legacySetData = legacySetSnap.data() || {};
      if (
        normalizePromptConfigKey(legacySetData.title || normalizedSetName) === normalizedPromptName
      ) {
        await legacySetRef.delete();
      }
      continue;
    }

    if (
      hasLegacyPromptFields(data) &&
      normalizePromptConfigKey(data.title || normalizedSetName) === normalizedSetName &&
      normalizePromptConfigKey(data.title || 'default') === normalizedPromptName
    ) {
      await pageDoc.ref.delete();
    }
  }
}

// Strip noise from a URL so it dedups against equivalents that differ only
// by tracking params, fragments, scheme, or trailing slash.
function normalizeUrlForDedup(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const u = new URL(rawUrl);
    u.protocol = 'https:';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.hash = '';
    const TRACKING = /^utm_|^mc_|^fbclid$|^gclid$|^ref$|^source$/i;
    [...u.searchParams.keys()].forEach((k) => {
      if (TRACKING.test(k)) u.searchParams.delete(k);
    });
    let path = u.pathname.replace(/\/+$/, '');
    if (path === '') path = '/';
    return `${u.protocol}//${u.hostname}${path}${u.search}`;
  } catch {
    return null;
  }
}

// Lossy normalization for title-similarity dedup. Lowercase, ASCII-fold,
// strip punctuation, collapse whitespace.
function normalizeTitleForDedup(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return null;
  const folded = rawTitle
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return folded || null;
}

const TITLE_DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns `{ duplicate: true, reason, existingId }` if any incoming candidate
 * already exists, otherwise `{ duplicate: false }`. Checks in order:
 *   1. exact `sourceUrl` match (fast path)
 *   2. legacy `'CD Url'` match (fast path)
 *   3. normalized URL match (`normalizedUrl` field) — collapses utm/fragment variants
 *   4. canonical URL match (`canonicalUrl` field, when caller has it)
 *   5. normalized title within a 7-day window (`normalizedTitle` field)
 *
 * For (5) we widen the window with a single equality query on
 * `normalizedTitle` and filter by recency in memory; this avoids requiring
 * a composite index. The window starts from the candidate's `publishedAt`
 * (when available) or from `now`.
 */
// Stage 1: exact `sourceUrl` and legacy `CD Url` match.
async function dedupCheckExactUrl(db, url) {
  if (!url) return null;
  const exact = await db.collection('content').where('sourceUrl', '==', url).limit(1).get();
  if (!exact.empty) {
    return { duplicate: true, reason: 'exact_url', existingId: exact.docs[0].id };
  }
  const legacy = await db.collection('content').where('CD Url', '==', url).limit(1).get();
  if (!legacy.empty) {
    return { duplicate: true, reason: 'legacy_url', existingId: legacy.docs[0].id };
  }
  return null;
}

// Stage 2: normalized URL (utm/fragment-stripped) match.
async function dedupCheckNormalizedUrl(db, normalizedUrl) {
  if (!normalizedUrl) return null;
  const normMatch = await db
    .collection('content')
    .where('normalizedUrl', '==', normalizedUrl)
    .limit(1)
    .get();
  if (!normMatch.empty) {
    return { duplicate: true, reason: 'normalized_url', existingId: normMatch.docs[0].id };
  }
  return null;
}

// Stage 3: canonical URL match (when distinct from normalizedUrl).
async function dedupCheckCanonicalUrl(db, normalizedCanonical, normalizedUrl) {
  if (!normalizedCanonical || normalizedCanonical === normalizedUrl) return null;
  const canonMatch = await db
    .collection('content')
    .where('normalizedUrl', '==', normalizedCanonical)
    .limit(1)
    .get();
  if (!canonMatch.empty) {
    return { duplicate: true, reason: 'canonical_url', existingId: canonMatch.docs[0].id };
  }
  const canonExact = await db
    .collection('content')
    .where('canonicalUrl', '==', normalizedCanonical)
    .limit(1)
    .get();
  if (!canonExact.empty) {
    return { duplicate: true, reason: 'canonical_url', existingId: canonExact.docs[0].id };
  }
  return null;
}

// Stage 4: normalized title match within +/-7d of candidate publish date.
async function dedupCheckTitleWindow(db, normalizedTitle, candidatePublishedMs) {
  if (!normalizedTitle || normalizedTitle.length < 8) return null;
  const titleMatches = await db
    .collection('content')
    .where('normalizedTitle', '==', normalizedTitle)
    .limit(10)
    .get();
  for (const doc of titleMatches.docs) {
    const data = doc.data() || {};
    const candidateRef =
      data.publishedAt ||
      data.blogPublishedAt ||
      data['Published At'] ||
      data.publishedDate ||
      data.fetchedAt ||
      data['Created At'];
    const refDate = getDocDateValue(candidateRef);
    if (!refDate) continue;
    if (Math.abs(refDate.getTime() - candidatePublishedMs) <= TITLE_DEDUP_WINDOW_MS) {
      return { duplicate: true, reason: 'title_within_window', existingId: doc.id };
    }
  }
  return null;
}

async function findDuplicateContent(db, candidate = {}) {
  const url = candidate.url || candidate.sourceUrl || '';
  const canonical = candidate.canonicalUrl || '';
  const title = candidate.title || candidate.Title || '';
  let candidatePublishedMs = Date.now();
  if (typeof candidate.publishedMs === 'number') {
    candidatePublishedMs = candidate.publishedMs;
  } else if (candidate.publishedAt instanceof Date) {
    candidatePublishedMs = candidate.publishedAt.getTime();
  }

  const normalizedUrl = normalizeUrlForDedup(url);
  const normalizedCanonical = normalizeUrlForDedup(canonical);
  const normalizedTitle = normalizeTitleForDedup(title);

  return (
    (await dedupCheckExactUrl(db, url)) ||
    (await dedupCheckNormalizedUrl(db, normalizedUrl)) ||
    (await dedupCheckCanonicalUrl(db, normalizedCanonical, normalizedUrl)) ||
    (await dedupCheckTitleWindow(db, normalizedTitle, candidatePublishedMs)) || {
      duplicate: false,
    }
  );
}

/**
 * Returns the dedup-related fields to merge into a new content doc so future
 * inserts can match against it via `findDuplicateContent`.
 */
function buildDedupFields({ url, canonicalUrl, title }) {
  const out = {};
  const normalizedUrl = normalizeUrlForDedup(url);
  if (normalizedUrl) out.normalizedUrl = normalizedUrl;
  const normalizedCanonical = normalizeUrlForDedup(canonicalUrl);
  if (normalizedCanonical) out.canonicalUrl = normalizedCanonical;
  const normalizedTitle = normalizeTitleForDedup(title);
  if (normalizedTitle) out.normalizedTitle = normalizedTitle;
  return out;
}

// Helper: process a single URL for ingestion (used by submitContentUrls)
async function processIngestUrl(db, url, params) {
  try {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return { error: 'Invalid URL format' };
    }

    const dup = await findDuplicateContent(db, {
      url,
      canonicalUrl: params?.canonicalUrl,
      title: params?.title,
    });
    if (dup.duplicate) {
      return { duplicate: true, duplicateReason: dup.reason, existingId: dup.existingId };
    }

    const baseDoc = buildContentDoc({ url, ...params });
    const dedupFields = buildDedupFields({
      url,
      canonicalUrl: params?.canonicalUrl,
      title: params?.title || baseDoc.Title,
    });
    const createdRef = await db.collection('content').add({ ...baseDoc, ...dedupFields });
    return { createdId: createdRef.id };
  } catch (err) {
    return { error: String(err.message || err) };
  }
}

// Build the merged provider/section/landingProvider context shared across
// both new and reused publish paths.
function resolvePublishContext(contentData, params) {
  const effectivePublishTarget = normalizePublishTarget(
    params.publishTarget,
    contentData.publishTarget || contentData.type
  );
  const inferredProvider =
    normalizeProviderName(params.cloudProvider) ||
    normalizeProviderName(
      contentData?.['Cloud Provider'] ||
        contentData?.cloudProvider ||
        contentData?.provider ||
        contentData?.Provider
    );
  return {
    effectivePublishTarget,
    persistedPublishedDate: resolvePreferredPublishedDate(contentData),
    curatedSection: getPublicSectionForPublishTarget(effectivePublishTarget),
    inferredProvider,
    resolvedLandingProvider:
      normalizeProviderName(params.landingProvider) ||
      normalizeProviderName(contentData?.landingProvider) ||
      inferredProvider,
  };
}

// Republish path: an existing blog already maps to this content. Update both.
async function republishExistingBlog({ contentRef, contentId, contentData, params, ctx, blogDoc }) {
  const existingBlogData = blogDoc.data() || {};
  const existingSlug = existingBlogData.slug || existingBlogData.Slug || contentData.slug || '';
  const resolvedPath =
    existingBlogData.curatedSubpagePath ||
    (ctx.resolvedLandingProvider && existingSlug
      ? `/${String(ctx.resolvedLandingProvider).toLowerCase()}/${ctx.curatedSection}/${existingSlug}`
      : null);
  const updatedBlogData = buildBlogData({
    contentData,
    contentId,
    user: params.user,
    publishTarget: ctx.effectivePublishTarget,
    cloudProvider: ctx.inferredProvider,
    landingProvider: ctx.resolvedLandingProvider,
    markLive: params.markLive,
    createSlugPageTrigger: params.createSlugPageTrigger,
    addToCurated: params.addToCurated,
    slug: existingSlug,
    curatedSubpagePath: resolvedPath,
  });
  await blogDoc.ref.update({
    ...updatedBlogData,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const publishMarker =
    ctx.persistedPublishedDate ||
    existingBlogData.blogPublishedAt ||
    existingBlogData.publishedAt ||
    contentData.blogPublishedAt ||
    contentData.publishedAt ||
    admin.firestore.FieldValue.serverTimestamp();

  await contentRef.update(
    buildContentUpdateForReused({
      blogId: blogDoc.id,
      params,
      ctx,
      existingSlug,
      resolvedPath,
      publishMarker,
    })
  );

  return {
    reused: true,
    blogId: blogDoc.id,
    slug: existingSlug || null,
    curatedSubpagePath: resolvedPath,
    expectedPublicUrl: toPublicUrl(resolvedPath),
    sourceUrl: contentData.sourceUrl || contentData.url || contentData['CD Url'] || null,
    landingProvider: ctx.resolvedLandingProvider || null,
  };
}

function buildContentUpdateForReused({
  blogId,
  params,
  ctx,
  existingSlug,
  resolvedPath,
  publishMarker,
}) {
  return {
    publishedToBlogs: true,
    publishedBlogId: blogId,
    movedToBlogsAt: admin.firestore.FieldValue.serverTimestamp(),
    contentStatus: 'published_blog',
    Live: Boolean(params.markLive),
    publishTarget: ctx.effectivePublishTarget,
    approvedForBlog: true,
    ...(existingSlug && { slug: existingSlug, Slug: existingSlug }),
    ...(resolvedPath && {
      curatedSubpagePath: resolvedPath,
      slugPageUrl: toPublicUrl(resolvedPath),
      publishedUrl: toPublicUrl(resolvedPath),
      publicUrl: toPublicUrl(resolvedPath),
      blogUrl: toPublicUrl(resolvedPath),
    }),
    ...(ctx.resolvedLandingProvider && {
      landingProvider: ctx.resolvedLandingProvider,
      targetLandingZone: `/${String(ctx.resolvedLandingProvider).toLowerCase()}/${ctx.curatedSection}`,
    }),
    ...(ctx.inferredProvider && {
      'Cloud Provider': ctx.inferredProvider,
      cloudProvider: ctx.inferredProvider,
    }),
    blogPublishedAt: publishMarker,
    publishedAt: publishMarker,
    ...(ctx.persistedPublishedDate && {
      'Published At': ctx.persistedPublishedDate,
      publishedDate: ctx.persistedPublishedDate,
      datePublished: ctx.persistedPublishedDate,
    }),
  };
}

// R1 (May 11, 2026) — Fire Imagen-4 cover generation at publish time. Skips
// when the content already has a cover (uploaded / scraped / earlier AI run)
// or when a generation is already in flight. See AI-Integration-Inventory.md
// §9.4 R1. Mutates contentUpdate in place.
function applyPublishTimeCoverTrigger(contentUpdate, contentData) {
  const hasExistingCover =
    Boolean(contentData.altCoverImage) ||
    Boolean(contentData['Cover Image']) ||
    Boolean(contentData.contentImageUrl) ||
    Boolean(contentData.aiImageUrls?.hero);
  const alreadyTriggered = contentData.altCoverImageTrigger === true;
  if (hasExistingCover || alreadyTriggered) return;
  contentUpdate.altCoverImageTrigger = true;
  if (!Array.isArray(contentData.aiImageTargets) || contentData.aiImageTargets.length === 0) {
    contentUpdate.aiImageTargets = ['hero'];
  }
}

// First-time publish path: no blog yet. Validate metadata, create blog, mark content.
async function publishNewBlog({ db, contentRef, contentId, contentData, params, ctx }) {
  const rawTitle = contentData.Title || contentData.title || 'Untitled Article';
  const baseSlug = slugify(rawTitle);
  const slug = uniqueSlug(baseSlug, contentId);
  const curatedSubpagePath = `/${String(ctx.resolvedLandingProvider || '').toLowerCase()}/${ctx.curatedSection}/${slug}`;

  const metadataErrors = validatePublishMetadata({
    contentData,
    publishTarget: ctx.effectivePublishTarget,
    cloudProvider: ctx.inferredProvider,
    slug,
  });
  if (metadataErrors.length > 0) {
    return { error: `Publish metadata validation failed: ${metadataErrors.join('; ')}` };
  }

  // F2 — Archive scraped image URLs to Cloud Storage at publish time.
  // During inspection only URL refs are stored (no Storage cost on drafts);
  // here we materialize them so the published blog has stable archived copies.
  // Best-effort: a download failure doesn't block publish.
  const refs = Array.isArray(contentData.scrapedImages) ? contentData.scrapedImages : [];
  const needsArchive = refs.length > 0 && refs.some((r) => !r.stored);
  if (needsArchive) {
    try {
      const { _internal_archiveScrapedImageRefs } = require('./index');
      const archived = await _internal_archiveScrapedImageRefs(refs, contentId);
      contentData.scrapedImages = archived;
      contentData.scrapedImagesCount = archived.length;
    } catch (archiveErr) {
      logger.warn(
        `[publishNewBlog] scrapedImages archive failed for ${contentId}: ${archiveErr.message}`
      );
    }
  }

  const blogData = buildBlogData({
    contentData,
    contentId,
    user: params.user,
    publishTarget: ctx.effectivePublishTarget,
    cloudProvider: ctx.inferredProvider,
    landingProvider: ctx.resolvedLandingProvider,
    markLive: params.markLive,
    createSlugPageTrigger: params.createSlugPageTrigger,
    addToCurated: params.addToCurated,
    slug,
    curatedSubpagePath,
  });
  const blogRef = await db.collection('blogs').add(blogData);

  const publishMarker =
    ctx.persistedPublishedDate ||
    contentData.blogPublishedAt ||
    contentData.publishedAt ||
    admin.firestore.FieldValue.serverTimestamp();

  const contentUpdate = buildContentUpdateForNew({
    blogId: blogRef.id,
    params,
    ctx,
    slug,
    curatedSubpagePath,
    publishMarker,
  });
  // Persist newly archived scrapedImages back to the content doc so the
  // editor's image picker can use the stable Storage URLs going forward.
  if (needsArchive && Array.isArray(contentData.scrapedImages)) {
    contentUpdate.scrapedImages = contentData.scrapedImages;
    contentUpdate.scrapedImagesCount = contentData.scrapedImagesCount;
  }
  // R1 — Fire Imagen-4 cover generation at publish time, not inspection.
  applyPublishTimeCoverTrigger(contentUpdate, contentData);
  await contentRef.update(contentUpdate);

  return {
    blogId: blogRef.id,
    reused: false,
    slug,
    curatedSubpagePath,
    expectedPublicUrl: toPublicUrl(curatedSubpagePath),
    sourceUrl: contentData.sourceUrl || contentData.url || contentData['CD Url'] || null,
    landingProvider: ctx.resolvedLandingProvider || null,
  };
}

function buildContentUpdateForNew({
  blogId,
  params,
  ctx,
  slug,
  curatedSubpagePath,
  publishMarker,
}) {
  return {
    publishedToBlogs: true,
    publishedBlogId: blogId,
    movedToBlogsAt: admin.firestore.FieldValue.serverTimestamp(),
    blogId,
    contentStatus: 'published_blog',
    Live: Boolean(params.markLive),
    publishTarget: ctx.effectivePublishTarget,
    approvedForBlog: true,
    slug,
    Slug: slug,
    curatedSubpagePath,
    slugPageUrl: toPublicUrl(curatedSubpagePath),
    publishedUrl: toPublicUrl(curatedSubpagePath),
    publicUrl: toPublicUrl(curatedSubpagePath),
    blogUrl: toPublicUrl(curatedSubpagePath),
    ...(ctx.resolvedLandingProvider && {
      landingProvider: ctx.resolvedLandingProvider,
      targetLandingZone: `/${String(ctx.resolvedLandingProvider).toLowerCase()}/blog`,
    }),
    ...(ctx.inferredProvider && {
      'Cloud Provider': ctx.inferredProvider,
      cloudProvider: ctx.inferredProvider,
    }),
    blogPublishedAt: publishMarker,
    publishedAt: publishMarker,
    ...(ctx.persistedPublishedDate && {
      'Published At': ctx.persistedPublishedDate,
      publishedDate: ctx.persistedPublishedDate,
      datePublished: ctx.persistedPublishedDate,
    }),
  };
}

// Helper: process publishing a single content item to blogs
async function processPublishContent(db, contentId, params) {
  try {
    const contentRef = db.collection('content').doc(contentId);
    const contentSnap = await contentRef.get();
    if (!contentSnap.exists) return { error: 'Content not found' };

    const contentData = contentSnap.data() || {};
    const currentStatus = normalizeCurrentStatusForBlogOnly(
      contentData.contentStatus || 'ingested'
    );
    const allowedPublishStatuses = ['approved_blog', 'published_blog'];
    if (!allowedPublishStatuses.includes(currentStatus)) {
      return {
        error: `Cannot publish from status '${currentStatus}'. Allowed statuses: ${allowedPublishStatuses.join(', ')}`,
      };
    }

    const ctx = resolvePublishContext(contentData, params);

    let blogDoc = null;
    if (contentData.publishedBlogId) {
      const publishedBlogRef = db.collection('blogs').doc(contentData.publishedBlogId);
      const publishedBlogSnap = await publishedBlogRef.get();
      if (publishedBlogSnap.exists) {
        blogDoc = publishedBlogSnap;
      }
    }
    if (!blogDoc) {
      const existingBlog = await db
        .collection('blogs')
        .where('sourceContentId', '==', contentId)
        .limit(1)
        .get();
      if (!existingBlog.empty) {
        [blogDoc] = existingBlog.docs;
      }
    }

    if (blogDoc) {
      return republishExistingBlog({
        contentRef,
        contentId,
        contentData,
        params,
        ctx,
        blogDoc,
      });
    }

    return publishNewBlog({ db, contentRef, contentId, contentData, params, ctx });
  } catch (err) {
    return { error: String(err.message || err) };
  }
}
// scrapeUrlForDraft helpers — direct + two fallbacks. Each fallback returns
// a draft result on success or null when not applicable.
function buildDirectDraftResult($, html, startedAt) {
  const title =
    $('meta[property="og:title"]').attr('content') || $('title').text().trim() || 'Untitled';
  const description =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';
  const articleText =
    $('article').text().trim() || $('main').text().trim() || $('body').text().trim() || '';
  const cleaned = articleText.replace(/\s+/g, ' ').trim().slice(0, 16000);
  const turndown = new TurndownService();
  const markdown = turndown.turndown(html).slice(0, 22000);
  return {
    title,
    description,
    cleanedText: cleaned,
    markdown,
    html,
    scrapeMode: 'direct_html',
    scrapeLatencyMs: Date.now() - startedAt,
    scrapeFailureReason: null,
  };
}

async function tryDraftReaderFallback(url, startedAt) {
  const fallbackEnabled = String(process.env.CONTENTFORGE_SCRAPE_FALLBACK_ENABLED || 'false')
    .toLowerCase()
    .trim();
  if (fallbackEnabled !== 'true') return null;
  const normalized = String(url).replace(/^https?:\/\//i, '');
  const fallbackUrl = `https://r.jina.ai/http://${normalized}`;
  const fallbackResponse = await axios.get(fallbackUrl, {
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HCW-Bot/1.0)' },
  });
  const fallbackText = String(fallbackResponse.data || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (fallbackText.length <= 200) return null;
  const title = fallbackText.split('.').slice(0, 1).join('.').slice(0, 120) || 'Untitled';
  return {
    title,
    description: fallbackText.slice(0, 280),
    cleanedText: fallbackText.slice(0, 16000),
    markdown: fallbackText.slice(0, 22000),
    html: '',
    scrapeMode: 'reader_fallback',
    scrapeLatencyMs: Date.now() - startedAt,
    scrapeFailureReason: null,
  };
}

async function tryDraftHeadlessFallback(url, startedAt) {
  const headlessEnabled = String(process.env.CONTENTFORGE_HEADLESS_FALLBACK_ENABLED || 'false')
    .toLowerCase()
    .trim();
  const headlessEndpoint = String(process.env.CONTENTFORGE_HEADLESS_FALLBACK_URL || '').trim();
  if (headlessEnabled !== 'true' || !headlessEndpoint) return null;
  const headlessResponse = await axios.post(
    headlessEndpoint,
    { url, timeoutMs: 30000, userAgent: 'Mozilla/5.0 (compatible; HCW-Bot/1.0)' },
    { timeout: 45000, headers: { 'Content-Type': 'application/json' } }
  );
  const payload = headlessResponse.data || {};
  const plainText = String(payload.plainText || payload.text || '')
    .replace(/\s+/g, ' ')
    .trim();
  const markdown = String(payload.markdown || plainText).trim();
  const title = String(payload.title || '').trim() || 'Untitled';
  const description = String(payload.description || plainText.slice(0, 280)).trim();
  if (markdown.length <= 200 && plainText.length <= 200) return null;
  return {
    title: title.slice(0, 120),
    description: description.slice(0, 280),
    cleanedText: plainText.slice(0, 16000),
    markdown: markdown.slice(0, 22000),
    html: String(payload.html || '').slice(0, 22000),
    scrapeMode: 'headless_fallback',
    scrapeLatencyMs: Date.now() - startedAt,
    scrapeFailureReason: null,
  };
}

async function scrapeUrlForDraft(url) {
  const startedAt = Date.now();
  try {
    const response = await axios.get(url, {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HCW-Bot/1.0)' },
    });
    const html = response.data || '';
    const $ = cheerio.load(html);
    return buildDirectDraftResult($, html, startedAt);
  } catch (err) {
    const reader = await tryDraftReaderFallback(url, startedAt);
    if (reader) return reader;
    const headless = await tryDraftHeadlessFallback(url, startedAt);
    if (headless) return headless;
    throw err;
  }
}

async function generateDraftWithGemini({
  url,
  cloudProvider,
  scrapedTitle,
  description,
  markdown,
  customInstructionPrompt = '',
  supportingDocuments = [],
}) {
  const normalizedDocuments = Array.isArray(supportingDocuments)
    ? supportingDocuments.slice(0, MAX_SUPPORTING_DOCUMENTS).map((doc, index) => ({
        name: String(doc?.name || `Supporting Document ${index + 1}`).slice(0, 160),
        mimeType: String(doc?.mimeType || doc?.type || '')
          .trim()
          .toLowerCase(),
        textContent: String(doc?.textContent || '').slice(0, 18000),
        base64Data: String(doc?.base64Data || '').trim(),
      }))
    : [];

  const instructionPrompt =
    String(customInstructionPrompt || '').trim() || DEFAULT_DRAFT_INSTRUCTION_PROMPT;

  const parts = [
    {
      text: `${instructionPrompt}

Return strict JSON with keys:
- title
- summary
- postContent (target around 2500-3200 words)
- summaryPrompt
- detailsPrompt
- keyTopics (array of strings)

Context:
- sourceUrl: ${url}
- cloudProvider: ${cloudProvider || 'Auto'}
- extractedTitle: ${scrapedTitle}
- extractedDescription: ${description || 'N/A'}

Source markdown excerpt:
${String(markdown || '').slice(0, 12000)}

Instructions:
- title must be publication-ready.
- summary should be concise and editorial quality.
- postContent must be structured markdown with headings.
- summaryPrompt must define environment/scenario/theme for image generation.
- detailsPrompt must provide detailed visual specifics for this exact article.
- if supporting documents are provided, use them to sharpen accuracy, specificity, and terminology.
- no code fences, only raw JSON.`,
    },
  ];

  normalizedDocuments.forEach((doc, index) => {
    const label = `Supporting document ${index + 1}: ${doc.name}`;
    if (doc.textContent) {
      parts.push({ text: `${label}\n\n${doc.textContent}` });
      return;
    }

    if (doc.base64Data && doc.mimeType === 'application/pdf') {
      parts.push({ text: `${label}\n\nUse the attached PDF as additional reference material.` });
      parts.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: doc.base64Data,
        },
      });
    }
  });

  const modelOverride = process.env.CONTENTFORGE_DRAFT_MODEL || null;
  const aiProvider = getActiveAiProvider();
  const parsed = await generateJsonResponse({
    prompt: parts[0].text,
    parts,
    model: modelOverride,
    purpose: 'draft',
  });

  return {
    ...parsed,
    aiProvider,
    aiModel: modelOverride || undefined,
  };
}

async function uploadGeneratedImage(buffer, filename) {
  const storagePath = `covers/${filename}`;
  const file = admin.storage().bucket(BUCKET).file(storagePath);
  await file.save(buffer, {
    metadata: {
      contentType: 'image/png',
      metadata: { firebaseStorageDownloadTokens: crypto.randomUUID() },
    },
  });
  const encodedPath = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodedPath}?alt=media`;
}

// F9 — Variant-producing wrapper. Lazy-requires the index.js helper to keep
// the existing circular-import pattern. Returns { original, webp: { ... } }.
// Falls back to a plain upload if the helper isn't available (e.g., during
// local module-only loads).
async function uploadGeneratedImageWithVariants(buffer, filename) {
  try {
    const { _internal_uploadCoverWithResponsiveVariants } = require('./index');
    if (typeof _internal_uploadCoverWithResponsiveVariants === 'function') {
      return _internal_uploadCoverWithResponsiveVariants(buffer, filename);
    }
  } catch (err) {
    logger.warn(`[uploadGeneratedImageWithVariants] fallback to plain PNG: ${err.message}`);
  }
  const original = await uploadGeneratedImage(buffer, filename);
  return { original, webp: { 640: null, 1280: null, 2048: null } };
}

async function downloadImageBuffer(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
  return Buffer.from(response.data);
}

function getRemoteDocumentName(url, fallbackIndex) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments.pop() || `Supporting-Document-${fallbackIndex}`;
  } catch {
    return `Supporting-Document-${fallbackIndex}`;
  }
}

function inferRemoteDocumentKind(url, contentType = '') {
  const normalizedUrl = String(url || '')
    .trim()
    .toLowerCase();
  const normalizedType = String(contentType || '')
    .toLowerCase()
    .split(';')[0]
    .trim();

  if (normalizedType === 'application/pdf' || /\.pdf($|[?#])/.test(normalizedUrl)) {
    return { kind: 'pdf', mimeType: 'application/pdf' };
  }

  if (
    normalizedType === 'text/plain' ||
    normalizedType === 'text/markdown' ||
    normalizedType === 'application/octet-stream' ||
    /\.txt($|[?#])/.test(normalizedUrl)
  ) {
    return { kind: 'txt', mimeType: 'text/plain' };
  }

  return null;
}

async function fetchSupportingDocumentsFromUrls(documentUrls = []) {
  const urls = Array.isArray(documentUrls)
    ? Array.from(
        new Set(
          documentUrls
            .map((entry) => String(entry || '').trim())
            .filter((entry) => entry.startsWith('http'))
        )
      ).slice(0, MAX_SUPPORTING_DOCUMENTS)
    : [];

  const results = [];

  for (let index = 0; index < urls.length; index += 1) {
    const documentUrl = urls[index];
    let response;

    try {
      response = await axios.get(documentUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: MAX_REMOTE_SUPPORTING_DOCUMENT_BYTES,
        maxBodyLength: MAX_REMOTE_SUPPORTING_DOCUMENT_BYTES,
      });
    } catch (_err) {
      throw new Error(`Failed to fetch supporting document URL: ${documentUrl}`);
    }

    const documentKind = inferRemoteDocumentKind(
      documentUrl,
      response?.headers?.['content-type'] || ''
    );
    if (!documentKind) {
      throw new Error(`Only public PDF or TXT document URLs are supported: ${documentUrl}`);
    }

    const buffer = Buffer.from(response.data || []);
    if (buffer.length > MAX_REMOTE_SUPPORTING_DOCUMENT_BYTES) {
      throw new Error(
        `Supporting document URL exceeds the ${Math.round(
          MAX_REMOTE_SUPPORTING_DOCUMENT_BYTES / (1024 * 1024)
        )} MB limit: ${documentUrl}`
      );
    }

    if (documentKind.kind === 'pdf') {
      results.push({
        name: getRemoteDocumentName(documentUrl, index + 1),
        mimeType: 'application/pdf',
        textContent: '',
        base64Data: buffer.toString('base64'),
      });
      continue;
    }

    results.push({
      name: getRemoteDocumentName(documentUrl, index + 1),
      mimeType: 'text/plain',
      textContent: buffer.toString('utf8').slice(0, 20000),
      base64Data: '',
    });
  }

  return results;
}

async function generateImageByPrompt(apiKey, prompt) {
  // `useFileOutput: false` keeps the v0.x behavior of returning URL strings
  // from `replicate.run()` for file-output models. v1.0+ defaults to
  // returning FileObject instances; we don't need that since the caller
  // immediately does its own `downloadImageBuffer(url)` fetch. Compatibility
  // shim for replicate@^1.4.0 (PR #160).
  const replicate = new Replicate({ auth: apiKey.trim(), useFileOutput: false });
  // R2: admin-tool / curated images use CONTENTFORGE_IMAGE_MODEL (no hero
  // override here — that is reserved for publish-time covers in index.js).
  const imageModel = process.env.CONTENTFORGE_IMAGE_MODEL || 'google/imagen-4-fast';
  const output = await replicate.run(imageModel, {
    input: {
      prompt,
      aspect_ratio: '16:9',
      image_size: process.env.CONTENTFORGE_IMAGE_SIZE || '2K',
      output_format: 'png',
      safety_filter_level: 'block_medium_and_above',
    },
  });

  if (Array.isArray(output) && output[0]) return output[0];
  if (typeof output === 'string') return output;
  throw new Error('No image URL returned from image generator');
}

async function requireAdmin(req, res, requiredRole = 'viewer') {
  return requireAdminClaims(req, res, requiredRole);
}

function getConfiguredModelSummary(provider) {
  return {
    provider,
    draftModel: process.env.CONTENTFORGE_DRAFT_MODEL || defaultModelFor(provider, 'draft'),
    analysisModel: process.env.CONTENTFORGE_ANALYSIS_MODEL || defaultModelFor(provider, 'analysis'),
    multimodalModel:
      process.env.CONTENTFORGE_MULTIMODAL_MODEL || defaultModelFor(provider, 'multimodal'),
  };
}

function getAiControlSummary() {
  return {
    metadataOnly: process.env.CONTENTFORGE_METADATA_ONLY === 'true',
    tokenUsageLogging: process.env.CONTENTFORGE_LOG_TOKEN_USAGE === 'true',
    altTextEnabled: process.env.CONTENTFORGE_ALT_TEXT_ENABLED === 'true',
    imageModel: process.env.CONTENTFORGE_IMAGE_MODEL || 'google/imagen-4-fast',
    imageModelHero:
      process.env.CONTENTFORGE_IMAGE_MODEL_HERO ||
      process.env.CONTENTFORGE_IMAGE_MODEL ||
      'google/imagen-4-fast',
  };
}

async function evaluateAiReadiness({ provider, replicateReady }) {
  const openAiReady = Boolean(String(process.env.OPENAI_API_KEY || '').trim());
  const anthropicReady = Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim());
  const headlessEnabled =
    String(process.env.CONTENTFORGE_HEADLESS_FALLBACK_ENABLED || 'false').toLowerCase() === 'true';
  const headlessUrl = String(process.env.CONTENTFORGE_HEADLESS_FALLBACK_URL || '').trim();
  const vertex = await getVertexReadiness();

  const missing = [];
  if (provider === 'openai' && !openAiReady) {
    missing.push('OPENAI_API_KEY');
  }
  if (provider === 'anthropic' && !anthropicReady) {
    missing.push('ANTHROPIC_API_KEY');
  }
  if (headlessEnabled && !headlessUrl) {
    missing.push('CONTENTFORGE_HEADLESS_FALLBACK_URL');
  }
  if (!replicateReady) {
    missing.push('REPLICATE_API_KEY');
  }
  if (provider === 'vertex' && !vertex.ready) {
    missing.push(...vertex.missing);
  }

  return {
    provider,
    vertex,
    openAiReady,
    anthropicReady,
    replicateReady,
    headlessFallbackEnabled: headlessEnabled,
    headlessFallbackUrlConfigured: Boolean(headlessUrl),
    missing,
    ready: missing.length === 0,
  };
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getCanonicalContentTypeForAdmin(data = {}) {
  const raw = data.type || data.contentType || data.publishTarget || 'blog';
  const normalized = String(raw || '')
    .trim()
    .toLowerCase();
  if (normalized === 'news' || normalized === 'rss') return 'news';
  if (SUPPORTED_PUBLISH_TARGETS.has(normalized)) return normalized;
  return 'blog';
}

function matchesAdminContentType(item = {}, contentTypeFilter = 'all') {
  const canonical = getCanonicalContentTypeForAdmin(item);
  if (contentTypeFilter === 'all') return true;
  if (contentTypeFilter === 'blog') return canonical === 'blog' || canonical === 'news';
  return canonical === contentTypeFilter;
}

function matchesQueueStatus(item = {}, statusFilter = 'needs_review') {
  const status = String(item.contentStatus || 'ingested');
  if (statusFilter === 'needs_review') {
    return status === 'ingested' || status === 'inspected';
  }
  if (statusFilter === 'ready_to_publish') {
    return ['approved', 'approved_blog', 'published_blog'].includes(status) && item.Live !== true;
  }
  if (statusFilter === 'published_live') {
    return item.Live === true;
  }
  if (statusFilter === 'in_progress') {
    if (status === 'rejected' || status === 'archived') return false;
    if (item.Live === true) return false;
    if (status === 'ingested' || status === 'inspected') return false;
    return true;
  }
  return status === statusFilter;
}

function summarizeDashboardItems(items = []) {
  const summary = {
    blog: { needsReview: 0, inProgress: 0, published: 0, total: 0 },
    framework: { needsReview: 0, inProgress: 0, published: 0, total: 0 },
    architecture: { needsReview: 0, inProgress: 0, published: 0, total: 0 },
    coder_corner: { needsReview: 0, inProgress: 0, published: 0, total: 0 },
    news: { needsReview: 0, inProgress: 0, published: 0, total: 0 },
    rejected: 0,
  };

  items.forEach((item) => {
    const type = getCanonicalContentTypeForAdmin(item);
    const bucket = summary[type] || summary.blog;
    const status = String(item.contentStatus || 'ingested');

    if (status === 'rejected') {
      summary.rejected += 1;
      return;
    }

    bucket.total += 1;

    if (item.Live === true) {
      bucket.published += 1;
      return;
    }

    if (status === 'ingested' || status === 'inspected') {
      bucket.needsReview += 1;
    } else if (status !== 'archived') {
      // Everything else not-yet-Live (in_review, approved, approved_blog,
      // editing, published_blog staged but Live=false) is in progress.
      bucket.inProgress += 1;
    }
  });

  return summary;
}

// Returns the dashboard bucket name a content doc contributes to, or null if
// the doc doesn't count toward any bucket (archived/missing). Mirrors the
// summarizeDashboardItems classification rules exactly so the maintained
// dashboard_stats doc agrees with full-scan summaries.
// Returns one of: 'needsReview' | 'inProgress' | 'published' | 'rejected' | null
function classifyContentBucket(data) {
  if (!data) return null;
  const status = String(data.contentStatus || 'ingested');
  if (status === 'rejected') return 'rejected';
  if (status === 'archived') return null;
  if (data.Live === true) return 'published';
  if (status === 'ingested' || status === 'inspected') return 'needsReview';
  return 'inProgress';
}

const DASHBOARD_STATS_DOC_PATH = 'dashboard_stats/v1';
const DASHBOARD_STATS_TYPES = ['blog', 'framework', 'architecture', 'coder_corner', 'news'];

function emptyDashboardStats() {
  const stats = { rejected: 0, totalDocs: 0, schemaVersion: 1 };
  DASHBOARD_STATS_TYPES.forEach((type) => {
    stats[type] = { needsReview: 0, inProgress: 0, published: 0, total: 0 };
  });
  return stats;
}

// Builds the FieldValue.increment map for a single before/after transition.
// Symmetric: creates apply only the after-side increments; deletes apply only
// the before-side decrements; updates apply both (typically cancelling out
// when nothing relevant changed).
function buildDashboardStatsUpdates(beforeData, afterData) {
  const updates = {};
  const addDelta = (key, delta) => {
    if (delta === 0) return;
    updates[key] = (updates[key] || 0) + delta;
  };

  const beforeBucket = classifyContentBucket(beforeData);
  const afterBucket = classifyContentBucket(afterData);
  const beforeType = beforeData ? getCanonicalContentTypeForAdmin(beforeData) : null;
  const afterType = afterData ? getCanonicalContentTypeForAdmin(afterData) : null;

  // totalDocs tracks every doc except hard-deletions/missing.
  if (!beforeData && afterData) addDelta('totalDocs', 1);
  if (beforeData && !afterData) addDelta('totalDocs', -1);

  // Decrement the old position.
  if (beforeBucket === 'rejected') addDelta('rejected', -1);
  else if (beforeBucket && beforeType) {
    addDelta(`${beforeType}.${beforeBucket}`, -1);
    addDelta(`${beforeType}.total`, -1);
  }

  // Increment the new position.
  if (afterBucket === 'rejected') addDelta('rejected', 1);
  else if (afterBucket && afterType) {
    addDelta(`${afterType}.${afterBucket}`, 1);
    addDelta(`${afterType}.total`, 1);
  }

  // Convert to FieldValue.increment payload, filtering zero deltas.
  const out = {};
  Object.keys(updates).forEach((key) => {
    if (updates[key] !== 0) {
      out[key] = admin.firestore.FieldValue.increment(updates[key]);
    }
  });
  return out;
}

async function applyDashboardStatsTransition(beforeData, afterData) {
  const updates = buildDashboardStatsUpdates(beforeData, afterData);
  if (Object.keys(updates).length === 0) return;
  updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await admin.firestore().doc(DASHBOARD_STATS_DOC_PATH).set(updates, { merge: true });
}

// Maintains dashboard_stats/v1 in real time. Listens to every content write
// (create / update / delete) and applies bucket transition increments. Avoids
// the per-admin-page-load full-collection scan that was costing ~$7-$72/mo at
// the documented launch volumes.
exports.maintainDashboardStats = onDocumentWritten(
  {
    document: 'content/{contentId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    try {
      const beforeData = event.data?.before?.exists ? event.data.before.data() : null;
      const afterData = event.data?.after?.exists ? event.data.after.data() : null;
      await applyDashboardStatsTransition(beforeData, afterData);
      return null;
    } catch (error) {
      // Drift is recoverable via the backfill script. Don't fail the write.
      console.error('[dashboard-stats] failed to apply transition:', error.message);
      return null;
    }
  }
);

const ADMIN_CONTENT_SNAPSHOT_FIELDS = [
  'Title',
  'title',
  'Summary',
  'summary',
  'sourceUrl',
  'type',
  'contentType',
  'publishTarget',
  'targetLandingZone',
  'Cloud Provider',
  'cloudProvider',
  'contentStatus',
  'Live',
  'fetchedAt',
  'createdAt',
  'updatedAt',
  'reviewedAt',
  'blogPublishedAt',
  'publishedAt',
  'slug',
  'Slug',
  'category',
  'wordCount',
  'readTime',
  'source',
  'altCoverImage',
  'coverImage',
  'Cover Image',
  'heroImageUrl',
  'contentImageUrl',
  'secondaryImageUrls',
  'aiImageUrls',
  'slugPageUrl',
  'publishedUrl',
  'blogUrl',
  'publicUrl',
  'curatedSubpagePath',
];

function getAdminContentSnapshotQuery(db) {
  return db.collection('content').select(...ADMIN_CONTENT_SNAPSHOT_FIELDS);
}

async function getRecentNeedsReviewItems(db, limit = 10) {
  const baseQuery = db
    .collection('content')
    .where('contentStatus', 'in', ['ingested', 'inspected'])
    .limit(limit)
    .select(...ADMIN_CONTENT_SNAPSHOT_FIELDS);

  try {
    const snap = await baseQuery.orderBy('fetchedAt', 'desc').get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    logger.warn(
      `[getAdminDashboardSnapshot] recent needs review ordered query failed, falling back to unsorted fetch: ${error.message}`
    );

    const fallbackSnap = await baseQuery.get();
    return fallbackSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => {
        const aMs = toMillis(a.fetchedAt || a.updatedAt || a.createdAt);
        const bMs = toMillis(b.fetchedAt || b.updatedAt || b.createdAt);
        return bMs - aMs;
      })
      .slice(0, limit);
  }
}

function toHoursSince(value, nowMs) {
  const ts = toMillis(value);
  if (!ts) return null;
  return Math.max(0, Math.round(((nowMs - ts) / (1000 * 60 * 60)) * 10) / 10);
}

function getWorkflowAlertStatus(alert = {}) {
  return alert.status || (alert.active === false ? 'resolved' : 'open');
}

// ============================================================================
// Valid Status Transitions (State Machine)
// ============================================================================

const VALID_TRANSITIONS = {
  ingested: ['inspected', 'in_review', 'approved_blog', 'published_blog', 'rejected'],
  inspected: ['in_review', 'approved_blog', 'published_blog', 'rejected'],
  in_review: ['approved_blog', 'published_blog', 'rejected'],
  approved_blog: ['editing', 'published_blog', 'rejected'],
  editing: ['approved_blog', 'published_blog', 'in_review', 'rejected'],
  published_blog: ['archived', 'editing', 'inspected', 'rejected'],
  rejected: ['inspected', 'in_review', 'archived'],
  archived: ['in_review', 'rejected'],
};

const VALID_STATUSES = Object.keys(VALID_TRANSITIONS);

// Helper: process batch of URLs for ingestion
async function processUrlBatch(db, urls, params) {
  const results = { created: 0, duplicates: 0, createdIds: [], errors: [], collection: 'content' };

  for (const url of urls.slice(0, 50)) {
    const r = await processIngestUrl(db, url, params);

    if (r.error) {
      results.errors.push({ url, error: r.error });
      continue;
    }
    if (r.duplicate) {
      results.duplicates++;
      continue;
    }
    results.created++;
    if (r.createdId) results.createdIds.push(r.createdId);
  }

  return results;
}

/**
 * Marks rejected content for soft-delete instead of hard-deleting it.
 *
 * Why soft: rejected items used to be hard-deleted by `cleanupRejectedContent`
 * (cron at 04:00 CT) the moment they hit 24h old. That makes accidental
 * rejection unrecoverable. This function now sets `softDeletedAt = now`,
 * which routes the doc through `cleanupSoftDeletedContent` — that cron has
 * its own grace window (configured at the schedule call site, currently
 * 7 days). Net effect: a rejection-then-misclick can be undone for ~7 days.
 *
 * Items already missing `softDeletedAt` and meeting the cutoff are the
 * candidates. We skip docs that already have `softDeletedAt` set so this
 * cron is idempotent.
 */
async function deleteRejectedContentBatch({ olderThanHours = null, limit = 500 } = {}) {
  const maxLimit = Math.min(Number(limit) || 500, 500);
  const cutoff =
    typeof olderThanHours === 'number' && olderThanHours > 0
      ? new Date(Date.now() - olderThanHours * 60 * 60 * 1000)
      : null;

  const snapshot = await admin
    .firestore()
    .collection('content')
    .where('contentStatus', '==', 'rejected')
    .limit(maxLimit)
    .get();

  const toMark = snapshot.docs.filter((doc) => {
    const data = doc.data() || {};
    if (data.softDeletedAt) return false;
    if (!cutoff) return true;
    const referenceDate = getRejectionReferenceDate(data);
    return referenceDate && referenceDate < cutoff;
  });

  if (toMark.length === 0) {
    return {
      deletedCount: 0,
      softDeletedCount: 0,
      examinedCount: snapshot.size,
      hasMore: snapshot.size === maxLimit,
    };
  }

  const db = admin.firestore();
  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  toMark.forEach((doc) =>
    batch.update(doc.ref, {
      softDeletedAt: now,
      softDeletedReason: 'rejected_aged_out',
    })
  );

  const auditRef = createAdminAuditRef(db);
  batch.set(
    auditRef,
    buildSystemAuditLogData({
      action: 'cron_soft_deleted_rejected_content',
      source: 'cleanupRejectedContent',
      details: {
        affectedCount: toMark.length,
        examinedCount: snapshot.size,
        olderThanHours: typeof olderThanHours === 'number' ? olderThanHours : null,
        affectedIds: toMark.slice(0, 50).map((doc) => doc.id),
        truncatedAffectedIds: toMark.length > 50,
      },
    })
  );

  await batch.commit();

  return {
    // `deletedCount` kept for backward compatibility with the schedule's log line.
    deletedCount: toMark.length,
    softDeletedCount: toMark.length,
    examinedCount: snapshot.size,
    hasMore: snapshot.size === maxLimit,
  };
}

async function deleteSoftDeletedContentBatch({ olderThanHours = 24, limit = 200 } = {}) {
  const maxLimit = Math.min(Number(limit) || 200, 500);
  const cutoff = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - olderThanHours * 60 * 60 * 1000)
  );
  const db = admin.firestore();
  const snapshot = await db
    .collection('content')
    .where('softDeletedAt', '<=', cutoff)
    .limit(maxLimit)
    .get();

  if (snapshot.empty) {
    return {
      deletedContentCount: 0,
      deletedBlogCount: 0,
      examinedCount: 0,
      hasMore: false,
    };
  }

  const batch = db.batch();
  let deletedBlogCount = 0;

  for (const contentDoc of snapshot.docs) {
    const data = contentDoc.data() || {};
    const blogRefs = [];

    if (data.publishedBlogId) {
      const linkedBlogRef = db.collection('blogs').doc(data.publishedBlogId);
      const linkedBlogSnap = await linkedBlogRef.get();
      if (linkedBlogSnap.exists) {
        blogRefs.push(linkedBlogRef);
      }
    }

    const relatedBlogs = await db
      .collection('blogs')
      .where('sourceContentId', '==', contentDoc.id)
      .get();

    relatedBlogs.forEach((blogDoc) => {
      if (!blogRefs.some((ref) => ref.path === blogDoc.ref.path)) {
        blogRefs.push(blogDoc.ref);
      }
    });

    blogRefs.forEach((ref) => {
      batch.delete(ref);
      deletedBlogCount += 1;
    });
    batch.delete(contentDoc.ref);
  }

  const auditRef = createAdminAuditRef(db);
  batch.set(
    auditRef,
    buildSystemAuditLogData({
      action: 'cron_hard_deleted_soft_deleted_content',
      source: 'cleanupSoftDeletedContent',
      details: {
        deletedContentCount: snapshot.size,
        deletedBlogCount,
        olderThanHours,
        affectedIds: snapshot.docs.slice(0, 50).map((d) => d.id),
        truncatedAffectedIds: snapshot.size > 50,
      },
    })
  );

  await batch.commit();

  return {
    deletedContentCount: snapshot.size,
    deletedBlogCount,
    examinedCount: snapshot.size,
    hasMore: snapshot.size === maxLimit,
  };
}

// Helper: build draft from scraped content with AI generation fallback
async function buildDraftFromScraped(
  url,
  cloudProvider,
  scraped,
  customInstructionPrompt = '',
  supportingDocuments = []
) {
  let draft;
  try {
    draft = await generateDraftWithGemini({
      url,
      cloudProvider,
      scrapedTitle: scraped.title,
      description: scraped.description,
      markdown: scraped.markdown,
      customInstructionPrompt,
      supportingDocuments,
    });
  } catch (aiErr) {
    draft = {
      title: scraped.title,
      summary: scraped.description || scraped.cleanedText.slice(0, 280),
      postContent: scraped.markdown.slice(0, 18000),
      summaryPrompt: `Cloud ${cloudProvider || 'platform'} architecture scenario with modern enterprise environment and technical implementation context.`,
      detailsPrompt: `Lego-style technical illustration showing engineers implementing the specific architecture described in ${scraped.title}.`,
      keyTopics: [],
      aiError: aiErr.message,
    };
  }
  return draft;
}

function mergeScrapedDraftSources(scrapedEntries = []) {
  const entries = Array.isArray(scrapedEntries) ? scrapedEntries.filter(Boolean) : [];
  const primary = entries[0] || {
    title: 'Untitled',
    description: '',
    cleanedText: '',
    markdown: '',
    scrapeMode: 'direct_html',
    scrapeLatencyMs: null,
    scrapeFailureReason: null,
  };

  const combinedMarkdown = entries
    .map((entry, index) => {
      const title = String(entry.title || `Source ${index + 1}`).trim();
      const body = String(entry.markdown || entry.cleanedText || '').trim();
      if (!body) return '';
      return `## Source ${index + 1}: ${title}\n\n${body}`;
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 32000);

  const combinedDescription = entries
    .map((entry) => String(entry.description || '').trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 1200);

  return {
    title: primary.title,
    description: combinedDescription || primary.description || '',
    cleanedText: entries
      .map((entry) => String(entry.cleanedText || '').trim())
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 20000),
    markdown: combinedMarkdown || String(primary.markdown || '').slice(0, 22000),
    scrapeMode:
      entries.length > 1
        ? `multi_source:${entries.map((entry) => entry.scrapeMode || 'direct_html').join(',')}`
        : primary.scrapeMode || 'direct_html',
    scrapeLatencyMs: entries.reduce(
      (total, entry) => total + Number(entry.scrapeLatencyMs || 0),
      0
    ),
    scrapeFailureReason: primary.scrapeFailureReason || null,
  };
}

// Helper: build article draft response
function buildDraftResponse(url, cloudProvider, scraped, draft) {
  return {
    success: true,
    draft: {
      sourceUrl: url,
      sourceUrls: draft.sourceUrls || [url],
      title: draft.title || scraped.title,
      summary: draft.summary || scraped.description || '',
      postContent: draft.postContent || scraped.markdown,
      summaryPrompt: draft.summaryPrompt || '',
      detailsPrompt: draft.detailsPrompt || '',
      keyTopics: Array.isArray(draft.keyTopics) ? draft.keyTopics : [],
      cloudProvider: cloudProvider || null,
      scrapeMode: scraped.scrapeMode || 'direct_html',
      scrapeLatencyMs: scraped.scrapeLatencyMs || null,
      scrapeFailureReason: scraped.scrapeFailureReason || null,
    },
  };
}

// ============================================================================
// submitContentUrls — Manual URL Ingestion
// ============================================================================

exports.submitContentUrls = onRequest(
  { region: 'us-central1', timeoutSeconds: 120, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const {
      urls,
      autoInspect = true,
      cloudProvider = null,
      publishTarget = null,
      title = '',
      publishedDate = null,
      heroImageUrl = '',
      secondaryImageUrls = [],
      generateAiCover = false,
      aiImageTargets = [],
      imagePromptSeed = '',
      imagePromptDetails = '',
    } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'urls array required' });
    }

    const db = admin.firestore();
    const results = await processUrlBatch(db, urls, {
      title,
      publishedDate,
      imageUrl: req.body.imageUrl,
      heroImageUrl,
      secondaryImageUrls,
      generateAiCover,
      aiImageTargets,
      imagePromptSeed,
      imagePromptDetails,
      cloudProvider,
      publishTarget: normalizePublishTarget(publishTarget),
      type: req.body.type || 'blog',
      autoInspect,
    });

    logger.warn(
      `submitContentUrls Created: ${results.created}, Dupes: ${results.duplicates}, Errors: ${results.errors.length}`
    );
    res.json({ success: true, ...results });
  }
);

exports.generateArticleDraft = onRequest(
  { region: 'us-central1', timeoutSeconds: 120, memory: '512MiB', secrets: aiSecrets },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const {
      url,
      urls = [],
      cloudProvider = null,
      customInstructionPrompt = '',
      documentUrls = [],
      supportingDocuments = [],
    } = req.body || {};
    const normalizedSupportingDocuments = Array.isArray(supportingDocuments)
      ? supportingDocuments
      : [];
    const normalizedUrls = Array.isArray(urls)
      ? urls.map((entry) => String(entry || '').trim()).filter((entry) => entry.startsWith('http'))
      : [];
    const primaryUrl = String(url || '').trim();
    if (primaryUrl.startsWith('http')) {
      normalizedUrls.unshift(primaryUrl);
    }

    const dedupedUrls = Array.from(new Set(normalizedUrls));
    if (dedupedUrls.length === 0) {
      return res.status(400).json({ error: 'At least one valid URL is required' });
    }
    const normalizedDocumentUrls = Array.isArray(documentUrls)
      ? documentUrls
          .map((entry) => String(entry || '').trim())
          .filter((entry) => entry.startsWith('http'))
      : [];

    if (
      normalizedSupportingDocuments.length + normalizedDocumentUrls.length >
      MAX_SUPPORTING_DOCUMENTS
    ) {
      return res.status(400).json({
        error: `A maximum of ${MAX_SUPPORTING_DOCUMENTS} total supporting documents is allowed`,
      });
    }

    try {
      const remoteSupportingDocuments =
        await fetchSupportingDocumentsFromUrls(normalizedDocumentUrls);
      const scrapedEntries = [];
      for (const nextUrl of dedupedUrls) {
        const scrapedEntry = await scrapeUrlForDraft(nextUrl);
        scrapedEntries.push(scrapedEntry);
      }

      const scraped = mergeScrapedDraftSources(scrapedEntries);
      const draft = await buildDraftFromScraped(
        dedupedUrls[0],
        cloudProvider,
        scraped,
        customInstructionPrompt,
        [...normalizedSupportingDocuments, ...remoteSupportingDocuments]
      );
      res.json(
        buildDraftResponse(dedupedUrls[0], cloudProvider, scraped, {
          ...draft,
          sourceUrls: dedupedUrls,
        })
      );
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to generate article draft' });
    }
  }
);

// Generate one preview image and persist its metadata. Returns
// { imageUrl, imageRecord, slotPrompt }.
async function generateOnePreviewImageSlot({ target, body, replicateKey }) {
  const {
    summaryPrompt,
    detailsPrompt,
    title,
    summary,
    provider,
    contentType,
    sourceUrl,
    articleId,
    slotTemplates,
  } = body;
  const slotPrompt = buildPreviewSlotPrompt({
    target,
    summaryPrompt: summaryPrompt.trim(),
    detailsPrompt: detailsPrompt.trim(),
    slotTemplates,
    title,
    summary,
  });
  logger.info('generatePreviewImages slot prompt', {
    articleId: String(articleId || title || ''),
    slot: target,
    templateVersion: slotPrompt.templateVersion,
    prompt: slotPrompt.prompt,
  });
  const { prompt } = slotPrompt;
  const imageUrl = await generateImageByPrompt(replicateKey, prompt);
  const buffer = await downloadImageBuffer(imageUrl);
  const filename = `${Date.now()}-${target}.png`;
  // F9 — emit WebP variants alongside the PNG so the admin preview UI and
  // any downstream consumer can opt into <img srcset>.
  const { original: publicUrl, webp: imageVariants } = await uploadGeneratedImageWithVariants(
    buffer,
    filename
  );
  const imageRef = await admin
    .firestore()
    .collection('generated_content_images')
    .add({
      articleId: String(articleId || title || Date.now()),
      contentId: '',
      slot: target,
      imageUrl: publicUrl,
      ...(imageVariants && { imageVariants }),
      title: title || 'Untitled',
      provider: provider || '',
      contentType: contentType || 'blog',
      sourceCollection: 'preview',
      sourceUrl: String(sourceUrl || ''),
      promptTemplateVersion: slotPrompt.templateVersion,
      slotPrompt: slotPrompt.prompt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  return {
    imageUrl: publicUrl,
    imageRecord: { imageId: imageRef.id, imageUrl: publicUrl },
    slotPrompt,
  };
}

exports.generatePreviewImages = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 180,
    memory: '512MiB',
    secrets: [replicateApiKey, ...aiSecrets],
  },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const body = {
      summaryPrompt: '',
      detailsPrompt: '',
      aiImageTargets: ['hero'],
      title: '',
      summary: '',
      provider: '',
      contentType: 'blog',
      sourceUrl: '',
      articleId: '',
      slotTemplates: {},
      ...(req.body || {}),
    };

    if (!body.summaryPrompt.trim() || !body.detailsPrompt.trim()) {
      return res.status(400).json({ error: 'summaryPrompt and detailsPrompt are required' });
    }

    const targets =
      Array.isArray(body.aiImageTargets) && body.aiImageTargets.length > 0
        ? body.aiImageTargets.slice(0, 4)
        : ['hero'];

    try {
      const generated = {};
      const imageRecords = {};
      const promptLogs = {};
      const replicateKey = replicateApiKey.value();
      for (const target of targets) {
        const result = await generateOnePreviewImageSlot({ target, body, replicateKey });
        generated[target] = result.imageUrl;
        imageRecords[target] = result.imageRecord;
        promptLogs[target] = result.slotPrompt;
      }

      res.json({ success: true, imageUrls: generated, imageRecords, promptLogs, targets });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to generate preview images' });
    }
  }
);

// ============================================================================
// triggerAiImageGeneration — Trigger multi-slot AI image generation
// ============================================================================

exports.triggerAiImageGeneration = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const {
      contentIds = [],
      blogIds = [],
      aiImageTargets = ['hero'],
      imagePromptSeed = '',
      imagePromptDetails = '',
    } = req.body || {};

    const ids = Array.isArray(contentIds) && contentIds.length > 0 ? contentIds : blogIds;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'contentIds array required' });
    }

    const combinedPrompt = [imagePromptSeed, imagePromptDetails]
      .filter((part) => typeof part === 'string' && part.trim().length > 0)
      .join('\n\n')
      .trim();

    const targets =
      Array.isArray(aiImageTargets) && aiImageTargets.length > 0
        ? aiImageTargets.slice(0, 4)
        : ['hero'];

    const db = admin.firestore();
    const triggeredIds = [];

    for (const contentId of ids.slice(0, 25)) {
      const docRef = db.collection('content').doc(contentId);
      await docRef.update({
        altCoverImageTrigger: true,
        aiImageTargets: targets,
        altCoverImageError: admin.firestore.FieldValue.delete(),
        ...(combinedPrompt && { altCoverImagePrompt: combinedPrompt }),
        ...(imagePromptSeed && { imagePromptSeed }),
        ...(imagePromptDetails && { imagePromptDetails }),
      });
      triggeredIds.push(contentId);
    }

    res.json({ success: true, triggered: triggeredIds.length, triggeredIds, targets });
  }
);

// ============================================================================
// deleteGeneratedImageSlot — Remove one generated slot image from docs
// ============================================================================

exports.deleteGeneratedImageSlot = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { contentIds = [], blogIds = [], slot = '' } = req.body || {};
    const ids = Array.isArray(contentIds) && contentIds.length > 0 ? contentIds : blogIds;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'contentIds array required' });
    }
    if (!slot) {
      return res.status(400).json({ error: 'slot required' });
    }

    const db = admin.firestore();
    const updatedIds = [];

    for (const contentId of ids.slice(0, 25)) {
      const docRef = db.collection('content').doc(contentId);
      const updateData = {
        [`aiImageUrls.${slot}`]: admin.firestore.FieldValue.delete(),
      };
      if (slot === 'hero') {
        updateData.altCoverImage = admin.firestore.FieldValue.delete();
      }
      await docRef.update(updateData);
      updatedIds.push(contentId);
    }

    res.json({ success: true, updated: updatedIds.length, updatedIds, slot });
  }
);

// ============================================================================
// Content CRUD + Publish Workflow
// ============================================================================

exports.createContentItem = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { data = {} } = req.body || {};
    const db = admin.firestore();

    const requestedType = String(data.type || '').toLowerCase();
    const normalizedType = ['blog', 'framework', 'architecture', 'coder_corner'].includes(
      requestedType
    )
      ? requestedType
      : 'blog';

    const normalizedData = normalizeContentBodyFields({
      ...data,
      publishTarget: normalizePublishTarget(data.publishTarget, normalizedType),
      type: normalizedType,
      approvedForBlog: false,
    });

    const createdRef = await db.collection('content').add({
      ...normalizedData,
      contentStatus: normalizedData.contentStatus || 'draft',
      storageCollection: 'content',
      createdBy: user.email || user.uid || 'admin',
      'Created At': admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, contentId: createdRef.id });
  }
);

exports.getContentItem = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res, 'GET, POST, OPTIONS')) return;
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ error: 'GET or POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const contentId = req.method === 'GET' ? req.query.contentId : req.body?.contentId;
    if (!contentId) {
      return res.status(400).json({ error: 'contentId required' });
    }

    const snap = await admin.firestore().collection('content').doc(contentId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: `content ${contentId} not found` });
    }

    res.json({ success: true, item: { id: snap.id, ...snap.data() } });
  }
);

exports.recordAdminAudit = onRequest(
  { region: 'us-central1', timeoutSeconds: 30, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { action, details = {} } = req.body || {};
    if (!action || typeof action !== 'string') {
      return res.status(400).json({ error: 'action is required' });
    }
    if (String(action).trim().length > 120) {
      return res.status(400).json({ error: 'action exceeds 120 characters' });
    }
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
      return res.status(400).json({ error: 'details must be an object' });
    }

    const db = admin.firestore();
    const auditRef = createAdminAuditRef(db);
    await auditRef.set(
      buildAdminAuditLogData({
        action,
        user,
        req,
        details: typeof details === 'object' && details ? details : {},
      })
    );

    res.json({ success: true, auditId: auditRef.id });
  }
);

const LEGACY_BLOGS_READS_DOC_PATH = 'telemetry/legacyBlogsReads';

// Whitelisted telemetry sources (post-normalization) — matches the callers in
// src/hooks/useFirestore.js and src/pages/admin/SocialHubPage.jsx. Prevents
// attacker-controlled `sources.<key>` field growth on the telemetry doc.
const LEGACY_BLOGS_READ_SOURCES = new Set([
  'usefirestoredocument_realtime',
  'usefirestoredocument',
  'usefirestorecollection',
  'usefirestorequery',
  'socialhubpage',
  'unknown',
]);

const LEGACY_BLOGS_DETAILS_MAX_KEYS = 10;
const LEGACY_BLOGS_DETAILS_MAX_JSON = 2000;

/**
 * Sanitize the caller-supplied `details` object: primitive values only,
 * max 10 keys, serialized size <= 2000 chars. Returns null when invalid.
 */
function sanitizeLegacyBlogsDetails(details) {
  const keys = Object.keys(details);
  if (keys.length > LEGACY_BLOGS_DETAILS_MAX_KEYS) return null;
  const sanitized = {};
  for (const key of keys) {
    const value = details[key];
    const type = typeof value;
    if (value !== null && type !== 'string' && type !== 'number' && type !== 'boolean') {
      return null;
    }
    sanitized[String(key).slice(0, 120)] = type === 'string' ? value.slice(0, 500) : value;
  }
  if (JSON.stringify(sanitized).length > LEGACY_BLOGS_DETAILS_MAX_JSON) return null;
  return sanitized;
}

exports.recordLegacyBlogsRead = onRequest(
  { region: 'us-central1', timeoutSeconds: 15, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res, 'POST, OPTIONS')) return;
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const { source, count = 1, details = {} } = req.body || {};
    const normalizedSource = String(source || 'unknown')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .slice(0, 80);
    const normalizedCount = Number.isFinite(Number(count))
      ? Math.max(1, Math.floor(Number(count)))
      : 1;

    if (!normalizedSource) {
      return res.status(400).json({ error: 'source is required' });
    }
    if (!LEGACY_BLOGS_READ_SOURCES.has(normalizedSource)) {
      return res.status(400).json({ error: 'unrecognized source' });
    }
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
      return res.status(400).json({ error: 'details must be an object' });
    }
    const sanitizedDetails = sanitizeLegacyBlogsDetails(details);
    if (!sanitizedDetails) {
      return res.status(400).json({ error: 'details too large or contains non-primitive values' });
    }

    const db = admin.firestore();
    const updates = {
      totalReads: admin.firestore.FieldValue.increment(normalizedCount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      [`sources.${normalizedSource}`]: admin.firestore.FieldValue.increment(normalizedCount),
    };
    if (Object.keys(sanitizedDetails).length > 0) {
      updates.lastDetails = sanitizedDetails;
    }

    await db.doc(LEGACY_BLOGS_READS_DOC_PATH).set(updates, { merge: true });

    res.json({ success: true });
  }
);

function mapSaveEditorDraftError(err, contentId) {
  if (err.message === 'RESOURCE_NOT_FOUND') {
    return { status: 404, error: `content ${contentId} not found` };
  }
  if (err.message === 'EDIT_CONFLICT') {
    return { status: 409, error: 'EDIT_CONFLICT' };
  }
  return null;
}

function assertNoEditConflict(currentData, expectedEditedAtMs, force) {
  const currentEditedAtMs =
    currentData.blogEditedAt?.toMillis?.() ||
    currentData.blogEditedAt?.toDate?.()?.getTime?.() ||
    0;
  if (!force && Number(currentEditedAtMs) !== Number(expectedEditedAtMs || 0)) {
    throw new Error('EDIT_CONFLICT');
  }
}

function buildEditorDraftUpdatePayload(currentData, fields) {
  const {
    normalizedDraft,
    title,
    resolvedAuthor,
    nextPublishedDate,
    summary,
    sidebarContent,
    normalizedTags,
    validatedImageUrls,
    user,
  } = fields;
  const currentStatus = String(currentData.contentStatus || '');
  const nextStatus = currentStatus.startsWith('published_') ? currentStatus : 'editing';
  const imageUpdates = buildContentImageUpdates(validatedImageUrls, currentData);
  const sts = admin.firestore.FieldValue.serverTimestamp();
  return {
    blogDraft: normalizedDraft,
    Title: String(title || ''),
    title: String(title || ''),
    editorAuthor: resolvedAuthor,
    siteAuthor: resolvedAuthor,
    publishedDate: nextPublishedDate,
    Summary: String(summary || ''),
    summary: String(summary || ''),
    sidebarContent: String(sidebarContent || ''),
    Tags: normalizedTags,
    ...buildContentImageFieldUpdates(imageUpdates),
    blogEditedAt: sts,
    contentStatus: nextStatus,
    updatedAt: sts,
    updatedBy: user.email || user.uid || 'admin',
  };
}

// Validate and normalize the saveEditorDraft request body. Returns either
// `{ ok: true, ...normalizedFields }` or `{ ok: false, error }`.
function validateSaveEditorDraftBody(body) {
  try {
    const normalizedDraft = ensureTldrSectionAtEnd(
      assertStringLength(body.draft, 'draft', 200000, { allowEmpty: true })
    );
    assertStringLength(body.title, 'title', 250, { allowEmpty: true });
    const resolvedAuthor =
      assertStringLength(body.authorName, 'authorName', 120, { allowEmpty: true }).trim() ||
      'Hybrid Cloud Works';
    assertStringLength(body.summary, 'summary', 5000, { allowEmpty: true });
    assertStringLength(body.sidebarContent, 'sidebarContent', 12000, { allowEmpty: true });
    const validatedImageUrls = assertImageUrlList(body.orderedImageUrls)
      .filter(Boolean)
      .slice(0, 4);
    const nextPublishedDate = assertOptionalDateString(body.publishedDate, 'publishedDate');
    const normalizedTags = String(body.tags || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (normalizedTags.length > 25) {
      throw new Error('tags exceeds 25 entries');
    }
    normalizedTags.forEach((tag) => {
      if (tag.length > 80) {
        throw new Error('tag exceeds 80 characters');
      }
    });
    return {
      ok: true,
      normalizedDraft,
      resolvedAuthor,
      normalizedTags,
      validatedImageUrls,
      nextPublishedDate,
    };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

exports.saveEditorDraft = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const {
      contentId,
      expectedEditedAtMs = 0,
      force = false,
      draft = '',
      title = '',
      authorName = '',
      publishedDate = '',
      summary = '',
      tags = '',
      sidebarContent = '',
      orderedImageUrls = [],
    } = req.body || {};

    if (!contentId || typeof contentId !== 'string') {
      return res.status(400).json({ error: 'contentId required' });
    }

    const validation = validateSaveEditorDraftBody({
      draft,
      title,
      authorName,
      summary,
      sidebarContent,
      orderedImageUrls,
      publishedDate,
      tags,
    });
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    const {
      normalizedDraft,
      resolvedAuthor,
      normalizedTags,
      validatedImageUrls,
      nextPublishedDate,
    } = validation;

    const db = admin.firestore();
    const docRef = db.collection('content').doc(contentId);
    let currentTitle = '';

    try {
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        if (!snapshot.exists) {
          throw new Error('RESOURCE_NOT_FOUND');
        }
        const currentData = snapshot.data() || {};
        currentTitle = currentData.Title || currentData.title || '';

        assertNoEditConflict(currentData, expectedEditedAtMs, force);

        const updatePayload = buildEditorDraftUpdatePayload(currentData, {
          normalizedDraft,
          title,
          resolvedAuthor,
          nextPublishedDate,
          summary,
          sidebarContent,
          normalizedTags,
          validatedImageUrls,
          user,
        });
        transaction.update(docRef, updatePayload);

        const auditRef = createAdminAuditRef(db);
        transaction.set(
          auditRef,
          buildAdminAuditLogData({
            action: force ? 'draft_force_saved' : 'draft_saved',
            user,
            req,
            details: {
              contentId,
              force: Boolean(force),
              fieldUpdated: 'blogDraft',
              imageCount: validatedImageUrls.length,
            },
            contentId,
            contentTitle: currentTitle,
          })
        );
      });
    } catch (err) {
      const mapped = mapSaveEditorDraftError(err, contentId);
      if (mapped) return res.status(mapped.status).json({ error: mapped.error });
      throw err;
    }

    res.json({
      success: true,
      contentId,
      normalizedDraft,
      editorAuthor: resolvedAuthor,
      tagCount: normalizedTags.length,
    });
  }
);

exports.updateContentItem = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST' && req.method !== 'PATCH') {
      return res.status(405).json({ error: 'POST or PATCH only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { contentId, updates = {} } = req.body || {};
    if (!contentId || typeof updates !== 'object') {
      return res.status(400).json({ error: 'contentId and updates object required' });
    }

    let validatedUpdates;
    try {
      validatedUpdates = validateAndNormalizeUpdateContentItemUpdates(updates);
    } catch (error) {
      return res.status(400).json({ error: String(error.message || error) });
    }

    const normalizedUpdates = normalizeContentBodyFields(
      normalizeContentUpdatesForBlogOnly(validatedUpdates)
    );

    await admin
      .firestore()
      .collection('content')
      .doc(contentId)
      .update({
        ...normalizedUpdates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: user.email || user.uid || 'admin',
      });

    res.json({ success: true, contentId });
  }
);

exports.unpublishContentToInspected = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { contentId, reviewNotes = '' } = req.body || {};
    if (!contentId || typeof contentId !== 'string') {
      return res.status(400).json({ error: 'contentId required' });
    }
    if (String(reviewNotes || '').length > 5000) {
      return res.status(400).json({ error: 'reviewNotes exceeds 5000 characters' });
    }

    const db = admin.firestore();
    const docRef = db.collection('content').doc(contentId);
    let previousStatus = null;
    let contentTitle = '';

    try {
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        if (!snapshot.exists) {
          throw new Error('RESOURCE_NOT_FOUND');
        }

        const currentData = snapshot.data() || {};
        previousStatus = normalizeCurrentStatusForBlogOnly(currentData.contentStatus || 'ingested');
        contentTitle = currentData.Title || currentData.title || '';
        const allowedStatuses = ['published_blog', 'approved_blog'];
        if (!allowedStatuses.includes(previousStatus)) {
          const error = new Error('INVALID_UNPUBLISH_STATUS');
          error.allowedStatuses = allowedStatuses;
          throw error;
        }

        transaction.update(docRef, {
          contentStatus: 'inspected',
          Live: false,
          approvedForBlog: false,
          approvedForNews: false,
          scheduledPublishDate: null,
          reviewNotes: String(reviewNotes || ''),
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewedBy: user.email || user.uid || 'admin',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: user.email || user.uid || 'admin',
        });

        const auditRef = createAdminAuditRef(db);
        transaction.set(
          auditRef,
          buildAdminAuditLogData({
            action: 'content_unpublished',
            user,
            req,
            details: {
              contentId,
              fromStatus: previousStatus,
              toStatus: 'inspected',
              reviewNotes: String(reviewNotes || ''),
            },
            contentId,
            contentTitle,
          })
        );
      });
    } catch (err) {
      if (err.message === 'RESOURCE_NOT_FOUND') {
        return res.status(404).json({ error: `content ${contentId} not found` });
      }
      if (err.message === 'INVALID_UNPUBLISH_STATUS') {
        return res.status(400).json({
          error: `Cannot unpublish content from status ${previousStatus || 'unknown'}`,
          allowedStatuses: err.allowedStatuses || [],
        });
      }
      throw err;
    }

    res.json({ success: true, contentId, from: previousStatus, to: 'inspected' });
  }
);

exports.deleteContentItem = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { contentId } = req.body || {};
    if (!contentId) {
      return res.status(400).json({ error: 'contentId required' });
    }

    await admin.firestore().collection('content').doc(contentId).delete();
    res.json({ success: true, contentId });
  }
);

exports.requestContentInspection = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { contentId } = req.body || {};
    if (!contentId || typeof contentId !== 'string') {
      return res.status(400).json({ error: 'contentId required' });
    }

    const contentRef = admin.firestore().collection('content').doc(contentId);
    const contentSnap = await contentRef.get();
    if (!contentSnap.exists) {
      return res.status(404).json({ error: `content ${contentId} not found` });
    }

    await contentRef.update({
      inspectTrigger: true,
      contentStatus: 'ingested',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: user.email || user.uid || 'admin',
    });

    res.json({ success: true, contentId });
  }
);

exports.saveContentSchedule = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const {
      contentId,
      instantPublish = true,
      scheduledPublishDate = null,
      publishTarget = null,
    } = req.body || {};

    if (!contentId || typeof contentId !== 'string') {
      return res.status(400).json({ error: 'contentId required' });
    }

    const contentRef = admin.firestore().collection('content').doc(contentId);
    const contentSnap = await contentRef.get();
    if (!contentSnap.exists) {
      return res.status(404).json({ error: `content ${contentId} not found` });
    }

    const contentData = contentSnap.data() || {};
    const resolvedPublishTarget = normalizePublishTarget(
      publishTarget,
      contentData.publishTarget || contentData.type || contentData.contentType
    );
    const updates = {
      contentStatus: 'approved_blog',
      publishTarget: resolvedPublishTarget,
      Live: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: user.email || user.uid || 'admin',
    };

    if (instantPublish) {
      updates.scheduledPublishDate = null;
    } else {
      const scheduleDate = toValidDate(scheduledPublishDate);
      if (!scheduleDate) {
        return res.status(400).json({ error: 'Valid scheduledPublishDate required' });
      }
      if (scheduleDate.getTime() <= Date.now()) {
        return res.status(400).json({ error: 'scheduledPublishDate must be in the future' });
      }
      updates.scheduledPublishDate = scheduleDate;
    }

    await contentRef.update(updates);

    res.json({
      success: true,
      contentId,
      instantPublish: Boolean(instantPublish),
      scheduledPublishDate: instantPublish ? null : updates.scheduledPublishDate.toISOString(),
    });
  }
);

exports.resetContentReviewState = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { contentId } = req.body || {};
    if (!contentId || typeof contentId !== 'string') {
      return res.status(400).json({ error: 'contentId required' });
    }

    const contentRef = admin.firestore().collection('content').doc(contentId);
    const contentSnap = await contentRef.get();
    if (!contentSnap.exists) {
      return res.status(404).json({ error: `content ${contentId} not found` });
    }

    await contentRef.update({
      inspectTrigger: false,
      contentStatus: 'ingested',
      inspectError: null,
      Live: false,
      scheduledPublishDate: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: user.email || user.uid || 'admin',
    });

    res.json({ success: true, contentId });
  }
);

exports.saveContentImageOrder = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { contentId, imageUrls = [] } = req.body || {};
    if (!contentId || typeof contentId !== 'string') {
      return res.status(400).json({ error: 'contentId required' });
    }
    if (!Array.isArray(imageUrls)) {
      return res.status(400).json({ error: 'imageUrls array required' });
    }

    const contentRef = admin.firestore().collection('content').doc(contentId);
    const contentSnap = await contentRef.get();
    if (!contentSnap.exists) {
      return res.status(404).json({ error: `content ${contentId} not found` });
    }

    const updates = buildContentImageUpdates(imageUrls, contentSnap.data() || {});
    await contentRef.update({
      heroImageUrl: updates.heroImageUrl || admin.firestore.FieldValue.delete(),
      contentImageUrl: updates.contentImageUrl || admin.firestore.FieldValue.delete(),
      altCoverImage: updates.altCoverImage || admin.firestore.FieldValue.delete(),
      secondaryImageUrls:
        updates.secondaryImageUrls.length > 0
          ? updates.secondaryImageUrls
          : admin.firestore.FieldValue.delete(),
      aiImageUrls: updates.aiImageUrls,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: user.email || user.uid || 'admin',
    });

    res.json({ success: true, contentId, imageCount: imageUrls.length });
  }
);

exports.upsertSpeakerEvent = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { docId, data = {}, merge = true } = req.body || {};
    if (!docId || typeof docId !== 'string') {
      return res.status(400).json({ error: 'docId required' });
    }
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'data object required' });
    }

    const normalizeSpeakerEventDate = (value) => {
      if (value === null || value === undefined || value === '') return null;
      if (value instanceof Date) {
        return isNaN(value.getTime()) ? null : admin.firestore.Timestamp.fromDate(value);
      }
      if (typeof value === 'number') {
        const dt = new Date(value);
        return isNaN(dt.getTime()) ? null : admin.firestore.Timestamp.fromDate(dt);
      }
      if (typeof value === 'string') {
        const dt = new Date(value);
        return isNaN(dt.getTime()) ? null : admin.firestore.Timestamp.fromDate(dt);
      }
      if (typeof value === 'object') {
        const seconds = value.seconds ?? value._seconds;
        if (typeof seconds === 'number') {
          const nanos = value.nanoseconds ?? value._nanoseconds ?? 0;
          return new admin.firestore.Timestamp(seconds, nanos);
        }
      }
      return null;
    };

    const normalizedData = { ...data };
    if (Object.prototype.hasOwnProperty.call(normalizedData, 'date')) {
      normalizedData.date = normalizeSpeakerEventDate(normalizedData.date);
    }

    const payload = {
      ...normalizedData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: user.email || user.uid || 'admin',
    };

    if (!merge) {
      payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
      payload.createdBy = user.email || user.uid || 'admin';
    }

    await admin
      .firestore()
      .collection('speakerevents')
      .doc(docId)
      .set(payload, { merge: merge !== false });

    res.json({ success: true, docId });
  }
);

exports.deleteSpeakerEvent = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { docId } = req.body || {};
    if (!docId || typeof docId !== 'string') {
      return res.status(400).json({ error: 'docId required' });
    }

    const docRef = admin.firestore().collection('speakerevents').doc(docId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: `speakerevents/${docId} not found` });
    }

    await docRef.delete();
    res.json({ success: true, docId, deletedBy: user.email || user.uid || 'admin' });
  }
);

function validateGalleryImageMetadataRequest(body) {
  const {
    imageId,
    id,
    galleryCollection = 'generated_content_images',
    provider,
    slot = '',
    title,
    folder,
    customTags,
  } = body || {};

  const actualImageId = imageId || id;

  if (!actualImageId || typeof actualImageId !== 'string') {
    return { ok: false, status: 400, error: 'imageId or id required' };
  }
  if (!['generated_content_images', 'curated_article_images'].includes(galleryCollection)) {
    return { ok: false, status: 400, error: 'Invalid galleryCollection' };
  }
  return {
    ok: true,
    imageId: actualImageId,
    galleryCollection,
    provider,
    slot,
    title,
    folder,
    customTags,
  };
}

/**
 * Build the partial update for a gallery image.
 *
 * This is a PATCH, not a PUT: a field absent from the request must stay
 * untouched in Firestore, which is why every field is guarded on undefined
 * rather than merely falsy — a caller clearing a title to "" is a real edit and
 * has to be distinguishable from not mentioning the title at all. Note slot
 * checks undefined only, so an explicit null clears it; that asymmetry is
 * preserved from the inline version.
 */
function buildGalleryMetadataUpdate({ provider, slot, title, folder, customTags }, user) {
  const updateData = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: user.email || user.uid || 'admin',
  };

  if (provider !== undefined && provider !== null) {
    updateData.provider = String(provider || '')
      .trim()
      .toLowerCase();
  }

  if (slot !== undefined) {
    updateData.slot = String(slot || '').trim();
  }

  if (title !== undefined && title !== null) {
    updateData.title = String(title || '').trim() || 'Uploaded image';
  }

  if (folder !== undefined && folder !== null) {
    updateData.folder = String(folder || 'default')
      .trim()
      .toLowerCase();
  }

  if (customTags !== undefined && customTags !== null) {
    updateData.customTags = Array.isArray(customTags)
      ? customTags
          .map((tag) =>
            String(tag || '')
              .trim()
              .toLowerCase()
          )
          .filter(Boolean)
      : [];
  }

  return updateData;
}

exports.updateGalleryImageMetadata = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const validated = validateGalleryImageMetadataRequest(req.body);
    if (!validated.ok) {
      return res.status(validated.status).json({ error: validated.error });
    }
    const { imageId, galleryCollection, provider, slot, title, folder, customTags } = validated;

    const imageRef = admin.firestore().collection(galleryCollection).doc(imageId);
    const snap = await imageRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: `${galleryCollection}/${imageId} not found` });
    }

    const updateData = buildGalleryMetadataUpdate(
      { provider, slot, title, folder, customTags },
      user
    );

    await imageRef.update(updateData);

    res.json({ success: true, imageId, galleryCollection, ...updateData });
  }
);

function buildManualGalleryImageDoc(body, user) {
  const sts = admin.firestore.FieldValue.serverTimestamp();
  const actor = user.email || user.uid || 'admin';
  const customTags = Array.isArray(body.customTags)
    ? body.customTags.filter((tag) => String(tag || '').trim()).map((tag) => String(tag).trim())
    : [];
  return {
    articleId: String(body.articleId || 'manual-upload').trim(),
    contentId: '',
    imageUrl: String(body.imageUrl).trim(),
    provider: String(body.provider || '').trim(),
    title: String(body.title || '').trim() || 'Uploaded image',
    slot: String(body.slot || '').trim(),
    customTags,
    folder: String(body.folder || 'Default').trim(),
    sourceCollection: 'manual_upload',
    storagePath: String(body.storagePath || '').trim(),
    createdAt: sts,
    createdBy: actor,
    updatedAt: sts,
    updatedBy: actor,
  };
}

exports.createManualGalleryImageRecord = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const body = req.body || {};
    if (!String(body.imageUrl || '').trim()) {
      return res.status(400).json({ error: 'imageUrl required' });
    }

    const createdRef = await admin
      .firestore()
      .collection('generated_content_images')
      .add(buildManualGalleryImageDoc(body, user));

    res.json({ success: true, imageId: createdRef.id });
  }
);

async function handleImagePromptSaveSet({ res, db, user, normalizedSetName, body }) {
  if (!normalizedSetName) {
    return res.status(400).json({ error: 'setName is required' });
  }
  try {
    assertStringLength(body.primaryPrompt, 'primaryPrompt', 12000, { allowEmpty: false });
  } catch (error) {
    return res.status(400).json({ error: String(error.message || error) });
  }
  await db
    .collection('image_prompt_sets')
    .doc(normalizedSetName)
    .set(
      {
        name: normalizedSetName,
        primaryPrompt: String(body.primaryPrompt || '').trim(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: user.email || user.uid || 'admin',
      },
      { merge: true }
    );
  return res.json({ success: true, action: 'saveSet', setName: normalizedSetName });
}

async function handleImagePromptDeleteSet({ res, db, normalizedSetName }) {
  if (!normalizedSetName) {
    return res.status(400).json({ error: 'setName is required' });
  }
  await deleteImagePromptSetArtifacts(db, normalizedSetName);
  return res.json({ success: true, action: 'deleteSet', setName: normalizedSetName });
}

async function handleImagePromptSavePrompt({
  res,
  db,
  user,
  normalizedSetName,
  normalizedPromptName,
  body,
}) {
  if (!normalizedSetName || !normalizedPromptName) {
    return res.status(400).json({ error: 'setName and promptName are required' });
  }
  try {
    assertStringLength(body.additionalParameters, 'additionalParameters', 12000, {
      allowEmpty: true,
    });
    Object.values(normalizeSlotTemplates(body.slotTemplates)).forEach((value) => {
      assertStringLength(value, 'slotTemplate', 2000, { allowEmpty: true });
    });
  } catch (error) {
    return res.status(400).json({ error: String(error.message || error) });
  }
  const sts = admin.firestore.FieldValue.serverTimestamp();
  const actor = user.email || user.uid || 'admin';
  await db
    .collection('image_prompt_sets')
    .doc(normalizedSetName)
    .set({ name: normalizedSetName, updatedAt: sts, updatedBy: actor }, { merge: true });
  await db
    .collection('image_prompt_sets')
    .doc(normalizedSetName)
    .collection('prompts')
    .doc(normalizedPromptName)
    .set(
      {
        name: normalizedPromptName,
        additionalParameters: String(body.additionalParameters || '').trim(),
        slotTemplates: normalizeSlotTemplates(body.slotTemplates),
        updatedAt: sts,
        updatedBy: actor,
      },
      { merge: true }
    );
  return res.json({
    success: true,
    action: 'savePrompt',
    setName: normalizedSetName,
    promptName: normalizedPromptName,
  });
}

async function handleImagePromptDeletePrompt({ res, db, normalizedSetName, normalizedPromptName }) {
  if (!normalizedSetName || !normalizedPromptName) {
    return res.status(400).json({ error: 'setName and promptName are required' });
  }
  await db
    .collection('image_prompt_sets')
    .doc(normalizedSetName)
    .collection('prompts')
    .doc(normalizedPromptName)
    .delete();
  await deleteLegacyImagePromptIfNeeded(db, normalizedSetName, normalizedPromptName);
  return res.json({
    success: true,
    action: 'deletePrompt',
    setName: normalizedSetName,
    promptName: normalizedPromptName,
  });
}

async function handleImagePromptSavePageAssignment({
  res,
  db,
  user,
  normalizedSetName,
  normalizedPromptName,
  pagePath,
}) {
  let normalizedPagePath = String(pagePath || '').trim();
  try {
    normalizedPagePath = assertAllowedPromptPage(normalizedPagePath);
  } catch (error) {
    return res.status(400).json({ error: String(error.message || error) });
  }
  const pageDocId = pathToPromptPageDocId(normalizedPagePath);
  await db
    .collection('image_prompt_pages')
    .doc(pageDocId)
    .set(
      {
        pagePath: normalizedPagePath,
        setName: normalizedSetName || '',
        promptName: normalizedPromptName || '',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: user.email || user.uid || 'admin',
      },
      { merge: true }
    );
  return res.json({
    success: true,
    action: 'savePageAssignment',
    pagePath: normalizedPagePath,
    setName: normalizedSetName || '',
    promptName: normalizedPromptName || '',
  });
}

exports.manageImagePromptConfig = onRequest(
  { region: 'us-central1', timeoutSeconds: 120, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const body = req.body || {};
    const normalizedAction = String(body.action || '').trim();
    const normalizedSetName = normalizePromptConfigKey(body.setName);
    const normalizedPromptName = normalizePromptConfigKey(body.promptName);
    const db = admin.firestore();

    if (!normalizedAction) {
      return res.status(400).json({ error: 'action is required' });
    }
    if (normalizedSetName.length > 120 || normalizedPromptName.length > 120) {
      return res.status(400).json({ error: 'setName/promptName exceeds 120 characters' });
    }

    const ctx = { res, db, user, normalizedSetName, normalizedPromptName, body };
    switch (normalizedAction) {
      case 'saveSet':
        return handleImagePromptSaveSet(ctx);
      case 'deleteSet':
        return handleImagePromptDeleteSet(ctx);
      case 'savePrompt':
        return handleImagePromptSavePrompt(ctx);
      case 'deletePrompt':
        return handleImagePromptDeletePrompt(ctx);
      case 'savePageAssignment':
        return handleImagePromptSavePageAssignment({ ...ctx, pagePath: body.pagePath });
      default:
        return res.status(400).json({ error: `Unsupported action: ${normalizedAction}` });
    }
  }
);

exports.deleteRejectedContent = onRequest(
  { region: 'us-central1', timeoutSeconds: 120, memory: '256MiB', invoker: 'public' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { olderThanHours = null, limit = 500 } = req.body || {};
    const result = await deleteRejectedContentBatch({ olderThanHours, limit });

    logger.warn(`deleteRejectedContent deleted ${result.deletedCount} items`);
    res.json({ success: true, ...result });
  }
);

// Resolve the content doc + the set of blog docs to soft-delete.
// Handles three input modes: contentId, blogId, or both. Looks up
// linked blogs via sourceContentId / publishedBlogId.
async function resolveLivePageRefs(db, { contentId, blogId }) {
  let contentRef = contentId ? db.collection('content').doc(contentId) : null;
  let contentSnap = contentRef ? await contentRef.get() : null;

  const directBlogRef = blogId ? db.collection('blogs').doc(blogId) : null;
  const directBlogSnap = directBlogRef ? await directBlogRef.get() : null;

  if ((!contentSnap || !contentSnap.exists) && directBlogSnap?.exists) {
    const directBlogData = directBlogSnap.data() || {};
    if (directBlogData.sourceContentId) {
      contentRef = db.collection('content').doc(directBlogData.sourceContentId);
      contentSnap = await contentRef.get();
    }
  }

  const blogRefs = [];
  if (directBlogSnap?.exists) {
    blogRefs.push(directBlogRef);
  }

  if (contentSnap?.exists) {
    const contentData = contentSnap.data() || {};
    if (contentData.publishedBlogId) {
      const linkedBlogRef = db.collection('blogs').doc(contentData.publishedBlogId);
      const linkedBlogSnap = await linkedBlogRef.get();
      if (linkedBlogSnap.exists && !blogRefs.some((ref) => ref.path === linkedBlogRef.path)) {
        blogRefs.push(linkedBlogRef);
      }
    }
    const relatedBlogs = await db
      .collection('blogs')
      .where('sourceContentId', '==', contentSnap.id)
      .get();
    relatedBlogs.forEach((blogDoc) => {
      if (!blogRefs.some((ref) => ref.path === blogDoc.ref.path)) {
        blogRefs.push(blogDoc.ref);
      }
    });
  }

  return { contentRef, contentSnap, blogRefs };
}

exports.softDeleteLivePage = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { contentId = '', blogId = '', reason = '' } = req.body || {};
    if (!contentId && !blogId) {
      return res.status(400).json({ error: 'contentId or blogId required' });
    }

    const db = admin.firestore();
    const deletedAt = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + 24 * 60 * 60 * 1000)
    );

    const resolved = await resolveLivePageRefs(db, { contentId, blogId });
    const { contentRef, contentSnap, blogRefs } = resolved;

    if ((!contentSnap || !contentSnap.exists) && blogRefs.length === 0) {
      return res.status(404).json({ error: 'No matching live page record found' });
    }

    const batch = db.batch();
    const sharedDeleteState = {
      Live: false,
      Status: 'Archived',
      contentStatus: 'archived',
      archivedAt: deletedAt,
      softDeletedAt: deletedAt,
      softDeleteExpiresAt: expiresAt,
      scheduledPublishDate: null,
      deletionRequestedBy: user.email || user.uid || 'admin',
      deletionReason: String(reason || '').trim(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (contentSnap?.exists) {
      batch.update(contentRef, {
        ...sharedDeleteState,
      });
    }

    blogRefs.forEach((ref) => {
      batch.update(ref, {
        ...sharedDeleteState,
      });
    });

    await batch.commit();

    res.json({
      success: true,
      contentId: contentSnap?.exists ? contentSnap.id : null,
      blogIds: blogRefs.map((ref) => ref.id),
      softDeleteExpiresAt: expiresAt.toDate().toISOString(),
    });
  }
);

// Build the per-action update payload for a workflow_alert document.
function buildWorkflowAlertUpdates({ action, now, actor, normalizedResolutionNote, alertData }) {
  const updates = { updatedAt: now, updatedBy: actor };
  if (action === 'acknowledge') {
    updates.acknowledgedAt = now;
    updates.acknowledgedBy = actor;
    updates.status = 'acknowledged';
  } else if (action === 'resolve') {
    updates.active = false;
    updates.resolvedAt = now;
    updates.resolvedBy = actor;
    updates.status = 'resolved';
    updates.resolutionNote = normalizedResolutionNote;
    if (!alertData?.acknowledgedAt) {
      updates.acknowledgedAt = now;
      updates.acknowledgedBy = actor;
    }
  } else if (action === 'reopen') {
    updates.active = true;
    updates.status = 'open';
    updates.resolvedAt = null;
    updates.resolvedBy = null;
    updates.resolutionNote = null;
  }
  return updates;
}

function buildWorkflowAlertAuditDoc({
  auditRef,
  now,
  action,
  alertId,
  alertData,
  updates,
  user,
  actor,
  normalizedResolutionNote,
  req,
}) {
  return {
    id: auditRef.id,
    timestamp: now,
    action: `workflow_alert_${action}`,
    resourceType: 'workflow_alert',
    resourceId: alertId,
    resourceTitle: alertData?.alertType || 'workflow_alert',
    userId: user.uid || actor,
    userName: user.name || user.displayName || '',
    userEmail: user.email || '',
    changes: {
      before: { active: alertData?.active ?? true, status: alertData?.status || 'open' },
      after: updates,
      changedFields: Object.keys(updates),
      notes: normalizedResolutionNote,
    },
    ipAddress: req.ip || null,
    userAgent: req.headers['user-agent'] || null,
    metadata: { authMethod: 'firebase_id_token', alertType: alertData?.alertType || null },
    compliance: {
      dataClassification: 'internal',
      retentionMonths: 24,
      identityVerified: true,
    },
  };
}

exports.updateWorkflowAlert = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST' && req.method !== 'PATCH') {
      return res.status(405).json({ error: 'POST or PATCH only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { alertId, action, resolutionNote = '' } = req.body || {};
    const normalizedResolutionNote = String(resolutionNote || '').trim();
    if (!alertId || !action) {
      return res.status(400).json({ error: 'alertId and action required' });
    }

    if (!['acknowledge', 'resolve', 'reopen'].includes(action)) {
      return res
        .status(400)
        .json({ error: 'Invalid action', validActions: ['acknowledge', 'resolve', 'reopen'] });
    }

    if (action === 'resolve' && !normalizedResolutionNote) {
      return res.status(400).json({ error: 'resolutionNote is required when resolving an alert' });
    }

    const alertRef = admin.firestore().collection('workflow_alerts').doc(alertId);
    const alertSnap = await alertRef.get();
    if (!alertSnap.exists) {
      return res.status(404).json({ error: `workflow_alert ${alertId} not found` });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const actor = user.email || user.uid || 'admin';
    const updates = buildWorkflowAlertUpdates({
      action,
      now,
      actor,
      normalizedResolutionNote,
      alertData: alertSnap.data() || {},
    });

    await alertRef.update(updates);

    const auditRef = admin.firestore().collection('audits').doc();
    await auditRef.set(
      buildWorkflowAlertAuditDoc({
        auditRef,
        now,
        action,
        alertId,
        alertData: alertSnap.data() || {},
        updates,
        user,
        actor,
        normalizedResolutionNote,
        req,
      })
    );

    res.json({ success: true, alertId, action });
  }
);

exports.getAdminDashboardSnapshot = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '512MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const db = admin.firestore();
      const [statsDocSnap, recentNeedsReview] = await Promise.all([
        db.doc(DASHBOARD_STATS_DOC_PATH).get(),
        getRecentNeedsReviewItems(db, 10),
      ]);

      let stats;
      if (statsDocSnap.exists) {
        const raw = statsDocSnap.data() || {};
        // Project to the same shape summarizeDashboardItems returned so the
        // admin DashboardPage UI doesn't need any changes.
        stats = emptyDashboardStats();
        delete stats.totalDocs;
        delete stats.schemaVersion;
        DASHBOARD_STATS_TYPES.forEach((t) => {
          if (raw[t]) stats[t] = { ...stats[t], ...raw[t] };
        });
        stats.rejected = raw.rejected || 0;
      } else {
        // Stats doc not yet seeded (first deploy). Fall back to live aggregation
        // AND persist the seed so subsequent loads use the fast path.
        const fullSnap = await getAdminContentSnapshotQuery(db).get();
        const items = fullSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        stats = summarizeDashboardItems(items);

        // Seed the stats doc from this full scan. Fire-and-forget — if the
        // write races a concurrent dashboard load, both writes converge on
        // the same merge result.
        const seed = emptyDashboardStats();
        seed.rejected = stats.rejected;
        DASHBOARD_STATS_TYPES.forEach((t) => {
          if (stats[t]) seed[t] = { ...stats[t] };
        });
        seed.totalDocs = items.length;
        seed.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        db.doc(DASHBOARD_STATS_DOC_PATH)
          .set(seed, { merge: true })
          .catch((err) => logger.warn('[dashboard-stats] seed write failed:', err.message));
      }

      res.json({
        success: true,
        generatedAt: new Date().toISOString(),
        stats,
        recentNeedsReview,
      });
    } catch (error) {
      logger.error('Error in getAdminDashboardSnapshot', error);
      res.status(500).json({
        error: 'Failed to generate dashboard snapshot',
        message: error?.message || 'Unknown error',
      });
    }
  }
);

// Full-recalculate endpoint: does a complete scan of the content collection and
// overwrites the dashboard_stats/v1 doc with accurate counts. Use when the
// incremental stats have drifted.
exports.recalculateDashboardStats = onRequest(
  { region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const db = admin.firestore();
      const fullSnap = await db
        .collection('content')
        .select(
          'contentStatus',
          'Live',
          'type',
          'contentType',
          'publishTarget',
          'targetLandingZone'
        )
        .get();
      const items = fullSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const stats = summarizeDashboardItems(items);

      const seed = emptyDashboardStats();
      seed.rejected = stats.rejected;
      DASHBOARD_STATS_TYPES.forEach((t) => {
        if (stats[t]) seed[t] = { ...stats[t] };
      });
      seed.totalDocs = items.length;
      seed.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      seed.recalculatedAt = admin.firestore.FieldValue.serverTimestamp();
      seed.recalculatedBy = user.email || user.uid || 'admin';

      await db.doc(DASHBOARD_STATS_DOC_PATH).set(seed);

      logger.info(
        `[dashboard-stats] recalculated: ${items.length} docs scanned by ${user.email || user.uid}`
      );

      res.json({
        success: true,
        totalDocs: items.length,
        stats,
      });
    } catch (error) {
      logger.error('Error in recalculateDashboardStats', error);
      res.status(500).json({
        error: 'Failed to recalculate dashboard stats',
        message: error?.message || 'Unknown error',
      });
    }
  }
);

exports.getCurrentAdminStatus = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res, 'GET, OPTIONS')) return;
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'GET only' });
    }

    return getCurrentAdminStatusHandler(req, res);
  }
);

// Resolve and validate the bootstrap allowlist for first-admin self-promotion.
// Returns { ok: true } if the request should proceed; otherwise { ok: false,
// status, error } describing the reason.
function checkBootstrapAllowlist(decoded) {
  // FINDING-06 (CRITICAL): CMS_BOOTSTRAP_ALLOW_ANY removed. Setting this env var
  // to "true" granted super_admin to ANY authenticated user, bypassing the allowlist
  // entirely. There is no legitimate production use case for this flag.
  const expandList = (envValues, lowercase) =>
    envValues.filter(Boolean).flatMap((value) =>
      String(value)
        .split(',')
        .map((entry) => (lowercase ? entry.trim().toLowerCase() : entry.trim()))
        .filter(Boolean)
    );
  // FINDING-06: Removed VITE_-prefixed env vars — VITE_ variables are bundled
  // into the client-side JS build; they must never be read server-side.
  // Use CMS_BOOTSTRAP_ALLOWED_UIDS / CMS_BOOTSTRAP_ALLOWED_EMAILS (server-only).
  const bootstrapAllowedUids = expandList(
    [process.env.CMS_BOOTSTRAP_ALLOWED_UIDS, process.env.OWNER_ADMIN_UID],
    false
  );
  const bootstrapAllowedEmails = expandList(
    [process.env.CMS_BOOTSTRAP_ALLOWED_EMAILS, process.env.OWNER_ADMIN_EMAIL],
    true
  );

  if (bootstrapAllowedUids.length === 0 && bootstrapAllowedEmails.length === 0) {
    logger.error(
      'Initial bootstrap blocked: configure CMS_BOOTSTRAP_ALLOWED_UIDS or CMS_BOOTSTRAP_ALLOWED_EMAILS (or OWNER_ADMIN_UID/EMAIL).'
    );
    return {
      ok: false,
      status: 503,
      error:
        'Initial bootstrap is locked. Configure bootstrap allowlist env vars for the first admin.',
    };
  }

  const email = String(decoded.email || '')
    .trim()
    .toLowerCase();
  const uidAllowed = bootstrapAllowedUids.includes(decoded.uid);
  const emailAllowed = email ? bootstrapAllowedEmails.includes(email) : false;
  if (!uidAllowed && !emailAllowed) {
    return {
      ok: false,
      status: 403,
      error: 'User is not allowed to perform initial bootstrap',
    };
  }
  return { ok: true };
}

exports.bootstrapCurrentUserAdmin = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const requestedRole = String(req.body?.role || 'super_admin').toLowerCase();
    if (!ADMIN_ROLES[requestedRole.toUpperCase()]) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const authHeader = req.headers.authorization || '';
    const [, token] = authHeader.match(/^Bearer (.+)$/i) || [];
    if (!token) {
      return res.status(401).json({ error: 'Missing Authorization bearer token' });
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token, true);
    } catch (err) {
      logger.warn('ID token verification failed in bootstrapCurrentUserAdmin', err.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const activeAdminsSnap = await admin
      .firestore()
      .collection('admins')
      .where('active', '==', true)
      .limit(1)
      .get();

    if (!activeAdminsSnap.empty) {
      const actor = await requireAdminClaims(req, res, 'super_admin');
      if (!actor) return;
      decoded = actor;
    } else {
      const bootstrapCheck = checkBootstrapAllowlist(decoded);
      if (!bootstrapCheck.ok) {
        return res.status(bootstrapCheck.status).json({ error: bootstrapCheck.error });
      }
    }

    await setAdminRole(
      decoded.uid,
      requestedRole,
      decoded.uid || 'bootstrap-self',
      activeAdminsSnap.empty
        ? 'Initial bootstrap via bootstrapCurrentUserAdmin'
        : 'Role update via bootstrapCurrentUserAdmin'
    );

    return res.json({
      success: true,
      uid: decoded.uid,
      email: decoded.email || null,
      role: requestedRole,
      initialBootstrap: activeAdminsSnap.empty,
    });
  }
);

exports.getQueueSnapshot = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const {
        statusFilter = 'needs_review',
        contentTypeFilter = 'all',
        itemLimit = 100,
      } = req.body || {};
      const db = admin.firestore();
      const normalizedLimit = Math.min(Math.max(Number(itemLimit) || 100, 1), 200);

      // Translate statusFilter into bounded Firestore queries. Content-type
      // filtering still happens in JS because it's derived from up to 3
      // fallback fields (type / contentType / publishTarget) and isn't
      // amenable to a single where() clause. Fetching with a 2-3x buffer
      // gives us room to discard non-matching content types and still hit
      // the requested limit.
      const fetchSize = contentTypeFilter === 'all' ? normalizedLimit : normalizedLimit * 3;

      // Build the underlying Firestore query for both the page fetch and the
      // count() aggregation. Note: count() is a single index scan; it does
      // NOT bill per-doc reads.
      let filterableQuery;
      let sortField;
      if (statusFilter === 'needs_review') {
        filterableQuery = db
          .collection('content')
          .where('contentStatus', 'in', ['ingested', 'inspected']);
        sortField = 'fetchedAt';
      } else if (statusFilter === 'ready_to_publish') {
        filterableQuery = db
          .collection('content')
          .where('contentStatus', 'in', ['approved', 'approved_blog', 'published_blog']);
        sortField = 'updatedAt';
      } else if (statusFilter === 'published_live') {
        filterableQuery = db.collection('content').where('Live', '==', true);
        sortField = 'blogPublishedAt';
      } else if (statusFilter === 'in_progress') {
        filterableQuery = db
          .collection('content')
          .where('contentStatus', 'in', ['approved', 'approved_blog', 'in_review', 'editing']);
        sortField = 'updatedAt';
      } else {
        filterableQuery = db.collection('content').where('contentStatus', '==', statusFilter);
        sortField = 'fetchedAt';
      }

      const [countAgg, snap] = await Promise.all([
        filterableQuery.count().get(),
        filterableQuery
          .orderBy(sortField, 'desc')
          .limit(fetchSize)
          .select(...ADMIN_CONTENT_SNAPSHOT_FIELDS)
          .get(),
      ]);

      let items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      // Apply remaining JS-side filters that couldn't be expressed in Firestore.
      if (statusFilter === 'ready_to_publish' || statusFilter === 'in_progress') {
        items = items.filter((item) => matchesQueueStatus(item, statusFilter));
      }
      if (contentTypeFilter !== 'all') {
        items = items.filter((item) => matchesAdminContentType(item, contentTypeFilter));
      }

      // Firestore-side total. The 'in' queries occasionally include items that
      // don't match the JS-side ready_to_publish 'Live != true' nuance — that
      // small discrepancy is acceptable for a header display ("Showing N of M").
      res.json({
        success: true,
        generatedAt: new Date().toISOString(),
        totalCount: countAgg.data().count,
        items: items.slice(0, normalizedLimit),
      });
    } catch (error) {
      logger.error('Error in getQueueSnapshot', error);
      res.status(500).json({
        error: 'Failed to generate queue snapshot',
        message: error?.message || 'Unknown error',
      });
    }
  }
);

exports.getPublishSnapshot = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const db = admin.firestore();
      // 'ready_to_publish' = approved/approved_blog/published_blog with Live != true.
      // We fetch the broad bucket then filter Live=true out client-side
      // (small discrepancy vs the original is acceptable for this page).
      const readyBucketQuery = db
        .collection('content')
        .where('contentStatus', 'in', ['approved', 'approved_blog', 'published_blog']);
      const publishedQuery = db
        .collection('content')
        .where('Live', '==', true)
        .where('contentStatus', '==', 'published_blog');

      const [readyCountAgg, readySnap, publishedCountAgg, publishedSnap] = await Promise.all([
        readyBucketQuery.count().get(),
        readyBucketQuery
          .orderBy('updatedAt', 'desc')
          .limit(150)
          .select(...ADMIN_CONTENT_SNAPSHOT_FIELDS)
          .get(),
        publishedQuery.count().get(),
        publishedQuery
          .orderBy('blogPublishedAt', 'desc')
          .limit(100)
          .select(...ADMIN_CONTENT_SNAPSHOT_FIELDS)
          .get(),
      ]);

      const readyCandidates = readySnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((item) => item.Live !== true)
        .slice(0, 100);
      const publishedItems = publishedSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      res.json({
        success: true,
        generatedAt: new Date().toISOString(),
        readyTotal: readyCountAgg.data().count,
        publishedTotal: publishedCountAgg.data().count,
        readyCandidates,
        publishedItems,
      });
    } catch (error) {
      logger.error('Error in getPublishSnapshot', error);
      res.status(500).json({
        error: 'Failed to generate publish snapshot',
        message: error?.message || 'Unknown error',
      });
    }
  }
);

exports.getOpsHealthSnapshot = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const db = admin.firestore();
      const digestDate = new Date().toISOString().slice(0, 10);
      const nowMs = Date.now();
      const breachCutoff = new Date(nowMs - 24 * 60 * 60 * 1000);

      // Bounded reads + count() aggregations replace the prior full-collection scan.
      // The published-set is fetched (limit 200) only to compute missingSlugCount —
      // we need to inspect each doc's slug/Slug fields, so a count() doesn't work here.
      // Most install bases have <200 published items, so this stays cheap.
      const [
        publishedCountAgg,
        publishedSlim,
        rssCountAgg,
        queueBreachAgg,
        stagedSnap,
        digestSnap,
        latestDigestSnap,
        alertsSnap,
        generatedImagesSnap,
      ] = await Promise.all([
        db.collection('content').where('contentStatus', '==', 'published_blog').count().get(),
        db
          .collection('content')
          .where('contentStatus', '==', 'published_blog')
          .select('slug', 'Slug')
          .limit(200)
          .get(),
        db.collection('content').where('source', '==', 'rss').count().get(),
        db
          .collection('content')
          .where('contentStatus', 'in', ['ingested', 'inspected'])
          .where('fetchedAt', '<', breachCutoff)
          .count()
          .get(),
        db
          .collection('content')
          .where('contentStatus', 'in', ['approved_blog', 'published_blog'])
          .orderBy('updatedAt', 'desc')
          .limit(50)
          .select('contentStatus', 'Live', 'updatedAt', 'reviewedAt', 'fetchedAt')
          .get(),
        db.collection('workflow_digests').doc(digestDate).get(),
        db.collection('workflow_digests').orderBy('digestDate', 'desc').limit(1).get(),
        db.collection('workflow_alerts').orderBy('updatedAt', 'desc').limit(20).get(),
        db.collection('generated_content_images').select('contentId', 'sourceCollection').get(),
      ]);

      const alerts = alertsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const missingSlugCount = publishedSlim.docs.filter((doc) => {
        const d = doc.data() || {};
        return !d.slug && !d.Slug;
      }).length;
      const readiness = {
        functionsConfigured: true,
        publishedItems: publishedCountAgg.data().count,
        missingSlugCount,
        rssSources: rssCountAgg.data().count,
      };
      let digestData = null;
      if (digestSnap.exists) {
        digestData = digestSnap.data();
      } else if (latestDigestSnap.docs[0]) {
        digestData = latestDigestSnap.docs[0].data();
      }
      const queueBreachCount = queueBreachAgg.data().count;
      const stagedHours = stagedSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((item) => item.Live !== true)
        .map((item) => toHoursSince(item.updatedAt || item.reviewedAt || item.fetchedAt, nowMs))
        .filter((value) => value !== null);
      const openAlerts = alerts.filter((alert) => getWorkflowAlertStatus(alert) !== 'resolved');
      const openAlertHours = openAlerts
        .map((alert) => toHoursSince(alert.updatedAt || alert.firstSeenAt, nowMs))
        .filter((value) => value !== null);
      const publishFailureCount = alerts.filter(
        (alert) =>
          alert.alertType === 'scheduled_publish_failures' &&
          getWorkflowAlertStatus(alert) !== 'resolved'
      ).length;

      // Orphan detection: iterate the (typically smaller) generated_images
      // collection and probe content/blogs existence with exists() — far
      // cheaper than reading the entire content collection just to build a Set.
      const orphanProbes = await Promise.all(
        generatedImagesSnap.docs.map(async (doc) => {
          const data = doc.data() || {};
          const contentId = String(data.contentId || '').trim();
          if (!contentId) return 1; // orphan: no contentId
          const sourceCol =
            String(data.sourceCollection || '').trim() === 'blogs' ? 'blogs' : 'content';
          const refSnap = await db.collection(sourceCol).doc(contentId).get();
          return refSnap.exists ? 0 : 1;
        })
      );
      const orphanedGeneratedImages = orphanProbes.reduce((sum, v) => sum + v, 0);
      const operationalSignals = {
        queueBreachCount,
        oldestStagedHours: stagedHours.length > 0 ? Math.max(...stagedHours) : 0,
        openAlertAgeHours: openAlertHours.length > 0 ? Math.max(...openAlertHours) : 0,
        publishFailureCount,
        orphanedGeneratedImages,
        lastSchedulerSuccessAt:
          digestData?.publishingOps?.status === 'success'
            ? digestData?.publishingOps?.lastRunAt
            : null,
      };

      res.json({
        success: true,
        generatedAt: new Date().toISOString(),
        readiness,
        digest: digestData,
        alerts,
        operationalSignals,
      });
    } catch (error) {
      logger.error('Error in getOpsHealthSnapshot', error);
      res.status(500).json({
        error: 'Failed to generate operations health snapshot',
        message: error?.message || 'Unknown error',
      });
    }
  }
);

exports.listContentItems = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res, 'GET, OPTIONS')) return;
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'GET only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const status = req.query.status || '';
      const max = Math.min(Number(req.query.limit || 25), 100);
      let q = getAdminContentSnapshotQuery(admin.firestore());
      if (status) {
        q = q.where('contentStatus', '==', status);
      }

      const snap = await q.limit(max).get();
      const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      res.json({ success: true, items, total: items.length });
    } catch (error) {
      logger.error('Error in listContentItems', error);
      res.status(500).json({
        error: 'Failed to list content items',
        message: error?.message || 'Unknown error',
      });
    }
  }
);

// Accumulate one processPublishContent result into the publishContentToBlogs
// response shape. Splits error / reused / new branches and tracks
// expectedPublicUrl warnings.
function buildPublishMappingEntry(contentId, r, reused) {
  return {
    contentId,
    blogId: r.blogId,
    reused,
    slug: r.slug || null,
    curatedSubpagePath: r.curatedSubpagePath || null,
    expectedPublicUrl: r.expectedPublicUrl || null,
    sourceUrl: r.sourceUrl || null,
    landingProvider: r.landingProvider || null,
  };
}

function accumulatePublishResult(results, contentId, r) {
  if (r.error) {
    results.errors.push({ contentId, error: r.error });
    return;
  }
  if (r.reused) {
    results.skipped += 1;
    results.mappings.push(buildPublishMappingEntry(contentId, r, true));
    if (!r.expectedPublicUrl) {
      results.warnings.push({
        contentId,
        warning: 'Published via existing mapping but expectedPublicUrl is missing.',
      });
    }
    return;
  }
  results.published += 1;
  results.mappings.push(buildPublishMappingEntry(contentId, r, false));
  if (!r.expectedPublicUrl) {
    results.warnings.push({
      contentId,
      warning: 'Publish completed but expectedPublicUrl is missing from mapping.',
    });
  }
}

exports.publishContentToBlogs = onRequest(
  { region: 'us-central1', timeoutSeconds: 120, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const {
      contentIds = [],
      publishTarget = null,
      markLive = true,
      createSlugPageTrigger = true,
      addToCurated = true,
      cloudProvider = null,
      landingProvider = null,
    } = req.body || {};

    if (!Array.isArray(contentIds) || contentIds.length === 0) {
      return res.status(400).json({ error: 'contentIds array required' });
    }
    const normalizedPublishTarget = normalizePublishTarget(publishTarget);

    const db = admin.firestore();
    const results = { published: 0, skipped: 0, errors: [], mappings: [], warnings: [] };

    for (const contentId of contentIds.slice(0, 25)) {
      const r = await processPublishContent(db, contentId, {
        user,
        publishTarget: normalizedPublishTarget,
        markLive,
        createSlugPageTrigger,
        addToCurated,
        cloudProvider,
        landingProvider,
      });
      accumulatePublishResult(results, contentId, r);
    }

    res.json({ success: true, ...results });
  }
);

// ============================================================================
// transitionContentStatus — Status State Machine with Audit Trail
// ============================================================================

function validateTransitionRequest({
  contentId,
  blogId,
  normalizedStatus,
  markLive,
  reviewNotes,
  reviewedBy,
}) {
  if (contentId && typeof contentId !== 'string') {
    return { ok: false, status: 400, error: { error: 'contentId must be a string' } };
  }
  if (blogId && typeof blogId !== 'string') {
    return { ok: false, status: 400, error: { error: 'blogId must be a string' } };
  }
  if (markLive !== null && markLive !== undefined && typeof markLive !== 'boolean') {
    return {
      ok: false,
      status: 400,
      error: { error: 'markLive must be boolean when provided' },
    };
  }
  if (String(reviewNotes || '').length > 5000) {
    return { ok: false, status: 400, error: { error: 'reviewNotes exceeds 5000 characters' } };
  }
  if (String(reviewedBy || '').length > 240) {
    return { ok: false, status: 400, error: { error: 'reviewedBy exceeds 240 characters' } };
  }
  if ((!contentId && !blogId) || !normalizedStatus) {
    return {
      ok: false,
      status: 400,
      error: { error: 'contentId (or blogId) and newStatus required' },
    };
  }
  if (!VALID_STATUSES.includes(normalizedStatus)) {
    return {
      ok: false,
      status: 400,
      error: { error: `Invalid status: ${normalizedStatus}`, validStatuses: VALID_STATUSES },
    };
  }
  return { ok: true };
}

async function resolveTransitionContentId(db, { contentId, blogId }) {
  if (contentId) {
    return { ok: true, resolvedContentId: contentId, legacyBlogId: null };
  }
  if (!blogId) {
    return { ok: false, status: 400, error: 'contentId (or blogId) required' };
  }
  const legacyBlogSnap = await db.collection('blogs').doc(blogId).get();
  if (!legacyBlogSnap.exists) {
    return { ok: false, status: 404, error: `Legacy blog ${blogId} not found` };
  }
  const legacyBlogData = legacyBlogSnap.data() || {};
  const resolvedContentId = legacyBlogData.sourceContentId || null;
  if (!resolvedContentId) {
    return {
      ok: false,
      status: 400,
      error: 'Legacy blog record is missing sourceContentId and cannot be transitioned',
    };
  }
  return { ok: true, resolvedContentId, legacyBlogId: blogId };
}

exports.transitionContentStatus = onRequest(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (req, res) => {
    if (!applyCors(req, res)) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const {
      contentId,
      blogId,
      newStatus,
      publishTarget = null,
      markLive = null,
      reviewNotes = '',
      reviewedBy = user.email || user.uid || 'admin',
    } = req.body;

    const normalizedStatus = normalizeStatusForBlogOnly(newStatus);
    const normalizedPublishTarget = normalizePublishTarget(publishTarget);

    const validation = validateTransitionRequest({
      contentId,
      blogId,
      normalizedStatus,
      markLive,
      reviewNotes,
      reviewedBy,
    });
    if (!validation.ok) {
      return res.status(validation.status).json(validation.error);
    }

    const db = admin.firestore();
    const resolved = await resolveTransitionContentId(db, { contentId, blogId });
    if (!resolved.ok) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const { resolvedContentId, legacyBlogId } = resolved;

    const docRef = db.collection('content').doc(resolvedContentId);

    let previousStatus = null;

    try {
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);

        if (!doc.exists) {
          const err = new Error('RESOURCE_NOT_FOUND');
          throw err;
        }

        const data = doc.data();
        const currentStatus = data.contentStatus || 'ingested';
        const normalizedCurrentStatus = normalizeCurrentStatusForBlogOnly(currentStatus);
        previousStatus = normalizedCurrentStatus;

        // Validate transition inside the transaction
        const allowed = VALID_TRANSITIONS[normalizedCurrentStatus];
        if (!allowed || !allowed.includes(normalizedStatus)) {
          const err = new Error('INVALID_TRANSITION');
          err.currentStatus = normalizedCurrentStatus;
          err.allowedTransitions = allowed || [];
          throw err;
        }

        // Build update payload using helper to reduce inline complexity
        const updateData = buildStatusUpdateData(data, normalizedStatus, reviewedBy, reviewNotes, {
          publishTarget: normalizedPublishTarget,
          markLive,
        });

        // Enforce additional invariants tied to the state machine.
        if (normalizedStatus === 'archived') {
          updateData.archivedAt = admin.firestore.FieldValue.serverTimestamp();
        }
        if (normalizedCurrentStatus === 'rejected' && normalizedStatus === 'inspected') {
          // "Restore" should remove rejection marker so the doc no longer appears as rejected.
          updateData.rejectedAt = null;
        }

        // Atomic: update doc + create audit log inside the transaction
        transaction.update(docRef, updateData);

        const auditRef = db.collection('audits').doc();
        transaction.set(auditRef, {
          id: auditRef.id,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          action: 'status_transition',
          resourceType: 'content',
          resourceId: resolvedContentId,
          resourceTitle: data.Title || data.title || '',
          userId: user.uid || reviewedBy,
          userName: user.name || user.displayName || '',
          userEmail: user.email || '',
          changes: {
            before: { contentStatus: currentStatus },
            after: { contentStatus: normalizedStatus },
            changedFields: Object.keys(updateData),
            notes: reviewNotes,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
          metadata: {
            ...(legacyBlogId ? { legacyBlogId } : {}),
            authMethod: 'firebase_id_token',
            reviewedBy,
          },
          compliance: {
            dataClassification: 'internal',
            retentionMonths: 24,
            identityVerified: true,
          },
        });
      });
    } catch (err) {
      if (err.message === 'RESOURCE_NOT_FOUND') {
        return res.status(404).json({ error: `Content ${resolvedContentId} not found` });
      }
      if (err.message === 'INVALID_TRANSITION') {
        return res.status(400).json({
          error: `Invalid transition: ${err.currentStatus} → ${normalizedStatus}`,
          allowedTransitions: err.allowedTransitions || [],
        });
      }
      throw err;
    }

    logger.warn(
      `transitionStatus ${resolvedContentId}: ${previousStatus} → ${normalizedStatus} by ${reviewedBy}`
    );
    res.json({
      success: true,
      contentId: resolvedContentId,
      legacyBlogId,
      collectionName: 'content',
      from: previousStatus,
      to: normalizedStatus,
    });
  }
);

exports.deleteRejectedContentBatch = deleteRejectedContentBatch;

// ============================================================================
// batchInspect — Trigger Inspection on Uninspected Documents
// ============================================================================

exports.batchInspect = onRequest(
  { region: 'us-central1', timeoutSeconds: 300, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { limit: maxItems = 10 } = req.body || {};
    const db = admin.firestore();

    // Find docs that are ingested but not yet inspected
    const uninspected = await db
      .collection('content')
      .where('contentStatus', '==', 'ingested')
      .where('inspectTrigger', '==', false)
      .limit(Math.min(maxItems, 25))
      .get();

    let triggered = 0;
    const triggeredIds = [];

    for (const doc of uninspected.docs) {
      // Only trigger if the doc has a URL to inspect
      const data = doc.data();
      const url = data.url || data.sourceUrl || data['CD Url'];
      if (!url) continue;

      await doc.ref.update({
        inspectTrigger: true,
        url, // Ensure url field is set for the inspector
      });
      triggered++;
      triggeredIds.push(doc.id);

      // Stagger triggers to avoid overwhelming Gemini rate limits (4s delay = ~15/min)
      if (triggered < uninspected.size) {
        await new Promise((r) => setTimeout(r, 4000));
      }
    }

    logger.warn(`batchInspect Triggered ${triggered} of ${uninspected.size} uninspected docs`);
    res.json({
      success: true,
      triggered,
      total: uninspected.size,
      triggeredIds,
    });
  }
);

exports.aiStackReadiness = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB', secrets: [replicateApiKey] },
  async (req, res) => {
    if (!applyCors(req, res, 'GET, POST, OPTIONS')) return;

    const user = await requireAdmin(req, res);
    if (!user) return;

    const provider = getActiveAiProvider();
    let replicateReady = false;
    try {
      replicateReady = Boolean(String(replicateApiKey.value() || '').trim());
    } catch (error) {
      logger.warn('aiStackReadiness: replicate secret access failed', error?.message || error);
      replicateReady = false;
    }

    const modelSummary = getConfiguredModelSummary(provider);
    const controls = getAiControlSummary();
    const readiness = await evaluateAiReadiness({ provider, replicateReady });

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      activeProvider: provider,
      modelSummary,
      controls,
      readiness,
      notes: {
        geminiMinimumPolicy: 'Gemini 2.5 minimum baseline is enforced in defaultModelFor().',
        costPriorityPolicy: 'Draft defaults to flash-lite, analysis/multimodal default to flash.',
      },
    });
  }
);

function getStoragePathFromPublicUrl(url) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname === 'storage.googleapis.com') {
      const prefix = `/${BUCKET}/`;
      if (parsed.pathname.startsWith(prefix)) {
        return decodeURIComponent(parsed.pathname.slice(prefix.length));
      }
    }

    if (
      parsed.hostname === 'firebasestorage.googleapis.com' ||
      parsed.hostname.endsWith('.firebasestorage.googleapis.com')
    ) {
      const marker = '/o/';
      const markerIndex = parsed.pathname.indexOf(marker);
      if (markerIndex >= 0) {
        const encodedPath = parsed.pathname.slice(markerIndex + marker.length);
        return decodeURIComponent(encodedPath);
      }
    }
  } catch (error) {
    logger.warn('getStoragePathFromPublicUrl failed', error?.message || error);
  }

  return null;
}

exports.deleteCuratedGeneratedImage = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { articleId } = req.body || {};
    if (!articleId || typeof articleId !== 'string') {
      return res.status(400).json({ error: 'articleId is required' });
    }

    const db = admin.firestore();
    const cacheRef = db.collection('curated_article_images').doc(articleId);
    const cacheSnap = await cacheRef.get();

    if (!cacheSnap.exists) {
      return res.status(404).json({ error: `curated_article_images/${articleId} not found` });
    }

    const cacheData = cacheSnap.data() || {};
    const imageUrl = String(cacheData.imageUrl || '').trim();
    let storageDeleted = false;

    if (imageUrl) {
      const storagePath = getStoragePathFromPublicUrl(imageUrl);
      if (storagePath) {
        try {
          await admin.storage().bucket(BUCKET).file(storagePath).delete({ ignoreNotFound: true });
          storageDeleted = true;
        } catch (error) {
          logger.warn('deleteCuratedGeneratedImage storage delete failed', {
            articleId,
            storagePath,
            error: error?.message || error,
          });
        }
      }
    }

    await cacheRef.delete();

    res.json({
      success: true,
      articleId,
      storageDeleted,
    });
  }
);

async function deleteImageFromStorage({ imageId, storagePath }) {
  if (!storagePath) return false;
  try {
    await admin.storage().bucket(BUCKET).file(storagePath).delete({ ignoreNotFound: true });
    return true;
  } catch (error) {
    logger.warn('deleteContentGeneratedImage storage delete failed', {
      imageId,
      storagePath,
      error: error?.message || error,
    });
    return false;
  }
}

function buildContentImageRemovalUpdates(contentData, { slot, imageUrl }) {
  const currentHistory = Array.isArray(contentData.aiImageHistory?.[slot])
    ? contentData.aiImageHistory[slot]
    : [];
  const nextHistory = currentHistory.filter((url) => url !== imageUrl);
  const fallbackUrl = nextHistory[nextHistory.length - 1] || '';
  const updates = {
    [`aiImageHistory.${slot}`]:
      nextHistory.length > 0 ? nextHistory : admin.firestore.FieldValue.delete(),
  };
  if ((contentData.aiImageUrls || {})[slot] === imageUrl) {
    updates[`aiImageUrls.${slot}`] = fallbackUrl || admin.firestore.FieldValue.delete();
  }
  if (slot === 'hero' && contentData.altCoverImage === imageUrl) {
    updates.altCoverImage = fallbackUrl || admin.firestore.FieldValue.delete();
  }
  return updates;
}

async function removeImageFromContentDoc(db, { sourceCollection, contentId, slot, imageUrl }) {
  if (!contentId) return;
  const contentRef = db.collection(sourceCollection).doc(contentId);
  const contentSnap = await contentRef.get();
  if (!contentSnap.exists) return;
  const updates = buildContentImageRemovalUpdates(contentSnap.data() || {}, { slot, imageUrl });
  await contentRef.update(updates);
}

exports.deleteContentGeneratedImage = onRequest(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (!applyCors(req, res)) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const { imageId } = req.body || {};
    if (!imageId || typeof imageId !== 'string') {
      return res.status(400).json({ error: 'imageId is required' });
    }

    const db = admin.firestore();
    const imageRef = db.collection('generated_content_images').doc(imageId);
    const imageSnap = await imageRef.get();

    if (!imageSnap.exists) {
      return res.status(404).json({ error: `generated_content_images/${imageId} not found` });
    }

    const imageData = imageSnap.data() || {};
    const contentId = String(imageData.contentId || imageData.articleId || '').trim();
    const slot = String(imageData.slot || 'hero').trim();
    const imageUrl = String(imageData.imageUrl || '').trim();
    const explicitStoragePath = String(imageData.storagePath || '').trim();
    const sourceCollection =
      String(imageData.sourceCollection || '').trim() === 'blogs' ? 'blogs' : 'content';

    const storagePath = explicitStoragePath || getStoragePathFromPublicUrl(imageUrl);
    const storageDeleted = await deleteImageFromStorage({ imageId, storagePath });

    await removeImageFromContentDoc(db, { sourceCollection, contentId, slot, imageUrl });
    await imageRef.delete();

    res.json({
      success: true,
      imageId,
      contentId,
      slot,
      sourceCollection,
      storageDeleted,
    });
  }
);

// ============================================================================
// generateCuratedArticleImage — Generate unique images for curated articles
// ============================================================================

// Default fallback cover image for articles without og:image or scraped images
const DEFAULT_FALLBACK_COVER_URL =
  'https://firebasestorage.googleapis.com/v0/b/hybridcloudworks-61e8d.appspot.com/o/covers%2F1779664455640-rss-azure-azuremicrosoftcomupdatesid562359.png?alt=media';

// Try to fetch and re-host the article's og:image / twitter:image. Returns
// the resolved storage URL on success, or null if the page is unreachable
// or has no og:image. Failures fall through to the default fallback cover.
// Allowlisted hostnames for og:image scraping (FINDING-11 / HIGH — SSRF).
// Restricts outbound HTTP requests to known content sources only.
// Add new domains here and re-deploy; never open this to arbitrary user input.
// Stage-2 fix: allowlist expanded to cover ALL configured RSS feed sources found
// in functions/index.js and src/context/ProviderContext.jsx. Missing domains caused
// legit article og:images to fall through to the default cover (silent data loss).
// www. prefix is stripped before lookup (see hostname normalization below).
const SCRAPE_ALLOWED_HOSTS = new Set([
  // Microsoft / Azure ecosystem
  'techcommunity.microsoft.com',
  'azure.microsoft.com',
  'learn.microsoft.com',
  'devblogs.microsoft.com',
  'blogs.microsoft.com',
  'docs.microsoft.com',
  'cloudblogs.microsoft.com',
  'microsoft.com', // www.microsoft.com release communications
  'partner.microsoft.com',
  'azurecomcdn.azureedge.net',
  // AWS
  'aws.amazon.com',
  // GCP / Google
  'cloud.google.com',
  'developers.googleblog.com',
  'firebase.blog',
  // GitHub / HashiCorp / FinOps
  'github.blog',
  'hashicorp.com', // www.hashicorp.com
  'finops.org', // www.finops.org
  'weekly.tf', // www.weekly.tf — HashiCorp newsletter
  // Aggregators
  'stackfeed.io',
  // General tech media
  'techcrunch.com',
  'thenewstack.io',
  'infoq.com',
  'hackernoon.com',
  'medium.com',
  'dev.to',
]);

async function tryScrapeArticleOgImage({ articleUrl, articleId }) {
  if (!articleUrl) return null;

  // FINDING-11 (HIGH / SSRF): Validate URL hostname against allowlist before
  // any outbound HTTP request. Prevents the function from being used as a
  // server-side proxy to internal metadata services (169.254.169.254, etc.).
  let parsedUrl;
  try {
    parsedUrl = new URL(articleUrl);
  } catch {
    logger.warn(`[tryScrapeArticleOgImage] Invalid URL rejected: ${articleUrl}`);
    return null;
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    logger.warn(`[tryScrapeArticleOgImage] Non-HTTP protocol rejected: ${parsedUrl.protocol}`);
    return null;
  }
  const hostname = parsedUrl.hostname.replace(/^www\./, '');
  if (!SCRAPE_ALLOWED_HOSTS.has(hostname)) {
    logger.warn(`[tryScrapeArticleOgImage] Host not in allowlist, skipping scrape: ${hostname}`);
    return null;
  }

  try {
    const scrapeResponse = await axios.get(articleUrl, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HCW-Bot/1.0)' },
    });
    const $ = cheerio.load(scrapeResponse.data || '');
    const ogImage =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      '';
    if (!ogImage || !ogImage.startsWith('http')) return null;
    logger.info(`[generateCuratedArticleImage] Scraping og:image for ${articleId}: ${ogImage}`);
    const buffer = await downloadImageBuffer(ogImage);
    const filename = `${Date.now()}-${articleId || 'curated'}.jpg`;
    const resolvedImageUrl = await uploadGeneratedImage(buffer, filename);
    logger.info(
      `[generateCuratedArticleImage] Uploaded scraped og:image for ${articleId}: ${resolvedImageUrl}`
    );
    return resolvedImageUrl;
  } catch (scrapeErr) {
    console.warn(
      `[generateCuratedArticleImage] og:image scrape failed for ${articleUrl}, falling back to default cover:`,
      scrapeErr.message
    );
    return null;
  }
}

// F10 (May 24, 2026) — Deprecated in favor of default fallback cover.
// AI generation was too expensive and slow for articles without og:image.
// Kept for potential future re-enablement if needed — the leading underscore
// marks it as intentionally unreferenced for no-unused-vars.
async function _generateCuratedAiImage({
  basePrompt,
  articleTitle,
  articleSummary,
  provider,
  articleId,
}) {
  const uniquePrompt = `${basePrompt}

Article Context:
- Title: ${articleTitle}
${articleSummary ? `- Summary: ${articleSummary}` : ''}
- Provider: ${provider}

Create a visually unique composition that reflects this specific article's content while maintaining the visual style defined above. Vary the composition, perspective, and elements to be distinct from other article images.`;
  const replicateUrl = await generateImageByPrompt(replicateApiKey.value(), uniquePrompt);
  const buffer = await downloadImageBuffer(replicateUrl);
  const filename = `${Date.now()}-${articleId || 'curated'}.png`;
  // Curated RSS covers don't currently use srcset on the consumer side
  // (CuratedArticlesGrid). Keep this path on a plain PNG upload until a UI
  // change justifies adding variants here. Variants are wired on the main AI
  // cover path (generatePreviewImages, generateAiCoverOnContentTrigger).
  return uploadGeneratedImage(buffer, filename);
}

/** Request fields for a curated-image generation, with the documented defaults. */
function readCuratedImageRequest(body) {
  const {
    articleTitle = '',
    basePrompt = '',
    provider = 'AWS',
    articleId = '',
    articleUrl = '',
  } = body || {};
  return { articleTitle, basePrompt, provider, articleId, articleUrl };
}

/** Cached image document for an article, or null when there is no usable cache entry. */
async function readCuratedImageCache(db, articleId) {
  if (!articleId) return null;
  const cacheDoc = await db.collection('curated_article_images').doc(articleId).get();
  if (!cacheDoc.exists) return null;
  return cacheDoc.data();
}

/**
 * Persist a resolved cover image for an article.
 *
 * The fallback cover is deliberately never cached: it is the same URL for every
 * article, so caching it would write one useless document per article and, worse,
 * pin articles to the fallback even after they later gain an og:image. The
 * DEFAULT check therefore comes first, matching the original branch precedence.
 */
async function cacheCuratedImage(db, { articleId, imageUrl, provider }) {
  if (imageUrl === DEFAULT_FALLBACK_COVER_URL) {
    logger.info(
      `[generateCuratedArticleImage] Skipping cache for ${articleId} (using default fallback)`
    );
    return;
  }
  if (!articleId || !imageUrl) return;

  await db
    .collection('curated_article_images')
    .doc(articleId)
    .set({
      imageUrl,
      provider: provider || 'unknown',
      slot: 'rss',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      articleId,
    });
  logger.info(`[generateCuratedArticleImage] Cached custom image for ${articleId}`);
}

exports.generateCuratedArticleImage = onRequest(
  { region: 'us-central1', timeoutSeconds: 120, memory: '512MiB', secrets: [replicateApiKey] },
  async (req, res) => {
    if (!applyCors(req, res)) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    // FINDING-10 (HIGH): Auth gate was missing — any caller (including unauthenticated)
    // could trigger Replicate AI generation and write to Firestore. requireAdmin
    // verifies the Firebase ID token and checks for a valid adminRole custom claim.
    const actor = await requireAdmin(req, res, 'editor');
    if (!actor) return;

    const { articleTitle, basePrompt, provider, articleId, articleUrl } =
      readCuratedImageRequest(req.body);

    if (!basePrompt.trim() || !articleTitle.trim()) {
      return res.status(400).json({ error: 'basePrompt and articleTitle are required' });
    }

    try {
      // Check Firestore cache first (admin SDK bypasses security rules)
      const db = admin.firestore();
      const cached = await readCuratedImageCache(db, articleId);
      if (cached) {
        logger.info(`[generateCuratedArticleImage] Cache hit for ${articleId}`);
        return res.json({ success: true, imageUrl: cached.imageUrl });
      }

      let resolvedImageUrl = await tryScrapeArticleOgImage({
        articleUrl,
        articleId,
      });

      // F10 (May 24, 2026) — Use default fallback cover instead of AI generation
      // to reduce cost and processing time. AI generation is expensive for articles
      // that don't have og:image metadata.
      if (!resolvedImageUrl) {
        logger.info(
          `[generateCuratedArticleImage] No og:image found for ${articleId}, using default fallback cover`
        );
        resolvedImageUrl = DEFAULT_FALLBACK_COVER_URL;
      }

      // Persist to Firestore cache using admin SDK (bypasses security rules)
      // Skip caching if using default fallback to avoid creating unnecessary cache entries
      // for every article. The default fallback URL is returned directly without caching.
      await cacheCuratedImage(db, { articleId, imageUrl: resolvedImageUrl, provider });

      res.json({ success: true, imageUrl: resolvedImageUrl });
    } catch (err) {
      console.error('[generateCuratedArticleImage] Error:', err);
      res.status(500).json({ error: err.message || 'Failed to generate curated article image' });
    }
  }
);

// ============================================================================
// Publer API Proxy (FINDING-04 / HIGH)
// ============================================================================
// Proxies all Publer API calls from the admin client through a Cloud Function
// so the PUBLER_API_KEY never ships in the client-side JS bundle.
// Client sends: { path: '/accounts', method: 'GET', body: null }
// ============================================================================

const PUBLER_API_BASE_URL = 'https://app.publer.com/api/v1';

exports.publerProxy = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [publerApiKeySecret, publerWorkspaceIdSecret],
  },
  async (req, res) => {
    if (!applyCors(req, res)) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    // Require at minimum editor-level admin — Publer is an admin-only feature.
    const actor = await requireAdmin(req, res, 'editor');
    if (!actor) return;

    const { path: publerPath, method = 'GET', body: publerBody } = req.body || {};

    if (!publerPath || typeof publerPath !== 'string' || !publerPath.startsWith('/')) {
      return res.status(400).json({ error: 'path must be a string starting with /' });
    }

    // B-2 fix (Stage-2 architecture review): path-level allowlist prevents an
    // authenticated admin from using this proxy to invoke destructive Publer API
    // operations (DELETE /accounts, mass-delete posts, etc.) beyond what the UI needs.
    const PUBLER_ALLOWED_PATHS = new Set(['/accounts', '/posts', '/job_status']);
    const PUBLER_ALLOWED_PREFIXES = ['/posts/', '/job_status/'];
    const pathAllowed =
      PUBLER_ALLOWED_PATHS.has(publerPath) ||
      PUBLER_ALLOWED_PREFIXES.some((p) => publerPath.startsWith(p));
    if (!pathAllowed) {
      logger.warn(`[publerProxy] uid=${actor.uid} attempted blocked Publer path: ${publerPath}`);
      return res.status(403).json({ error: 'Publer path not permitted' });
    }

    // Prevent this proxy from being used as an open relay to arbitrary URLs (SSRF).
    // The base URL is a constant — path is appended, never substituted.
    const targetUrl = `${PUBLER_API_BASE_URL}${publerPath}`;

    const normalizedMethod = method.toUpperCase();
    const fetchOptions = {
      method: normalizedMethod,
      headers: {
        Authorization: `Bearer-API ${publerApiKeySecret.value()}`,
        'Publer-Workspace-Id': publerWorkspaceIdSecret.value(),
        'Content-Type': 'application/json',
      },
    };

    if (publerBody && !['GET', 'HEAD'].includes(normalizedMethod)) {
      // Guard against circular refs or oversized payloads before stringify
      let bodyStr;
      try {
        bodyStr = JSON.stringify(publerBody);
      } catch {
        return res.status(400).json({ error: 'Invalid request body' });
      }
      if (bodyStr.length > 50000) {
        return res.status(413).json({ error: 'Request body too large' });
      }
      fetchOptions.body = bodyStr;
    }

    logger.info(`[publerProxy] uid=${actor.uid} -> ${fetchOptions.method} ${publerPath}`);

    const publerRes = await fetch(targetUrl, fetchOptions);
    const data = await publerRes.json().catch(() => ({}));

    if (!publerRes.ok) {
      logger.warn(`[publerProxy] Publer returned ${publerRes.status} for ${publerPath}`);
      return res.status(publerRes.status).json(data);
    }

    return res.json(data);
  }
);

exports.processPublishContent = processPublishContent;
exports.buildDraftFromScraped = buildDraftFromScraped;
exports.buildDraftResponse = buildDraftResponse;
exports.scrapeUrlForDraft = scrapeUrlForDraft;
exports.deleteRejectedContentBatch = deleteRejectedContentBatch;
exports.deleteSoftDeletedContentBatch = deleteSoftDeletedContentBatch;
exports.toMillis = toMillis;
exports.toHoursSince = toHoursSince;
exports.getCanonicalContentTypeForAdmin = getCanonicalContentTypeForAdmin;
exports.matchesAdminContentType = matchesAdminContentType;
exports.matchesQueueStatus = matchesQueueStatus;
exports.getRecentNeedsReviewItems = getRecentNeedsReviewItems;
exports.summarizeDashboardItems = summarizeDashboardItems;
exports.getWorkflowAlertStatus = getWorkflowAlertStatus;
exports.findDuplicateContent = findDuplicateContent;
exports.buildDedupFields = buildDedupFields;
exports.normalizeUrlForDedup = normalizeUrlForDedup;
exports.normalizeTitleForDedup = normalizeTitleForDedup;

// ============================================================================
// Linkie API Proxy (P4 / Platform 2.0)
// ============================================================================
// Proxies Linkie Admin API calls from the admin client through a Cloud
// Function so LINKIE_API_KEY never ships in the client bundle. Mirrors the
// publerProxy pattern: admin auth, constant base URL, strict path allowlist.
//
// Endpoint specifics are isolated in this constants block. LINKIE_API_BASE_URL
// is intentionally configurable because the public docs are Cloudflare-gated
// from CI/non-browser fetches.
// Docs: https://linkie.bio/docs/getting-started/quickstart
// ============================================================================

const linkieApiKeySecret = defineSecret('LINKIE_API_KEY');

const LINKIE_API = {
  BASE_URL: process.env.LINKIE_API_BASE_URL || 'https://app.linkie.bio/api/v1',
  // Exact paths the admin UI needs.
  ALLOWED_PATHS: new Set(['/profiles', '/links', '/analytics']),
  // Prefixes for per-link operations (PUT/DELETE /links/:id).
  ALLOWED_PREFIXES: ['/links/'],
  authHeader(key) {
    return { Authorization: `Bearer ${key}` };
  },
};

const linkieProxy = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [linkieApiKeySecret],
  },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    // Linkie management is an admin-only feature — editor level minimum.
    const actor = await requireAdmin(req, res, 'editor');
    if (!actor) return;

    const { path: linkiePath, method = 'GET', body: linkieBody } = req.body || {};

    if (!linkiePath || typeof linkiePath !== 'string' || !linkiePath.startsWith('/')) {
      return res.status(400).json({ error: 'path must be a string starting with /' });
    }

    // Strip query string before allowlist check; re-append after.
    const [pathOnly, queryString] = linkiePath.split('?');
    // Reject dot-segments: fetch normalizes `..`, which would let a
    // prefix-allowlisted path escape to other endpoints on the API host.
    if (
      decodeURIComponent(pathOnly)
        .split('/')
        .some((seg) => seg === '..' || seg === '.')
    ) {
      return res.status(400).json({ error: 'path segments not permitted' });
    }
    const pathAllowed =
      LINKIE_API.ALLOWED_PATHS.has(pathOnly) ||
      LINKIE_API.ALLOWED_PREFIXES.some((p) => pathOnly.startsWith(p));
    if (!pathAllowed) {
      logger.warn(`[linkieProxy] uid=${actor.uid} attempted blocked path: ${linkiePath}`);
      return res.status(403).json({ error: 'Linkie path not permitted' });
    }

    const normalizedMethod = String(method).toUpperCase();
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(normalizedMethod)) {
      return res.status(400).json({ error: 'method not permitted' });
    }

    // SSRF guard: base URL is a constant — path is appended, never substituted.
    const targetUrl = `${LINKIE_API.BASE_URL}${pathOnly}${queryString ? `?${queryString}` : ''}`;

    const fetchOptions = {
      method: normalizedMethod,
      headers: {
        ...LINKIE_API.authHeader(linkieApiKeySecret.value()),
        'Content-Type': 'application/json',
      },
    };

    if (linkieBody && !['GET', 'HEAD'].includes(normalizedMethod)) {
      let bodyStr;
      try {
        bodyStr = JSON.stringify(linkieBody);
      } catch (_e) {
        return res.status(400).json({ error: 'Invalid request body' });
      }
      if (bodyStr.length > 20000) {
        return res.status(413).json({ error: 'Request body too large' });
      }
      fetchOptions.body = bodyStr;
    }

    logger.info(`[linkieProxy] uid=${actor.uid} -> ${normalizedMethod} ${pathOnly}`);

    const linkieRes = await fetch(targetUrl, fetchOptions);
    const data = await linkieRes.json().catch(() => ({}));

    if (!linkieRes.ok) {
      logger.warn(`[linkieProxy] Linkie returned ${linkieRes.status} for ${pathOnly}`);
      return res.status(linkieRes.status).json(data);
    }

    return res.json(data);
  }
);

exports.linkieProxy = linkieProxy;

// ============================================================================
// Klaviyo API Proxy (admin) + public newsletter subscribe
// ============================================================================
// https://developers.klaviyo.com/en/reference/api_overview
// Auth: `Authorization: Klaviyo-API-Key {key}` + `revision` header.
// ============================================================================

const klaviyoPrivateKeySecret = defineSecret('KLAVIYO_PRIVATE_KEY');
const klaviyoListIdSecret = defineSecret('KLAVIYO_LIST_ID');

const KLAVIYO_API = {
  BASE_URL: 'https://a.klaviyo.com',
  REVISION: '2024-10-15',
  // Read-only admin paths plus profile creation. The subscribe-job endpoint is
  // intentionally NOT proxied for the admin UI — public signups go through
  // newsletterSubscribe below, which owns validation + rate limiting.
  ALLOWED: [
    { prefix: '/api/lists/', methods: ['GET'] },
    { prefix: '/api/campaigns/', methods: ['GET'] },
    { prefix: '/api/profiles/', methods: ['GET', 'POST'] },
  ],
  headers(key) {
    return {
      Authorization: `Klaviyo-API-Key ${key}`,
      revision: this.REVISION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  },
};

/**
 * Serialize a JSON body onto fetch options with a 20 KB cap.
 * Returns null on success or { status, error } for the caller to send.
 */
function attachJsonBody(fetchOptions, body) {
  let bodyStr;
  try {
    bodyStr = JSON.stringify(body);
  } catch (_e) {
    return { status: 400, error: 'Invalid request body' };
  }
  if (bodyStr.length > 20000) {
    return { status: 413, error: 'Request body too large' };
  }
  fetchOptions.body = bodyStr;
  return null;
}

exports.klaviyoProxy = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [klaviyoPrivateKeySecret],
  },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const actor = await requireAdmin(req, res, 'editor');
    if (!actor) return;

    const { path: kPath, method = 'GET', body: kBody } = req.body || {};

    if (!kPath || typeof kPath !== 'string' || !kPath.startsWith('/')) {
      return res.status(400).json({ error: 'path must be a string starting with /' });
    }

    const normalizedMethod = String(method).toUpperCase();
    const [pathOnly, queryString] = kPath.split('?');
    // Reject dot-segments: fetch normalizes `..`, which would let a
    // prefix-allowlisted path escape to other endpoints on the API host.
    if (
      decodeURIComponent(pathOnly)
        .split('/')
        .some((seg) => seg === '..' || seg === '.')
    ) {
      return res.status(400).json({ error: 'path segments not permitted' });
    }
    const rule = KLAVIYO_API.ALLOWED.find(
      (r) => pathOnly === r.prefix || pathOnly.startsWith(r.prefix)
    );
    if (!rule || !rule.methods.includes(normalizedMethod)) {
      logger.warn(
        `[klaviyoProxy] uid=${actor.uid} attempted blocked: ${normalizedMethod} ${kPath}`
      );
      return res.status(403).json({ error: 'Klaviyo path/method not permitted' });
    }

    const targetUrl = `${KLAVIYO_API.BASE_URL}${pathOnly}${queryString ? `?${queryString}` : ''}`;

    const fetchOptions = {
      method: normalizedMethod,
      headers: KLAVIYO_API.headers(klaviyoPrivateKeySecret.value()),
    };

    if (kBody && normalizedMethod !== 'GET') {
      const bodyError = attachJsonBody(fetchOptions, kBody);
      if (bodyError) {
        return res.status(bodyError.status).json({ error: bodyError.error });
      }
    }

    logger.info(`[klaviyoProxy] uid=${actor.uid} -> ${normalizedMethod} ${pathOnly}`);

    const kRes = await fetch(targetUrl, fetchOptions);
    return forwardKlaviyoResponse(res, kRes, pathOnly);
  }
);

/** Forward a Klaviyo API response (202s may carry an empty body). */
async function forwardKlaviyoResponse(res, kRes, pathOnly) {
  const text = await kRes.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!kRes.ok) {
    logger.warn(`[klaviyoProxy] Klaviyo returned ${kRes.status} for ${pathOnly}`);
    return res.status(kRes.status).json(data);
  }
  return res.status(kRes.status === 202 ? 202 : 200).json(data);
}

// ── Public newsletter subscribe (rate-limited, no auth) ──────────────────────
// Accepts { email, source, website } where `website` is a honeypot field that
// must be empty. Per-IP rate limiting backed by Firestore (same pragmatic
// approach as the recordLegacyBlogsRead telemetry guard rails).

const NEWSLETTER_RATE_LIMIT = {
  COLLECTION: 'newsletter_rate_limits',
  WINDOW_MS: 60 * 60 * 1000, // 1 hour
  MAX_PER_WINDOW: 5,
};
const NEWSLETTER_MAX_EMAIL_LEN = 254;
const NEWSLETTER_MAX_SOURCE_LEN = 80;
// Pragmatic email shape check — Klaviyo does final validation.
const NEWSLETTER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function newsletterClientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '');
  return (fwd.split(',')[0] || req.ip || 'unknown').trim();
}

exports.newsletterSubscribe = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 15,
    memory: '256MiB',
    secrets: [klaviyoPrivateKeySecret, klaviyoListIdSecret],
  },
  async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const { email, source = 'website', website = '' } = req.body || {};

    // Honeypot: bots fill every field. Pretend success so they move on.
    if (website && String(website).trim() !== '') {
      return res.json({ success: true });
    }

    // Payload size cap — reject anything beyond the tiny expected shape.
    try {
      if (JSON.stringify(req.body).length > 2000) {
        return res.status(413).json({ error: 'Payload too large' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const normalizedEmail = String(email || '')
      .trim()
      .toLowerCase();
    if (
      !normalizedEmail ||
      normalizedEmail.length > NEWSLETTER_MAX_EMAIL_LEN ||
      !NEWSLETTER_EMAIL_RE.test(normalizedEmail)
    ) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    const normalizedSource = String(source || 'website')
      .trim()
      .slice(0, NEWSLETTER_MAX_SOURCE_LEN);

    // ── Per-IP rate limiting (Firestore-backed fixed window) ────────────────
    const db = admin.firestore();
    const ip = newsletterClientIp(req);
    const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
    const rlRef = db.collection(NEWSLETTER_RATE_LIMIT.COLLECTION).doc(ipHash);
    const now = Date.now();
    try {
      const allowed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(rlRef);
        const data = snap.exists ? snap.data() : null;
        if (!data || now - (data.windowStart || 0) > NEWSLETTER_RATE_LIMIT.WINDOW_MS) {
          tx.set(rlRef, { windowStart: now, count: 1 });
          return true;
        }
        if ((data.count || 0) >= NEWSLETTER_RATE_LIMIT.MAX_PER_WINDOW) return false;
        tx.update(rlRef, { count: admin.firestore.FieldValue.increment(1) });
        return true;
      });
      if (!allowed) {
        return res.status(429).json({ error: 'Too many signups from this address. Try later.' });
      }
    } catch (err) {
      // Rate-limit bookkeeping failure should not block a legit signup.
      logger.warn(`[newsletterSubscribe] rate-limit check failed: ${err.message}`);
    }

    const listId = klaviyoListIdSecret.value();
    if (!listId) {
      logger.error('[newsletterSubscribe] KLAVIYO_LIST_ID secret is empty');
      return res.status(500).json({ error: 'Newsletter is not configured yet.' });
    }

    const payload = {
      data: {
        type: 'profile-subscription-bulk-create-job',
        attributes: {
          custom_source: normalizedSource,
          profiles: {
            data: [
              {
                type: 'profile',
                attributes: {
                  email: normalizedEmail,
                  subscriptions: {
                    email: { marketing: { consent: 'SUBSCRIBED' } },
                  },
                },
              },
            ],
          },
        },
        relationships: {
          list: { data: { type: 'list', id: listId } },
        },
      },
    };

    const kRes = await fetch(`${KLAVIYO_API.BASE_URL}/api/profile-subscription-bulk-create-jobs/`, {
      method: 'POST',
      headers: KLAVIYO_API.headers(klaviyoPrivateKeySecret.value()),
      body: JSON.stringify(payload),
    });

    if (!kRes.ok) {
      const errText = await kRes.text().catch(() => '');
      logger.warn(`[newsletterSubscribe] Klaviyo ${kRes.status}: ${errText.slice(0, 500)}`);
      return res.status(502).json({ error: 'Subscription failed. Please try again later.' });
    }

    logger.info(`[newsletterSubscribe] subscribed (source=${normalizedSource})`);
    return res.json({ success: true });
  }
);
