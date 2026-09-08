/**
 * One reading of the integrations proxy envelope, for every integration page.
 *
 * ===========================================================================
 * WHY THIS MODULE EXISTS
 * ===========================================================================
 * `functions/src/lib/integrations/rest-proxy.js` answers **HTTP 200 for every
 * outcome**, carrying the real result inside an envelope:
 *
 *   `{ ok: true, status, data }`      upstream answered 2xx; `data` is its body
 *   `{ ok: false, code:
 *      'INTEGRATION_NOT_CONFIGURED',
 *      error }`                       the API key is unset, so the upstream was
 *                                     never called. Not a fault — the
 *                                     Connections page renders it as
 *                                     "not connected"
 *   `{ ok: false, status, data }`     upstream answered non-2xx — 401 on a bad
 *                                     key, 403, 429, 5xx. `status` is theirs
 *   `{ ok: false, error }`            the proxy's own fetch threw
 *
 * That envelope is deliberate and worth keeping: an unseeded key answering
 * `200 { ok: false, code: 'INTEGRATION_NOT_CONFIGURED' }` is what lets the
 * Connections page say "not connected" instead of paging someone about a 5xx.
 *
 * **But it is a footgun, and it caught three integrations in a row.**
 * `postJSON` is `return res.json()` with no status inspection — because the
 * HTTP status genuinely *is* 200 — so `ok: false` arrives as a RESOLVED
 * promise and a `.catch()` never runs. A caller written as though the proxy
 * returned the upstream body directly then reads a refused credential as an
 * empty result:
 *
 *   - **Publer** (#397) rendered an authentication failure as an empty
 *     workspace, because it tested the envelope with `Array.isArray`.
 *   - **Linkie** (#429) would have shown a green "Added to Linkie" on a 401.
 *   - **Klaviyo** (#430) reported "Connected to Klaviyo — 0 list(s) visible"
 *     in green, with a tick, for a rejected key.
 *
 * Three instances of one mistake is a design signal, not three slips. #430
 * put the choice to whoever fixed the third: patch the caller, add a shared
 * client helper, or make the proxy return the upstream status. This module is
 * the second — it keeps the envelope's deliberate behaviour and removes the
 * footgun, because the mistake is only available to a caller that reads the
 * envelope by hand.
 *
 * The logic here is not new. It is `unwrapLinkie` / `readLinkieBody` from
 * #429, promoted verbatim with the service name lifted into a parameter, so
 * this is one tested implementation rather than a second one written to look
 * like the first.
 */

/** The proxy's code for "a required app setting is missing, so nothing was called". */
export const INTEGRATION_NOT_CONFIGURED = 'INTEGRATION_NOT_CONFIGURED';

/**
 * Read the proxy envelope, keeping its four outcomes apart.
 *
 * THE PROXY ANSWERS 200 FOR EVERY OUTCOME, so the HTTP status of the call the
 * browser made says nothing and `ok` is the only signal.
 *
 * A bare body is accepted too, so a caller that already unwrapped is not
 * punished.
 *
 * @param {unknown} response - whatever `postJSON('<x>Proxy', …)` resolved to
 * @returns {{ body: unknown, notConfigured: boolean, failed: boolean,
 *             status: number | null, reason: string }}
 */
export function unwrapProxy(response) {
  const status = Number.isFinite(response?.status) ? response.status : null;
  const reason = typeof response?.error === 'string' ? response.error : '';

  if (response && response.ok === false) {
    const notConfigured = response.code === INTEGRATION_NOT_CONFIGURED;
    return { body: null, notConfigured, failed: !notConfigured, status, reason };
  }

  const body =
    response && typeof response === 'object' && 'data' in response ? response.data : response;
  return { body: body ?? null, notConfigured: false, failed: false, status, reason: '' };
}

/**
 * The failure in one line. Prefers the upstream status, because "Klaviyo
 * answered 401" is the sentence that tells an operator their key is wrong —
 * where "the request failed" sends them to the network tab.
 *
 * @param {string} service - the upstream's name, as an operator calls it
 * @param {{ status?: number | null, reason?: string }} failure
 * @returns {string}
 */
export function describeProxyFailure(service, { status, reason } = {}) {
  if (status) return `${service} answered ${status}${reason ? ` — ${reason}` : ''}`;
  return reason || 'the request failed';
}

/**
 * The body, or a throw — for write paths and for anything that must not let
 * "not ok" pass for success.
 *
 * @param {string} service
 * @param {unknown} response
 * @returns {unknown} the upstream body
 * @throws {Error} when the integration is unconfigured or the call failed
 */
export function readProxyBody(service, response) {
  const unwrapped = unwrapProxy(response);
  if (unwrapped.notConfigured) {
    throw new Error(unwrapped.reason || `${service} is not configured`);
  }
  if (unwrapped.failed) {
    throw new Error(describeProxyFailure(service, unwrapped));
  }
  return unwrapped.body;
}

/**
 * An array from the envelope, with the failure kept distinct from emptiness.
 *
 * This is the shape every list read wants and the one every caught caller got
 * wrong. `Array.isArray(res?.data) ? res.data : []` collapses "the call was
 * refused" and "there is nothing there" into the same empty list, and an
 * operator seeing an empty mailing list concludes the audience is empty —
 * the exact wrong conclusion, and an expensive one.
 *
 * There are THREE ways to get an empty list and only one of them is an empty
 * audience. A 2xx whose body this page cannot read is the third, and it
 * reports as an error rather than as emptiness: the call succeeded, so
 * `failed` is false, but nothing was learned about the audience and saying
 * "there is nothing there" would be a claim we cannot support.
 *
 * @param {string} service
 * @param {unknown} response
 * @param {(body: unknown) => unknown} [pick] - reach the array inside the
 *   upstream body when it is not the body itself; return a non-array to say
 *   the shape was not recognised
 * @returns {{ items: unknown[], error: string }}
 */
export function readProxyList(service, response, pick = (body) => body) {
  const unwrapped = unwrapProxy(response);
  if (unwrapped.notConfigured) {
    return { items: [], error: unwrapped.reason || `${service} is not configured` };
  }
  if (unwrapped.failed) {
    return { items: [], error: describeProxyFailure(service, unwrapped) };
  }
  const picked = pick(unwrapped.body);
  if (!Array.isArray(picked)) {
    return {
      items: [],
      error: `${service} answered ${unwrapped.status || '2xx'} with a body this page cannot read`,
    };
  }
  return { items: picked, error: '' };
}
