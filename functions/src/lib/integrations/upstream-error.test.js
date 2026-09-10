/**
 * The upstream error reader (#463 item 4).
 *
 * The point of this module is that a rejected credential arrives with a reason
 * attached and we were throwing it away. So the cases that matter here are the
 * shapes real providers answer with, and — just as much — the shapes that must
 * produce `''` rather than a plausible-looking string, because a wrong reason
 * beside a real status is worse than no reason at all.
 */
import { describe, it, expect } from 'vitest';
import { readUpstreamError, describeUpstreamFailure } from './upstream-error.js';

describe('readUpstreamError', () => {
  it('reads Publer\'s errors array, which is what #358 spent two days without', () => {
    expect(readUpstreamError({ errors: ['Missing or invalid Authorization header'] })).toBe(
      'Missing or invalid Authorization header'
    );
  });

  it('reads the first entry when a provider lists several', () => {
    expect(readUpstreamError({ errors: ['first', 'second'] })).toBe('first');
  });

  it('reads an errors array of objects, which is what Klaviyo answers with', () => {
    expect(readUpstreamError({ errors: [{ detail: 'The API key is invalid', title: 'Nope' }] })).toBe(
      'The API key is invalid'
    );
    // `title` when there is no `detail`, rather than nothing.
    expect(readUpstreamError({ errors: [{ title: 'Unauthorized' }] })).toBe('Unauthorized');
  });

  it('reads the plain shapes too', () => {
    expect(readUpstreamError({ message: 'bad key' })).toBe('bad key');
    expect(readUpstreamError({ error: 'bad key' })).toBe('bad key');
    expect(readUpstreamError({ detail: 'bad key' })).toBe('bad key');
  });

  it('reads the non-JSON body the proxy parks under `raw`', () => {
    // An HTML error page from a gateway in front of the API still says more
    // than the status alone.
    expect(readUpstreamError({ raw: '<html>502 Bad Gateway</html>' })).toBe(
      '<html>502 Bad Gateway</html>'
    );
  });

  it('returns "" for a body with no message, so nothing is invented', () => {
    for (const body of [null, undefined, '', 0, {}, [], { errors: [] }, { errors: [{}] }]) {
      expect(readUpstreamError(body)).toBe('');
    }
  });

  it('ignores a non-string where a message should be, rather than stringifying it', () => {
    // `[object Object]` in an operator's error line is noise that reads like
    // information, which is the worst of both.
    expect(readUpstreamError({ message: { nested: true } })).toBe('');
    expect(readUpstreamError({ errors: [42, null, 'real'] })).toBe('real');
  });

  it('caps the length, because this is written to Cosmos and to a log line', () => {
    expect(readUpstreamError({ errors: ['x'.repeat(1000) ] })).toHaveLength(300);
  });

  it('never throws on anything JSON.parse can produce — it runs on an error path', () => {
    // A reader that can fail turns a reported failure into an unreported one,
    // and every caller here is already inside a catch or an `if (!ok)`.
    for (const body of [
      { errors: 'a string not an array' },
      { errors: { a: 1 } },
      { errors: [[['deep']]] },
      [[['deep']]],
      { message: null },
    ]) {
      expect(() => readUpstreamError(body)).not.toThrow();
    }
  });
});

describe('describeUpstreamFailure', () => {
  it('appends the reason when there is one', () => {
    expect(describeUpstreamFailure(401, { errors: ['Missing or invalid Authorization header'] })).toBe(
      'HTTP 401 — Missing or invalid Authorization header'
    );
  });

  it('is exactly the old sentence when there is not', () => {
    // The status alone is what every caller printed before this module, so a
    // provider that says nothing must read identically to how it always did.
    expect(describeUpstreamFailure(500, {})).toBe('HTTP 500');
    expect(describeUpstreamFailure(429, null)).toBe('HTTP 429');
  });
});

describe('Telegram’s description field (#483)', () => {
  it('reads the sentence Telegram actually sends', () => {
    // `{ ok: false, error_code: 401, description: 'Unauthorized' }`. Without
    // this the connection probe would print a bare HTTP 401, which is the
    // exact thing #463 item 4 existed to stop.
    expect(readUpstreamError({ ok: false, error_code: 401, description: 'Unauthorized' })).toBe(
      'Unauthorized'
    );
  });

  it('still prefers the fields the other providers use', () => {
    // Appended last on purpose: adding it must not change what Publer,
    // Klaviyo or Linkie resolve to.
    expect(readUpstreamError({ message: 'the real one', description: 'the vaguer one' })).toBe(
      'the real one'
    );
  });
});
