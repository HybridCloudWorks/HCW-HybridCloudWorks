/**
 * A gallery upload has to produce an image something can display.
 *
 * The defect (#602): uploads went to the `content` container. Every container
 * is private in Terraform, and only those in PUBLIC_MEDIA_CONTAINERS are
 * reachable through the media delivery route — so the upload route answered
 * 200 with `url: ''` by design, and the page wrote that empty string into the
 * gallery record. The image stored fine and was then unusable: no thumbnail on
 * the card, and "Use this image" handed an empty hero URL to the submit page.
 *
 * Nothing failed. That is what these tests are for — the container is asserted
 * because it is the fix, and the empty-URL guard is asserted because it is what
 * makes the next such mistake loud instead of silent.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import ImageGalleryPage from './ImageGalleryPage';

const postJSON = vi.fn();
const uploadImageFile = vi.fn();

const loadGalleryItems = vi.fn(() => Promise.resolve([]));

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
  getJSON: vi.fn(() => Promise.resolve({ items: [] })),
}));
// Only the network read is replaced; the derived-list helpers stay real, so
// the filter dropdowns below are rendered from the real code path.
vi.mock('@/lib/imageGallery', async (importOriginal) => ({
  ...(await importOriginal()),
  loadGalleryItems: (...args) => loadGalleryItems(...args),
}));
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
// The real module's validation is exercised as itself in imageUpload.test.js;
// here only the network call is replaced, so publicImageFileProblem and
// PUBLIC_IMAGE_EXTENSIONS stay real and the picker's accept list is the real
// one.
vi.mock('@/lib/imageUpload', async (importOriginal) => ({
  ...(await importOriginal()),
  uploadImageFile: (...args) => uploadImageFile(...args),
}));

const png = () => new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' });
const svg = () => new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });

/** Queue files on the picker and press Upload. */
async function upload(files) {
  const picker = document.querySelector('input[type="file"]');
  fireEvent.change(picker, { target: { files } });
  const button = await screen.findByRole('button', { name: /upload/i });
  fireEvent.click(button);
}

function recordCalls() {
  return postJSON.mock.calls.filter(([route]) => route === 'createManualGalleryImageRecord');
}

describe('a gallery upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postJSON.mockResolvedValue({ items: [] });
    loadGalleryItems.mockResolvedValue([]);
    uploadImageFile.mockResolvedValue({ url: '/api/public/media/covers/x/hero.png' });
  });

  it('goes to a container the media route actually serves', async () => {
    render(<ImageGalleryPage />);
    await upload([png()]);
    await waitFor(() => expect(uploadImageFile).toHaveBeenCalled());
    // `covers`, not `content`. This is the whole fix; if it moves again it has
    // to move to another container in PUBLIC_MEDIA_CONTAINERS.
    const [[uploadArgs]] = uploadImageFile.mock.calls;
    expect(uploadArgs.container).toBe('covers');
  });

  it('builds the path from the declared type, not the filename', async () => {
    // `.jfif` is what Windows writes for a JPEG saved from a browser. The
    // upload route requires the path's extension to agree with the content
    // type, so trusting the name made a perfectly valid file a 415 (#631).
    render(<ImageGalleryPage />);
    await upload([new File([new Uint8Array([1])], 'photo.jfif', { type: 'image/jpeg' })]);
    await waitFor(() => expect(uploadImageFile).toHaveBeenCalled());
    const [[args]] = uploadImageFile.mock.calls;
    expect(args.path.endsWith('.jpg')).toBe(true);
  });

  it('trusts the type over a filename that contradicts it', async () => {
    render(<ImageGalleryPage />);
    await upload([new File([new Uint8Array([1])], 'screenshot.jpg', { type: 'image/png' })]);
    await waitFor(() => expect(uploadImageFile).toHaveBeenCalled());
    const [[args]] = uploadImageFile.mock.calls;
    expect(args.path.endsWith('.png')).toBe(true);
  });

  it('records the URL the route returned, and the ref that can delete the blob', async () => {
    render(<ImageGalleryPage />);
    await upload([png()]);
    await waitFor(() => expect(recordCalls()).toHaveLength(1));
    const [[, body]] = recordCalls();
    expect(body.imageUrl).toBe('/api/public/media/covers/x/hero.png');
    // parseStorageRef splits on the first segment to find the blob to delete,
    // so the prefix has to be the container that was actually written.
    expect(body.storagePath.startsWith('covers/')).toBe(true);
  });

  it('creates no record when the route returns no URL', async () => {
    // The defect, reproduced: a private container answers 200 with url:''.
    // Persisting that is what made a stored image invisible everywhere.
    uploadImageFile.mockResolvedValue({ url: '', blobUrl: 'https://…/covers/x/hero.png' });
    render(<ImageGalleryPage />);
    await upload([png()]);
    await waitFor(() => expect(screen.getByText(/no public URL/i)).toBeInTheDocument());
    expect(recordCalls()).toHaveLength(0);
  });

  it('refuses a type the public container will not take, and names the file', async () => {
    render(<ImageGalleryPage />);
    await upload([svg()]);
    // SVG is a scriptable document; the route refuses it in any publicly
    // served container. Saying so here beats a 415 that names nothing.
    await waitFor(() => expect(screen.getByText(/logo\.svg/)).toBeInTheDocument());
    expect(uploadImageFile).not.toHaveBeenCalled();
    expect(recordCalls()).toHaveLength(0);
  });

  it('uploads the good files in a mixed batch and reports only the bad one', async () => {
    render(<ImageGalleryPage />);
    await upload([png(), svg()]);
    await waitFor(() => expect(recordCalls()).toHaveLength(1));
    expect(uploadImageFile).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/logo\.svg/)).toBeInTheDocument();
  });

  it('offers only the types the route accepts', async () => {
    render(<ImageGalleryPage />);
    const accept = document.querySelector('input[type="file"]').getAttribute('accept');
    expect(accept).not.toContain('image/*');
    expect(accept).toContain('image/png');
    expect(accept).not.toContain('svg');
  });
});

describe('the filter dropdowns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postJSON.mockResolvedValue({ items: [] });
    uploadImageFile.mockResolvedValue({ url: '/api/public/media/covers/x/hero.png' });
  });

  it('render the options derived from the loaded items', async () => {
    // The derivations moved to lib/imageGallery to get the component's exits
    // down. The move renamed the locals, and the three `<select>` blocks still
    // referred to the OLD names — which now resolve to the imported FUNCTIONS,
    // so `providerOptions.map` threw at render. Nothing in the suite noticed,
    // because nothing rendered a filter. This does.
    // `oracle` on purpose: the provider dropdown renders COMMON_PROVIDERS from
    // a static list and appends only the providers NOT in it, so a common one
    // would pass this test through the static path and prove nothing.
    loadGalleryItems.mockResolvedValue([
      { id: '1', provider: 'oracle', slot: 'hero', customTags: ['cloud'], folder: 'aws' },
    ]);
    render(<ImageGalleryPage />);
    await waitFor(() => expect(screen.getByRole('option', { name: 'ORACLE' })).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'hero' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'cloud' })).toBeInTheDocument();
  });
});
