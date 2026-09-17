import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { getJSON } from '@/lib/api';
import { useImagePrompts } from '@/hooks/useImagePrompts';
import * as draftStage from '@/components/admin/submit-urls/draftStage';
import {
  DEFAULT_DRAFT_INSTRUCTION_PROMPT,
  isValidHttpUrl,
} from '@/components/admin/submit-urls/draftStage';
import * as imageStage from '@/components/admin/submit-urls/imageStage';
import {
  EMPTY_SLOT_FILES,
  EMPTY_SLOT_IDS,
  EMPTY_SLOT_TEMPLATES,
  EMPTY_SLOT_URLS,
  IMAGE_SLOTS,
} from '@/components/admin/submit-urls/imageStage';
import * as persistStage from '@/components/admin/submit-urls/persistStage';
import * as promptStage from '@/components/admin/submit-urls/promptStage';
import {
  applyBuilderSnapshot,
  readBuilderSnapshot,
  writeBuilderSnapshot,
} from '@/components/admin/submit-urls/builderSnapshot';
import {
  buildReadinessChecks,
  canGenerateDraftImages,
  getCurrentStep,
  getPreviewSection,
  getPromptLibraryPagePath,
  getPublishTargetLabel,
  getResolvedBlogLandingProvider,
  getResolvedProvider,
  inferProviderFromUrl,
  slugifyTitle,
} from '@/components/admin/submit-urls/pageMeta';
import StageOneCard from '@/components/admin/submit-urls/StageOneCard';
import StageTwoCard from '@/components/admin/submit-urls/StageTwoCard';
import StageThreeCard from '@/components/admin/submit-urls/StageThreeCard';
import StageFourCard from '@/components/admin/submit-urls/StageFourCard';
import FeedbackCard, {
  SelectionSummaryCard,
  WorkflowHeader,
} from '@/components/admin/submit-urls/pageChrome';
import { SECTION_BLOCKS_BY_TYPE } from '@/components/admin/submit-urls/contentBlocks';

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
  const [previewSessionId] = useState(() => {
    const rand =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID().slice(0, 8)
        : Array.from(globalThis.crypto.getRandomValues(new Uint8Array(4)), (b) =>
            b.toString(16).padStart(2, '0')
          ).join('');
    return `preview-${Date.now()}-${rand}`;
  });

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

    writeBuilderSnapshot(snapshot);
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
      imageStage.collectSelectedSlotImages({
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

  /**
   * The prompt library's machinery is in promptStage.js over this bag (#634).
   * Built inside each hook below rather than once in the body, because the
   * load is an effect and a bag rebuilt every render cannot be a dependency.
   */
  const promptBag = () => ({
    promptLibraryPagePath,
    selectedPromptSet,
    fetchPageAssignment,
    fetchPrompt,
    fetchPromptNames,
    fetchPromptSet,
    fetchPromptSets,
    savePageAssignment,
    setDetailsPrompt,
    setPromptLibraryError,
    setPromptLibraryLoading,
    setPromptLibraryStatus,
    setPromptNames,
    setPromptSets,
    setSelectedPromptName,
    setSelectedPromptSet,
    setSelectedSlotTemplates,
    setSummaryPrompt,
  });

  React.useEffect(() => {
    let cancelled = false;
    promptStage.loadPromptLibrary(
      {
        promptLibraryPagePath,
        fetchPageAssignment,
        fetchPrompt,
        fetchPromptNames,
        fetchPromptSet,
        fetchPromptSets,
        setDetailsPrompt,
        setPromptLibraryError,
        setPromptLibraryLoading,
        setPromptLibraryStatus,
        setPromptNames,
        setPromptSets,
        setSelectedPromptName,
        setSelectedPromptSet,
        setSelectedSlotTemplates,
        setSummaryPrompt,
      },
      () => cancelled
    );

    return () => {
      cancelled = true;
    };
  }, [
    fetchPageAssignment,
    fetchPrompt,
    fetchPromptNames,
    fetchPromptSet,
    fetchPromptSets,
    promptLibraryPagePath,
  ]);

  const handleSelectPromptSet = (setName) => promptStage.selectPromptSet(promptBag(), setName);
  const handleSelectPromptName = (promptName) =>
    promptStage.selectPromptName(promptBag(), promptName);

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

  /**
   * Stage 2's machinery lives in draftStage.js over this bag (#634), the same
   * shape as imageState below. The useCallback wrappers these replace bought
   * nothing: no consumer is memoized and none of them appears in a dependency
   * array, so a stable identity was never read by anything.
   */
  const draftState = {
    draftContent,
    draftInstructionPrompt,
    draftReady,
    kbArticleUrls,
    kbDocumentUrl,
    kbDocumentUrls,
    provider,
    sourceUrl,
    supportingDocuments,
    title,
    resetGeneratedDraftAssets,
    setDetailsPrompt,
    setDraftContent,
    setDraftReady,
    setDraftSummary,
    setDraftTitle,
    setDraftTopics,
    setError,
    setKbArticleUrls,
    setKbDocumentUrl,
    setKbDocumentUrls,
    setResult,
    setSourceUrl,
    setSubmittingDraft,
    setSummaryPrompt,
    setSupportingDocuments,
  };

  const handleSupportingDocumentUpload = (e) => draftStage.addSupportingDocuments(draftState, e);
  const removeSupportingDocument = (id) => draftStage.removeSupportingDocument(draftState, id);
  const addKbDocumentUrl = () => draftStage.addKbDocumentUrl(draftState);
  const removeKbDocumentUrl = (url) => draftStage.removeKbDocumentUrl(draftState, url);
  const addKbArticleUrl = () => draftStage.addKbArticleUrl(draftState);
  const removeKbArticleUrl = (url) => draftStage.removeKbArticleUrl(draftState, url);
  const insertSectionBlock = (section) => draftStage.insertSectionBlock(draftState, section);
  const handleSubmitDraft = (e) => draftStage.submitDraft(draftState, e);

  /**
   * Stage 3's machinery lives in imageStage.js as module-level functions over
   * this bag (#634). Rebuilt every render, which is what keeps the reads
   * current — the functions receive it per call and never hold on to it.
   */
  const imageState = {
    canGenerateImages,
    contentType,
    detailsPrompt,
    draftSummary,
    draftTitle,
    generatedImageIds,
    generatedImages,
    kbArticleUrls,
    previewSessionId,
    resolvedProvider,
    selectedAiTargets,
    selectedGenerated,
    selectedSlotTemplates,
    selectedUploaded,
    slotFiles,
    slotUrls,
    sourceUrl,
    summaryPrompt,
    setError,
    setGalleryItems,
    setGeneratedImageIds,
    setGeneratedImages,
    setGeneratingImages,
    setGenerationError,
    setGenerationPromptLogs,
    setGenerationStatus,
    setResult,
    setSelectedGenerated,
    setSelectedUploaded,
    setSlotFiles,
    setSlotUrls,
    setUploadingSlot,
  };

  const uploadSlotImage = (slot, explicitFile) =>
    imageStage.uploadSlotImageFile(imageState, slot, explicitFile);
  const handleGenerateImages = () => imageStage.generateSlotImages(imageState);
  const removeGeneratedImage = (slot) => imageStage.removeGeneratedImage(imageState, slot);
  const deleteGalleryItem = (item) => imageStage.deleteGalleryItem(imageState, item);
  const resolveSlotImage = (slot) => imageStage.resolveSlotImage(imageState, slot);

  /**
   * Stage 4 is the only stage that writes anything durable; its machinery is
   * in persistStage.js over this bag (#634).
   */
  const persistState = {
    canPreview,
    contentType,
    draftContent,
    draftSummary,
    draftTitle,
    draftTopics,
    detailsPrompt,
    frameworkConceptSeeds,
    frameworkDiagramPrompt,
    frameworkImagePrompt,
    frameworkKnowledgePrompt,
    frameworkSourceUrls,
    generatedImages,
    kbArticleUrls,
    publishedDate,
    readinessComplete,
    resolvedBlogLandingProvider,
    resolvedProvider,
    selectedGenerated,
    selectedUploaded,
    slotUrls,
    sourceUrl,
    summaryPrompt,
    title,
    navigate,
    setCreateAndOpenSaving,
    setError,
    setPreviewSaving,
    setResult,
    setSavedContentId,
  };

  const handlePreviewSave = (e) => persistStage.savePreview(persistState, e);
  const handleCreateAndOpenEditor = () => persistStage.createAndOpenEditor(persistState);

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
          saveLabel={`${getPublishTargetLabel(contentType)} Draft`}
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
