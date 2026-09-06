/**
 * Re-host the images an article body hotlinks (issue #374).
 *
 * Curated articles keep their body as ingested, upstream `<img>` and
 * `![alt](url)` references included. The cover already re-hosts — the
 * publish-time cover trigger writes to blob storage and the page serves it
 * from `/api/public/media/…` — but nothing did the same for the body, and on
 * 2026-09-06 the published-pages audit found an article whose two body images
 * loaded with zero natural width: the publisher refuses cross-site hotlinking.
 * The reader saw two empty boxes.
 *
 * WHAT THIS DOES. At publish time, every external image URL in the rendered
 * body field is fetched once through the same guarded fetcher the cover
 * mirror uses (`triggers/fetch-image.js`: protocol and private-IP checks,
 * redirect cap, size cap, timeout), stored under the article's id in the
 * public `covers` container, and the body's references are rewritten to the
 * site's own media path. A URL that cannot be fetched is left exactly as it
 * was — the alt text still renders — and recorded on the document, so the
 * editor can see what did not come across instead of finding out from a
 * reader.
 *
 * WHY IT NEVER FAILS A PUBLISH. The image is decoration on an article that
 * passed the quality and image gates already; a publisher's hotlink policy is
 * not a reason to hold the article. Every failure is per-URL, caught, and
 * summarised in `inlineImages` on the document.
 *
 * WHY THE BLOB NAME IS A HASH OF THE URL. Re-publishing the same article must
 * not upload the same image twice, and two articles hotlinking the same asset
 * must not collide — the path is `<contentId>/inline/<sha256(url)[0:16]>.<ext>`,
 * so a republish overwrites its own copy and nothing else.
 *
 * Pure core (`findInlineImageUrls`, `rewriteBody`, `inlineBlobPath`) over an
 * injected edge (`storage.uploadBlob`, `fetchImage`), the house style in this
 * directory. `createDefaultInlineImageRehoster` in inline-images-default.js
 * wires the real edge for the three publish call sites.
 */
import { createHash } from 'node:crypto';

import { mediaUrlFor } from '../blob-paths.js';
import { MIME_TO_EXT, isExternalUrlString } from '../triggers/fetch-image.js';

/** Public media container the re-hosted copies live in; the cover trigger's. */
export const INLINE_IMAGE_CONTAINER = 'covers';

/**
 * The body fields an article can carry, in the page's own precedence
 * (BlogDetailTemplate: `blogDraft || Content || content`). ALL of them are
 * rewritten, not just the one that renders today: on 2026-09-06 the audited
 * article held an RSS stub in `Content` and its eleven images in `content`,
 * and a step that only looked at the rendering field would have rewritten the
 * stub and left every image where it was. Rewriting each field an image
 * appears in is cheap (one fetch per distinct URL, whichever fields share it)
 * and survives an editor switching which field the page uses.
 */
export const BODY_FIELDS = Object.freeze(['blogDraft', 'Content', 'content']);

/** Hosts whose images are already ours and must not be fetched again. */
const OWN_HOSTS = new Set(['hybridcloudworks.com', 'www.hybridcloudworks.com']);

const HTML_IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
// `![alt](url)` and `![alt](url "title")`. The URL stops at whitespace or the
// closing parenthesis; a nested parenthesis in a URL is rare enough that a
// miss there is a leave-alone, not a wrong rewrite.
const MARKDOWN_IMG = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/** Every body field this document carries as non-empty text, in precedence order. */
export function resolveBodyFields(doc = {}) {
  return BODY_FIELDS.filter((field) => typeof doc[field] === 'string' && doc[field].trim());
}

