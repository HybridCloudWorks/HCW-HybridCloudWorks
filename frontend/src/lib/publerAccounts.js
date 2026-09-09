/**
 * One reading of the Publer accounts response, shared by every page that asks
 * for it.
 *
 * It lives here because it was written twice and only landed once: the Platform
 * settings page unwrapped the proxy envelope (#391) while the Social Hub still
 * tested the response with `Array.isArray`, which an envelope never satisfies,
 * so the Social Hub's account list was empty on a fully connected estate
 * (#397). A second copy would have drifted the same way, so there is one.
 */

export const PUBLER_NOT_CONFIGURED = 'INTEGRATION_NOT_CONFIGURED';

/**
 * The first sentence out of Publer's `{ "errors": [...] }` error body.
 *
 * The proxy passes upstream bodies through untouched, so this is available on
 * every failed envelope and was being thrown away — leaving the Social Hub and
 * the Connections card showing `Publer answered 401` and nothing else while
 * Publer was naming the cause in the body (#463 item 4).
 *
 * Mirrors `functions/src/lib/integrations/upstream-error.js`, which does the
 * same job for the timer and the proxy. The two are small, deliberately
 * separate — the browser bundle should not import a function module — and
 * tested against the same shapes.
 *
 * @param {unknown} data the parsed upstream body from the proxy envelope
 * @returns {string} the message, or `''` when the body carried none
 */
export function readPublerErrors(data) {
  if (!data || typeof data !== 'object') return '';
  const candidates = [data.errors, data.error, data.message].flat();
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 300);
    const nested = candidate?.detail || candidate?.message || candidate?.title;
    if (typeof nested === 'string' && nested.trim()) return nested.trim().slice(0, 300);
  }
  return '';
}

/**
 * Read the publerProxy envelope (functions/src/lib/integrations/rest-proxy.js).
 *
 * THE PROXY ANSWERS 200 FOR EVERY OUTCOME, so the HTTP status of the call the
 * browser made says nothing and `ok` is the only signal. There are four
 * envelopes, and the whole point of this function is that they do not collapse
 * into each other:
 *
 *   `{ ok: true, status, data }`         Publer answered 2xx. `data` is the
 *                                        parsed body — a bare array here, with
 *                                        an `accounts` or `data` wrapper
 *                                        tolerated in case the shape shifts.
 *   `{ ok: false, code: 'INTEGRATION_
 *      NOT_CONFIGURED', error }`         a required app setting is missing, so
 *                                        Publer was never called. For Publer
 *                                        that is PUBLER_API_KEY *or*
 *                                        PUBLER_WORKSPACE_ID — the code does
 *                                        not distinguish them, `error` names
 *                                        the one that is missing.
 *   `{ ok: false, status, data }`        Publer answered, and answered non-2xx
 *                                        — 401 on a bad key, 403, 429, 5xx.
 *                                        `status` is Publer's, not ours.
 *   `{ ok: false, error }`               the proxy's own fetch threw; there is
 *                                        no upstream status to report.
 *
 * The third one is why this comment is long. It arrives as a *resolved*
 * promise, so a caller with only a `.catch()` for failure sees an envelope that
 * is merely not-ok and, if it treats that as "no accounts", renders a Publer
 * authentication failure as an empty workspace — the same conflation as #397,
 * one layer down. `failed` exists to make that impossible to miss.
 *
 * `notConfigured` and `failed` are mutually exclusive, and both are false on
 * success. A bare array is accepted too, so a caller that already unwrapped is
 * not punished.
 *
 * @param {unknown} response - whatever `postJSON('publerProxy', …)` resolved to
 * @returns {{
 *   accounts: Array<{ id: string }>,
 *   notConfigured: boolean,
 *   failed: boolean,
 *   status: number | null,
 *   reason: string,
 * }} `status` is Publer's HTTP status when the proxy reported one, and `reason`
 *    the server's own explanation when it gave one — both for display, and both
 *    absent (null / '') when the envelope carried neither.
 */
export function unwrapPublerAccounts(response) {
  const status = Number.isFinite(response?.status) ? response.status : null;
  // Two different sentences, and the third envelope can carry both. `error` is
  // the PROXY's explanation (it never called Publer, or its own fetch threw);
  // `data.errors[0]` is PUBLER's, which is the one that says whether the key
  // was refused or the header was malformed. Preferring the proxy's when it
  // has one keeps "not configured" reading as it always did (#463 item 4).
  const reason =
    (typeof response?.error === 'string' && response.error) || readPublerErrors(response?.data);

  if (response && response.ok === false) {
    const notConfigured = response.code === PUBLER_NOT_CONFIGURED;
    return { accounts: [], notConfigured, failed: !notConfigured, status, reason };
  }

  const body =
    response && typeof response === 'object' && 'data' in response ? response.data : response;
  const list = [body, body?.accounts, body?.data].find(Array.isArray) ?? [];
  return {
    accounts: list.filter((account) => account && account.id),
    notConfigured: false,
    failed: false,
    status,
    reason: '',
  };
}

/**
 * The four-state machine both pages drive their copy from, derived once here so
 * the two cannot disagree about which envelope is which. `loading` is the
 * caller's own initial state; this names the three a response can produce.
 *
 * @param {{ notConfigured?: boolean, failed?: boolean }} unwrapped
 * @returns {'not_configured' | 'error' | 'ready'}
 */
export function publerAccountsStatus({ notConfigured, failed } = {}) {
  if (failed) return 'error';
  if (notConfigured) return 'not_configured';
  return 'ready';
}

/**
 * The failure in one line, for a page to show beside an empty list. Prefers the
 * upstream status, because "Publer answered 401" is the sentence that tells an
 * operator their key is wrong; falls back to whatever the server said.
 *
 * @param {{ status?: number | null, reason?: string }} failure
 * @returns {string}
 */
export function describePublerFailure({ status, reason } = {}) {
  if (status) return `Publer answered ${status}${reason ? ` — ${reason}` : ''}`;
  return reason || 'the request failed';
}
