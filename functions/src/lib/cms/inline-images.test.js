import { describe, it, expect, vi } from 'vitest';

import {
  BODY_FIELDS,
  INLINE_IMAGE_CONTAINER,
  buildInlineImageUpdate,
  createInlineImageRehoster,
  findInlineImageUrls,
  inlineBlobPath,
  isOwnMediaUrl,
  resolveBodyField,
  rewriteBody,
} from './inline-images.js';

const UPSTREAM_A = 'https://devblogs.microsoft.com/foundry/wp-content/uploads/a.png';
const UPSTREAM_B = 'https://cdn.example.org/diagram.webp';

const BODY = [
  '<p>Intro</p>',
  `<img src="${UPSTREAM_A}" alt="Rubric" width="600">`,
  `Some markdown ![Diagram](${UPSTREAM_B} "Architecture")`,
  `<img alt="again" src='${UPSTREAM_A}'>`,
  '![own](/api/public/media/covers/c1/cover.png)',
  '![site](https://hybridcloudworks.com/icons/hcw-logo.png)',
  '![relative](/images/local.png)',
  '<img src="data:image/png;base64,AAAA">',
].join('\n');

describe('findInlineImageUrls', () => {
  it('returns each external image once, HTML and markdown, in first-seen order', () => {
    expect(findInlineImageUrls(BODY)).toEqual([UPSTREAM_A, UPSTREAM_B]);
  });

  it('ignores the site itself, relative paths and data URIs', () => {
    expect(findInlineImageUrls('![x](/api/public/media/covers/a/b.png)')).toEqual([]);
    expect(findInlineImageUrls('<img src="https://www.hybridcloudworks.com/x.png">')).toEqual([]);
    expect(findInlineImageUrls('<img src="/local.png">')).toEqual([]);
    expect(findInlineImageUrls('<img src="data:image/gif;base64,R0lGOD">')).toEqual([]);
    expect(findInlineImageUrls('')).toEqual([]);
    expect(findInlineImageUrls(null)).toEqual([]);
  });

  it('isOwnMediaUrl recognises the media path and both site hosts only', () => {
    expect(isOwnMediaUrl('/api/public/media/covers/x.png')).toBe(true);
    expect(isOwnMediaUrl('https://hybridcloudworks.com/a.png')).toBe(true);
    expect(isOwnMediaUrl('https://hybridcloudworks.com.evil.example/a.png')).toBe(false);
    expect(isOwnMediaUrl(UPSTREAM_A)).toBe(false);
    expect(isOwnMediaUrl(42)).toBe(false);
  });
});

describe('resolveBodyField', () => {
  it('follows the article page precedence: blogDraft, Content, content', () => {
    expect(BODY_FIELDS).toEqual(['blogDraft', 'Content', 'content']);
    expect(resolveBodyField({ content: 'c', Content: 'C', blogDraft: 'd' })).toBe('blogDraft');
    expect(resolveBodyField({ content: 'c', Content: 'C' })).toBe('Content');
    expect(resolveBodyField({ content: 'c' })).toBe('content');
    expect(resolveBodyField({ blogDraft: '   ', content: 'c' })).toBe('content');
    expect(resolveBodyField({})).toBeNull();
  });
});

describe('inlineBlobPath and rewriteBody', () => {
  it('names the blob by article and a hash of the URL, with the MIME extension', () => {
    const p = inlineBlobPath('c1', UPSTREAM_A, 'image/webp');
    expect(p).toMatch(/^c1\/inline\/[0-9a-f]{16}\.webp$/);
    expect(inlineBlobPath('c1', UPSTREAM_A, 'image/webp')).toBe(p);
    expect(inlineBlobPath('c1', UPSTREAM_B, 'image/webp')).not.toBe(p);
    expect(inlineBlobPath('c2', UPSTREAM_A, 'image/webp')).not.toBe(p);
    expect(inlineBlobPath('c1', UPSTREAM_A, 'application/octet-stream')).toMatch(/\.png$/);
  });

  it('replaces every occurrence and touches nothing else', () => {
    const out = rewriteBody(BODY, [
      { from: UPSTREAM_A, to: '/api/public/media/covers/c1/inline/x.png' },
    ]);
    expect(out).not.toContain(UPSTREAM_A);
    expect(out.match(/\/api\/public\/media\/covers\/c1\/inline\/x\.png/g)).toHaveLength(2);
    expect(out).toContain(UPSTREAM_B);
    expect(rewriteBody(BODY, [])).toBe(BODY);
  });
});

