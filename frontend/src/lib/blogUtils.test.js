/**
 * Cover-image resolution when the feed supplies a video (issue #374).
 *
 * What these tests guard is not hypothetical. On 2026-09-07 the published-pages
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

  // #518. This used to assert the rewrite, on the understanding that it
  // preserved images for migrated content. The bucket is gone: the root and
  // every asset URL still referenced by the content manifest return 404, so
  // the rewrite produced one dead URL from another and five published articles
  // rendered a broken frame with `og:image` pointing at a 404.
  it.each([
    'https://storage.googleapis.com/my-bucket/covers/hero.png',
    // `http` and mixed case too: AboutPage.jsx matches by regex rather than by
    // `new URL().hostname`, and the two must agree or one page renders a broken
    // image the other has learned to skip.
    'http://storage.googleapis.com/my-bucket/covers/hero.png',
    'HTTPS://FirebaseStorage.GoogleAPIs.com/v0/b/my-bucket/o/covers%2Fhero.png?alt=media',
    'https://firebasestorage.googleapis.com/v0/b/my-bucket/o/covers%2Fhero.png?alt=media',
    // A real one, from frontend/data/content-manifest.json.
    'https://firebasestorage.googleapis.com/v0/b/hybridcloudworks-61e8d.appspot.com/o/covers%2F1775288380237-hero.png?alt=media',
  ])('treats the retired Firebase bucket as absent: %s', (url) => {
    expect(normalizePublicImageUrl(url)).toBeNull();
  });

  it('leaves the Azure blob host alone, which is where images live now', () => {
    const url = 'https://stsiteprodcus01.blob.core.windows.net/covers/hero.png';
    expect(normalizePublicImageUrl(url)).toBe(url);
  });
});

describe('pickPublicImageUrl', () => {
  // The same shadowing problem the video case describes, with a dead image in
  // place of the video: `contentImageUrl` sits first in every cover chain, so
  // an article whose first candidate points at the retired bucket must fall
  // through to the Azure-hosted cover behind it rather than showing nothing.
  it('skips a retired-bucket candidate and takes the live cover behind it', () => {
    const live = 'https://stsiteprodcus01.blob.core.windows.net/covers/hero.png';
    expect(
      pickPublicImageUrl(
        'https://firebasestorage.googleapis.com/v0/b/hybridcloudworks-61e8d.appspot.com/o/covers%2Fgone.png?alt=media',
        live
      )
    ).toBe(live);
  });

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
