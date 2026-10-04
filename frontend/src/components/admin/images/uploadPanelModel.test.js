/**
 * The non-rendering half of UploadPanel (ADR 0033): the queue skips what the
 * public container refuses and uploads the rest in order, and the sentences
 * the panel reports with say what they used to say inline.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildGalleryUploadData,
  importedMessage,
  importProblem,
  isHttpUrl,
  parseTagList,
  runUploadQueue,
  uploadedMessage,
} from './uploadPanelModel';

const png = (name = 'hero.png') =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
const svg = () => new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });

describe('runUploadQueue', () => {
  it('uploads the good files in order and names the rejected one', async () => {
    const upload = vi.fn(async (file) => file.name);
    const result = await runUploadQueue(
      [png('a.png'), svg(), png('b.png')],
      { folder: 'x' },
      upload
    );
    expect(result.uploaded).toEqual(['a.png', 'b.png']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatch(/^logo\.svg: /);
    // The index is the position in the queue, so the file numbers stay stable.
    expect(upload.mock.calls.map(([, index]) => index)).toEqual([0, 2]);
  });

  it('stops at the first failure so the error reaches the panel', async () => {
    const upload = vi.fn(async () => {
      throw new Error('no public URL');
    });
    await expect(runUploadQueue([png()], {}, upload)).rejects.toThrow('no public URL');
  });
});

describe('buildGalleryUploadData', () => {
  const options = { provider: '', slot: '', tags: [], rename: '', pullTags: false, folder: '' };

  it('takes the extension from the declared type and defaults the folder', () => {
    const data = buildGalleryUploadData({ file: png('photo.jfif'), index: 0, ...options });
    expect(data.extension).toBe('png');
    expect(data.storagePath).toMatch(/^image-gallery\/manual\/.*-photo-001\.png$/);
    expect(data.title).toBe('photo');
    expect(data.folder).toBe('default');
  });

  it('pulls tags from a hyphenated filename when asked, without duplicates', () => {
    const data = buildGalleryUploadData({
      file: png('aws-hero-diagram.png'),
      index: 1,
      ...options,
      tags: ['aws'],
      pullTags: true,
    });
    expect(data.allTags).toEqual(['aws', 'hero', 'diagram']);
  });

  it('refuses a type the gallery cannot store', () => {
    expect(() => buildGalleryUploadData({ file: svg(), index: 0, ...options })).toThrow(
      /logo\.svg/
    );
  });
});

describe('the helpers', () => {
  it('parse a tag line into lower-case tags', () => {
    expect(parseTagList(' Cloud, ,edge ')).toEqual(['cloud', 'edge']);
    expect(parseTagList('')).toEqual([]);
  });

  it('accept only full http(s) URLs for import', () => {
    expect(isHttpUrl('https://example.com/a.png')).toBe(true);
    expect(isHttpUrl('HTTP://example.com/a.png')).toBe(true);
    expect(isHttpUrl('example.com/a.png')).toBe(false);
  });

  it('word the upload and import summaries', () => {
    expect(uploadedMessage(1, 'aws')).toBe('1 image uploaded to the aws folder.');
    expect(uploadedMessage(2, 'aws')).toBe('2 images uploaded to the aws folder.');
    expect(importedMessage({ width: 800, height: 600, format: 'webp' }, 'aws')).toBe(
      'Imported 800 × 600 WEBP into the aws folder.'
    );
    expect(importedMessage({ format: 'png' }, 'default')).toBe(
      'Imported PNG into the default folder.'
    );
  });

  it('tell a duplicate (409) apart from a failed import', () => {
    const dup = Object.assign(new Error('Already in the gallery as img-1'), { status: 409 });
    expect(importProblem(dup)).toBe(
      'Already in the gallery as img-1. Search the gallery for it instead of importing twice.'
    );
    expect(importProblem(new Error('timeout'))).toBe('Import failed: timeout');
    expect(importProblem('boom')).toBe('Import failed: boom');
  });
});
