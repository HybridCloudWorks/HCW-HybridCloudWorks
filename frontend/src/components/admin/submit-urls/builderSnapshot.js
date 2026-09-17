/**
 * The Stage-1-to-4 draft kept in sessionStorage, so a reload does not lose it.
 *
 * Read and write both live here (#634). They were split across a module-level
 * reader and an inline effect, which is how the two lists of fields drifted
 * out of sight of each other.
 *
 * Every read is defaulted, because the snapshot is whatever an older version of
 * this page happened to write — a missing field is normal, not a fault.
 */
import { ensureTldrSectionAtEnd } from '@/lib/contentDraft';

import { DEFAULT_DRAFT_INSTRUCTION_PROMPT } from './draftStage';
import { EMPTY_SLOT_IDS, EMPTY_SLOT_URLS } from './imageStage';

const BUILDER_SESSION_STORAGE_KEY = 'hcw-publish-ready-builder-draft';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function readBuilderSnapshot() {
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

export function applyBuilderSnapshot(saved, setters) {
  applyPrimaryBuilderSnapshot(saved, setters);
  applyDraftBuilderSnapshot(saved, setters);
  applyImageBuilderSnapshot(saved, setters);
}

/**
 * Persist the snapshot, ignoring storage failures.
 *
 * Private browsing and a full quota both throw here, and neither is worth
 * interrupting the operator for: the draft is still intact in memory, it just
 * will not survive a reload.
 */
export function writeBuilderSnapshot(snapshot) {
  try {
    window.sessionStorage.setItem(BUILDER_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}