/** True for a URL the site already serves itself. */
export function isOwnMediaUrl(value) {
  if (typeof value !== 'string') return false;
  if (value.startsWith('/api/public/media/')) return true;
  try {
    return OWN_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * Every distinct external image URL the body references, in first-seen order.
 * Relative paths, data: URIs and the site's own media are not external and
 * are not returned.
 */
export function findInlineImageUrls(body) {
  const text = String(body ?? '');
  const found = [];
  const seen = new Set();
  const consider = (raw) => {
    const url = String(raw || '').trim();
    if (!url || seen.has(url)) return;
    if (!isExternalUrlString(url) || isOwnMediaUrl(url)) return;
    seen.add(url);
    found.push(url);
  };
  for (const match of text.matchAll(HTML_IMG_SRC)) consider(match[1] ?? match[2]);
  for (const match of text.matchAll(MARKDOWN_IMG)) consider(match[1]);
  return found;
}

/** `<contentId>/inline/<sha256(url)[0:16]>.<ext>` — stable per article and URL. */
export function inlineBlobPath(contentId, url, contentType) {
  const ext = MIME_TO_EXT[contentType] ?? 'png';
  const digest = createHash('sha256').update(String(url)).digest('hex').slice(0, 16);
  return `${contentId}/inline/${digest}.${ext}`;
}

/** Replace every occurrence of each `from` with its `to`. Plain text, no regex. */
export function rewriteBody(body, replacements) {
  let out = String(body ?? '');
  for (const { from, to } of replacements) {
    if (from && to && from !== to) out = out.split(from).join(to);
  }
  return out;
}

/**
 * @param {object} deps
 * @param {{ uploadBlob: Function }} deps.storage
 * @param {Function} deps.fetchImage `(url) => Promise<{ buffer, contentType }>`
 * @param {{ log?: Function, warn?: Function }} [deps.log]
 */
export function createInlineImageRehoster({ storage, fetchImage, log = {} }) {
  /**
   * Re-host every external image across the given body fields. A URL shared
   * by two fields is fetched and stored once.
   *
   * @param {{ contentId: string, bodies: Record<string, string> }} input
   * @returns {Promise<{ bodies: Record<string, string>, rewritten: Array<{from: string, to: string}>, failed: Array<{url: string, reason: string}> }>}
   */
  async function rehost({ contentId, bodies }) {
    const urls = [];
    const seen = new Set();
    for (const body of Object.values(bodies || {})) {
      for (const url of findInlineImageUrls(body)) {
        if (!seen.has(url)) {
          seen.add(url);
          urls.push(url);
        }
      }
    }
    const rewritten = [];
    const failed = [];
    for (const url of urls) {
      try {
        const { buffer, contentType } = await fetchImage(url);
        const blobPath = inlineBlobPath(contentId, url, contentType);
        await storage.uploadBlob(INLINE_IMAGE_CONTAINER, blobPath, buffer, contentType, {
          sourceUrl: url,
        });
        rewritten.push({ from: url, to: mediaUrlFor(INLINE_IMAGE_CONTAINER, blobPath) });
      } catch (error) {
        const reason = String(error?.message || error || 'unknown');
        failed.push({ url, reason });
        // Host only, never the full URL or the document: enough to see a
        // publisher refusing us, not enough to leak what was being read.
        let host = 'invalid-url';
        try {
          host = new URL(url).hostname;
        } catch {
          // keep the placeholder
        }
        // The fetcher's own messages embed the URL; strip it from the log line.
        const safeReason = reason.split(url).join('[url]');
        log.warn?.(
          `[inlineImages] ${contentId}: could not re-host an image from ${host}: ${safeReason}`
        );
      }
    }
    const out = {};
    for (const [field, body] of Object.entries(bodies || {}))
      out[field] = rewriteBody(body, rewritten);
    return { bodies: out, rewritten, failed };
  }

  return { rehost };
}

/**
 * The publish-time step: the content-document update that re-hosting the
 * body fields' images produces, or null when there is nothing to do.
 *
 * Never throws. A rehoster that blows up whole (not per-URL) is logged and
 * the article publishes with its body untouched, which is what happened before
 * this step existed.
 *
 * @returns {Promise<null | { [field: string]: string, inlineImages: object }>}
 */
export async function buildInlineImageUpdate({ contentData, contentId, rehost, nowIso, log = {} }) {
  if (typeof rehost !== 'function') return null;
  const fields = resolveBodyFields(contentData).filter(
    (field) => findInlineImageUrls(contentData[field]).length > 0
  );
  if (fields.length === 0) return null;
  const bodies = Object.fromEntries(fields.map((field) => [field, contentData[field]]));
  try {
    const result = await rehost({ contentId, bodies });
    const changed = Object.fromEntries(
      fields
        .filter(
          (field) => result.bodies?.[field] !== undefined && result.bodies[field] !== bodies[field]
        )
        .map((field) => [field, result.bodies[field]])
    );
    return {
      ...changed,
      inlineImages: {
        fields,
        rewritten: result.rewritten.length,
        failed: result.failed.length,
        failedUrls: result.failed.map((f) => f.url),
        at: nowIso,
      },
    };
  } catch (error) {
    log.warn?.(`[inlineImages] ${contentId}: re-hosting skipped: ${error?.message || error}`);
    return null;
  }
}