describe('createInlineImageRehoster', () => {
  const png = { buffer: Buffer.from('png-bytes'), contentType: 'image/png' };

  it('fetches, stores and rewrites the ones that work, and leaves the one that fails', async () => {
    const fetchImage = vi.fn(async (url) => {
      if (url === UPSTREAM_B) throw new Error('HTTP 403 fetching ' + url);
      return png;
    });
    const storage = { uploadBlob: vi.fn(async () => undefined) };
    const log = { warn: vi.fn() };
    const { rehost } = createInlineImageRehoster({ storage, fetchImage, log });

    const result = await rehost({ contentId: 'c1', body: BODY });

    expect(fetchImage).toHaveBeenCalledTimes(2);
    expect(storage.uploadBlob).toHaveBeenCalledTimes(1);
    const [container, blobPath, buffer, contentType, metadata] = storage.uploadBlob.mock.calls[0];
    expect(container).toBe(INLINE_IMAGE_CONTAINER);
    expect(blobPath).toBe(inlineBlobPath('c1', UPSTREAM_A, 'image/png'));
    expect(buffer).toBe(png.buffer);
    expect(contentType).toBe('image/png');
    expect(metadata).toEqual({ sourceUrl: UPSTREAM_A });

    expect(result.rewritten).toEqual([
      { from: UPSTREAM_A, to: `/api/public/media/covers/${blobPath}` },
    ]);
    expect(result.failed).toEqual([{ url: UPSTREAM_B, reason: 'HTTP 403 fetching ' + UPSTREAM_B }]);
    expect(result.body).not.toContain(UPSTREAM_A);
    expect(result.body).toContain(`![Diagram](${UPSTREAM_B} "Architecture")`);
    // The warning names the host, never the URL or the body.
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toContain('cdn.example.org');
    expect(log.warn.mock.calls[0][0]).not.toContain('/diagram.webp');
  });

  it('counts an upload failure as a failed image, not a thrown publish', async () => {
    const fetchImage = vi.fn(async () => png);
    const storage = {
      uploadBlob: vi.fn(async () => {
        throw new Error('403 on blob');
      }),
    };
    const { rehost } = createInlineImageRehoster({ storage, fetchImage });
    const result = await rehost({ contentId: 'c1', body: `<img src="${UPSTREAM_A}">` });
    expect(result.rewritten).toEqual([]);
    expect(result.failed).toEqual([{ url: UPSTREAM_A, reason: '403 on blob' }]);
    expect(result.body).toBe(`<img src="${UPSTREAM_A}">`);
  });

  it('does nothing for a body with no external images', async () => {
    const fetchImage = vi.fn();
    const storage = { uploadBlob: vi.fn() };
    const { rehost } = createInlineImageRehoster({ storage, fetchImage });
    const result = await rehost({ contentId: 'c1', body: '<p>text</p> ![x](/local.png)' });
    expect(fetchImage).not.toHaveBeenCalled();
    expect(result).toEqual({ body: '<p>text</p> ![x](/local.png)', rewritten: [], failed: [] });
  });
});

describe('buildInlineImageUpdate', () => {
  const nowIso = '2026-09-06T23:00:00.000Z';

  it('returns the rewritten body field and a summary the editor can read', async () => {
    const rehost = vi.fn(async ({ body }) => ({
      body: body.replace(UPSTREAM_A, '/api/public/media/covers/c1/inline/x.png'),
      rewritten: [{ from: UPSTREAM_A, to: '/api/public/media/covers/c1/inline/x.png' }],
      failed: [{ url: UPSTREAM_B, reason: 'HTTP 403' }],
    }));
    const contentData = {
      Content: `<img src="${UPSTREAM_A}"> ![d](${UPSTREAM_B})`,
      content: 'older',
    };
    const update = await buildInlineImageUpdate({ contentData, contentId: 'c1', rehost, nowIso });
    expect(rehost).toHaveBeenCalledWith({ contentId: 'c1', body: contentData.Content });
    expect(update.Content).toBe(
      `<img src="/api/public/media/covers/c1/inline/x.png"> ![d](${UPSTREAM_B})`
    );
    expect(update.content).toBeUndefined();
    expect(update.inlineImages).toEqual({
      field: 'Content',
      rewritten: 1,
      failed: 1,
      failedUrls: [UPSTREAM_B],
      at: nowIso,
    });
  });

  it('is null when there is no body, no rehoster, or nothing external in the body', async () => {
    const rehost = vi.fn();
    expect(
      await buildInlineImageUpdate({ contentData: {}, contentId: 'c1', rehost, nowIso })
    ).toBeNull();
    expect(
      await buildInlineImageUpdate({
        contentData: { content: '<p>x</p>' },
        contentId: 'c1',
        rehost,
        nowIso,
      })
    ).toBeNull();
    expect(
      await buildInlineImageUpdate({
        contentData: { content: `<img src="${UPSTREAM_A}">` },
        contentId: 'c1',
        rehost: null,
        nowIso,
      })
    ).toBeNull();
    expect(rehost).not.toHaveBeenCalled();
  });

  it('does not rewrite the field when nothing changed, but still records the failures', async () => {
    const body = `<img src="${UPSTREAM_A}">`;
    const rehost = vi.fn(async () => ({
      body,
      rewritten: [],
      failed: [{ url: UPSTREAM_A, reason: 'timeout' }],
    }));
    const update = await buildInlineImageUpdate({
      contentData: { blogDraft: body },
      contentId: 'c1',
      rehost,
      nowIso,
    });
    expect(update.blogDraft).toBeUndefined();
    expect(update.inlineImages.failed).toBe(1);
    expect(update.inlineImages.failedUrls).toEqual([UPSTREAM_A]);
  });

  it('swallows a rehoster that throws whole and publishes the body untouched', async () => {
    const log = { warn: vi.fn() };
    const rehost = vi.fn(async () => {
      throw new Error('storage account unreachable');
    });
    const update = await buildInlineImageUpdate({
      contentData: { content: `<img src="${UPSTREAM_A}">` },
      contentId: 'c1',
      rehost,
      nowIso,
      log,
    });
    expect(update).toBeNull();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
