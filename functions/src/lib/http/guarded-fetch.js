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
 * scraper and the supporting-document fetch doing exactly that, AP-B2), and
 * tightened on PR #889's review:
 *
 *   - http(s) only; `localhost` and every IPv6 literal refused by name, and a
 *     name that does not resolve is a refusal too (fail closed: a host the
 *     guard cannot classify is not fetched and not handed to a fallback);
 *   - the hostname resolved to IPv4 before the request, and refused when the
 *     address is loopback, link-local (the cloud metadata range), RFC 1918,
 *     carrier-grade NAT, multicast/reserved, or Azure's platform address
 *     168.63.129.16 (WireServer, which answers plain HTTP);
 *   - the connection is PINNED to the address that passed: the request is
 *     dispatched through an undici Agent whose DNS lookup returns that one
 *     answer, so a rebinding host (public A record for the check, private
 *     one for the connect) gets the address the guard saw, while Host and
 *     TLS SNI stay the original hostname;
 *   - redirects followed manually, up to `maxRedirects`, every hop
 *     re-validated and re-pinned;
 *   - one deadline over the whole exchange, body included, and a byte cap on
 *     the body, so a server that sends headers and then stalls, or streams
 *     without end, is cut off rather than held open.
 *
 * Because the body must be read under the deadline, this helper returns the
 * bytes, not a live Response: `{ response, buffer, text() }`. Resolution and
 * the dispatcher factory are injectable for tests and nothing else.
 */
import { lookup } from 'node:dns/promises';
import { Agent } from 'undici';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Default body cap: enough for any article page, far below the host's memory. */
export const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;

/** True for an IPv4 address this app must never fetch from. */
export function isPrivateIp(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b, c, d] = parts;
  return (
    a === 0 || // "this" network
    a === 10 || // RFC 1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT (RFC 6598)
    (a === 169 && b === 254) || // link-local, including the cloud metadata endpoint
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918
    (a === 192 && b === 168) || // RFC 1918
    (a === 168 && b === 63 && c === 129 && d === 16) || // Azure platform (WireServer)
    a >= 224 // multicast, reserved, broadcast
  );
}

/** A guard refusal: `refused: true` so a caller can tell "must not fetch this"
 * from "could not fetch this" and skip any fallback that would send the same
 * URL elsewhere. */
function refusal(message) {
  return Object.assign(new Error(message), { code: 'URL_REFUSED', refused: true });
}

/**
 * Throws (with `refused: true`) when the URL must not be fetched; otherwise
 * returns `{ address }`, the one IPv4 answer the request must connect to.
 */
export async function validateFetchUrl(
  urlString,
  { resolve = (host) => lookup(host, { family: 4 }) } = {}
) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw refusal(`Invalid URL: ${String(urlString)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw refusal('Invalid protocol');
  if (url.hostname === 'localhost') throw refusal('Localhost access denied');
  // `URL.hostname` keeps the brackets on an IPv6 literal. The guard classifies
  // IPv4 only, so an address it cannot classify is one it does not fetch.
  if (url.hostname.startsWith('[')) throw refusal('IPv6 targets are not fetched');
  let address;
  try {
    ({ address } = await resolve(url.hostname));
  } catch (error) {
    throw refusal(`Host could not be resolved: ${url.hostname} (${error?.code || error?.message})`);
  }
  if (!address || isPrivateIp(address)) throw refusal(`Private IP access denied: ${address}`);
  return { address };
}

/**
 * A `dns.lookup`-shaped function that answers every query with the one
 * address the guard validated. Given to undici's connector so the socket goes
 * where the check looked, whatever the name resolves to a moment later.
 */
export function pinnedLookup(address) {
  return (_hostname, options, callback) => {
    if (typeof options === 'function') {
      options(null, address, 4);
      return;
    }
    if (options?.all) callback(null, [{ address, family: 4 }]);
    else callback(null, address, 4);
  };
}

/** An undici dispatcher whose connections resolve to `address` only. */
export function pinnedDispatcher(address) {
  return new Agent({ connect: { lookup: pinnedLookup(address) } });
}

/** Reject when `signal` aborts, so a stalled body read can be raced against the deadline. */
function abortPromise(signal) {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

const tooLarge = (limit) =>
  Object.assign(new Error(`Response body exceeds ${limit} bytes`), { code: 'BODY_TOO_LARGE' });

/**
 * The response body as a Buffer, read under `signal` and capped at `maxBytes`.
 * Streams are read chunk by chunk so the cap holds before the bytes exist;
 * a response without a stream (a test double) is read whole and then measured.
 */
async function readBody(response, { maxBytes, signal }) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);

  const stream = response.body;
  if (stream && typeof stream.getReader === 'function') {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), abortPromise(signal)]);
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw tooLarge(maxBytes);
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock?.();
      if (total > maxBytes) stream.cancel?.().catch(() => {});
    }
    return Buffer.concat(chunks);
  }

  const whole = await Promise.race([
    typeof response.arrayBuffer === 'function'
      ? response.arrayBuffer().then((ab) => Buffer.from(ab))
      : response.text().then((t) => Buffer.from(String(t), 'utf8')),
    abortPromise(signal),
  ]);
  if (whole.byteLength > maxBytes) throw tooLarge(maxBytes);
  return whole;
}

/**
 * Fetch an untrusted URL: validated and pinned before the request and again
 * on every redirect hop, the body read under one deadline and one byte cap.
 * Returns `{ response, buffer, text }` (the response may still be non-2xx —
 * status handling stays with the caller). Throws on a refused or unresolvable
 * address (`refused: true`), a redirect with no Location, more than
 * `maxRedirects` hops, an oversized body (`BODY_TOO_LARGE`), or the deadline
 * (`FETCH_TIMEOUT`).
 *
 * @param {string} url
 * @param {{ fetch?: typeof fetch, resolve?: Function, dispatcherFor?: Function,
 *   maxRedirects?: number, timeoutMs?: number, maxBytes?: number,
 *   headers?: Record<string,string>, method?: string, body?: any }} [deps]
 * @returns {Promise<{ response: Response, buffer: Buffer, text: () => string }>}
 */
export async function guardedFetch(
  url,
  {
    fetch: fetchImpl = globalThis.fetch,
    resolve,
    dispatcherFor = pinnedDispatcher,
    maxRedirects = 5,
    timeoutMs = 30000,
    maxBytes = DEFAULT_MAX_BODY_BYTES,
    headers,
    method = 'GET',
    body,
  } = {}
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const { signal } = controller;
  let current = String(url);
  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const { address } = await validateFetchUrl(current, resolve ? { resolve } : {});
      const dispatcher = dispatcherFor(address);
      let response;
      try {
        response = await fetchImpl(current, {
          method,
          headers,
          body,
          redirect: 'manual',
          signal,
          dispatcher,
        });
        if (!REDIRECT_STATUSES.has(response.status)) {
          const buffer = await readBody(response, { maxBytes, signal });
          return { response, buffer, text: () => buffer.toString('utf8') };
        }
      } finally {
        dispatcher?.close?.().catch?.(() => {});
      }
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
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error(`timeout after ${timeoutMs} ms`), { code: 'FETCH_TIMEOUT' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
