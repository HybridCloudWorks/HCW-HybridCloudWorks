/**
 * resend-client.js — the handful of Resend calls the newsletter needs (ADR 0030).
 *
 * A client and not `rest-proxy.js`, for the reason `connection-probe.js` gives:
 * nothing here takes a path from a caller. Every URL is built from a fixed
 * template, and the only caller-derived value in any of them is an email
 * address, which is percent-encoded into its path segment.
 *
 * Every method answers `{ ok, status, data }` and never throws for an HTTP
 * failure, so the caller decides what a 404 or a 422 means in its own flow.
 * A transport failure or a timeout is `{ ok: false, status: 0, data: { message } }`
 * for the same reason. Nothing here logs: the bodies carry subscriber addresses,
 * and whether to log anything about them is the handler's decision.
 *
 * Contract, read from Resend's API reference on 2026-09-13:
 *   POST   /emails                                   send one email
 *   GET    /segments?limit=100&after=               list segments
 *   POST   /segments                                 { name }
 *   POST   /contacts                                 { email, unsubscribed, segments: [{ id }] }
 *   GET    /contacts/{id|email}                      { unsubscribed, ... }
 *   PATCH  /contacts/{id|email}                      { unsubscribed }
 *   GET    /contacts/{id|email}/segments             { data: [{ id, name }] }
 *   POST   /contacts/{id|email}/segments/{segmentId}
 *
 * `segments` on create is an array of OBJECTS, `[{ id }]`, not of strings —
 * the documentation's wording suggests otherwise and `resend/resend-node#854`
 * records the confusion. Its behaviour for an email that already exists is not
 * documented, which is why the handler reads the contact back rather than
 * trusting any status here.
 */

export const RESEND_API_BASE = 'https://api.resend.com';

/** Long enough for Resend, short enough that a hung call cannot hold a signup. */
export const RESEND_TIMEOUT_MS = 10_000;

/**
 * @param {object} options
 * @param {string} options.apiKey a Full access key
 * @param {typeof fetch} [options.fetch]
 */
export function createResendClient({ apiKey, fetch: fetchImpl = globalThis.fetch }) {
  if (!apiKey) throw new Error('createResendClient needs an API key');

  async function call(method, path, body) {
    let response;
    let text = '';
    try {
      response = await fetchImpl(`${RESEND_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      // The key is in a header, not the URL, so the message cannot carry it;
      // it is still reduced to its own message rather than passed whole.
      return { ok: false, status: 0, data: { message: String(error?.message ?? error) } };
    }
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 2000) };
    }
    return { ok: response.ok, status: response.status, data };
  }

  const contactPath = (email) => `/contacts/${encodeURIComponent(email)}`;

  return {
    sendEmail: (message) => call('POST', '/emails', message),
    listSegments: (after) =>
      call('GET', `/segments?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`),
    createSegment: (name) => call('POST', '/segments', { name }),
    createContact: ({ email, segmentId }) =>
      call('POST', '/contacts', { email, unsubscribed: false, segments: [{ id: segmentId }] }),
    getContact: (email) => call('GET', contactPath(email)),
    resubscribeContact: (email) => call('PATCH', contactPath(email), { unsubscribed: false }),
    listContactSegments: (email) => call('GET', `${contactPath(email)}/segments?limit=100`),
    addContactToSegment: (email, segmentId) =>
      call('POST', `${contactPath(email)}/segments/${encodeURIComponent(segmentId)}`),
  };
}
