/**
 * Moved here from PlatformSettingsPage.test.jsx with the helper it covers
 * (#397): two pages read this response now, so the contract is tested once
 * beside the module rather than inside one of its callers.
 */
import { describe, it, expect } from 'vitest';

import { PUBLER_NOT_CONFIGURED, unwrapPublerAccounts } from './publerAccounts';

describe('unwrapPublerAccounts', () => {
  it('reads the proxy envelope, not a bare array', () => {
    const accounts = [{ id: 'acc-1', name: 'HCW', provider: 'linkedin' }];
    expect(unwrapPublerAccounts({ ok: true, status: 200, data: accounts })).toEqual({
      accounts,
      notConfigured: false,
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

  it('names the unconfigured case and treats every other failure as empty', () => {
    expect(PUBLER_NOT_CONFIGURED).toBe('INTEGRATION_NOT_CONFIGURED');
    expect(unwrapPublerAccounts({ ok: false, code: 'INTEGRATION_NOT_CONFIGURED' })).toEqual({
      accounts: [],
      notConfigured: true,
    });
    expect(unwrapPublerAccounts({ ok: false, status: 401, data: { error: 'nope' } })).toEqual({
      accounts: [],
      notConfigured: false,
    });
    expect(unwrapPublerAccounts({ ok: true, status: 200, data: 'not json' }).accounts).toEqual([]);
    expect(unwrapPublerAccounts(undefined).accounts).toEqual([]);
    // Rows without an id cannot be chosen and are dropped.
    expect(
      unwrapPublerAccounts({ ok: true, status: 200, data: [{ name: 'no id' }, null] }).accounts
    ).toEqual([]);
  });
});
