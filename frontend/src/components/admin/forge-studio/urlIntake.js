/**
 * URL intake for Forge Studio's "From a URL" (owner request 2026-10-06):
 * the URLs in a pasted block of text or in an .html file saved from a
 * browser, deduplicated and bounded, so each becomes one queue entry.
 * Pure; the file reading happens in the component.
 */

/**
 * A browser favourites export runs to hundreds, sometimes a couple of
 * thousand links (owner, 2026-10-06); the queue takes 2,000 per add.
 */
export const MAX_URLS_PER_IMPORT = 2000;
/** Rows drawn in the detected list; the rest are counted, and Add all adds every one. */
export const DETECTED_ROWS_SHOWN = 200;
/** A saved page larger than this is not a reading list either. */
export const MAX_HTML_FILE_BYTES = 5 * 1024 * 1024;

const BARE_URL = /https?:\/\/[^\s<>"'`\])}]+/gi;
const HREF = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
/** Trailing punctuation a URL in prose drags along. */
const TRAILING = /[.,;:!?)]+$/;

/** A URL as the queue stores it: http(s) only, trimmed, no fragment; '' otherwise. */
export function normalizeUrl(value) {
  const raw = String(value ?? '')
    .trim()
    .replace(TRAILING, '');
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  parsed.hash = '';
  return parsed.toString();
}

/** The distinct http(s) URLs in a block of text, in order of first appearance. */
export function extractUrlsFromText(text) {
  const out = [];
  const seen = new Set();
  for (const match of String(text ?? '').matchAll(BARE_URL)) {
    const url = normalizeUrl(match[0]);
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/** The five named references plus numeric ones — what a saved page's attributes carry. */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref) => {
    if (ref[0] === '#') {
      const code =
        ref[1].toLowerCase() === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[ref.toLowerCase()] ?? match;
  });
}

/**
 * The href attributes of a document and its visible text, entities decoded.
 * Text work, deliberately: the file came from the owner's disk or clipboard
 * and is never parsed into a DOM, so nothing in it can run or load (CodeQL
 * flagged a DOMParser here, and the parser bought only the decoding, which
 * decodeEntities does).
 */
function hrefsOf(html) {
  const hrefs = [];
  for (const match of html.matchAll(HREF)) {
    hrefs.push(decodeEntities(match[1] ?? match[2] ?? match[3] ?? ''));
  }
  const text = decodeEntities(html.replace(/<[^>]*>/g, ' '));
  return { hrefs, text };
}

/**
 * The distinct http(s) URLs an HTML document links to: every `href` first
 * (relative ones resolved against `baseUrl` when given), then any bare URL
 * in the page's text, so a saved newsletter yields its links and nothing
 * else. Entities are decoded (`&amp;` is `&`), so a link's query survives.
 */
export function extractUrlsFromHtml(html, { baseUrl = '' } = {}) {
  const out = [];
  const seen = new Set();
  const take = (candidate) => {
    const url = normalizeUrl(candidate);
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  };
  const { hrefs, text } = hrefsOf(String(html ?? ''));
  for (const raw of hrefs) {
    const href = raw.trim();
    if (!href || /^(#|mailto:|javascript:|tel:|data:)/i.test(href)) continue;
    if (/^https?:\/\//i.test(href)) {
      take(href);
    } else if (baseUrl) {
      try {
        take(new URL(href, baseUrl).toString());
      } catch {
        // not a URL at all
      }
    }
  }
  for (const url of extractUrlsFromText(text)) take(url);
  return out;
}

/** Text or HTML, decided by the content: an .html file or anything with a tag and an href. */
export function extractUrls(
  text,
  { html = /<a[\s>]|href\s*=/i.test(String(text ?? '')), baseUrl } = {}
) {
  return html ? extractUrlsFromHtml(text, { baseUrl }) : extractUrlsFromText(text);
}

/**
 * The detected list after adding `urls`: distinct, in order, capped at
 * MAX_URLS_PER_IMPORT, with how many were left out.
 */
export function mergeDetected(current, urls) {
  const seen = new Set(current);
  const next = [...current];
  let dropped = 0;
  for (const raw of urls) {
    const url = normalizeUrl(raw);
    if (!url || seen.has(url)) continue;
    if (next.length >= MAX_URLS_PER_IMPORT) {
      dropped += 1;
      continue;
    }
    seen.add(url);
    next.push(url);
  }
  return { urls: next, dropped };
}

/** The display form of a URL: host and path, no scheme, no query noise. */
export function shortUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/$/, '') : '';
    return `${parsed.host}${path}`;
  } catch {
    return String(url || '');
  }
}
