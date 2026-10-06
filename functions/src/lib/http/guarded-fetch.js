/**
 * guarded-fetch.js — the one outbound fetch for a URL a caller did not choose.
 *
 * An editor's "forge this page", a KB document URL, a scraped `<img src>`: all
 * of these are attacker-influenced strings that this Function App — which sits
 * inside the integration subnet and holds a managed identity — is asked to
 * fetch. A bare `fetch` on such a string is a server-side request forgery
 * primitive: `http://10.0.0.5/`, `http://169.254.169.254/`, or a public host
 * whose redirect lands on either, and the response body comes back to the
 * caller through whatever the feature renders.
 *
 * The guard here is the one `triggers/fetch-image.js` has carried since T-734
 * for images, lifted out so every URL-taking feature uses the same primitive
 * instead of its own `fetch` (the 2026-10-06 estate review found the article
 * scraper and the supporting-document fetch doing exactly that, AP-B2):
 *
 *   - http(s) only, `localhost` refused by name;
 *   - the hostname resolved to IPv4 before the request, and refused when the
 *     address is loopback, link-local (the cloud metadata range), or RFC 1918;
 *   - redirects followed manually, up to `maxRedirects`, and every hop
 *     re-validated, so a public host cannot bounce the fetch onto the private
 *     network;
 *   - a hard per-hop deadline from `fetch-with-timeout.js`.
 *
 * Resolution is injectable (`resolve`) for tests and nothing else. An
 * IPv6-only host is refused by this guard, as it is by the image fetcher; that
 * is a known limit, recorded rather than silently widened.
 */
import { lookup } from 'node:dns/promises';
import { fetchWithTimeout } from './fetch-with-timeout.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** True for an IPv4 address this app must never fetch from. */
export function isPrivateIp(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) return false;
  if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  return false;
}

/** A guard refusal: `refused: true` so a caller can tell "must not fetch this"
 * from "could not fetch this" and skip any fallback that would send the same
 * URL elsewhere. */
function refusal(message) {
  return Object.assign(new Error(message), { code: 'URL_REFUSED', refused: true });
}

/** Throws (with `refused: true`) when the URL must not be fetched. */
export async function validateFetchUrl(
  urlString,
  { resolve = (host) => lookup(host, { family: 4 }) } = {}
) {
  const url = new URL(urlString);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw refusal('Invalid protocol');
  if (url.hostname === 'localhost') throw refusal('Localhost access denied');
  const { address } = await resolve(url.hostname);
  if (isPrivateIp(address)) throw refusal(`Private IP access denied: ${address}`);
  return true;
}

/**
 * `fetch` for an untrusted URL: validated before the request and again on
 * every redirect hop, with a deadline per hop. Returns the final response
 * (which may still be non-2xx — status handling stays with the caller, as it
 * does for `fetchWithTimeout`). Throws on a refused address, a redirect with
 * no Location, more than `maxRedirects` hops, or a timeout.
 *
 * @param {string} url
 * @param {{ fetch?: typeof fetch, resolve?: Function, maxRedirects?: number,
 *   timeoutMs?: number, headers?: Record<string,string>, method?: string, body?: any }} [deps]
 * @returns {Promise<Response>}
 */
export async function guardedFetch(
  url,
  {
    fetch: fetchImpl = globalThis.fetch,
    resolve,
    maxRedirects = 5,
    timeoutMs = 30000,
    headers,
    method = 'GET',
    body,
  } = {}
) {
  let current = String(url);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await validateFetchUrl(current, resolve ? { resolve } : {});
    const response = await fetchWithTimeout(fetchImpl, current, {
      method,
      headers,
      body,
      redirect: 'manual',
      timeoutMs,
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers?.get?.('location');
    if (!location || hop === maxRedirects) {
      throw Object.assign(new Error(`HTTP ${response.status} fetching ${current}`), {
        code: location ? 'REDIRECT_LIMIT' : 'REDIRECT_NO_LOCATION',
      });
    }
    current = /^https?:\/\//i.test(location) ? location : new URL(location, current).href;
  }
  /* istanbul ignore next -- the loop returns or throws on its last hop */
  throw new Error(`Too many redirects fetching ${url}`);
}
