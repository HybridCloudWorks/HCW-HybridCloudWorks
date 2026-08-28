/**
 * fetch-image.js — download an external image safely.
 *
 * Ported from Site-Main `fetchImage` / `validateUrl` / `isExternalUrlString`
 * (index.js, 088f458). The SSRF guard is the point: http(s) only, no
 * localhost, the hostname resolved to IPv4 and refused if private — and
 * re-checked on every redirect hop (redirects are followed manually, up to
 * five), so a public host cannot bounce the fetch onto the private network.
 */
import { lookup } from 'node:dns/promises';

export const MIME_TO_EXT = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/avif': 'avif',
});

export function isPrivateIp(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) return false;
  if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  return false;
}

/** Throws when the URL must not be fetched. */
export async function validateFetchUrl(
  urlString,
  { resolve = (host) => lookup(host, { family: 4 }) } = {}
) {
  const url = new URL(urlString);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid protocol');
  if (url.hostname === 'localhost') throw new Error('Localhost access denied');
  const { address } = await resolve(url.hostname);
  if (isPrivateIp(address)) throw new Error(`Private IP access denied: ${address}`);
  return true;
}

/** True for a plain external http(s) URL string — not Firebase/GCS storage, not a Rowy object. */
export function isExternalUrlString(value) {
  if (!value || typeof value !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  if (
    parsed.hostname === 'firebasestorage.googleapis.com' ||
    parsed.hostname === 'storage.googleapis.com'
  )
    return false;
  return true;
}

/**
 * @param {string} url
 * @param {{ fetch?: typeof fetch, resolve?: Function, maxRedirects?: number, timeoutMs?: number }} [deps]
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
/**
 * Ceiling on a fetched image, in bytes (T-734). Generous for a cover or an
 * in-article picture, and small enough that a hostile or broken origin cannot
 * make the host buffer an arbitrary amount of memory.
 */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export async function fetchImage(
  url,
  {
    fetch: fetchImpl = globalThis.fetch,
    resolve,
    maxRedirects = 5,
    timeoutMs = 15000,
    maxBytes = MAX_IMAGE_BYTES,
  } = {}
) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await validateFetchUrl(current, resolve ? { resolve } : {});
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 HybridCloudWorks-Bot/1.0' },
      });
    } catch (error) {
      clearTimeout(timer);
      throw error?.name === 'AbortError'
        ? new Error(`Request timed out fetching ${current}`)
        : error;
    }
    try {
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || hop === maxRedirects)
          throw new Error(`HTTP ${response.status} fetching ${current}`);
        current = /^https?:\/\//i.test(location) ? location : new URL(location, current).href;
        continue;
      }
      if (response.status < 200 || response.status >= 300)
        throw new Error(`HTTP ${response.status} fetching ${current}`);
      const rawType = response.headers.get('content-type') || '';
      const contentType = rawType.split(';')[0].trim() || 'image/png';
      // Refuse before buffering when the server declares an oversized body
      // (T-734). Content-Length is a hint, not a guarantee, so the buffered
      // length is re-checked below — but honouring it avoids pulling the bytes
      // at all in the common case.
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new Error(`Image at ${current} declares ${declared} bytes (max ${maxBytes})`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) {
        throw new Error(`Image at ${current} is ${buffer.length} bytes (max ${maxBytes})`);
      }
      return { buffer, contentType };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Too many redirects fetching ${url}`);
}
