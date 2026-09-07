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
 * The publerProxy envelope (functions/src/lib/integrations/rest-proxy.js):
 * `{ ok: true, status, data }` with `data` the parsed Publer body, or
 * `{ ok: false, code: 'INTEGRATION_NOT_CONFIGURED' }` when no key is seeded.
 * Publer's accounts list is a bare array; an `accounts` or `data` wrapper is
 * tolerated in case the upstream shape shifts. A bare array is accepted too,
 * so a caller that already unwrapped is not punished.
 *
 * `notConfigured` is the one failure worth naming to the operator, because it
 * has an action attached — seed the key — where every other failure does not.
 *
 * @param {unknown} response - whatever `postJSON('publerProxy', …)` resolved to
 * @returns {{ accounts: Array<{ id: string }>, notConfigured: boolean }}
 */
export function unwrapPublerAccounts(response) {
  if (response && response.ok === false) {
    return { accounts: [], notConfigured: response.code === PUBLER_NOT_CONFIGURED };
  }
  const body =
    response && typeof response === 'object' && 'data' in response ? response.data : response;
  const list = [body, body?.accounts, body?.data].find(Array.isArray) ?? [];
  return { accounts: list.filter((account) => account && account.id), notConfigured: false };
}
