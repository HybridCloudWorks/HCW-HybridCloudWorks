/**
 * `GET /accounts` through the publerProxy, as the four-state result the three
 * tabs that show accounts all need (#575).
 *
 * Per the Newsletter Hub standard each tab loads its own data, so Compose,
 * Accounts and Settings each call this rather than sharing one read at page
 * level: a refused key on Settings must not blank the composer, and nothing
 * one tab does changes what another would read.
 *
 * `status` is 'loading' | 'ready' | 'not_configured' | 'error' and is the whole
 * point — `accounts` being empty says nothing on its own, which is the #397
 * conflation. A failed read leaves the list empty rather than showing the
 * accounts from before it failed.
 */
import { useEffect, useState } from 'react';
import { loadPublerAccounts } from './publerApi';

const EMPTY = Object.freeze([]);

export default function usePublerAccounts() {
  const [state, setState] = useState({
    accounts: EMPTY,
    status: 'loading',
    error: '',
    reason: '',
  });

  // `loadPublerAccounts` returns its own cancel, and settles exactly once, so
  // the effect body is the subscription and its cleanup supersedes the read.
  useEffect(() => loadPublerAccounts(setState), []);

  return state;
}
