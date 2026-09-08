/**
 * Cover-image resolution when the feed supplies a video (issue #374).
 *
 * The case these guard is not hypothetical. On 2026-09-07 the published-pages
 * audit reported one broken image on
 * `/azure/blog/microsoft-foundry-end-to-end-observability-and-roi-for-production-ai-agents`,
 * and the deployed HTML held exactly one broken `<img>`:
 *
 *   <img alt="Build 2026: From observability to ROI for AI agents on any framework "
 *        src="https://devblogs.microsoft.com/foundry/wp-content/uploads/sites/89/2026/06/RUBRIC-EVALUATOR.mp4" …>
 *
 * — the article's hero, resolved from `contentImageUrl`, which the curated
 * feed had filled with a 5.3 MB `video/mp4`.
 */
import { describe, it, expect } from 'vitest';

import { isVideoUrl, normalizePublicImageUrl, pickPublicImageUrl } from '@/lib/blogUtils';

/** The exact URL the audit tripped over. */
const RUBRIC_EVALUATOR_MP4 =
  'https://devblogs.microsoft.com/foundry/wp-content/uploads/sites/89/2026/06/RUBRIC-EVALUATOR.mp4';

describe('isVideoUrl', () => {
  it('is true for the .mp4 the Foundry article carried as its cover', () => {
    expect(isVideoUrl(RUBRIC_EVALUATOR_MP4)).toBe(true);
  });

  it.each(['mp4', 'webm', 'ogv', 'ogg', 'mov', 'm4v', 'avi', 'mkv', 'm3u8'])(
    'is true for a .%s file',
    (ext) => {
      expect(isVideoUrl(`https://cdn.example.com/media/clip.${ext}`)).toBe(true);
    }
  );

  it('is true regardless of the case of the extension', () => {
    expect(isVideoUrl('https://cdn.example.com/media/CLIP.MP4')).toBe(true);
  });

  it.each(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'])(
    'is false for a .%s file',
    (ext) => {
      expect(isVideoUrl(`https://cdn.example.com/media/photo.${ext}`)).toBe(false);
    }
  );

  // A query string or fragment must not defeat the test in either direction.
  it('is true when a query string follows the extension', () => {
    expect(isVideoUrl('https://cdn.example.com/media/clip.mp4?w=1200&h=630')).toBe(true);
  });

  it('is true when a fragment follows the extension', () => {
    expect(isVideoUrl('https://cdn.example.com/media/clip.mp4#t=10')).toBe(true);
  });

  it('is false for an image whose query string merely mentions a video', () => {
    expect(isVideoUrl('https://cdn.example.com/media/photo.png?poster=clip.mp4')).toBe(false);
  });

  it('is false for an image whose fragment merely mentions a video', () => {
    expect(isVideoUrl('https://cdn.example.com/media/photo.png#clip.mp4')).toBe(false);
  });

  it('reads the last path segment, not a dot earlier in the path', () => {
    expect(isVideoUrl('https://cdn.example.com/v1.2/photo.png')).toBe(false);
    expect(isVideoUrl('https://cdn.example.com/v1.2/clip.mp4')).toBe(true);
  });

  it('handles a site-relative path', () => {
    expect(isVideoUrl('/api/public/media/covers/abc/inline/deadbeef.mp4')).toBe(true);
    expect(isVideoUrl('/api/public/media/covers/abc/inline/deadbeef.png')).toBe(false);
  });

  it('reads the declared media type of a data: URI rather than guessing', () => {
    expect(isVideoUrl('data:video/mp4;base64,AAAAIGZ0eXBpc29t')).toBe(true);
    expect(isVideoUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==')).toBe(false);
  });

  it('is false for a URL with no extension at all', () => {
    expect(isVideoUrl('https://cdn.example.com/media/photo')).toBe(false);
  });

  it.each([null, undefined, '', '   ', 42, {}])('is false for %p', (value) => {
    expect(isVideoUrl(value)).toBe(false);
  });
});

describe('normalizePublicImageUrl', () => {
  it('returns null for the Foundry cover video rather than a URL an <img> cannot paint', () => {
    expect(normalizePublicImageUrl(RUBRIC_EVALUATOR_MP4)).toBeNull();
  });

  it('returns null for a video that has already been re-hosted onto our own media path', () => {
    // #374 stores the file and rewrites the URL; that does not make it an image.
    expect(normalizePublicImageUrl('/api/public/media/covers/abc/inline/deadbeef.mp4')).toBeNull();
  });

  it('still returns an ordinary image URL unchanged', () => {
    const url = 'https://devblogs.microsoft.com/foundry/wp-content/uploads/rubric.webp';
    expect(normalizePublicImageUrl(url)).toBe(url);
  });

  it('still rewrites a storage.googleapis.com URL to its firebasestorage form', () => {
    expect(
      normalizePublicImageUrl('https://storage.googleapis.com/my-bucket/covers/hero.png')
    ).toBe('https://firebasestorage.googleapis.com/v0/b/my-bucket/o/covers%2Fhero.png?alt=media');
  });
});

describe('pickPublicImageUrl', () => {
  it('skips a video candidate and takes the real cover behind it', () => {
    // The shadowing case: `contentImageUrl` is first in every cover chain, so
    // a `||` chain would commit to the video and lose the AI cover entirely.
    expect(pickPublicImageUrl(RUBRIC_EVALUATOR_MP4, 'https://cdn.example.com/alt-cover.png')).toBe(
      'https://cdn.example.com/alt-cover.png'
    );
  });

  it('returns null when the only candidate is a video', () => {
    // This is the audited article exactly: contentImageUrl held the .mp4 and
    // the document carried no heroImageUrl, altCoverImage or imageUrl.
    expect(pickPublicImageUrl(RUBRIC_EVALUATOR_MP4, undefined, undefined, undefined)).toBeNull();
  });

  it('takes the first candidate when it is a usable image', () => {
    expect(
      pickPublicImageUrl('https://cdn.example.com/first.png', 'https://cdn.example.com/second.png')
    ).toBe('https://cdn.example.com/first.png');
  });

  it('skips empty and non-string candidates', () => {
    expect(
      pickPublicImageUrl(null, '', '   ', { downloadURL: 'x' }, 'https://cdn.example.com/ok.png')
    ).toBe('https://cdn.example.com/ok.png');
  });

  it('returns null when given nothing', () => {
    expect(pickPublicImageUrl()).toBeNull();
  });
});
