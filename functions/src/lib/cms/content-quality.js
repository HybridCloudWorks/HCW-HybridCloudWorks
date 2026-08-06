/**
 * Content quality, image readiness, and TL;DR shaping — pure scoring logic.
 *
 * Ported from Site-Main cms/core/content-quality.js, which its own header
 * describes as "logic that survives the Azure migration unchanged … at cutover
 * this file needs a CommonJS-to-ESM conversion and nothing else." That is what
 * this is: the conversion, plus the two internal `require`s re-pointed at the
 * modules already ported here (content-modules for the module/banned-phrase
 * primitives, publish-contracts for the per-type rubric).
 *
 * Nothing here touches Cosmos, the storage account, Key Vault, process.env, or
 * an HTTP request/response. `cheerio` is the only third-party import and is used
 * purely to strip HTML for a word count.
 */
import * as cheerio from 'cheerio';
import {
  validateModules,
  findBannedPhrases,
  scanBannedPhrases,
} from './content-modules.js';
import {
  getPublishContract,
  getContractBody,
  getMissingContractFields,
} from './publish-contracts.js';

export const MIN_ARTICLE_WORDS_FOR_PUBLISH = 650;
export const MIN_CONTENT_QUALITY_SCORE = 82;
export const MIN_IMAGE_QUALITY_SCORE = 78;
export const PLACEHOLDER_TLDR_TEXT = 'Add the final takeaway summary here.';

