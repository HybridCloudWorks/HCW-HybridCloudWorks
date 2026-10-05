/**
 * legacy-badge-url.js — the string rewrite that gives a fifth of the
 * certification registry its badge back (#868): a Firebase or GCS object URL
 * for a `certifications/…` path becomes the media delivery URL, and nothing
 * else is touched.
 */
import { describe, it, expect } from 'vitest';
import {
  legacyBadgePath,
  legacyBadgePathsOf,
  repointCertification,
  repointLegacyBadgeUrl,
} from './legacy-badge-url.js';

const FIREBASE =
  'https://firebasestorage.googleapis.com/v0/b/hybridcloudworks-61e8d.appspot.com/o/certifications%2F74GrtQFAFkhRgYWUTkf8%2Fimages%2Fbadge-image.png?alt=media';
const GCS =
  'https://storage.googleapis.com/hybridcloudworks-61e8d.appspot.com/certifications/74GrtQFAFkhRgYWUTkf8/images/badge-image.png';
const MEDIA = '/api/public/media/certifications/74GrtQFAFkhRgYWUTkf8/images/badge-image.png';

describe('legacyBadgePath', () => {
  it('reads the certifications path out of both Firebase shapes', () => {
    expect(legacyBadgePath(FIREBASE)).toBe('74GrtQFAFkhRgYWUTkf8/images/badge-image.png');
    expect(legacyBadgePath(GCS)).toBe('74GrtQFAFkhRgYWUTkf8/images/badge-image.png');
    expect(legacyBadgePath(`  ${FIREBASE}  `)).toBe('74GrtQFAFkhRgYWUTkf8/images/badge-image.png');
  });

  it('is null for anything that is not a legacy certifications object', () => {
    expect(legacyBadgePath('https://images.credly.com/size/340x340/images/x/image.png')).toBeNull();
    expect(legacyBadgePath(MEDIA)).toBeNull();
    expect(
      legacyBadgePath(
        'https://firebasestorage.googleapis.com/v0/b/b.appspot.com/o/blogs%2Fpost%2Fhero.png?alt=media'
      )
    ).toBeNull();
    expect(
      legacyBadgePath(
        'https://firebasestorage.googleapis.com/v0/b/b.appspot.com/o/certifications%2F..%2Fsecret.png?alt=media'
      )
    ).toBeNull();
    expect(legacyBadgePath('https://firebasestorage.googleapis.com/v0/b/b/o/%E0%A4%A?alt=media')).toBeNull();
    expect(legacyBadgePath(null)).toBeNull();
    expect(legacyBadgePath(42)).toBeNull();
  });
});

describe('repointLegacyBadgeUrl', () => {
  it('names the same path on the media route, encoded segment by segment', () => {
    expect(repointLegacyBadgeUrl(FIREBASE)).toBe(MEDIA);
    expect(repointLegacyBadgeUrl('https://example.com/x.png')).toBeNull();
  });
});

describe('legacyBadgePathsOf', () => {
  it('collects every field a legacy document may carry the badge in, once', () => {
    const doc = {
      imageUrl: FIREBASE,
      credentialImage: FIREBASE,
      image: [{ downloadURL: GCS }],
    };
    expect(legacyBadgePathsOf(doc)).toEqual(['74GrtQFAFkhRgYWUTkf8/images/badge-image.png']);
    expect(legacyBadgePathsOf({ imageUrl: MEDIA })).toEqual([]);
    expect(legacyBadgePathsOf({})).toEqual([]);
  });
});

describe('repointCertification', () => {
  const path = '74GrtQFAFkhRgYWUTkf8/images/badge-image.png';

  it('sets imageUrl and rewrites the legacy fields that named the old URL', () => {
    const doc = {
      id: 'c1',
      name: 'MCT',
      credentialImage: FIREBASE,
      image: [{ downloadURL: FIREBASE, name: 'badge-image.png' }],
    };
    const { doc: out, changes } = repointCertification(doc, path);
    expect(changes).toEqual({
      imageUrl: MEDIA,
      credentialImage: MEDIA,
      image: [{ downloadURL: MEDIA, name: 'badge-image.png' }],
    });
    expect(out).toEqual({ ...doc, ...changes });
    expect(doc.credentialImage).toBe(FIREBASE);
  });

  it('leaves a field that names a different image alone', () => {
    const other = 'https://images.credly.com/x.png';
    const { changes } = repointCertification({ imageUrl: other, credentialImage: FIREBASE }, path);
    expect(changes).toEqual({ credentialImage: MEDIA });
  });

  it('returns the same object when nothing named the path', () => {
    const doc = { imageUrl: MEDIA };
    const out = repointCertification(doc, path);
    expect(out.doc).toBe(doc);
    expect(out.changes).toEqual({});
  });
});
