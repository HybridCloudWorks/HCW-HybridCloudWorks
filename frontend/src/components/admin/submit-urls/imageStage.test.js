/**
 * Stage 3's "Upload Images" half, which had never worked (#630).
 *
 * Slot images went to the `content` container. Every container is private in
 * Terraform and only those in PUBLIC_MEDIA_CONTAINERS are reachable through
 * the media route, so the upload route answered 200 with `url: ''` by design.
 * The page stored that empty string — and an empty string is FALSY, so
 * `{slotUrls[key] && …}` never rendered the uploaded row. The operator pressed
 * Upload, the spinner finished, and nothing appeared: no error, no link, no
 * confirmation. Downstream, collectSelectedSlotImages drops the slot on
 * `.filter(Boolean(item.url))`, so `canPreview` and the article's hero were
 * computed as though nothing had been uploaded.
 *
 * The writes are module-level over a state bag (the linkWrites.js shape), so
 * these run against them directly rather than mounting the page (#634).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  clearGeneratedImageState,
  deleteGalleryItem,
  generateSlotImages,
  generationRequestFor,
  readGeneratedSlot,
  removeGeneratedImage,
  resolveSlotImage,
  uploadSlotImageFile,
} from './imageStage';

const postJSON = vi.fn();
vi.mock('@/lib/api', () => ({ postJSON: (...args) => postJSON(...args) }));

const uploadImageFile = vi.fn();
vi.mock('@/lib/imageUpload', async (importOriginal) => ({
  ...(await importOriginal()),
  uploadImageFile: (...args) => uploadImageFile(...args),
}));

function stateBag(slotFiles = {}) {
  return {
    slotFiles,
    setUploadingSlot: vi.fn(),
    setError: vi.fn(),
    setSlotUrls: vi.fn(),
    setSelectedUploaded: vi.fn(),
    setSlotFiles: vi.fn(),
  };
}

const file = (name, type) => new File([new Uint8Array([1, 2, 3])], name, { type });

describe('uploadSlotImageFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadImageFile.mockResolvedValue({ url: '/api/public/media/covers/x/hero.png' });
  });

  it('uploads to a container the media route serves', async () => {
    const state = stateBag();
    await uploadSlotImageFile(state, 'hero', file('shot.png', 'image/png'));
    const [[args]] = uploadImageFile.mock.calls;
    // `covers`, not `content`. If it moves again it has to move to another
    // container in PUBLIC_MEDIA_CONTAINERS.
    expect(args.container).toBe('covers');
    expect(args.path.startsWith('content-submissions/hero/')).toBe(true);
  });

  it('records the URL the route returned, and marks the slot selected', async () => {
    const state = stateBag();
    await uploadSlotImageFile(state, 'hero', file('shot.png', 'image/png'));
    const [[setter]] = state.setSlotUrls.mock.calls;
    expect(setter({})).toEqual({ hero: '/api/public/media/covers/x/hero.png' });
    expect(state.setSelectedUploaded).toHaveBeenCalled();
    expect(state.setError).not.toHaveBeenCalledWith(expect.stringContaining('no public URL'));
  });

  it('reports an error and stores nothing when the route returns no URL', async () => {
    // The defect, reproduced: a private container answers 200 with url:''.
    uploadImageFile.mockResolvedValue({ url: '' });
    const state = stateBag();
    await uploadSlotImageFile(state, 'hero', file('shot.png', 'image/png'));
    expect(state.setError).toHaveBeenCalledWith(expect.stringContaining('no public URL'));
    expect(state.setSlotUrls).not.toHaveBeenCalled();
    expect(state.setSelectedUploaded).not.toHaveBeenCalled();
  });

  it('derives the extension from the declared type, not the filename', async () => {
    // `.jfif` is what Windows writes for a JPEG saved from a browser. The route
    // requires the path's extension to agree with the content type, so trusting
    // the name here was a 415 on a perfectly valid file (#631).
    const state = stateBag();
    await uploadSlotImageFile(state, 'hero', file('photo.jfif', 'image/jpeg'));
    const [[args]] = uploadImageFile.mock.calls;
    expect(args.path.endsWith('.jpg')).toBe(true);
  });

  it('refuses SVG, which a publicly served container will not take', async () => {
    const state = stateBag();
    await uploadSlotImageFile(state, 'hero', file('logo.svg', 'image/svg+xml'));
    expect(uploadImageFile).not.toHaveBeenCalled();
    expect(state.setError).toHaveBeenCalledWith(expect.stringContaining('PNG, JPEG'));
    // Nothing is lost: an SVG here produced url:'' before, like every other
    // type, so it never worked either.
    expect(state.setSlotUrls).not.toHaveBeenCalled();
  });

  it('does nothing at all without a file', async () => {
    const state = stateBag();
    await uploadSlotImageFile(state, 'hero', null);
    expect(uploadImageFile).not.toHaveBeenCalled();
    expect(state.setUploadingSlot).not.toHaveBeenCalled();
  });

  it('falls back to the file queued for the slot when none is handed over', async () => {
    // The picker passes the file straight through; the Upload button does not,
    // and relies on this. Resolving it inside keeps the branch out of the page.
    const queued = file('queued.png', 'image/png');
    const state = stateBag({ hero: queued });
    await uploadSlotImageFile(state, 'hero', undefined);
    const [[args]] = uploadImageFile.mock.calls;
    expect(args.file).toBe(queued);
  });

  it('always clears the spinner, including when the upload throws', async () => {
    uploadImageFile.mockRejectedValue(new Error('network down'));
    const state = stateBag();
    await uploadSlotImageFile(state, 'hero', file('shot.png', 'image/png'));
    expect(state.setError).toHaveBeenCalledWith('network down');
    expect(state.setUploadingSlot).toHaveBeenLastCalledWith('');
  });
});

function generationBag(overrides = {}) {
  return {
    canGenerateImages: true,
    selectedAiTargets: ['hero'],
    summaryPrompt: 'a summary prompt',
    detailsPrompt: 'a details prompt',
    selectedSlotTemplates: { hero: 'wide' },
    draftTitle: 'A title',
    draftSummary: 'A summary',
    resolvedProvider: 'Azure',
    contentType: 'blog',
    kbArticleUrls: [],
    sourceUrl: '  https://example.com/a  ',
    previewSessionId: 'session-1',
    generatedImages: {},
    generatedImageIds: {},
    slotUrls: {},
    selectedUploaded: {},
    selectedGenerated: {},
    setError: vi.fn(),
    setResult: vi.fn(),
    setGalleryItems: vi.fn(),
    setGeneratedImageIds: vi.fn(),
    setGeneratedImages: vi.fn(),
    setGeneratingImages: vi.fn(),
    setGenerationError: vi.fn(),
    setGenerationPromptLogs: vi.fn(),
    setGenerationStatus: vi.fn(),
    setSelectedGenerated: vi.fn(),
    ...overrides,
  };
}

const generated = (slot, url, imageId = 'img-1', promptLog = null) => ({
  imageUrls: { [slot]: url },
  imageRecords: { [slot]: { imageId } },
  promptLogs: promptLog ? { [slot]: promptLog } : {},
});

describe('generationRequestFor', () => {
  it('prefers the first KB article URL over the single source URL', () => {
    const state = generationBag({ kbArticleUrls: ['https://kb.example.com/1'] });
    expect(generationRequestFor(state, 'hero').sourceUrl).toBe('https://kb.example.com/1');
  });

  it('falls back to the trimmed source URL when there are no KB articles', () => {
    // The trim matters: the field is free text and a trailing space reaches
    // the generator as part of the URL.
    expect(generationRequestFor(generationBag(), 'hero').sourceUrl).toBe('https://example.com/a');
  });

  it('asks for exactly the one slot it was given', () => {
    expect(generationRequestFor(generationBag(), 'secondary').aiImageTargets).toEqual([
      'secondary',
    ]);
  });
});

describe('readGeneratedSlot', () => {
  it('throws naming the slot when no URL came back', () => {
    // Not a silent skip: a slot with no image must not end up marked selected,
    // which is the shape of the defect the upload path had until #630.
    expect(() => readGeneratedSlot(generated('hero', ''), 'hero')).toThrow(/hero/);
  });

  it('survives a response missing the records and logs entirely', () => {
    expect(readGeneratedSlot({ imageUrls: { hero: '/m/a.png' } }, 'hero')).toEqual({
      imageUrl: '/m/a.png',
      imageId: '',
      promptLog: null,
    });
  });
});

describe('generateSlotImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postJSON.mockResolvedValue(generated('hero', '/m/hero.png'));
  });

  it('does nothing when generation is not available', async () => {
    const state = generationBag({ canGenerateImages: false });
    await generateSlotImages(state);
    expect(postJSON).not.toHaveBeenCalled();
    expect(state.setGeneratingImages).not.toHaveBeenCalled();
  });

  it('sends one request per selected slot, in order', async () => {
    postJSON
      .mockResolvedValueOnce(generated('hero', '/m/hero.png'))
      .mockResolvedValueOnce(generated('secondary', '/m/secondary.png'));
    await generateSlotImages(generationBag({ selectedAiTargets: ['hero', 'secondary'] }));
    expect(postJSON).toHaveBeenCalledTimes(2);
    const [[, first], [, second]] = postJSON.mock.calls;
    expect(first.aiImageTargets).toEqual(['hero']);
    expect(second.aiImageTargets).toEqual(['secondary']);
  });

  it('stores the image and marks the slot selected', async () => {
    const state = generationBag();
    await generateSlotImages(state);
    const [[setter]] = state.setGeneratedImages.mock.calls;
    expect(setter({})).toEqual({ hero: '/m/hero.png' });
    expect(state.setSelectedGenerated).toHaveBeenCalled();
  });

  it('does not store a prompt log that was not returned', async () => {
    const state = generationBag();
    await generateSlotImages(state);
    expect(state.setGenerationPromptLogs).not.toHaveBeenCalled();
  });

  it('reports the count of slots actually collected', async () => {
    const state = generationBag();
    await generateSlotImages(state);
    const [[result]] = state.setResult.mock.calls;
    expect(result).toEqual({ stage: 3, message: expect.stringContaining('1 image slot(s)') });
  });

  it('abandons the remaining slots when one returns no URL, and reports it', async () => {
    postJSON
      .mockResolvedValueOnce(generated('hero', '/m/hero.png'))
      .mockResolvedValueOnce(generated('secondary', ''));
    const state = generationBag({ selectedAiTargets: ['hero', 'secondary', 'tertiary'] });
    await generateSlotImages(state);
    // Two requests, not three: the second failed and the third never ran.
    expect(postJSON).toHaveBeenCalledTimes(2);
    expect(state.setGenerationError).toHaveBeenCalledWith(expect.stringContaining('secondary'));
    // No summary, because the run did not finish — but hero stays stored.
    expect(state.setResult).not.toHaveBeenCalled();
    expect(state.setGeneratedImages).toHaveBeenCalledTimes(1);
  });

  it('always clears the spinner and the status line, including on failure', async () => {
    postJSON.mockRejectedValue(new Error('generator down'));
    const state = generationBag();
    await generateSlotImages(state);
    expect(state.setError).toHaveBeenCalledWith('generator down');
    expect(state.setGeneratingImages).toHaveBeenLastCalledWith(false);
    expect(state.setGenerationStatus).toHaveBeenLastCalledWith('');
  });
});

describe('clearGeneratedImageState', () => {
  it('removes the slot from every generated map, prompt log included', () => {
    const state = generationBag();
    clearGeneratedImageState(state, 'hero');
    const [[images]] = state.setGeneratedImages.mock.calls;
    const [[ids]] = state.setGeneratedImageIds.mock.calls;
    const [[selected]] = state.setSelectedGenerated.mock.calls;
    const [[logs]] = state.setGenerationPromptLogs.mock.calls;
    expect(images({ hero: '/m/a.png' })).toEqual({ hero: '' });
    expect(ids({ hero: 'img-1' })).toEqual({ hero: '' });
    expect(selected({ hero: true })).toEqual({ hero: false });
    // Deleted rather than blanked: the log panel keys off presence.
    expect(logs({ hero: { prompt: 'x' }, secondary: { prompt: 'y' } })).toEqual({
      secondary: { prompt: 'y' },
    });
  });
});

describe('removeGeneratedImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postJSON.mockResolvedValue({});
  });

  it('keeps the image when the server-side delete fails', async () => {
    // Load-bearing: clearing locally after a failed delete leaves the operator
    // looking at an empty slot backed by a live blob they can no longer reach.
    postJSON.mockRejectedValue(new Error('delete refused'));
    const state = generationBag({ generatedImageIds: { hero: 'img-1' } });
    await removeGeneratedImage(state, 'hero');
    expect(state.setError).toHaveBeenCalledWith('delete refused');
    expect(state.setGeneratedImages).not.toHaveBeenCalled();
    expect(state.setGalleryItems).not.toHaveBeenCalled();
  });

  it('clears the slot locally without calling the server when nothing was stored', async () => {
    const state = generationBag({ generatedImageIds: {} });
    await removeGeneratedImage(state, 'hero');
    expect(postJSON).not.toHaveBeenCalled();
    expect(state.setGeneratedImages).toHaveBeenCalled();
  });

  it('drops the image from the gallery list once the delete succeeds', async () => {
    const state = generationBag({ generatedImageIds: { hero: 'img-1' } });
    await removeGeneratedImage(state, 'hero');
    const [[setter]] = state.setGalleryItems.mock.calls;
    expect(setter([{ id: 'img-1' }, { id: 'img-2' }])).toEqual([{ id: 'img-2' }]);
  });
});

describe('deleteGalleryItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postJSON.mockResolvedValue({});
  });

  it('ignores an item with no id', async () => {
    await deleteGalleryItem(generationBag(), { slot: 'hero' });
    expect(postJSON).not.toHaveBeenCalled();
  });

  it('also clears the slot when the deleted image is the one it holds', async () => {
    // Otherwise Stage 4 carries a hero URL pointing at a blob that is gone.
    const state = generationBag({ generatedImageIds: { hero: 'img-1' } });
    await deleteGalleryItem(state, { id: 'img-1', slot: 'hero' });
    expect(state.setGeneratedImages).toHaveBeenCalled();
  });

  it('leaves the slot alone when a different image is deleted', async () => {
    const state = generationBag({ generatedImageIds: { hero: 'img-1' } });
    await deleteGalleryItem(state, { id: 'img-9', slot: 'hero' });
    expect(state.setGeneratedImages).not.toHaveBeenCalled();
  });

  it('reports a failed delete and removes nothing', async () => {
    postJSON.mockRejectedValue(new Error('gallery delete refused'));
    const state = generationBag();
    await deleteGalleryItem(state, { id: 'img-1' });
    expect(state.setError).toHaveBeenCalledWith('gallery delete refused');
    expect(state.setGalleryItems).not.toHaveBeenCalled();
  });
});

describe('resolveSlotImage', () => {
  it('prefers the uploaded image over the generated one', () => {
    const state = generationBag({
      slotUrls: { hero: '/m/up.png' },
      selectedUploaded: { hero: true },
      generatedImages: { hero: '/m/gen.png' },
      selectedGenerated: { hero: true },
    });
    expect(resolveSlotImage(state, 'hero')).toBe('/m/up.png');
  });

  it('ignores an uploaded image the operator deselected', () => {
    // Presence is not selection, which is why this cannot collapse to
    // `slotUrls[slot] || generatedImages[slot]`.
    const state = generationBag({
      slotUrls: { hero: '/m/up.png' },
      selectedUploaded: { hero: false },
      generatedImages: { hero: '/m/gen.png' },
      selectedGenerated: { hero: true },
    });
    expect(resolveSlotImage(state, 'hero')).toBe('/m/gen.png');
  });

  it('is empty when nothing is selected', () => {
    expect(resolveSlotImage(generationBag(), 'hero')).toBe('');
  });
});
