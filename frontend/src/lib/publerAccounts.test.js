/**
 * Moved here from PlatformSettingsPage.test.jsx with the helper it covers
 * (#397): two pages read this response now, so the contract is tested once
 * beside the module rather than inside one of its callers.
 *
 * The envelopes below are the four the proxy actually returns
 * (functions/src/lib/integrations/rest-proxy.js), all of them HTTP 200. The
 * one worth naming is `{ ok: false, status: 401 }` — Publer refusing the key.
 * It resolves rather than rejects, so nothing but `failed` stops a caller from
 * reading it as an empty workspace.
 */
import { describe, it, expect } from 'vitest';

import {
  PUBLER_NOT_CONFIGURED,
  describePublerFailure,
  publerAccountsStatus,
  unwrapPublerAccounts,
} from './publerAccounts';

describe('unwrapPublerAccounts', () => {
  it('reads the proxy envelope, not a bare array', () => {
    const accounts = [{ id: 'acc-1', name: 'HCW', provider: 'linkedin' }];
    expect(unwrapPublerAccounts({ ok: true, status: 200, data: accounts })).toEqual({
      accounts,
      notConfigured: false,
      failed: false,
      status: 200,
      reason: '',
    });
    // Tolerated nestings, and a bare array from a caller that already unwrapped.
    expect(unwrapPublerAccounts({ ok: true, status: 200, data: { accounts } }).accounts).toEqual(
      accounts
    );
    expect(
      unwrapPublerAccounts({ ok: true, status: 200, data: { data: accounts } }).accounts
    ).toEqual(accounts);
    expect(unwrapPublerAccounts(accounts).accounts).toEqual(accounts);
  });

  it('names the unconfigured case, and carries the setting the server named', () => {
    expect(PUBLER_NOT_CONFIGURED).toBe('INTEGRATION_NOT_CONFIGURED');
    // The proxy returns this for a missing PUBLER_API_KEY *or* a missing
    // PUBLER_WORKSPACE_ID; only `error` says which.
    expect(
      unwrapPublerAccounts({
        ok: false,
        code: 'INTEGRATION_NOT_CONFIGURED',
        error: 'Publer is not configured: PUBLER_WORKSPACE_ID is not set',
      })
    ).toEqual({
      accounts: [],
      notConfigured: true,
      failed: false,
      status: null,
      reason: 'Publer is not configured: PUBLER_WORKSPACE_ID is not set',
    });
    // Without an `error`, the code alone is still enough to say "not configured".
    expect(unwrapPublerAccounts({ ok: false, code: 'INTEGRATION_NOT_CONFIGURED' })).toEqual({
      accounts: [],
      notConfigured: true,
      failed: false,
      status: null,
      reason: '',
    });
  });

  it('reports an upstream refusal as a failure, not as an empty workspace', () => {
    // Publer answered 401. The proxy still returns HTTP 200, so this arrives as
    // a resolved promise and a `.catch()` never sees it. Before #402 this read
    // as { accounts: [], notConfigured: false } — indistinguishable from an
    // empty workspace, which is the bug of #397 one layer down.
    expect(unwrapPublerAccounts({ ok: false, status: 401, data: { error: 'nope' } })).toEqual({
      accounts: [],
      notConfigured: false,
      failed: true,
      status: 401,
      reason: '',
    });
    // The proxy's own fetch threw: no upstream status exists to report.
    expect(
      unwrapPublerAccounts({ ok: false, error: 'Publer request failed: fetch failed' })
    ).toEqual({
      accounts: [],
      notConfigured: false,
      failed: true,
      status: null,
      reason: 'Publer request failed: fetch failed',
    });
  });

  it('treats an unreadable success body as empty rather than as a failure', () => {
    expect(unwrapPublerAccounts({ ok: true, status: 200, data: 'not json' })).toEqual({
      accounts: [],
      notConfigured: false,
      failed: false,
      status: 200,
      reason: '',
    });
    expect(unwrapPublerAccounts(undefined).accounts).toEqual([]);
    expect(unwrapPublerAccounts(undefined).failed).toBe(false);
    // Rows without an id cannot be chosen and are dropped.
    expect(
      unwrapPublerAccounts({ ok: true, status: 200, data: [{ name: 'no id' }, null] }).accounts
    ).toEqual([]);
  });
});

describe('publerAccountsStatus', () => {
  it('maps each envelope to the state both pages render', () => {
    const status = (response) => publerAccountsStatus(unwrapPublerAccounts(response));
    expect(status({ ok: true, status: 200, data: [{ id: 'a' }] })).toBe('ready');
    expect(status({ ok: true, status: 200, data: [] })).toBe('ready');
    expect(status({ ok: false, code: 'INTEGRATION_NOT_CONFIGURED' })).toBe('not_configured');
    expect(status({ ok: false, status: 401, data: {} })).toBe('error');
    expect(status({ ok: false, error: 'Publer request failed: fetch failed' })).toBe('error');
    // A ready-but-empty workspace is the only "no accounts" that means what it
    // says; the other two are failures wearing the same clothes.
    expect(publerAccountsStatus()).toBe('ready');
  });
});

describe('describePublerFailure', () => {
  it('leads with the upstream status, because that is the actionable half', () => {
    expect(describePublerFailure({ status: 401, reason: '' })).toBe('Publer answered 401');
    expect(describePublerFailure({ status: 429, reason: 'slow down' })).toBe(
      'Publer answered 429 — slow down'
    );
  });

  it('falls back to the server’s reason, then to a plain statement', () => {
    expect(
      describePublerFailure({ status: null, reason: 'Publer request failed: fetch failed' })
    ).toBe('Publer request failed: fetch failed');
    expect(describePublerFailure({})).toBe('the request failed');
    expect(describePublerFailure()).toBe('the request failed');
  });
});
