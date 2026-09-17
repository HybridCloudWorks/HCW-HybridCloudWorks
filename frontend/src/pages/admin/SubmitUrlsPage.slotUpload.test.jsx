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
 * The write is module-level over a state bag (the linkWrites.js shape), so
 * these run against it directly rather than mounting a 2,859-line page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { uploadSlotImageFile } from './SubmitUrlsPage';

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
