/**
 * The two reads the builder makes once, on load (PR #841): the preview
 * session id it files images under, and the hero image another page may
 * have asked it to reuse.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { takeReuseImage } from './builderSnapshot';
import { createPreviewSessionId } from './pageMeta';

describe('createPreviewSessionId', () => {
  it('is preview-<ms>-<8 hex>, and unique per call', () => {
    const id = createPreviewSessionId(1700000000000);
    expect(id).toMatch(/^preview-1700000000000-[0-9a-f]{8}$/);
    expect(createPreviewSessionId()).not.toBe(createPreviewSessionId());
  });
});

describe('takeReuseImage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('prefers the query string', () => {
    window.localStorage.setItem('contentforge_reuse_image', '/m/cached.png');
    expect(takeReuseImage('?reuseImage=%2Fm%2Fquery.png')).toBe('/m/query.png');
  });

  it('consumes the stored hand-off so it is used once', () => {
    window.localStorage.setItem('contentforge_reuse_image', '/m/cached.png');
    expect(takeReuseImage('')).toBe('/m/cached.png');
    expect(window.localStorage.getItem('contentforge_reuse_image')).toBeNull();
    expect(takeReuseImage('')).toBe('');
  });
});