export function getHeadingMatch(line = '') {
  const match = String(line).match(/^(#{1,6})\s+(.+?)\s*$/);
  if (!match) return null;
  return { level: match[1].length, title: match[2].trim() };
}

export function moveTldrSectionToEnd(markdown = '') {
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

export function ensureTldrSectionAtEnd(markdown = '') {
  const source = String(markdown || '').trim();
  if (!source) return '';
  return moveTldrSectionToEnd(source);
}

export function normalizeContentBodyFields(data = {}) {
  const normalized = { ...data };
  ['Content', 'content', 'postContent', 'blogDraft'].forEach((key) => {
    if (typeof normalized[key] === 'string') {
      normalized[key] = ensureTldrSectionAtEnd(normalized[key]);
    }
  });
  return normalized;
}

export function getPrimaryContentBody(data = {}) {
  return String(data.postContent || data.blogDraft || data.content || data.Content || '').trim();
}

export function countWords(value = '') {
  const withoutModules = String(value || '').replace(
    /<module\s+type="[^"]+"(?:\s+align="[^"]*")?\s*>[\s\S]*?<\/module>/g,
    ' '
  );
  return cheerio.load(withoutModules, null, false).text().split(/\s+/).filter(Boolean).length;
}

export function countHeadings(markdown = '') {
  return String(markdown || '')
    .split('\n')
    .filter((line) => /^#{2,4}\s+\S/.test(line.trim())).length;
}

export function hasPlaceholderContent(markdown = '') {
  const source = String(markdown || '').toLowerCase();
  return (
    source.includes(PLACEHOLDER_TLDR_TEXT.toLowerCase()) ||
    source.includes('[insert ') ||
    source.includes('todo:') ||
    source.includes('lorem ipsum')
  );
}

export function computeContentQualityScore({
  wordCount,
  headingCount,
  moduleCount,
  bannedPhraseHits = [],
  placeholderContent = false,
  critique = null,
  // Defaults reproduce the blog rubric for callers that score without a
  // contract, so an unqualified call behaves exactly as it did before.
  rubric = { minWords: MIN_ARTICLE_WORDS_FOR_PUBLISH, minHeadings: 3, minModules: 2 },
}) {
  let score = 100;
  if (wordCount < rubric.minWords) score -= 20;
  if (rubric.minHeadings > 0 && headingCount < rubric.minHeadings) score -= 10;
  if (rubric.minModules > 0 && moduleCount < rubric.minModules) score -= 12;
  if (bannedPhraseHits.length > 0) score -= Math.min(24, bannedPhraseHits.length * 8);
  if (placeholderContent) score -= 30;
  if (critique?.genericityScore >= 7) score -= 18;
  if (critique?.specificityScore <= 3) score -= 18;
  if (critique?.verdict === 'revise') score -= 12;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function buildContentQualityReport(data = {}, critique = null, publishTarget = null) {
  const contract = getPublishContract(
    publishTarget || data.publishTarget || data.type || data.contentType
  );
  const { minWords, minHeadings, minModules } = contract.rubric;
  const content = getContractBody(data, contract) || getPrimaryContentBody(data);
  const moduleReport = validateModules(content);
  const deterministicBannedHits = [
    ...new Set([
      ...scanBannedPhrases(`${data.Title || data.title || ''}\n${content}`),
      ...findBannedPhrases(content),
    ]),
  ];
  const wordCount = countWords(content);
  const headingCount = countHeadings(content);
  const placeholderContent = hasPlaceholderContent(content);
  const issues = [];

  const missingFields = getMissingContractFields(data, contract);

  if (wordCount < minWords) {
    issues.push(`${contract.label} is too thin (${wordCount} words; minimum ${minWords}).`);
  }
  if (minHeadings > 0 && headingCount < minHeadings) {
    issues.push(
      `${contract.label} needs more structure (${headingCount} section headings found; minimum ${minHeadings}).`
    );
  }
  if (minModules > 0 && moduleReport.moduleCount < minModules) {
    issues.push(
      `${contract.label} needs at least ${minModules} inline modules; found ${moduleReport.moduleCount}.`
    );
  }
  missingFields.forEach((label) => {
    issues.push(`${contract.label} is missing ${label}.`);
  });
  if (!moduleReport.valid) {
    issues.push(...moduleReport.issues.map((issue) => `Module issue: ${issue}`));
  }
  if (deterministicBannedHits.length > 0) {
    issues.push(`Remove AI-sounding phrase(s): ${deterministicBannedHits.join(', ')}.`);
  }
  if (placeholderContent) {
    issues.push('Remove placeholder content before saving or publishing.');
  }
  if (critique?.issues?.length) {
    issues.push(...critique.issues.map((issue) => `Editorial critique: ${issue}`));
  }

  const score = computeContentQualityScore({
    wordCount,
    headingCount,
    moduleCount: moduleReport.moduleCount,
    bannedPhraseHits: deterministicBannedHits,
    placeholderContent,
    critique,
    rubric: contract.rubric,
  });

  return {
    score,
    publishTarget: contract.target,
    contractLabel: contract.label,
    missingFields,
    ready: score >= MIN_CONTENT_QUALITY_SCORE && issues.length === 0,
    threshold: MIN_CONTENT_QUALITY_SCORE,
    wordCount,
    headingCount,
    moduleCount: moduleReport.moduleCount,
    moduleIssues: moduleReport.issues,
    bannedPhraseHits: deterministicBannedHits,
    placeholderContent,
    critique: critique
      ? {
          verdict: critique.verdict || null,
          genericityScore: critique.genericityScore ?? null,
          specificityScore: critique.specificityScore ?? null,
          issues: Array.isArray(critique.issues) ? critique.issues : [],
          error: critique.error || null,
        }
      : null,
    issues: issues.slice(0, 12),
  };
}

export function buildImageReadinessReport(data = {}, publishTarget = null) {
  const contract = getPublishContract(
    publishTarget || data.publishTarget || data.type || data.contentType
  );
  const { requireHero, requirePromptLineage } = contract.imagery;
  const heroImageUrl = String(
    data.heroImageUrl || data.altCoverImage || data.contentImageUrl || data.imageUrl || ''
  ).trim();
  const secondaryImageUrls = Array.isArray(data.secondaryImageUrls)
    ? data.secondaryImageUrls.filter(Boolean)
    : [];
  const aiImageUrls =
    data.aiImageUrls && typeof data.aiImageUrls === 'object' ? data.aiImageUrls : {};
  const promptSummary = String(
    data.summaryPrompt || data.imagePromptSeed || data.imageLineage?.summaryPrompt || ''
  ).trim();
  const promptDetails = String(
    data.detailsPrompt || data.imagePromptDetails || data.imageLineage?.detailsPrompt || ''
  ).trim();
  const promptSet = String(
    data.imagePromptSet || data.promptSet || data.imageLineage?.promptSet || ''
  ).trim();
  const promptName = String(
    data.imagePromptName || data.promptName || data.imageLineage?.promptName || ''
  ).trim();
  const issues = [];

  if (requireHero && !heroImageUrl) issues.push('Hero image is required.');
  if (heroImageUrl && !heroImageUrl.startsWith('https://')) {
    issues.push('Hero image must use an https URL.');
  }
  if (requirePromptLineage && (!promptSummary || !promptDetails)) {
    issues.push('Image prompt summary and details are required for traceability.');
  }
  if (requirePromptLineage && (!promptSet || !promptName)) {
    issues.push('Image prompt set and prompt name should be recorded.');
  }

  let score = 100;
  if (requireHero) {
    if (!heroImageUrl) score -= 35;
    if (secondaryImageUrls.length === 0 && !aiImageUrls.secondary1) score -= 8;
    if (String(data.altText || data.imageAlt || '').trim().length < 12) score -= 7;
  }
  if (heroImageUrl && !heroImageUrl.startsWith('https://')) score -= 20;
  if (requirePromptLineage) {
    if (!promptSummary || !promptDetails) score -= 18;
    if (!promptSet || !promptName) score -= 12;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    ready: score >= MIN_IMAGE_QUALITY_SCORE && !issues.some((issue) => issue.includes('required')),
    threshold: MIN_IMAGE_QUALITY_SCORE,
    heroImageUrl,
    secondaryCount: secondaryImageUrls.length,
    aiSlots: Object.keys(aiImageUrls).filter((key) => aiImageUrls[key]),
    promptSet,
    promptName,
    issues,
  };
}

export function normalizeSlotTemplates(slotTemplates = {}) {
  const keys = ['hero', 'secondary1', 'secondary2', 'secondary3'];
  return keys.reduce((acc, key) => {
    const value = String(slotTemplates?.[key] || '').trim();
    if (value) acc[key] = value;
    return acc;
  }, {});
}

export function buildImageLineage(data = {}) {
  return {
    promptSet: String(data.imagePromptSet || data.promptSet || '').trim(),
    promptName: String(data.imagePromptName || data.promptName || '').trim(),
    promptTemplateVersion: String(data.promptTemplateVersion || '').trim() || 'manual-create-v1',
    summaryPrompt: String(data.summaryPrompt || data.imagePromptSeed || '').trim(),
    detailsPrompt: String(data.detailsPrompt || data.imagePromptDetails || '').trim(),
    slotTemplates:
      data.slotTemplates && typeof data.slotTemplates === 'object'
        ? normalizeSlotTemplates(data.slotTemplates)
        : {},
  };
}
