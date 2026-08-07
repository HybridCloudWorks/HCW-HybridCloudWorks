import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Upload, Loader2, CheckCircle, AlertCircle, Sparkles, Link2, X } from 'lucide-react';
import { postJSON, getJSON } from '@/lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getPublishTargetForType, getPublicSectionForTarget } from '@/lib/contentModel';
import { ensureTldrSectionAtEnd } from '@/lib/contentDraft';
import { useImagePrompts } from '@/hooks/useImagePrompts';
import {
  PROVIDER_OPTIONS_WITH_AUTO as PROVIDER_OPTIONS,
  BLOG_LANDING_ZONE_OPTIONS,
  ADMIN_ROUTES,
} from '@/config/admin';

const DEFAULT_DRAFT_INSTRUCTION_PROMPT =
  'You are generating a high-quality technical draft article for Hybrid Cloud Works. Use the source URL as the primary source. If supporting documents are provided, incorporate them as additional context. Produce a publication-ready title, concise editorial summary, a structured markdown article draft around 2500-3200 words, and image prompts tailored to the article.';

const _MAX_STAGE_TWO_SUPPORTING_FILES = 5;
const MAX_STAGE_TWO_FILE_BYTES = 4 * 1024 * 1024;
const MAX_STAGE_TWO_SUPPORTING_SOURCES = 5;

const CONTENT_TYPE_OPTIONS = [
  { value: 'blog', label: 'Blog' },
  { value: 'framework', label: 'Framework' },
  { value: 'architecture', label: 'Architecture' },
  { value: 'coder_corner', label: 'Coder Corner' },
];

const IMAGE_SLOTS = [
  { key: 'hero', label: 'Hero Image' },
  { key: 'secondary1', label: 'Secondary Image 1' },
  { key: 'secondary2', label: 'Secondary Image 2' },
  { key: 'secondary3', label: 'Secondary Image 3' },
];

const EMPTY_SLOT_TEMPLATES = {
  hero: '',
  secondary1: '',
  secondary2: '',
  secondary3: '',
};

const SECTION_BLOCKS_BY_TYPE = {
  blog: [
    {
      key: 'overview',
      title: 'Overview',
      heading: '## Overview',
      template:
        '## Overview\n\nExplain the business context, current pain point, and why this matters now.\n',
      required: true,
    },
    {
      key: 'architecture',
      title: 'Architecture Approach',
      heading: '## Architecture Approach',
      template:
        '## Architecture Approach\n\nDescribe the high-level architecture, major components, and data flow.\n',
      required: true,
    },
    {
      key: 'implementation',
      title: 'Implementation Steps',
      heading: '## Implementation Steps',
      template: '## Implementation Steps\n\n1. Step one\n2. Step two\n3. Step three\n',
      required: true,
    },
    {
      key: 'ops',
      title: 'Operations and Risk',
      heading: '## Operations and Risk',
      template:
        '## Operations and Risk\n\nCall out observability, cost impact, security, and rollout risks.\n',
      required: false,
    },
    {
      key: 'next-steps',
      title: 'Next Steps',
      heading: '## Next Steps',
      template: '## Next Steps\n\nSummarize recommended actions and what teams should do next.\n',
      required: false,
    },
  ],
  framework: [
    {
      key: 'problem',
      title: 'Problem Statement',
      heading: '## Problem Statement',
      template:
        '## Problem Statement\n\nDescribe the challenge this framework addresses and expected outcomes.\n',
      required: true,
    },
    {
      key: 'principles',
      title: 'Guiding Principles',
      heading: '## Guiding Principles',
      template:
        '## Guiding Principles\n\nList the principles, guardrails, and design constraints.\n',
      required: true,
    },
    {
      key: 'framework-model',
      title: 'Framework Model',
      heading: '## Framework Model',
      template:
        '## Framework Model\n\nDefine phases, domains, or pillars and how teams apply them.\n',
      required: true,
    },
    {
      key: 'implementation-roadmap',
      title: 'Implementation Roadmap',
      heading: '## Implementation Roadmap',
      template:
        '## Implementation Roadmap\n\nDescribe rollout stages, ownership, and milestones.\n',
      required: false,
    },
    {
      key: 'measurement',
      title: 'Measurement and Governance',
      heading: '## Measurement and Governance',
      template:
        '## Measurement and Governance\n\nDefine KPIs, review cadence, and governance checkpoints.\n',
      required: false,
    },
  ],
  architecture: [
    {
      key: 'context',
      title: 'Context and Requirements',
      heading: '## Context and Requirements',
      template:
        '## Context and Requirements\n\nCapture business goals, technical constraints, and non-functional requirements.\n',
      required: true,
    },
    {
      key: 'system-design',
      title: 'System Design',
      heading: '## System Design',
      template:
        '## System Design\n\nDescribe the architecture, key services, boundaries, and data flow.\n',
      required: true,
    },
    {
      key: 'deployment',
      title: 'Deployment and Operations',
      heading: '## Deployment and Operations',
      template:
        '## Deployment and Operations\n\nExplain deployment model, observability, resilience, and operations runbook.\n',
      required: true,
    },
    {
      key: 'security',
      title: 'Security and Compliance',
      heading: '## Security and Compliance',
      template:
        '## Security and Compliance\n\nDocument threat model, controls, and compliance considerations.\n',
      required: false,
    },
    {
      key: 'trade-offs',
      title: 'Trade-offs and Decisions',
      heading: '## Trade-offs and Decisions',
      template:
        '## Trade-offs and Decisions\n\nCall out key decisions, trade-offs, and alternatives considered.\n',
      required: false,
    },
  ],
  coder_corner: [
    {
      key: 'problem',
      title: 'Problem and Use Case',
      heading: '## Problem and Use Case',
      template:
        '## Problem and Use Case\n\nDescribe the developer problem, expected audience, and when this pattern should be used.\n',
      required: true,
    },
    {
      key: 'solution',
      title: 'Solution Overview',
      heading: '## Solution Overview',
      template:
        '## Solution Overview\n\nExplain the approach, key components, and why this solution is effective.\n',
      required: true,
    },
    {
      key: 'implementation',
      title: 'Implementation Walkthrough',
      heading: '## Implementation Walkthrough',
      template:
        '## Implementation Walkthrough\n\n1. Set up prerequisites\n2. Implement the core logic\n3. Validate the outcome\n',
      required: true,
    },
    {
      key: 'code-notes',
      title: 'Code Notes',
      heading: '## Code Notes',
      template:
        '## Code Notes\n\nCall out the most important code paths, trade-offs, and extension points.\n',
      required: false,
    },
    {
      key: 'testing',
      title: 'Testing and Next Steps',
      heading: '## Testing and Next Steps',
      template:
        '## Testing and Next Steps\n\nDescribe validation steps, known gaps, and logical next improvements.\n',
      required: false,
    },
  ],
};

const EMPTY_SLOT_FILES = {
  hero: null,
  secondary1: null,
  secondary2: null,
  secondary3: null,
};

const EMPTY_SLOT_URLS = {
  hero: '',
  secondary1: '',
  secondary2: '',
  secondary3: '',
};

const EMPTY_SLOT_IDS = {
  hero: '',
  secondary1: '',
  secondary2: '',
  secondary3: '',
};

