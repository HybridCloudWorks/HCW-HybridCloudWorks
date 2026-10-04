/**
 * Where a gallery row says it came from, now a table rather than a chain of
 * returns (PR #841).
 */
import { describe, it, expect } from 'vitest';
import { getSourceLabel, normalizeGalleryItem, sourceIdFor } from './imageGallerySource';

describe('sourceIdFor', () => {
  it('maps every legacy collection name, curated by either collection', () => {
    expect(sourceIdFor('anything', 'curated_article_images')).toBe('curated');
    expect(sourceIdFor('curated_article_images', '')).toBe('curated');
    expect(sourceIdFor('manual_upload', '')).toBe('upload');
    expect(sourceIdFor('preview', '')).toBe('preview');
    expect(sourceIdFor('import', '')).toBe('import');
    expect(sourceIdFor('rehost', '')).toBe('rehost');
    expect(sourceIdFor('content', '')).toBe('ai-cover');
    expect(sourceIdFor('generated_content_images', '')).toBe('ai-cover');
    expect(sourceIdFor('blogs', '')).toBe('ai-cover');
  });

  it('calls an unknown collection other, and nothing at all an AI cover', () => {
    expect(sourceIdFor('mystery', '')).toBe('other');
    expect(sourceIdFor('', '')).toBe('ai-cover');
    expect(sourceIdFor(undefined, undefined)).toBe('ai-cover');
  });
});

describe('getSourceLabel', () => {
  it('words a source id, or a legacy collection, and falls back to Generated', () => {
    expect(getSourceLabel('upload')).toBe('Uploaded');
    expect(getSourceLabel('manual_upload')).toBe('Uploaded');
    expect(getSourceLabel('mystery')).toBe('Generated');
    expect(getSourceLabel('')).toBe('AI cover');
  });
});

describe('normalizeGalleryItem', () => {
  it('keeps a stamped source and derives one otherwise', () => {
    expect(normalizeGalleryItem({ id: 'a', source: 'import' }, 'manual_upload').source).toBe(
      'import'
    );
    expect(normalizeGalleryItem({ id: 'b' }, 'curated_article_images').source).toBe('curated');
  });
});
