/**
 * What can honestly be asserted about a navigation jsdom does not perform.
 *
 * jsdom implements no navigation except hash changes: `location.replace()`
 * neither throws nor changes `href`, and there is no hook to observe the
 * attempt. So this pins the contract as far as the environment allows — the
 * export exists, takes a url, and delegates without throwing — and the
 * behavioural assertion (that AuthCallbackPage calls it with `/admin`, and only
 * when MSAL left the browser on the callback path) lives in that page's own
 * tests, where this module is mocked.
 *
 * It is here rather than nowhere because an untested one-line module is how a
 * one-line module quietly becomes a three-line one.
 */
import { describe, expect, it } from 'vitest';
import { hardAssign, hardReplace } from './hardNavigate';

describe('hardReplace', () => {
  it('delegates to location.replace without throwing', () => {
    const before = window.location.href;
    expect(() => hardReplace('/admin')).not.toThrow();
    // jsdom performs no navigation, so the document is exactly where it was.
    expect(window.location.href).toBe(before);
  });
});

describe('hardAssign', () => {
  it('delegates to location.assign without throwing', () => {
    // A same-document hash is the one navigation jsdom performs, so it shows
    // the call reached `assign`; the MCP Connect button's behavioural test
    // (McpOAuth.test.jsx) mocks this module.
    expect(() => hardAssign('#oauth')).not.toThrow();
    expect(window.location.hash).toBe('#oauth');
  });
});
