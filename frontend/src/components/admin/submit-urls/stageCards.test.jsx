/**
 * Every Stage card renders (#634).
 *
 * These exist because of what moving them exposed. Lifting the cards out of
 * the page left FIVE references to things their new files did not import —
 * `PROVIDER_OPTIONS`, `BLOG_LANDING_ZONE_OPTIONS`, `getPublishTargetLabel`
 * (twice), `isSupportedDocumentUrl` and a namespaced `imageStage.` call — and
 * `npm run lint` reported **0 errors** for all of them. ESLint does not run
 * `no-undef` on these files, so an unbound identifier is a ReferenceError at
 * render time and silent everywhere else.
 *
 * That is the same failure as #629, where a rename left three `<select>`
 * blocks pointing at dead names and lint, build and every unit test passed
 * because nothing rendered them. A smoke render per card is the cheapest thing
 * that catches the whole class.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import StageOneCard from './StageOneCard';
import StageTwoCard from './StageTwoCard';
import StageThreeCard from './StageThreeCard';
import FeedbackCard, { SelectionSummaryCard, WorkflowHeader } from './pageChrome';

const noop = vi.fn();

describe('StageOneCard', () => {
  const props = {
    contentType: 'blog',
    setContentType: noop,
    provider: '',
    setProvider: noop,
    inferredProvider: '',
    blogLandingProvider: '',
    setBlogLandingProvider: noop,
    title: '',
    setTitle: noop,
    publishedDate: '',
    setPublishedDate: noop,
    previewPath: '/azure/blog/x',
    draftReady: false,
  };

  it('renders', () => {
    render(<StageOneCard {...props} />);
    expect(screen.getByText(/Stage 1/)).toBeInTheDocument();
  });

  it('offers every content type', () => {
    render(<StageOneCard {...props} />);
    for (const label of ['Blog', 'Framework', 'Architecture', 'Coder Corner']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });
});

describe('StageTwoCard', () => {
  const props = {
    contentType: 'blog',
    draftInstructionPrompt: 'prompt',
    setDraftInstructionPrompt: noop,
    supportingDocuments: [],
    handleSupportingDocumentUpload: noop,
    removeSupportingDocument: noop,
    kbDocumentUrl: '',
    setKbDocumentUrl: noop,
    kbDocumentUrls: [],
    addKbDocumentUrl: noop,
    removeKbDocumentUrl: noop,
    sourceUrl: '',
    setSourceUrl: noop,
    kbArticleUrls: [],
    addKbArticleUrl: noop,
    removeKbArticleUrl: noop,
    handleSubmitDraft: noop,
    submittingDraft: false,
    draftReady: false,
    frameworkSourceUrls: '',
    setFrameworkSourceUrls: noop,
    frameworkKnowledgePrompt: '',
    setFrameworkKnowledgePrompt: noop,
    frameworkDiagramPrompt: '',
    setFrameworkDiagramPrompt: noop,
    frameworkImagePrompt: '',
    setFrameworkImagePrompt: noop,
    frameworkConceptSeeds: '',
    setFrameworkConceptSeeds: noop,
  };

  it('renders', () => {
    render(<StageTwoCard {...props} />);
    // /Stage 2/ alone matches the description too, which mentions the stage.
    expect(screen.getAllByText('Stage 2: URL Submission').length).toBeGreaterThan(0);
  });

  it('gates the Add button on a supported document URL', () => {
    // isSupportedDocumentUrl is one of the imports the move dropped.
    const { rerender } = render(<StageTwoCard {...props} kbDocumentUrl="not-a-url" />);
    const disabled = screen.getAllByRole('button').filter((b) => b.disabled).length;
    rerender(<StageTwoCard {...props} kbDocumentUrl="https://e.com/a.pdf" />);
    expect(screen.getAllByRole('button').filter((b) => b.disabled).length).toBeLessThan(disabled);
  });

  it('renders the framework fields only for a framework draft', () => {
    const { rerender } = render(<StageTwoCard {...props} />);
    expect(screen.queryByText(/Framework Source URLs/i)).not.toBeInTheDocument();
    rerender(<StageTwoCard {...props} contentType="framework" />);
    expect(screen.getByText(/Framework Source URLs/i)).toBeInTheDocument();
  });
});

describe('StageThreeCard', () => {
  const props = {
    slotFiles: {},
    setSlotFiles: noop,
    uploadSlotImage: noop,
    uploadingSlot: '',
    slotUrls: {},
    selectedUploaded: {},
    setSelectedUploaded: noop,
    aiTargets: {},
    setAiTargets: noop,
    promptSets: [],
    promptNames: [],
    selectedPromptSet: '',
    selectedPromptName: '',
    handleSelectPromptSet: noop,
    handleSelectPromptName: noop,
    promptLibraryLoading: false,
    promptLibraryStatus: '',
    promptLibraryError: '',
    summaryPrompt: '',
    setSummaryPrompt: noop,
    detailsPrompt: '',
    setDetailsPrompt: noop,
    draftReady: true,
    handleGenerateImages: noop,
    canGenerateImages: false,
    generatingImages: false,
    generationStatus: '',
    generationError: '',
    selectedAiTargets: [],
    generatedSlots: [],
    selectedGenerated: {},
    setSelectedGenerated: noop,
    generatedImages: {},
    removeGeneratedImage: noop,
    generationPromptLogs: {},
    galleryItems: [],
    galleryLoading: false,
    galleryRefreshing: false,
    refreshGalleryItems: noop,
    deleteGalleryItem: noop,
  };

  it('renders', () => {
    render(<StageThreeCard {...props} />);
    expect(screen.getByText(/Stage 3/)).toBeInTheDocument();
  });

  it('offers a file picker for every slot', () => {
    // SLOT_IMAGE_ACCEPT reached this card through a namespace in the page and
    // would have been a ReferenceError here.
    const { container } = render(<StageThreeCard {...props} />);
    const pickers = container.querySelectorAll('input[type="file"]');
    expect(pickers).toHaveLength(4);
    expect(pickers[0].getAttribute('accept')).toContain('image/');
  });

  it('links each generated slot once one exists', () => {
    // A link to the blob, not an inline preview -- the slot list is a list.
    render(
      <StageThreeCard
        {...props}
        generatedSlots={[{ key: 'hero', label: 'Hero Image' }]}
        generatedImages={{ hero: '/m/hero.png' }}
        selectedGenerated={{ hero: true }}
      />
    );
    expect(screen.getByRole('link', { name: /Hero Image/ }).getAttribute('href')).toBe(
      '/m/hero.png'
    );
  });
});

describe('the page chrome', () => {
  it('renders the step header', () => {
    render(
      <WorkflowHeader
        currentStep={2}
        readinessComplete={false}
        readinessScore={3}
        readinessTotal={10}
      />
    );
    expect(screen.getByText(/3\/10/)).toBeInTheDocument();
  });

  it('renders the selection summary with the publish target', () => {
    // getPublishTargetLabel is another import the move dropped.
    render(
      <SelectionSummaryCard
        contentType="framework"
        resolvedProvider="Azure"
        resolvedBlogLandingProvider=""
        previewPath="/azure/frameworks/x"
      />
    );
    expect(screen.getAllByText(/Framework/).length).toBeGreaterThan(0);
  });

  it('links a success banner to the content queue', () => {
    render(<FeedbackCard variant="success" message="Saved." contentId="abc12345" />);
    expect(screen.getByRole('link').getAttribute('href')).toContain('source=content');
  });

  it('shows an error banner without a link', () => {
    render(<FeedbackCard variant="error" message="It failed." contentId="" />);
    expect(screen.getByText('It failed.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