const BUILDER_SESSION_STORAGE_KEY = 'hcw-publish-ready-builder-draft';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function readBuilderSnapshot() {
  try {
    const raw = window.sessionStorage.getItem(BUILDER_SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function applyPrimaryBuilderSnapshot(saved, setters) {
  const {
    provider = '',
    blogLandingProvider = '',
    contentType = 'blog',
    title = '',
    publishedDate = '',
    sourceUrl = '',
    kbArticleUrls = [],
    kbDocumentUrl = '',
    kbDocumentUrls = [],
    draftInstructionPrompt = DEFAULT_DRAFT_INSTRUCTION_PROMPT,
    frameworkSourceUrls = '',
    frameworkKnowledgePrompt = '',
    frameworkDiagramPrompt = '',
    frameworkImagePrompt = '',
    frameworkConceptSeeds = '',
  } = saved;

  setters.setProvider(provider);
  setters.setBlogLandingProvider(blogLandingProvider);
  setters.setContentType(contentType);
  setters.setTitle(title);
  setters.setPublishedDate(publishedDate);
  setters.setSourceUrl(sourceUrl);
  setters.setKbArticleUrls(toArray(kbArticleUrls));
  setters.setKbDocumentUrl(kbDocumentUrl);
  setters.setKbDocumentUrls(toArray(kbDocumentUrls));
  setters.setDraftInstructionPrompt(draftInstructionPrompt);
  setters.setFrameworkSourceUrls(frameworkSourceUrls);
  setters.setFrameworkKnowledgePrompt(frameworkKnowledgePrompt);
  setters.setFrameworkDiagramPrompt(frameworkDiagramPrompt);
  setters.setFrameworkImagePrompt(frameworkImagePrompt);
  setters.setFrameworkConceptSeeds(frameworkConceptSeeds);
}

function applyDraftBuilderSnapshot(saved, setters) {
  const {
    draftTitle = '',
    draftSummary = '',
    draftContent = '',
    draftTopics = [],
    draftReady = false,
    summaryPrompt = '',
    detailsPrompt = '',
  } = saved;

  setters.setDraftTitle(draftTitle);
  setters.setDraftSummary(draftSummary);
  setters.setDraftContent(ensureTldrSectionAtEnd(draftContent));
  setters.setDraftTopics(toArray(draftTopics));
  setters.setDraftReady(Boolean(draftReady));
  setters.setSummaryPrompt(summaryPrompt);
  setters.setDetailsPrompt(detailsPrompt);
}

function applyImageBuilderSnapshot(saved, setters) {
  const {
    generatedImages = {},
    generatedImageIds = {},
    selectedUploaded = {},
    selectedGenerated = {},
    aiTargets = {},
    slotUrls = {},
  } = saved;

  setters.setGeneratedImages({ ...EMPTY_SLOT_URLS, ...generatedImages });
  setters.setGeneratedImageIds({ ...EMPTY_SLOT_IDS, ...generatedImageIds });
  setters.setSelectedUploaded((prev) => ({ ...prev, ...selectedUploaded }));
  setters.setSelectedGenerated((prev) => ({ ...prev, ...selectedGenerated }));
  setters.setAiTargets((prev) => ({ ...prev, ...aiTargets }));
  setters.setSlotUrls({ ...EMPTY_SLOT_URLS, ...slotUrls });
}

function applyBuilderSnapshot(saved, setters) {
  applyPrimaryBuilderSnapshot(saved, setters);
  applyDraftBuilderSnapshot(saved, setters);
  applyImageBuilderSnapshot(saved, setters);
}

function _hasSelectedImage(urlsBySlot, selectedBySlot) {
  return Object.entries(urlsBySlot).some(
    ([slot, url]) => Boolean(url) && Boolean(selectedBySlot[slot])
  );
}

function canGenerateDraftImages(summaryPrompt, detailsPrompt, draftReady) {
  return summaryPrompt.trim().length > 0 && detailsPrompt.trim().length > 0 && draftReady;
}

function slugifyTitle(value = '') {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function inferProviderFromUrl(url = '') {
  const normalized = String(url).toLowerCase();
  if (normalized.includes('azure') || normalized.includes('microsoft')) return 'Azure';
  if (normalized.includes('aws') || normalized.includes('amazon')) return 'Aws';
  if (
    normalized.includes('gcp') ||
    normalized.includes('google') ||
    normalized.includes('cloud.google')
  )
    return 'Gcp';
  if (normalized.includes('github')) return 'Github';
  if (normalized.includes('terraform')) return 'Terraform';
  if (normalized.includes('finops')) return 'Finops';
  return '';
}

function isValidHttpUrl(value = '') {
  try {
    const parsed = new URL(String(value).trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSupportedDocumentUrl(value = '') {
  if (!isValidHttpUrl(value)) return false;
  const normalized = String(value).trim().toLowerCase();
  return /\.pdf($|[?#])/.test(normalized) || /\.txt($|[?#])/.test(normalized);
}

function parseLineItems(value = '') {
  return String(value)
    .split(/\n|,|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectSelectedSlotImages({
  slotUrls,
  selectedUploaded,
  generatedImages,
  selectedGenerated,
}) {
  return IMAGE_SLOTS.map(({ key, label }) => {
    const uploadedUrl = selectedUploaded[key] ? slotUrls[key] : '';
    const generatedUrl = selectedGenerated[key] ? generatedImages[key] : '';
    const selectedUrl = uploadedUrl || generatedUrl || '';

    return {
      slot: key,
      label,
      url: selectedUrl,
      source: getImageSourceLabel(uploadedUrl, generatedUrl),
    };
  }).filter((item) => Boolean(item.url));
}

function getImageSourceLabel(uploadedUrl, generatedUrl) {
  if (uploadedUrl) return 'uploaded';
  if (generatedUrl) return 'generated';
  return '';
}

function renderGalleryContent({ galleryLoading, galleryItems, deleteGalleryItem }) {
  if (galleryLoading) {
    return <p className="text-xs text-muted-foreground">Loading saved gallery items...</p>;
  }

  if (galleryItems.length > 0) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {galleryItems.map((item) => (
          <div key={item.id} className="rounded-md border border-border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="secondary" className="text-[10px]">
                {item.slot || 'preview'}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => deleteGalleryItem(item)}
                aria-label={`Delete saved ${item.slot || 'preview'} image`}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <a href={item.imageUrl} target="_blank" rel="noreferrer">
              <img
                src={item.imageUrl}
                alt={item.slot || 'Saved gallery image'}
                className="h-32 w-full rounded object-cover"
              />
            </a>
            <p className="text-[11px] text-muted-foreground truncate">{item.imageUrl}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      Generate images to save them here for inline review and deletion.
    </p>
  );
}

function buildPreviewImageSelection({
  slotUrls,
  selectedUploaded,
  generatedImages,
  selectedGenerated,
}) {
  const selectedImages = collectSelectedSlotImages({
    slotUrls,
    selectedUploaded,
    generatedImages,
    selectedGenerated,
  });

  const heroImageUrl = selectedImages[0]?.url || '';
  const secondaryImageUrls = selectedImages.slice(1).map((item) => item.url);
  const aiImageUrls = Object.fromEntries(
    selectedImages
      .filter((item) => item.source === 'generated')
      .map((item) => [item.slot, item.url])
  );

  return { heroImageUrl, secondaryImageUrls, aiImageUrls, selectedImages };
}

function buildContentCreatePayload({
  sourceUrl,
  sourceUrls,
  provider,
  blogLandingProvider,
  draftTitle,
  title,
  draftSummary,
  draftContent,
  draftTopics,
  summaryPrompt,
  detailsPrompt,
  publishedDate,
  heroImageUrl,
  secondaryImageUrls,
  aiImageUrls,
  contentType,
  frameworkSourceUrls,
  frameworkKnowledgePrompt,
  frameworkDiagramPrompt,
  frameworkImagePrompt,
  frameworkConceptSeeds,
}) {
  const normalizedContent = ensureTldrSectionAtEnd(draftContent || '');
  const parsedFrameworkSources = parseLineItems(frameworkSourceUrls).filter((url) =>
    isValidHttpUrl(url)
  );
  const parsedConceptSeeds = parseLineItems(frameworkConceptSeeds);
  const publishTarget = getPublishTargetForType(contentType);

  return {
    url: sourceUrl.trim(),
    sourceUrl: sourceUrl.trim(),
    kbArticleUrls: Array.isArray(sourceUrls) ? sourceUrls : [],
    'CD Url': sourceUrl.trim(),
    source: 'manual_url',
    contentStatus: 'inspected',
    inspectTrigger: false,
    storageCollection: 'content',
    type: contentType,
    publishTarget,
    cloudProvider: provider || null,
    ...(provider && { 'Cloud Provider': provider }),
    ...(blogLandingProvider && {
      landingProvider: blogLandingProvider,
      targetLandingZone: `/${blogLandingProvider.toLowerCase()}/${getPublicSectionForTarget(publishTarget)}`,
    }),
    Title: draftTitle || title || '',
    title: draftTitle || title || '',
    Summary: draftSummary || '',
    summary: draftSummary || '',
    Content: normalizedContent,
    content: normalizedContent,
    postContent: normalizedContent,
    keyTopics: draftTopics,
    imagePromptSeed: summaryPrompt,
    imagePromptDetails: detailsPrompt,
    summaryPrompt,
    detailsPrompt,
    ...(publishedDate && { 'Published At': new Date(publishedDate) }),
    ...(heroImageUrl && {
      heroImageUrl,
      contentImageUrl: heroImageUrl,
      altCoverImage: heroImageUrl,
    }),
    ...(secondaryImageUrls.length > 0 && { secondaryImageUrls }),
    aiImageUrls,
    ...(contentType === 'framework' && {
      frameworkSourceUrls: parsedFrameworkSources,
      officialSources: parsedFrameworkSources,
      frameworkKnowledgePrompt: frameworkKnowledgePrompt.trim(),
      frameworkDiagramPrompt: frameworkDiagramPrompt.trim(),
      frameworkImagePrompt: frameworkImagePrompt.trim(),
      frameworkConceptSeeds: parsedConceptSeeds,
    }),
    Live: false,
    approvedForBlog: false,
  };
}

function getResolvedProvider(provider, inferredProvider) {
  return provider || inferredProvider || '';
}

function getResolvedBlogLandingProvider(contentType, blogLandingProvider, resolvedProvider) {
  if (contentType !== 'blog') return resolvedProvider;
  return blogLandingProvider || resolvedProvider;
}

function getPreviewSection(contentType) {
  if (contentType === 'framework') return 'frameworks';
  if (contentType === 'architecture') return 'architecture-designs';
  if (contentType === 'coder_corner') return 'code';
  return 'blog';
}

function getPromptLibraryPagePath(contentType, providerSegment) {
  const normalizedProvider = String(providerSegment || '')
    .trim()
    .toLowerCase();
  if (!normalizedProvider) return '';

  if (contentType === 'framework') return `/${normalizedProvider}/frameworks`;
  if (contentType === 'architecture') return `/${normalizedProvider}/architecture-designs`;
  if (contentType === 'coder_corner') return `/${normalizedProvider}/code`;
  return `/${normalizedProvider}/blog`;
}

function getCurrentStep({
  hasSourceUrls,
  draftReady,
  hasUploadedImages,
  hasSelectedGeneratedImages,
}) {
  if (!hasSourceUrls) return 1;
  if (!draftReady) return 2;
  if (!hasUploadedImages && !hasSelectedGeneratedImages) return 3;
  return 4;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64Data = result.includes(',') ? result.split(',').pop() : result;
      resolve(base64Data || '');
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function getQueueReviewPath(contentId) {
  return `${ADMIN_ROUTES.REVIEW.replace(':id', contentId)}?source=content`;
}

function getEditorPath(contentId) {
  return ADMIN_ROUTES.EDITOR.replace(':id', contentId);
}

function formatSaveLabel(contentType) {
  return `${getPublishTargetLabel(contentType)} Draft`;
}

function getPublishTargetLabel(contentType) {
  switch (contentType) {
    case 'framework':
      return 'Framework';
    case 'architecture':
      return 'Architecture';
    case 'coder_corner':
      return 'Coder Corner';
    case 'blog':
    default:
      return 'Blog';
  }
}

function buildReadinessChecks({
  sourceUrl,
  contentType,
  frameworkSourceUrls,
  resolvedProvider,
  resolvedBlogLandingProvider,
  inferredProvider,
  previewSlug,
  previewPath,
  draftTitle,
  title,
  draftSummary,
  draftContent,
  hasHeroSelected,
  sectionBlocks,
}) {
  const normalizedContent = draftContent.trim();
  const presentHeadings = sectionBlocks.map((section) => ({
    ...section,
    present: normalizedContent.includes(section.heading),
  }));
  const requiredSectionsComplete = presentHeadings
    .filter((section) => section.required)
    .every((section) => section.present);

  return [
    {
      key: 'url',
      label: 'Valid source URL',
      done: isValidHttpUrl(sourceUrl),
      hint: 'Paste a full http(s) URL before generating draft content.',
    },
    {
      key: 'framework-sources',
      label: 'Framework source URLs captured',
      done:
        contentType !== 'framework' ||
        parseLineItems(frameworkSourceUrls).filter((url) => isValidHttpUrl(url)).length > 0,
      hint:
        contentType !== 'framework'
          ? 'Not required for non-framework content types.'
          : 'Provide one or more official documentation URLs (one per line).',
    },
    {
      key: 'provider',
      label: 'Cloud provider selected',
      done: Boolean(resolvedProvider),
      hint: inferredProvider
        ? `Detected provider from URL: ${inferredProvider}.`
        : 'Select provider manually or keep auto-detect if unsure.',
    },
    {
      key: 'landing-zone',
      label: 'Blog landing zone selected',
      done: contentType !== 'blog' || Boolean(resolvedBlogLandingProvider),
      hint:
        contentType !== 'blog'
          ? 'Not required for non-blog content types.'
          : `Target landing zone: /${(resolvedBlogLandingProvider || 'provider').toLowerCase()}/blog`,
    },
    {
      key: 'slug',
      label: 'Publication slug ready',
      done: previewSlug.length >= 8,
      hint: previewSlug ? previewPath : 'Add/adjust title to generate a clean slug.',
    },
    {
      key: 'title',
      label: 'Publishable title',
      done: (draftTitle || title).trim().length >= 12,
      hint: 'Aim for a descriptive title (12+ characters).',
    },
    {
      key: 'summary',
      label: 'Summary complete',
      done: draftSummary.trim().length >= 80,
      hint: 'Write a summary that clearly explains value and outcome.',
    },
    {
      key: 'content',
      label: 'Content body complete',
      done: normalizedContent.length >= 700,
      hint: 'Content should be substantial and publication-ready.',
    },
    {
      key: 'schema-sections',
      label: 'Required section blocks present',
      done: requiredSectionsComplete,
      hint:
        presentHeadings
          .filter((section) => section.required && !section.present)
          .map((section) => section.title)
          .join(', ') || 'All required sections are present.',
    },
    {
      key: 'hero',
      label: 'At least one image selected',
      done: hasHeroSelected,
      hint: 'Select one or more uploaded or AI-generated images to include in the draft.',
    },
  ];
}

function WorkflowHeader({ currentStep, readinessComplete, readinessScore, readinessTotal }) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Publish-Ready Builder</h1>
      <p className="text-muted-foreground">
        Guided workflow: Options → Draft → Images → Final QA and publish-style preview.
      </p>
      <div className="flex flex-wrap gap-2 mt-3">
        {[1, 2, 3, 4].map((step) => (
          <Badge key={step} variant={currentStep >= step ? 'default' : 'outline'}>
            Step {step}
          </Badge>
        ))}
        <Badge variant={readinessComplete ? 'default' : 'outline'}>
          Readiness {readinessScore}/{readinessTotal}
        </Badge>
      </div>
    </div>
  );
}

function SelectionSummaryCard({
  provider,
  inferredProvider,
  contentType,
  resolvedBlogLandingProvider,
  publishedDate,
}) {
  const resolvedProvider = provider || inferredProvider || 'Auto-detect';
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-sm">Current Builder Selections</CardTitle>
        <CardDescription>These values carry into draft, images, and final save.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Badge variant="outline">Provider: {resolvedProvider}</Badge>
        <Badge variant="outline">Type: {getPublishTargetLabel(contentType)}</Badge>
        <Badge variant="outline">Target: {getPublishTargetLabel(contentType)}</Badge>
        {contentType === 'blog' && (
          <Badge variant="outline">
            Landing: {resolvedBlogLandingProvider || 'Match provider'}
          </Badge>
        )}
        {publishedDate && <Badge variant="outline">Date: {publishedDate}</Badge>}
      </CardContent>
    </Card>
  );
}

function StageOneCard({
  provider,
  setProvider,
  inferredProvider,
  hasProviderMismatch,
  contentType,
  setContentType,
  blogLandingProvider,
  setBlogLandingProvider,
  resolvedBlogLandingProvider,
  title,
  setTitle,
  publishedDate,
  setPublishedDate,
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stage 1: Global Options</CardTitle>
        <CardDescription>Set content metadata and ingestion defaults.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Cloud Provider</Label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {PROVIDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {inferredProvider && !provider && (
            <p className="text-xs text-muted-foreground mt-1">
              Auto-detected from URL: {inferredProvider}
            </p>
          )}
          {hasProviderMismatch && (
            <p className="text-xs text-destructive mt-1">
              Selected provider differs from URL signal ({inferredProvider}).
            </p>
          )}
        </div>

        <div>
          <Label className="text-xs">Content Type</Label>
          <select
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
            className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {CONTENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label className="text-xs">Publish Target</Label>
          <Input value={`${getPublishTargetLabel(contentType)} (locked)`} disabled />
        </div>

        <div>
          <Label className="text-xs">Blog Landing Zone</Label>
          <select
            value={blogLandingProvider}
            onChange={(e) => setBlogLandingProvider(e.target.value)}
            disabled={contentType !== 'blog'}
            className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
          >
            {BLOG_LANDING_ZONE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            {contentType === 'blog'
              ? `Subpage destination: /${(resolvedBlogLandingProvider || 'provider').toLowerCase()}/blog`
              : 'Landing zone applies to blog content only.'}
          </p>
        </div>

        <div>
          <Label className="text-xs">Title (optional prefill)</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Optional title seed"
          />
        </div>

        <div>
          <Label className="text-xs">Published Date</Label>
          <Input
            value={publishedDate}
            onChange={(e) => setPublishedDate(e.target.value)}
            type="date"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function StageTwoCard({
  contentType,
  draftInstructionPrompt,
  setDraftInstructionPrompt,
  supportingDocuments,
  handleSupportingDocumentUpload,
  removeSupportingDocument,
  kbDocumentUrl,
  setKbDocumentUrl,
  kbDocumentUrls,
  addKbDocumentUrl,
  removeKbDocumentUrl,
  sourceUrl,
  setSourceUrl,
  kbArticleUrls,
  addKbArticleUrl,
  removeKbArticleUrl,
  handleSubmitDraft,
  submittingDraft,
  draftReady,
  frameworkSourceUrls,
  setFrameworkSourceUrls,
  frameworkKnowledgePrompt,
  setFrameworkKnowledgePrompt,
  frameworkDiagramPrompt,
  setFrameworkDiagramPrompt,
  frameworkImagePrompt,
  setFrameworkImagePrompt,
  frameworkConceptSeeds,
  setFrameworkConceptSeeds,
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stage 2: URL Submission</CardTitle>
        <CardDescription>
          Combine a source URL, optional supporting files, and an editable instruction prompt to
          generate a more tailored in-memory draft.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border p-3 space-y-3">
          {contentType === 'framework' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2 md:col-span-2">
                <Label className="text-xs">Official Framework Source URLs</Label>
                <Textarea
                  value={frameworkSourceUrls}
                  onChange={(e) => setFrameworkSourceUrls(e.target.value)}
                  placeholder="https://learn.microsoft.com/...&#10;https://docs.aws.amazon.com/..."
                  className="min-h-25 text-xs font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Firecrawl/AI ingestion metadata source list. One URL per line.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Knowledge Prompt</Label>
                <Textarea
                  value={frameworkKnowledgePrompt}
                  onChange={(e) => setFrameworkKnowledgePrompt(e.target.value)}
                  placeholder="Extract principles, controls, implementation guidance, and measurable outcomes."
                  className="min-h-22.5 text-xs"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Diagram Prompt</Label>
                <Textarea
                  value={frameworkDiagramPrompt}
                  onChange={(e) => setFrameworkDiagramPrompt(e.target.value)}
                  placeholder="Generate node relationships for an interactive framework map."
                  className="min-h-22.5 text-xs"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Image Prompt</Label>
                <Textarea
                  value={frameworkImagePrompt}
                  onChange={(e) => setFrameworkImagePrompt(e.target.value)}
                  placeholder="Visual style prompt for framework hero/diagram imagery."
                  className="min-h-20 text-xs"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Concept Seeds</Label>
                <Textarea
                  value={frameworkConceptSeeds}
                  onChange={(e) => setFrameworkConceptSeeds(e.target.value)}
                  placeholder="Security posture&#10;Reliability guardrails&#10;Cost governance"
                  className="min-h-20 text-xs"
                />
              </div>
            </div>
          )}

          <div
            className={contentType === 'framework' ? 'pt-2 border-t border-border space-y-3' : ''}
          >
            <div className="space-y-2">
              <Label className="text-xs">Optional Tailoring Prompt</Label>
              <Textarea
                value={draftInstructionPrompt}
                onChange={(e) => setDraftInstructionPrompt(e.target.value)}
                placeholder="Adjust how the AI should generate the draft."
                className="min-h-30 text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Prefilled with the current Stage 2 draft-generation prompt. Edit it to steer the
                generated title, summary, content, and image prompts.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">
                Supporting Documents Upload (PDF or TXT, combined total up to 5)
              </Label>
              <Input
                type="file"
                accept=".pdf,.txt,text/plain,application/pdf"
                multiple
                onChange={handleSupportingDocumentUpload}
              />
              <p className="text-xs text-muted-foreground">
                Local files stay in memory for this builder session and are sent with the URL on
                submit. Use this as the backup path for private or non-hosted files.
              </p>
            </div>

            {supportingDocuments.length > 0 && (
              <div className="space-y-2 rounded-md border border-border/70 p-3">
                <Label className="text-xs">Files in Memory</Label>
                <div className="space-y-2">
                  {supportingDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{doc.name}</p>
                        <p className="text-muted-foreground">
                          {doc.kind.toUpperCase()} · {Math.max(1, Math.round(doc.size / 1024))} KB
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        onClick={() => removeSupportingDocument(doc.id)}
                        aria-label={`Remove ${doc.name}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2 rounded-md border border-border/70 p-3">
              <Label className="text-xs">KB Document URLs</Label>
              <div className="flex flex-col lg:flex-row gap-2">
                <Input
                  value={kbDocumentUrl}
                  onChange={(e) => setKbDocumentUrl(e.target.value)}
                  placeholder="https://.../reference.pdf"
                  type="url"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addKbDocumentUrl}
                  disabled={!isSupportedDocumentUrl(kbDocumentUrl)}
                  className="gap-1"
                >
                  <Link2 className="h-4 w-4" />
                  Add Document URL
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Public PDF/TXT URLs are fetched server-side at submit time. Use this for hosted
                documents larger than the local upload limit.
              </p>
              {kbDocumentUrls.length > 0 && (
                <div className="space-y-2">
                  {kbDocumentUrls.map((url) => (
                    <div
                      key={url}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-xs"
                    >
                      <p className="min-w-0 truncate font-medium">{url}</p>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        onClick={() => removeKbDocumentUrl(url)}
                        aria-label={`Remove ${url}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-border space-y-3">
            <Label className="text-xs">Article URL</Label>
            <div className="flex flex-col lg:flex-row gap-2">
              <Input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://..."
                type="url"
              />
              <Button
                type="button"
                variant="outline"
                onClick={addKbArticleUrl}
                disabled={!sourceUrl.trim().startsWith('http')}
                className="gap-1"
              >
                <Link2 className="h-4 w-4" />
                Add URL
              </Button>
              <Button
                type="button"
                onClick={handleSubmitDraft}
                disabled={
                  submittingDraft ||
                  (kbArticleUrls.length === 0 && !sourceUrl.trim().startsWith('http'))
                }
                className="gap-1"
              >
                {submittingDraft ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                {draftReady ? 'Regenerate' : 'Submit'}
              </Button>
            </div>
            {kbArticleUrls.length > 0 && (
              <div className="space-y-2 rounded-md border border-border/70 p-3">
                <Label className="text-xs">KB Articles</Label>
                <div className="space-y-2">
                  {kbArticleUrls.map((url) => (
                    <div
                      key={url}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-xs"
                    >
                      <p className="min-w-0 truncate font-medium">{url}</p>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        onClick={() => removeKbArticleUrl(url)}
                        aria-label={`Remove ${url}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Submit generates AI title, summary, content draft (~3000 words target), and both
              prompts in memory using the added KB articles and optional supporting documents. Use
              it again any time to regenerate with updated URLs, KB articles, files, or prompt.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StageThreeCard({
  slotFiles,
  setSlotFiles,
  uploadSlotImage,
  uploadingSlot,
  slotUrls,
  selectedUploaded,
  setSelectedUploaded,
  aiTargets,
  setAiTargets,
  promptSets,
  promptNames,
  selectedPromptSet,
  selectedPromptName,
  handleSelectPromptSet,
  handleSelectPromptName,
  promptLibraryLoading,
  promptLibraryStatus,
  promptLibraryError,
  summaryPrompt,
  setSummaryPrompt,
  detailsPrompt,
  setDetailsPrompt,
  draftReady,
  handleGenerateImages,
  canGenerateImages,
  generatingImages,
  generationStatus,
  generationError,
  selectedAiTargets,
  generatedSlots,
  selectedGenerated,
  setSelectedGenerated,
  generatedImages,
  removeGeneratedImage,
  generationPromptLogs,
  galleryItems,
  galleryLoading,
  galleryRefreshing,
  refreshGalleryItems,
  deleteGalleryItem,
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stage 3: Image Generation</CardTitle>
        <CardDescription>
          Upload images and/or generate AI images. Preview generations are saved to the AI Image
          Gallery automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3 rounded-lg border border-border p-3 bg-card/40">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Upload className="h-4 w-4" /> Upload Images
            </h3>
            {IMAGE_SLOTS.map(({ key, label }) => (
              <div key={key} className="space-y-2">
                <Label className="text-xs">{label}</Label>
                <div className="flex gap-2">
                  <Input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={(e) => {
                      const nextFile = e.target.files?.[0] || null;
                      setSlotFiles((prev) => ({ ...prev, [key]: nextFile }));
                      if (nextFile) {
                        uploadSlotImage(key, nextFile);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => uploadSlotImage(key)}
                    disabled={!slotFiles[key] || uploadingSlot === key}
                  >
                    {uploadingSlot === key ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {slotUrls[key] && (
                  <div className="rounded-md border border-border px-2 py-1">
                    <label className="text-xs flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedUploaded[key]}
                        onChange={(e) =>
                          setSelectedUploaded((prev) => ({ ...prev, [key]: e.target.checked }))
                        }
                      />
                      <a
                        href={slotUrls[key]}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline truncate"
                      >
                        {label} uploaded (select to include)
                      </a>
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-3 rounded-lg border border-border p-3 bg-card/40">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> AI Image Creation
            </h3>

            <div>
              <Label className="text-xs">Image Targets</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {IMAGE_SLOTS.map(({ key, label }) => (
                  <label key={key} className="text-xs flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={aiTargets[key]}
                      onChange={(e) =>
                        setAiTargets((prev) => ({ ...prev, [key]: e.target.checked }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs">Prompt Library</Label>
              <div className="grid grid-cols-1 gap-2 mt-1">
                <select
                  value={selectedPromptSet}
                  onChange={(e) => handleSelectPromptSet(e.target.value)}
                  disabled={promptLibraryLoading}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select Prompt Set...</option>
                  {promptSets.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedPromptName}
                  onChange={(e) => handleSelectPromptName(e.target.value)}
                  disabled={promptLibraryLoading || !selectedPromptSet}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select Prompt Name...</option>
                  {promptNames.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {promptLibraryLoading
                  ? 'Loading prompt library...'
                  : promptLibraryStatus ||
                    'Select a saved Prompt Set and Prompt Name for this page.'}
              </p>
              {promptLibraryError && (
                <p className="mt-1 text-[11px] text-destructive">{promptLibraryError}</p>
              )}
            </div>

            <div>
              <Label className="text-xs">Summary Prompt</Label>
              <Textarea
                value={summaryPrompt}
                onChange={(e) => setSummaryPrompt(e.target.value)}
                placeholder="Define environment, scenario, and overall theme..."
                rows={3}
                disabled={!draftReady}
              />
            </div>

            <div>
              <Label className="text-xs">Details Prompt</Label>
              <Textarea
                value={detailsPrompt}
                onChange={(e) => setDetailsPrompt(e.target.value)}
                placeholder="Detailed visual specifics for this article..."
                rows={3}
                disabled={!draftReady}
              />
            </div>

            <Button
              type="button"
              onClick={handleGenerateImages}
              disabled={!canGenerateImages || generatingImages || selectedAiTargets.length === 0}
              className="gap-1"
            >
              {generatingImages ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate
            </Button>
            {(generationStatus || generationError) && (
              <div className="rounded-md border border-border px-3 py-2 text-xs space-y-1">
                {generationStatus && <p>{generationStatus}</p>}
                {generationError && <p className="text-destructive">{generationError}</p>}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <h4 className="text-sm font-semibold">Newly Created Images</h4>

          {generatedSlots.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Generated image links appear here after clicking Generate.
            </p>
          ) : (
            <div className="space-y-2">
              {generatedSlots.map(({ key, label }) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <label className="flex items-center gap-2 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={selectedGenerated[key]}
                      onChange={(e) =>
                        setSelectedGenerated((prev) => ({ ...prev, [key]: e.target.checked }))
                      }
                    />
                    <a
                      href={generatedImages[key]}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline truncate"
                    >
                      {label}: {generatedImages[key]}
                    </a>
                  </label>
                  {generationPromptLogs[key]?.slotLabel && (
                    <Badge variant="outline" className="text-[10px]">
                      {generationPromptLogs[key].slotLabel}
                    </Badge>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeGeneratedImage(key)}
                    aria-label={`Delete ${label}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold">Saved to AI Image Gallery</h4>
              <p className="text-xs text-muted-foreground">
                These are the saved preview images for this draft session.
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={refreshGalleryItems}>
                {galleryRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
              </Button>
              <Button type="button" variant="outline" size="sm" asChild>
                <a href="/admin/image-gallery" target="_blank" rel="noreferrer">
                  Open AI Image Gallery
                </a>
              </Button>
            </div>
          </div>

          {renderGalleryContent({ galleryLoading, galleryItems, deleteGalleryItem })}
        </div>

        {Object.keys(generationPromptLogs).length > 0 && (
          <div className="border-t border-border pt-4 space-y-3">
            <h4 className="text-sm font-semibold">Generation Prompt Payloads</h4>
            <p className="text-xs text-muted-foreground">
              Exact slot prompts used for the latest generated images in this session.
            </p>
            <div className="space-y-3">
              {Object.entries(generationPromptLogs).map(([slot, info]) => (
                <div key={slot} className="space-y-1">
                  <Label className="text-xs">
                    {info.slotLabel || slot} · template {info.templateVersion || 'v1'}
                  </Label>
                  <Textarea value={info.prompt || ''} readOnly rows={5} className="text-xs" />
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StageFourCard({
  draftTitle,
  setDraftTitle,
  title,
  draftSummary,
  setDraftSummary,
  sectionBlocks,
  draftContent,
  setDraftContent,
  draftReady,
  insertSectionBlock,
  draftTopics,
  resolveSlotImage,
  previewPath,
  readinessChecks,
  savedContentId,
  canPreview,
  readinessComplete,
  previewSaving,
  createAndOpenSaving,
  handleCreateAndOpenEditor,
  contentType,
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stage 4: Content Draft</CardTitle>
        <CardDescription>
          Edit content with schema blocks, validate readiness, and preview using live-style layout.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs">Generated Title</Label>
          <Input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Title will be generated after Stage 2 Submit"
            disabled={!draftReady}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Generated Summary</Label>
          <Textarea
            value={draftSummary}
            onChange={(e) => setDraftSummary(e.target.value)}
            rows={4}
            placeholder="Summary will be generated after Stage 2 Submit"
            disabled={!draftReady}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Schema Section Blocks</Label>
          <p className="text-xs text-muted-foreground">
            Use these buttons to insert the required sections named in the readiness checklist.
          </p>
          <div className="flex flex-wrap gap-2">
            {sectionBlocks.map((section) => {
              const exists = draftContent.includes(section.heading);
              return (
                <Button
                  key={section.key}
                  type="button"
                  size="sm"
                  variant={exists ? 'default' : 'outline'}
                  onClick={() => insertSectionBlock(section)}
                  disabled={!draftReady}
                >
                  {exists ? '✓ ' : ''}
                  {section.title}
                </Button>
              );
            })}
          </div>
        </div>

        {draftTopics.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {draftTopics.map((topic) => (
              <Badge key={topic} variant="outline">
                {topic}
              </Badge>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 border-t border-border pt-4">
          <div className="space-y-2">
            <Label className="text-xs">Editor (Markdown)</Label>
            <Textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={20}
              placeholder="Article content will be generated after Stage 2 Submit"
              disabled={!draftReady}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Final Page Preview (Live-style)</Label>
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                {resolveSlotImage('hero') && (
                  <img src={resolveSlotImage('hero')} alt="" className="w-full h-48 object-cover" />
                )}
                <div className="p-4 space-y-3">
                  <div className="text-xs text-muted-foreground">{previewPath}</div>
                  <h3 className="text-xl font-bold">
                    {draftTitle || title || 'Untitled content draft'}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {draftSummary || 'No summary yet.'}
                  </p>
                  {draftTopics.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {draftTopics.slice(0, 6).map((topic) => (
                        <Badge key={topic} variant="outline">
                          {topic}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="prose prose-sm dark:prose-invert max-w-none border-t border-border pt-3 max-h-105 overflow-y-auto">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {draftContent || '_Draft content preview appears here._'}
                    </ReactMarkdown>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-sm">Publish Readiness Checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {readinessChecks.map((check) => (
              <div key={check.key} className="flex items-start gap-2 text-sm">
                {check.done ? (
                  <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
                )}
                <div>
                  <p className={check.done ? 'text-foreground' : 'text-muted-foreground'}>
                    {check.label}
                  </p>
                  {!check.done && (
                    <p className="text-xs text-muted-foreground">
                      {check.key === 'schema-sections'
                        ? `${check.hint}. Add them using the Schema Section Blocks buttons above.`
                        : check.hint}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="border-t border-border pt-4 flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Draft ready: {draftReady ? 'Yes' : 'No'}</p>
            <p>Images selected/uploaded: {canPreview ? 'Yes' : 'No'}</p>
            <p>Readiness complete: {readinessComplete ? 'Yes' : 'No'}</p>
            {savedContentId && (
              <p>
                Saved content:{' '}
                <a
                  href={getQueueReviewPath(savedContentId)}
                  className="text-blue-600 hover:underline"
                >
                  {savedContentId.slice(0, 8)}
                </a>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCreateAndOpenEditor}
              disabled={createAndOpenSaving || previewSaving || !canPreview || !readinessComplete}
              className="gap-1"
            >
              {createAndOpenSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              Create + Open Editor
            </Button>
            <Button
              type="submit"
              disabled={previewSaving || createAndOpenSaving || !canPreview || !readinessComplete}
              className="gap-1"
            >
              {previewSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              Save {formatSaveLabel(contentType)}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FeedbackCard({ variant, message, contentId }) {
  const isSuccess = variant === 'success';
  const borderClass = isSuccess
    ? 'border-green-200 dark:border-green-800'
    : 'border-red-200 dark:border-red-800';
  const iconClass = isSuccess ? 'text-green-600' : 'text-red-600';
  const Icon = isSuccess ? CheckCircle : AlertCircle;

  return (
    <Card className={borderClass}>
      <CardContent className="p-4 flex items-start gap-3">
        <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${iconClass}`} />
        <div className="text-sm space-y-1">
          <p className="font-medium">{isSuccess ? 'Success' : 'Error'}</p>
          <p className={isSuccess ? '' : 'text-muted-foreground'}>{message}</p>
          {isSuccess && contentId && (
            <a href={getQueueReviewPath(contentId)} className="text-blue-600 hover:underline">
              Open in Content Queue
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SubmitUrlsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    fetchPromptSets,
    fetchPromptSet,
    fetchPromptNames,
    fetchPrompt,
    fetchPageAssignment,
    savePageAssignment,
  } = useImagePrompts();

  // Stage 1: Global Options
  const [provider, setProvider] = useState('');
  const [blogLandingProvider, setBlogLandingProvider] = useState('');
  const [contentType, setContentType] = useState('blog');
  const [title, setTitle] = useState('');
  const [publishedDate, setPublishedDate] = useState('');

  // Stage 2: URL Submission + AI Draft (in-memory)
  const [sourceUrl, setSourceUrl] = useState('');
  const [kbArticleUrls, setKbArticleUrls] = useState([]);
  const [kbDocumentUrl, setKbDocumentUrl] = useState('');
  const [kbDocumentUrls, setKbDocumentUrls] = useState([]);
  const [draftInstructionPrompt, setDraftInstructionPrompt] = useState(
    DEFAULT_DRAFT_INSTRUCTION_PROMPT
  );
  const [supportingDocuments, setSupportingDocuments] = useState([]);
  const [frameworkSourceUrls, setFrameworkSourceUrls] = useState('');
  const [frameworkKnowledgePrompt, setFrameworkKnowledgePrompt] = useState('');
  const [frameworkDiagramPrompt, setFrameworkDiagramPrompt] = useState('');
  const [frameworkImagePrompt, setFrameworkImagePrompt] = useState('');
  const [frameworkConceptSeeds, setFrameworkConceptSeeds] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSummary, setDraftSummary] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [draftTopics, setDraftTopics] = useState([]);
  const [submittingDraft, setSubmittingDraft] = useState(false);
  const [draftReady, setDraftReady] = useState(false);

  // Stage 3: Image Generation
  const [slotFiles, setSlotFiles] = useState(EMPTY_SLOT_FILES);
  const [slotUrls, setSlotUrls] = useState(EMPTY_SLOT_URLS);
  const [uploadingSlot, setUploadingSlot] = useState('');
  const [aiTargets, setAiTargets] = useState({
    hero: true,
    secondary1: false,
    secondary2: false,
    secondary3: false,
  });
  const [summaryPrompt, setSummaryPrompt] = useState('');
  const [detailsPrompt, setDetailsPrompt] = useState('');
  const [selectedSlotTemplates, setSelectedSlotTemplates] = useState(EMPTY_SLOT_TEMPLATES);
  const [generatingImages, setGeneratingImages] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const [generationError, setGenerationError] = useState('');
  const [generatedImages, setGeneratedImages] = useState(EMPTY_SLOT_URLS);
  const [generatedImageIds, setGeneratedImageIds] = useState(EMPTY_SLOT_IDS);
  const [generationPromptLogs, setGenerationPromptLogs] = useState({});
  const [selectedUploaded, setSelectedUploaded] = useState({
    hero: true,
    secondary1: true,
    secondary2: true,
    secondary3: true,
  });
  const [selectedGenerated, setSelectedGenerated] = useState({
    hero: true,
    secondary1: true,
    secondary2: true,
    secondary3: true,
  });
  const [promptSets, setPromptSets] = useState([]);
  const [promptNames, setPromptNames] = useState([]);
  const [selectedPromptSet, setSelectedPromptSet] = useState('');
  const [selectedPromptName, setSelectedPromptName] = useState('');
  const [promptLibraryLoading, setPromptLibraryLoading] = useState(false);
  const [promptLibraryStatus, setPromptLibraryStatus] = useState('');
  const [promptLibraryError, setPromptLibraryError] = useState('');
  const [galleryItems, setGalleryItems] = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryRefreshing, setGalleryRefreshing] = useState(false);

  // Stage 4: Preview (persist)
  const [previewSaving, setPreviewSaving] = useState(false);
  const [createAndOpenSaving, setCreateAndOpenSaving] = useState(false);
  const [savedContentId, setSavedContentId] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [builderStateLoaded, setBuilderStateLoaded] = useState(false);
  const [previewSessionId] = useState(
    () => `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBuilderStateLoaded(true);
      return;
    }

    const saved = readBuilderSnapshot();
    if (saved) {
      applyBuilderSnapshot(saved, {
        setProvider,
        setBlogLandingProvider,
        setContentType,
        setTitle,
        setPublishedDate,
        setSourceUrl,
        setKbArticleUrls,
        setKbDocumentUrl,
        setKbDocumentUrls,
        setDraftInstructionPrompt,
        setFrameworkSourceUrls,
        setFrameworkKnowledgePrompt,
        setFrameworkDiagramPrompt,
        setFrameworkImagePrompt,
        setFrameworkConceptSeeds,
        setDraftTitle,
        setDraftSummary,
        setDraftContent,
        setDraftTopics,
        setDraftReady,
        setSummaryPrompt,
        setDetailsPrompt,
        setGeneratedImages,
        setGeneratedImageIds,
        setSelectedUploaded,
        setSelectedGenerated,
        setAiTargets,
        setSlotUrls,
      });
    }

    setBuilderStateLoaded(true);
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !builderStateLoaded) return;

    const snapshot = {
      provider,
      blogLandingProvider,
      contentType,
      title,
      publishedDate,
      sourceUrl,
      kbArticleUrls,
      kbDocumentUrl,
      kbDocumentUrls,
      draftInstructionPrompt,
      frameworkSourceUrls,
      frameworkKnowledgePrompt,
      frameworkDiagramPrompt,
      frameworkImagePrompt,
      frameworkConceptSeeds,
      draftTitle,
      draftSummary,
      draftContent,
      draftTopics,
      draftReady,
      summaryPrompt,
      detailsPrompt,
      generatedImages,
      generatedImageIds,
      selectedUploaded,
      selectedGenerated,
      aiTargets,
      slotUrls,
    };

    try {
      window.sessionStorage.setItem(BUILDER_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore storage issues
    }
  }, [
    builderStateLoaded,
    provider,
    blogLandingProvider,
    contentType,
    title,
    publishedDate,
    sourceUrl,
    kbArticleUrls,
    kbDocumentUrl,
    kbDocumentUrls,
    draftInstructionPrompt,
    frameworkSourceUrls,
    frameworkKnowledgePrompt,
    frameworkDiagramPrompt,
    frameworkImagePrompt,
    frameworkConceptSeeds,
    draftTitle,
    draftSummary,
    draftContent,
    draftTopics,
    draftReady,
    summaryPrompt,
    detailsPrompt,
    generatedImages,
    generatedImageIds,
    selectedUploaded,
    selectedGenerated,
    aiTargets,
    slotUrls,
  ]);

  React.useEffect(() => {
    const query = new URLSearchParams(location.search);
    const queryReuseImage = query.get('reuseImage');
    let cachedReuseImage = '';

    try {
      cachedReuseImage = window.localStorage.getItem('contentforge_reuse_image') || '';
      window.localStorage.removeItem('contentforge_reuse_image');
    } catch {
      cachedReuseImage = '';
    }

    const reuseImage = queryReuseImage || cachedReuseImage;
    if (!reuseImage) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlotUrls((prev) => ({ ...prev, hero: reuseImage }));
    setSelectedUploaded((prev) => ({ ...prev, hero: true }));
  }, [location.search]);

  const loadPreviewGalleryItems = React.useCallback(
    async ({ silent = false } = {}) => {
      if (!previewSessionId) return;
      if (silent) {
        setGalleryRefreshing(true);
      } else {
        setGalleryLoading(true);
      }

      try {
        const res = await getJSON(
          `cms/images?articleId=${encodeURIComponent(previewSessionId)}&limit=24`
        );
        // Server returns each gallery newest-first already.
        const items = res.generated || [];

        setGalleryItems(items);
      } catch (err) {
        setError(err.message || 'Failed to load saved gallery images.');
      } finally {
        setGalleryLoading(false);
        setGalleryRefreshing(false);
      }
    },
    [previewSessionId]
  );

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPreviewGalleryItems();
  }, [loadPreviewGalleryItems, generatedImageIds]);

  const selectedAiTargets = useMemo(
    () =>
      Object.entries(aiTargets)
        .filter(([, selected]) => selected)
        .map(([slot]) => slot),
    [aiTargets]
  );

  const canGenerateImages = canGenerateDraftImages(summaryPrompt, detailsPrompt, draftReady);

  const selectedImages = useMemo(
    () =>
      collectSelectedSlotImages({
        slotUrls,
        selectedUploaded,
        generatedImages,
        selectedGenerated,
      }),
    [slotUrls, selectedUploaded, generatedImages, selectedGenerated]
  );
  const hasUploadedImages = selectedImages.some((item) => item.source === 'uploaded');
  const hasSelectedGeneratedImages = selectedImages.some((item) => item.source === 'generated');
  const hasSourceUrls = kbArticleUrls.length > 0 || isValidHttpUrl(sourceUrl);
  const canPreview = draftReady && selectedImages.length > 0;
  const hasHeroSelected = selectedImages.length > 0;
  const inferredProvider = useMemo(
    () => inferProviderFromUrl(kbArticleUrls[0] || sourceUrl),
    [kbArticleUrls, sourceUrl]
  );
  const resolvedProvider = useMemo(
    () => getResolvedProvider(provider, inferredProvider),
    [provider, inferredProvider]
  );
  const resolvedBlogLandingProvider = useMemo(() => {
    return getResolvedBlogLandingProvider(contentType, blogLandingProvider, resolvedProvider);
  }, [contentType, blogLandingProvider, resolvedProvider]);
  const previewSlug = useMemo(() => slugifyTitle(draftTitle || title), [draftTitle, title]);
  const previewProviderSegment = useMemo(
    () => (resolvedBlogLandingProvider ? resolvedBlogLandingProvider.toLowerCase() : 'provider'),
    [resolvedBlogLandingProvider]
  );
  const sectionBlocks = useMemo(
    () => SECTION_BLOCKS_BY_TYPE[contentType] || SECTION_BLOCKS_BY_TYPE.blog,
    [contentType]
  );
  const previewSection = useMemo(() => getPreviewSection(contentType), [contentType]);
  const previewPath = useMemo(
    () => `/${previewProviderSegment}/${previewSection}/${previewSlug || 'draft-slug'}`,
    [previewProviderSegment, previewSection, previewSlug]
  );
  const hasProviderMismatch = Boolean(
    provider && inferredProvider && provider !== inferredProvider
  );

  const readinessChecks = useMemo(() => {
    return buildReadinessChecks({
      sourceUrl: kbArticleUrls[0] || sourceUrl,
      contentType,
      frameworkSourceUrls,
      resolvedProvider,
      resolvedBlogLandingProvider,
      inferredProvider,
      previewSlug,
      previewPath,
      draftTitle,
      title,
      draftSummary,
      draftContent,
      hasHeroSelected,
      sectionBlocks,
    });
  }, [
    sourceUrl,
    kbArticleUrls,
    resolvedProvider,
    contentType,
    resolvedBlogLandingProvider,
    inferredProvider,
    previewSlug,
    previewPath,
    draftTitle,
    title,
    frameworkSourceUrls,
    draftSummary,
    draftContent,
    hasHeroSelected,
    sectionBlocks,
  ]);

  const readinessComplete = readinessChecks.every((check) => check.done);
  const readinessScore = useMemo(
    () => readinessChecks.filter((check) => check.done).length,
    [readinessChecks]
  );

  const currentStep = useMemo(() => {
    return getCurrentStep({
      hasSourceUrls,
      draftReady,
      hasUploadedImages,
      hasSelectedGeneratedImages,
    });
  }, [hasSourceUrls, draftReady, hasUploadedImages, hasSelectedGeneratedImages]);
  const promptLibraryPagePath = useMemo(() => {
    const providerSegment =
      contentType === 'blog' ? resolvedBlogLandingProvider || resolvedProvider : resolvedProvider;
    return getPromptLibraryPagePath(contentType, providerSegment);
  }, [contentType, resolvedBlogLandingProvider, resolvedProvider]);

  const applyPromptSelection = React.useCallback(
    async (setName, promptName) => {
      if (!setName) {
        setSummaryPrompt('');
        setDetailsPrompt('');
        setSelectedSlotTemplates(EMPTY_SLOT_TEMPLATES);
        return;
      }

      const [setData, promptData] = await Promise.all([
        fetchPromptSet(setName),
        promptName ? fetchPrompt(setName, promptName) : Promise.resolve(null),
      ]);

      setSummaryPrompt(setData?.primaryPrompt || '');
      setDetailsPrompt(promptData?.additionalParameters || '');
      setSelectedSlotTemplates({
        ...EMPTY_SLOT_TEMPLATES,
        ...(promptData?.slotTemplates || {}),
      });
    },
    [fetchPrompt, fetchPromptSet]
  );

  React.useEffect(() => {
    let cancelled = false;

    async function loadPromptLibrary() {
      if (!promptLibraryPagePath) {
        setPromptSets([]);
        setPromptNames([]);
        setSelectedPromptSet('');
        setSelectedPromptName('');
        setSelectedSlotTemplates(EMPTY_SLOT_TEMPLATES);
        setPromptLibraryStatus('Select a provider/page target to load saved prompts.');
        setPromptLibraryError('');
        return;
      }

      setPromptLibraryLoading(true);
      setPromptLibraryError('');
      try {
        const [allSets, assignment] = await Promise.all([
          fetchPromptSets(),
          fetchPageAssignment(promptLibraryPagePath),
        ]);

        if (cancelled) return;

        setPromptSets(allSets);

        const assignedSetName = String(assignment?.setName || '').trim();
        const assignedPromptName = String(assignment?.promptName || '').trim();

        if (!assignedSetName) {
          setPromptNames([]);
          setSelectedPromptSet('');
          setSelectedPromptName('');
          setSelectedSlotTemplates(EMPTY_SLOT_TEMPLATES);
          setPromptLibraryStatus(
            allSets.length > 0
              ? `No Prompt Set assigned to ${promptLibraryPagePath} yet.`
              : 'No saved Prompt Sets found yet.'
          );
          return;
        }

        const names = await fetchPromptNames(assignedSetName);
        if (cancelled) return;

        setPromptNames(names);
        setSelectedPromptSet(assignedSetName);
        setSelectedPromptName(assignedPromptName);
        setPromptLibraryStatus(
          assignedPromptName
            ? `Assigned: ${assignedSetName} / ${assignedPromptName}`
            : `Assigned: ${assignedSetName}`
        );

        await applyPromptSelection(assignedSetName, assignedPromptName);
      } catch (err) {
        if (cancelled) return;
        setPromptLibraryError(err?.message || 'Failed to load saved prompts.');
      } finally {
        if (!cancelled) {
          setPromptLibraryLoading(false);
        }
      }
    }

    loadPromptLibrary();

    return () => {
      cancelled = true;
    };
  }, [
    applyPromptSelection,
    fetchPageAssignment,
    fetchPromptNames,
    fetchPromptSets,
    promptLibraryPagePath,
  ]);

  const handleSelectPromptSet = React.useCallback(
    async (setName) => {
      setSelectedPromptSet(setName);
      setSelectedPromptName('');
      setPromptLibraryError('');

      if (!promptLibraryPagePath) return;

      if (!setName) {
        setPromptNames([]);
        await applyPromptSelection('', '');
        setPromptLibraryStatus(`No Prompt Set assigned to ${promptLibraryPagePath} yet.`);
        await savePageAssignment(promptLibraryPagePath, '', '');
        return;
      }

      setPromptLibraryLoading(true);
      try {
        const names = await fetchPromptNames(setName);
        setPromptNames(names);
        await applyPromptSelection(setName, '');
        setPromptLibraryStatus(`Assigned: ${setName}`);
        await savePageAssignment(promptLibraryPagePath, setName, '');
      } catch (err) {
        setPromptLibraryError(err?.message || 'Failed to load Prompt Set.');
      } finally {
        setPromptLibraryLoading(false);
      }
    },
    [applyPromptSelection, fetchPromptNames, promptLibraryPagePath, savePageAssignment]
  );

  const handleSelectPromptName = React.useCallback(
    async (promptName) => {
      setSelectedPromptName(promptName);
      setPromptLibraryError('');

      if (!promptLibraryPagePath || !selectedPromptSet) return;

      setPromptLibraryLoading(true);
      try {
        await applyPromptSelection(selectedPromptSet, promptName);
        await savePageAssignment(promptLibraryPagePath, selectedPromptSet, promptName);
        setPromptLibraryStatus(
          promptName
            ? `Assigned: ${selectedPromptSet} / ${promptName}`
            : `Assigned: ${selectedPromptSet}`
        );
      } catch (err) {
        setPromptLibraryError(err?.message || 'Failed to load Prompt Name.');
      } finally {
        setPromptLibraryLoading(false);
      }
    },
    [applyPromptSelection, promptLibraryPagePath, savePageAssignment, selectedPromptSet]
  );

  const uploadSlotImage = async (slot, explicitFile = null) => {
    const file = explicitFile || slotFiles[slot];
    if (!file) return;

    setUploadingSlot(slot);
    setError('');
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `content-submissions/${slot}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const dataBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
      });
      const uploaded = await postJSON('cms/uploads/content', {
        path,
        contentType: file.type || 'image/png',
        dataBase64,
      });
      setSlotUrls((prev) => ({ ...prev, [slot]: uploaded.url }));
      setSelectedUploaded((prev) => ({ ...prev, [slot]: true }));
      setSlotFiles((prev) => ({ ...prev, [slot]: null }));
    } catch (err) {
      setError(err.message || 'Failed to upload image.');
    } finally {
      setUploadingSlot('');
    }
  };

  const handleSupportingDocumentUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const availableSlots =
      MAX_STAGE_TWO_SUPPORTING_SOURCES - (supportingDocuments.length + kbDocumentUrls.length);
    if (availableSlots <= 0) {
      setError(
        `You can keep up to ${MAX_STAGE_TWO_SUPPORTING_SOURCES} total supporting documents in Stage 2.`
      );
      e.target.value = '';
      return;
    }

    const nextFiles = files.slice(0, availableSlots);
    setError('');

    try {
      const parsedDocuments = [];

      for (const file of nextFiles) {
        const extension = String(file.name.split('.').pop() || '').toLowerCase();
        const isTxt = file.type === 'text/plain' || extension === 'txt';
        const isPdf = file.type === 'application/pdf' || extension === 'pdf';

        if (!isTxt && !isPdf) {
          throw new Error('Only PDF and TXT files are supported in Stage 2.');
        }
        if (file.size > MAX_STAGE_TWO_FILE_BYTES) {
          throw new Error(`${file.name} exceeds the 4 MB Stage 2 file limit.`);
        }

        if (isTxt) {
          const textContent = String(await file.text()).slice(0, 20000);
          parsedDocuments.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name,
            size: file.size,
            kind: 'txt',
            mimeType: 'text/plain',
            textContent,
            base64Data: '',
          });
          continue;
        }

        const base64Data = await readFileAsBase64(file);
        parsedDocuments.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          size: file.size,
          kind: 'pdf',
          mimeType: 'application/pdf',
          textContent: '',
          base64Data,
        });
      }

      setSupportingDocuments((prev) => [...prev, ...parsedDocuments]);

      if (files.length > availableSlots) {
        setResult({
          stage: 2,
          message: `Only the first ${availableSlots} file(s) were added. Stage 2 supports up to ${MAX_STAGE_TWO_SUPPORTING_SOURCES} total supporting documents.`,
        });
      }
    } catch (err) {
      setError(err.message || 'Failed to load supporting documents.');
    } finally {
      e.target.value = '';
    }
  };

  const removeSupportingDocument = React.useCallback((documentId) => {
    setSupportingDocuments((prev) => prev.filter((doc) => doc.id !== documentId));
  }, []);

  const addKbDocumentUrl = React.useCallback(() => {
    const normalizedUrl = kbDocumentUrl.trim();
    if (!isSupportedDocumentUrl(normalizedUrl)) {
      setError('Please enter a valid public PDF or TXT URL before adding it.');
      return;
    }

    if (supportingDocuments.length + kbDocumentUrls.length >= MAX_STAGE_TWO_SUPPORTING_SOURCES) {
      setError(
        `Stage 2 supports up to ${MAX_STAGE_TWO_SUPPORTING_SOURCES} total supporting documents across uploads and document URLs.`
      );
      return;
    }

    setKbDocumentUrls((prev) => {
      if (prev.includes(normalizedUrl)) return prev;
      return [...prev, normalizedUrl];
    });
    setKbDocumentUrl('');
    setError('');
  }, [kbDocumentUrl, supportingDocuments.length, kbDocumentUrls]);

  const removeKbDocumentUrl = React.useCallback((urlToRemove) => {
    setKbDocumentUrls((prev) => prev.filter((entry) => entry !== urlToRemove));
  }, []);

  const addKbArticleUrl = React.useCallback(() => {
    const normalizedUrl = sourceUrl.trim();
    if (!isValidHttpUrl(normalizedUrl)) {
      setError('Please enter a valid KB article URL before adding it.');
      return;
    }

    setKbArticleUrls((prev) => {
      if (prev.includes(normalizedUrl)) return prev;
      return [...prev, normalizedUrl];
    });
    setSourceUrl('');
    setError('');
  }, [sourceUrl]);

  const removeKbArticleUrl = React.useCallback((urlToRemove) => {
    setKbArticleUrls((prev) => prev.filter((entry) => entry !== urlToRemove));
  }, []);

  const resetGeneratedDraftAssets = React.useCallback(() => {
    setGeneratedImages({ ...EMPTY_SLOT_URLS });
    setGeneratedImageIds({ ...EMPTY_SLOT_IDS });
    setSelectedGenerated({
      hero: true,
      secondary1: true,
      secondary2: true,
      secondary3: true,
    });
    setGenerationPromptLogs({});
    setGalleryItems([]);
  }, []);

  const insertSectionBlock = (section) => {
    if (!draftReady) return;

    const hasSection = draftContent.includes(section.heading);
    if (hasSection) {
      setResult({ stage: 4, message: `${section.title} already exists in the draft.` });
      return;
    }

    const nextContent = ensureTldrSectionAtEnd(
      `${draftContent.trim()}\n\n${section.template}`.trim()
    );
    setDraftContent(nextContent);
  };

  const handleSubmitDraft = async (e) => {
    e.preventDefault();
    const isRegeneration = draftReady;
    setSubmittingDraft(true);
    setError('');
    setResult(null);

    const effectiveSourceUrls = Array.from(
      new Set([...kbArticleUrls, isValidHttpUrl(sourceUrl) ? sourceUrl.trim() : ''].filter(Boolean))
    );

    if (effectiveSourceUrls.length === 0) {
      setSubmittingDraft(false);
      setError('Please add at least one valid KB article URL for Stage 2.');
      return;
    }

    try {
      const response = await postJSON('generateArticleDraft', {
        url: effectiveSourceUrls[0],
        urls: effectiveSourceUrls,
        cloudProvider: provider || null,
        customInstructionPrompt: draftInstructionPrompt.trim(),
        documentUrls: kbDocumentUrls,
        supportingDocuments: supportingDocuments.map((doc) => ({
          name: doc.name,
          mimeType: doc.mimeType,
          textContent: doc.textContent || '',
          base64Data: doc.base64Data || '',
        })),
      });

      const draft = response?.draft || {};
      setKbArticleUrls(
        Array.isArray(draft.sourceUrls) && draft.sourceUrls.length > 0
          ? draft.sourceUrls
          : effectiveSourceUrls
      );
      setSourceUrl('');
      setDraftTitle(draft.title || title || 'Untitled');
      setDraftSummary(draft.summary || '');
      setDraftContent(ensureTldrSectionAtEnd(draft.postContent || ''));
      setDraftTopics(Array.isArray(draft.keyTopics) ? draft.keyTopics : []);
      setSummaryPrompt(draft.summaryPrompt || '');
      setDetailsPrompt(draft.detailsPrompt || '');
      setDraftReady(true);
      resetGeneratedDraftAssets();
      setResult({
        stage: 2,
        message: isRegeneration
          ? 'Draft regenerated in memory with the latest KB articles, document URLs, files, and prompt. Review Stage 3 images before saving.'
          : 'Draft generated in memory. Continue to Stages 3 and 4.',
      });
    } catch (err) {
      setError(err.message || 'Submission failed.');
    } finally {
      setSubmittingDraft(false);
    }
  };

  const handleGenerateImages = async () => {
    if (!canGenerateImages) return;
    setGeneratingImages(true);
    setError('');
    setGenerationError('');
    setGenerationStatus('');
    try {
      const collectedUrls = {};

      for (let index = 0; index < selectedAiTargets.length; index += 1) {
        const slot = selectedAiTargets[index];
        setGenerationStatus(
          `Generating ${slot} image (${index + 1} of ${selectedAiTargets.length})...`
        );

        const response = await postJSON('generatePreviewImages', {
          summaryPrompt,
          detailsPrompt,
          slotTemplates: selectedSlotTemplates,
          aiImageTargets: [slot],
          title: draftTitle,
          summary: draftSummary,
          provider: resolvedProvider,
          contentType,
          sourceUrl: kbArticleUrls[0] || sourceUrl.trim(),
          articleId: previewSessionId,
        });

        const imageUrl = response?.imageUrls?.[slot] || '';
        const imageId = response?.imageRecords?.[slot]?.imageId || '';
        const promptLog = response?.promptLogs?.[slot] || null;
        if (!imageUrl) {
          throw new Error(`No image URL was returned for ${slot}.`);
        }

        collectedUrls[slot] = imageUrl;
        setGeneratedImages((prev) => ({ ...prev, [slot]: imageUrl }));
        setGeneratedImageIds((prev) => ({ ...prev, [slot]: imageId }));
        if (promptLog) {
          setGenerationPromptLogs((prev) => ({ ...prev, [slot]: promptLog }));
        }
        setSelectedGenerated((prev) => ({ ...prev, [slot]: true }));
        setGenerationStatus(
          `Generated ${slot} image (${index + 1} of ${selectedAiTargets.length}).`
        );
      }

      setResult({
        stage: 3,
        message: `Generated ${Object.keys(collectedUrls).length} image slot(s). Review and select the ones to include.`,
      });
    } catch (err) {
      setGenerationError(err.message || 'Failed to generate images.');
      setError(err.message || 'Failed to generate images.');
    } finally {
      setGenerationStatus('');
      setGeneratingImages(false);
    }
  };

  const clearGeneratedImageState = (slot) => {
    setGeneratedImages((prev) => ({ ...prev, [slot]: '' }));
    setGeneratedImageIds((prev) => ({ ...prev, [slot]: '' }));
    setSelectedGenerated((prev) => ({ ...prev, [slot]: false }));
    setGenerationPromptLogs((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  };

  const removeGeneratedImage = async (slot) => {
    const imageId = generatedImageIds[slot];

    try {
      if (imageId) {
        await postJSON('deleteContentGeneratedImage', { imageId });
      }
    } catch (err) {
      setError(err.message || `Failed to delete generated ${slot} image.`);
      return;
    }

    clearGeneratedImageState(slot);
    setGalleryItems((prev) => prev.filter((item) => item.id !== imageId));
  };

  const deleteGalleryItem = async (item) => {
    if (!item?.id) return;

    try {
      await postJSON('deleteContentGeneratedImage', { imageId: item.id });
      setGalleryItems((prev) => prev.filter((entry) => entry.id !== item.id));
      if (item.slot && generatedImageIds[item.slot] === item.id) {
        clearGeneratedImageState(item.slot);
      }
    } catch (err) {
      setError(err.message || 'Failed to delete saved gallery image.');
    }
  };

  const resolveSlotImage = (slot) => {
    if (slotUrls[slot] && selectedUploaded[slot]) return slotUrls[slot];
    if (selectedGenerated[slot] && generatedImages[slot]) return generatedImages[slot];
    return '';
  };

  const persistContentItem = async () => {
    if (!canPreview || !readinessComplete) return null;

    const { heroImageUrl, secondaryImageUrls, aiImageUrls } = buildPreviewImageSelection({
      slotUrls,
      selectedUploaded,
      generatedImages,
      selectedGenerated,
    });

    try {
      const payload = buildContentCreatePayload({
        sourceUrl: kbArticleUrls[0] || sourceUrl,
        sourceUrls: kbArticleUrls,
        provider: resolvedProvider,
        blogLandingProvider: resolvedBlogLandingProvider,
        draftTitle,
        title,
        draftSummary,
        draftContent,
        draftTopics,
        summaryPrompt,
        detailsPrompt,
        publishedDate,
        heroImageUrl,
        secondaryImageUrls,
        aiImageUrls,
        contentType,
        frameworkSourceUrls,
        frameworkKnowledgePrompt,
        frameworkDiagramPrompt,
        frameworkImagePrompt,
        frameworkConceptSeeds,
      });

      const response = await postJSON('createContentItem', {
        data: payload,
      });

      const contentId = response?.contentId || '';
      setSavedContentId(contentId);
      return contentId;
    } catch (err) {
      setError(err.message || 'Failed to save preview to content collection.');
      return null;
    }
  };

  const handlePreviewSave = async (e) => {
    e.preventDefault();
    if (!canPreview || !readinessComplete) return;

    setPreviewSaving(true);
    setError('');
    setResult(null);
    try {
      const contentId = await persistContentItem();
      if (contentId) {
        setResult({ stage: 4, message: 'Draft saved to content collection.', contentId });
      }
    } finally {
      setPreviewSaving(false);
    }
  };

  const handleCreateAndOpenEditor = async () => {
    if (!canPreview || !readinessComplete) return;

    setCreateAndOpenSaving(true);
    setError('');
    setResult(null);
    try {
      const contentId = await persistContentItem();
      if (contentId) {
        navigate(getEditorPath(contentId));
      }
    } finally {
      setCreateAndOpenSaving(false);
    }
  };

  const generatedSlots = IMAGE_SLOTS.filter(({ key }) => generatedImages[key]);

  return (
    <div className="space-y-6 max-w-5xl">
      <WorkflowHeader
        currentStep={currentStep}
        readinessComplete={readinessComplete}
        readinessScore={readinessScore}
        readinessTotal={readinessChecks.length}
      />

      <SelectionSummaryCard
        provider={provider}
        inferredProvider={inferredProvider}
        contentType={contentType}
        resolvedBlogLandingProvider={resolvedBlogLandingProvider}
        publishedDate={publishedDate}
      />

      <form onSubmit={handlePreviewSave} className="space-y-6">
        <StageOneCard
          provider={provider}
          setProvider={setProvider}
          inferredProvider={inferredProvider}
          hasProviderMismatch={hasProviderMismatch}
          contentType={contentType}
          setContentType={setContentType}
          blogLandingProvider={blogLandingProvider}
          setBlogLandingProvider={setBlogLandingProvider}
          resolvedBlogLandingProvider={resolvedBlogLandingProvider}
          title={title}
          setTitle={setTitle}
          publishedDate={publishedDate}
          setPublishedDate={setPublishedDate}
        />

        <StageTwoCard
          contentType={contentType}
          draftInstructionPrompt={draftInstructionPrompt}
          setDraftInstructionPrompt={setDraftInstructionPrompt}
          supportingDocuments={supportingDocuments}
          handleSupportingDocumentUpload={handleSupportingDocumentUpload}
          removeSupportingDocument={removeSupportingDocument}
          kbDocumentUrl={kbDocumentUrl}
          setKbDocumentUrl={setKbDocumentUrl}
          kbDocumentUrls={kbDocumentUrls}
          addKbDocumentUrl={addKbDocumentUrl}
          removeKbDocumentUrl={removeKbDocumentUrl}
          sourceUrl={sourceUrl}
          setSourceUrl={setSourceUrl}
          kbArticleUrls={kbArticleUrls}
          addKbArticleUrl={addKbArticleUrl}
          removeKbArticleUrl={removeKbArticleUrl}
          handleSubmitDraft={handleSubmitDraft}
          submittingDraft={submittingDraft}
          draftReady={draftReady}
          frameworkSourceUrls={frameworkSourceUrls}
          setFrameworkSourceUrls={setFrameworkSourceUrls}
          frameworkKnowledgePrompt={frameworkKnowledgePrompt}
          setFrameworkKnowledgePrompt={setFrameworkKnowledgePrompt}
          frameworkDiagramPrompt={frameworkDiagramPrompt}
          setFrameworkDiagramPrompt={setFrameworkDiagramPrompt}
          frameworkImagePrompt={frameworkImagePrompt}
          setFrameworkImagePrompt={setFrameworkImagePrompt}
          frameworkConceptSeeds={frameworkConceptSeeds}
          setFrameworkConceptSeeds={setFrameworkConceptSeeds}
        />

        <StageThreeCard
          slotFiles={slotFiles}
          setSlotFiles={setSlotFiles}
          uploadSlotImage={uploadSlotImage}
          uploadingSlot={uploadingSlot}
          slotUrls={slotUrls}
          selectedUploaded={selectedUploaded}
          setSelectedUploaded={setSelectedUploaded}
          aiTargets={aiTargets}
          setAiTargets={setAiTargets}
          promptSets={promptSets}
          promptNames={promptNames}
          selectedPromptSet={selectedPromptSet}
          selectedPromptName={selectedPromptName}
          handleSelectPromptSet={handleSelectPromptSet}
          handleSelectPromptName={handleSelectPromptName}
          promptLibraryLoading={promptLibraryLoading}
          promptLibraryStatus={promptLibraryStatus}
          promptLibraryError={promptLibraryError}
          summaryPrompt={summaryPrompt}
          setSummaryPrompt={setSummaryPrompt}
          detailsPrompt={detailsPrompt}
          setDetailsPrompt={setDetailsPrompt}
          draftReady={draftReady}
          handleGenerateImages={handleGenerateImages}
          canGenerateImages={canGenerateImages}
          generatingImages={generatingImages}
          generationStatus={generationStatus}
          generationError={generationError}
          selectedAiTargets={selectedAiTargets}
          generatedSlots={generatedSlots}
          selectedGenerated={selectedGenerated}
          setSelectedGenerated={setSelectedGenerated}
          generatedImages={generatedImages}
          removeGeneratedImage={removeGeneratedImage}
          generationPromptLogs={generationPromptLogs}
          galleryItems={galleryItems}
          galleryLoading={galleryLoading}
          galleryRefreshing={galleryRefreshing}
          refreshGalleryItems={() => loadPreviewGalleryItems({ silent: true })}
          deleteGalleryItem={deleteGalleryItem}
        />

        <StageFourCard
          draftTitle={draftTitle}
          setDraftTitle={setDraftTitle}
          title={title}
          draftSummary={draftSummary}
          setDraftSummary={setDraftSummary}
          sectionBlocks={sectionBlocks}
          draftContent={draftContent}
          setDraftContent={setDraftContent}
          draftReady={draftReady}
          insertSectionBlock={insertSectionBlock}
          draftTopics={draftTopics}
          resolveSlotImage={resolveSlotImage}
          previewPath={previewPath}
          readinessChecks={readinessChecks}
          savedContentId={savedContentId}
          canPreview={canPreview}
          readinessComplete={readinessComplete}
          previewSaving={previewSaving}
          createAndOpenSaving={createAndOpenSaving}
          handleCreateAndOpenEditor={handleCreateAndOpenEditor}
          contentType={contentType}
        />
      </form>

      {result && (
        <FeedbackCard
          variant="success"
          message={result.message || 'Operation complete.'}
          contentId={result.contentId}
        />
      )}

      {error && <FeedbackCard variant="error" message={error} />}
    </div>
  );
}
