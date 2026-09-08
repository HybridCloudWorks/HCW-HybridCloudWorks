/**
 * One reading of the Klaviyo API, for the Mailing List page.
 *
 * ===========================================================================
 * TWO BUGS, NOT ONE
 * ===========================================================================
 * #430 reported that Test Connection shows "Connected to Klaviyo — 0 list(s)
 * visible" in green for a **rejected** key, because `setResult({ ok: true })`
 * was unconditional and the proxy resolves rather than throws. That is real,
 * and `lib/integrationEnvelope.js` is the fix for it.
 *
 * Writing that fix surfaced a second one hiding behind the same message.
 * The page read the list as:
 *
 *   `Array.isArray(res?.data) ? res.data : []`
 *
 * `res` is the **proxy envelope**, so `res.data` is Klaviyo's body — and
 * Klaviyo's revisioned API is JSON:API, so its body is
 * `{ data: [...], links: {...} }`, an object. `Array.isArray` of an object is
 * false. **So the list was empty on success too**, and had been for every
 * call: lists, profiles and campaigns alike.
 *
 * That is why the reported message said "0 list(s)". The zero was not
 * evidence of a refused key; it was unreachable from any other value.
 *
 * The array is therefore two levels down — `envelope.data.data` — which is
 * the same depth `extractProfiles` reaches for in `lib/linkie.js`, for the
 * same reason: this repository's envelope wraps an upstream that wraps its
 * own payload.
 *
 * Shallower depths are tolerated so a caller that already unwrapped, or a
 * Klaviyo response that is a bare array, still reads. Tolerated, not guessed:
 * each depth is a shape that actually occurs, and anything else yields an
 * empty list with an error rather than a silent zero.
 */
import { readProxyBody, readProxyList, unwrapProxy } from '@/lib/integrationEnvelope';

/** The operator-facing name, used in every message this module produces. */
export const SERVICE = 'Klaviyo';

/**
 * Reach the collection inside a Klaviyo body.
 *
 * @param {unknown} body - the upstream body, already out of the envelope
 * @returns {unknown} the array, or whatever was found so the caller can reject it
 */
export function pickKlaviyoCollection(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  return null;
}

/**
 * A Klaviyo collection, with failure kept distinct from emptiness.
 *
 * The distinction is the point. An operator who sees an empty mailing list
 * concludes the audience is empty — the exact wrong conclusion, and the one
 * that costs a campaign. `error` being non-empty means the list says nothing
 * about the audience.
 *
 * @param {unknown} response - whatever `postJSON('klaviyoProxy', …)` resolved to
 * @returns {{ items: unknown[], error: string }}
 */
export function klaviyoCollection(response) {
  return readProxyList(SERVICE, response, pickKlaviyoCollection);
}

/**
 * The collection, or a throw — for Test Connection and the connected
 * indicator, where "not ok" must never pass for success.
 *
 * A 2xx whose body is not a collection still throws: the connection test
 * claims Klaviyo answered *and was understood*, and a body this page cannot
 * read is not a working connection even when the credential is fine.
 *
 * @param {unknown} response
 * @returns {unknown[]}
 * @throws {Error} unconfigured, refused, failed, or an unreadable body
 */
export function requireKlaviyoCollection(response) {
  const body = readProxyBody(SERVICE, response);
  const items = pickKlaviyoCollection(body);
  if (!items) {
    const { status } = unwrapProxy(response);
    throw new Error(`${SERVICE} answered ${status || '2xx'} with a body this page cannot read`);
  }
  return items;
}

/**
 * The Test Connection sentence.
 *
 * Says how many, because a count is what proves the key reaches real data
 * rather than merely authenticating.
 *
 * @param {unknown[]} lists
 * @returns {string}
 */
export function connectionMessage(lists) {
  const count = lists.length;
  return `Connected to ${SERVICE} — ${count} list${count === 1 ? '' : 's'} visible.`;
}
