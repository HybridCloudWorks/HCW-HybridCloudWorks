/**
 * Nothing in the shipped data still renders as a broken image (#518).
 *
 * `frontend/data/content-manifest.json` carries 28 distinct URLs into
 * `hybridcloudworks-61e8d.appspot.com`, a Firebase Storage bucket that was
 * decommissioned with the migration to Azure. Verified 2026-09-12: the bucket
 * root and every one of those URLs returns **404**, checked against
 * `fonts.googleapis.com` and the live site as controls.
 *
 * They were believed to be preserved by a compatibility shim. They were not —
 * the shim rewrote one dead URL into another, so five published articles
 * rendered a broken frame and their `og:image` / `twitter:image` tags pointed
 * at 404s, breaking link previews as well as the page.
 *
 * This test does not assert the data is clean, because it is not: the rows
 * still hold those URLs and regenerating the manifest from Cosmos would bring
 * them back. It asserts the stronger and more useful thing — that whatever the
 * data holds, none of it reaches an `<img>`. That keeps holding if a row is
 * restored from an old backup, and it is why the fix lives in code rather than
 * in a one-off data edit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { normalizePublicImageUrl } from '@/lib/blogUtils';

const manifest = readFileSync(join(process.cwd(), 'data', 'content-manifest.json'), 'utf8');

/**
 * Every distinct URL into the retired bucket that the shipped manifest still
 * references.
 *
 * The two storage hosts by name, not `*.googleapis.com`. A broader match would
 * sweep in any other Google API that ever appears in content —
 * `fonts.googleapis.com`, say — and then demand it normalize to absent, which
 * is the opposite of correct for a URL that resolves perfectly well.
 */
const RETIRED_BUCKET_URL = /https?:\/\/(?:storage|firebasestorage)\.googleapis\.com\/[^"]+/gi;
const deadUrls = [...new Set(manifest.match(RETIRED_BUCKET_URL) ?? [])];

describe('the retired Firebase Storage bucket', () => {
  it('is still referenced by the manifest — this test exists because it is', () => {
    // If this ever reaches zero the data has been cleaned up, which is welcome.
    // Relax it to `toBeGreaterThanOrEqual(0)` then; do not delete the file,
    // because the normalizer is what keeps a restored backup harmless.
    expect(deadUrls.length).toBeGreaterThan(0);
  });

  it('renders none of them — every one normalizes to absent', () => {
    const leaked = deadUrls.filter((url) => normalizePublicImageUrl(url) !== null);
    expect(leaked).toEqual([]);
  });

  it('names the bucket that is gone, so the next reader can check for themselves', () => {
    expect(manifest).toContain('hybridcloudworks-61e8d.appspot.com');
  });

  // The narrowing above is the point of this case: a Google API that is not the
  // dead bucket must not be swept in and then required to normalize to absent.
  it('does not claim an unrelated Google API URL is a dead image', () => {
    const fonts = 'https://fonts.googleapis.com/css2?family=Roboto';
    expect(fonts.match(RETIRED_BUCKET_URL)).toBeNull();
    expect(normalizePublicImageUrl(fonts)).toBe(fonts);
  });
});
