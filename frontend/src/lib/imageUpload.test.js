/**
 * The client-side mirror of the upload route's limits. The route is the
 * authority (functions/src/lib/admin-uploads.js); these only have to agree
 * with it, so a file it would refuse is refused here first with a message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const postJSON = vi.fn();
vi.mock('@/lib/api', () => ({ postJSON: (...args) => postJSON(...args) }));

import {
  MAX_IMAGE_UPLOAD_BYTES,
  PUBLIC_IMAGE_EXTENSIONS,
  imageExtensionFor,
  publicImageFileProblem,
  readFileAsBase64,
  uploadImageFile,
} from './imageUpload';

beforeEach(() => postJSON.mockReset());

describe('publicImageFileProblem', () => {
  it('accepts every public image type at the size limit', () => {
    for (const type of Object.keys(PUBLIC_IMAGE_EXTENSIONS)) {
      expect(publicImageFileProblem({ type, size: MAX_IMAGE_UPLOAD_BYTES })).toBe('');
    }
  });

  it('refuses SVG, which no public container accepts', () => {
    expect(publicImageFileProblem({ type: 'image/svg+xml', size: 10 })).toMatch(/PNG, JPEG/);
  });

  it('refuses non-images and a missing file', () => {
    expect(publicImageFileProblem({ type: 'application/pdf', size: 10 })).not.toBe('');
    expect(publicImageFileProblem({ type: '', size: 10 })).not.toBe('');
    expect(publicImageFileProblem(null)).toBe('No file selected');
  });

  it('refuses a file over the route’s 15 MB cap', () => {
    expect(publicImageFileProblem({ type: 'image/png', size: MAX_IMAGE_UPLOAD_BYTES + 1 })).toMatch(
      /15 MB/
    );
  });
});

describe('uploadImageFile', () => {
  it('posts bare base64 to the named container', async () => {
    postJSON.mockResolvedValue({ url: '/api/public/media/covers/a.png' });
    const file = new File(['hi'], 'a.png', { type: 'image/png' });

    expect(await readFileAsBase64(file)).toBe('aGk=');
    await expect(uploadImageFile({ container: 'covers', path: 'a/b.png', file })).resolves.toEqual({
      url: '/api/public/media/covers/a.png',
    });
    expect(postJSON).toHaveBeenCalledWith('cms/uploads/covers', {
      path: 'a/b.png',
      contentType: 'image/png',
      dataBase64: 'aGk=',
    });
  });
});

describe('imageExtensionFor', () => {
  const as = (type) => ({ type });

  it('answers the extension the route expects for each accepted type', () => {
    expect(imageExtensionFor(as('image/png'))).toBe('png');
    expect(imageExtensionFor(as('image/jpeg'))).toBe('jpg');
    expect(imageExtensionFor(as('image/webp'))).toBe('webp');
    expect(imageExtensionFor(as('image/gif'))).toBe('gif');
    expect(imageExtensionFor(as('image/avif'))).toBe('avif');
  });

  it('ignores the filename entirely, which is the point', () => {
    // The route requires the path's extension to agree with the declared type.
    // `.jfif` is what Windows writes for a JPEG saved from a browser, and a
    // PNG someone named `.jpg` is refused the same way — both 415s on files
    // that are perfectly valid. (#631)
    expect(imageExtensionFor({ name: 'photo.jfif', type: 'image/jpeg' })).toBe('jpg');
    expect(imageExtensionFor({ name: 'shot.jpg', type: 'image/png' })).toBe('png');
    expect(imageExtensionFor({ name: 'no-extension', type: 'image/webp' })).toBe('webp');
  });

  it('is case-insensitive about the type, as the route is', () => {
    expect(imageExtensionFor(as('Image/PNG'))).toBe('png');
  });

  it("answers '' for a type this route does not accept, rather than guessing", () => {
    // SVG is refused in every publicly served container; a guess here would
    // build a path the route then rejects for a different reason.
    for (const value of [as('image/svg+xml'), as('image/bmp'), as(''), null, undefined]) {
      expect(imageExtensionFor(value)).toBe('');
    }
  });
});
