/**
 * The proxy envelope, read once for every integration.
 *
 * The assertions that matter here are all the same shape: a refused
 * credential must not be indistinguishable from an empty result. That is the
 * mistake this module exists to make unavailable, and it caught three
 * integrations before it was extracted (#397, #429, #430).
 */
import { describe, it, expect } from 'vitest';
import {
  INTEGRATION_NOT_CONFIGURED,
  describeProxyFailure,
  readProxyBody,
  readProxyList,
  unwrapProxy,
} from './integrationEnvelope';

describe('unwrapProxy', () => {
  it('keeps the four outcomes apart', () => {
    expect(unwrapProxy({ ok: true, status: 200, data: { a: 1 } })).toEqual({
      body: { a: 1 },
      notConfigured: false,
      failed: false,
      status: 200,
      reason: '',
    });

    expect(unwrapProxy({ ok: false, code: INTEGRATION_NOT_CONFIGURED, error: 'no key' })).toEqual({
      body: null,
      notConfigured: true,
      failed: false,
      status: null,
      reason: 'no key',
    });

    // The one that matters: upstream refused, and it is a failure rather than
    // an absence. HTTP 200 all the way, so nothing threw.
    expect(unwrapProxy({ ok: false, status: 401, data: { detail: 'bad key' } })).toMatchObject({
      failed: true,
      notConfigured: false,
      status: 401,
    });

    expect(unwrapProxy({ ok: false, error: 'fetch exploded' })).toMatchObject({
      failed: true,
      reason: 'fetch exploded',
    });
  });

  it('accepts a bare body, so a caller that already unwrapped is not punished', () => {
    expect(unwrapProxy([1, 2]).body).toEqual([1, 2]);
  });

  it('does not read a missing key as a failure', () => {
    // `ok` absent is not `ok: false`. A body that happens to have no `ok`
    // field must not be mistaken for a refusal.
    expect(unwrapProxy({ data: 'x' }).failed).toBe(false);
  });
});

describe('describeProxyFailure', () => {
  it('leads with the upstream status, which is what tells an operator what to fix', () => {
    expect(describeProxyFailure('Klaviyo', { status: 401 })).toBe('Klaviyo answered 401');
    expect(describeProxyFailure('Klaviyo', { status: 401, reason: 'bad key' })).toBe(
      'Klaviyo answered 401 — bad key'
    );
  });

  it('falls back to the reason, then to a sentence rather than nothing', () => {
    expect(describeProxyFailure('Linkie', { reason: 'timed out' })).toBe('timed out');
    expect(describeProxyFailure('Linkie')).toBe('the request failed');
  });
});

describe('readProxyBody', () => {
  it('raises on a refused credential instead of returning nothing', () => {
    expect(() => readProxyBody('Klaviyo', { ok: false, status: 401 })).toThrow(
      'Klaviyo answered 401'
    );
  });

  it('raises on an unconfigured integration, naming it', () => {
    expect(() => readProxyBody('Klaviyo', { ok: false, code: INTEGRATION_NOT_CONFIGURED })).toThrow(
      'Klaviyo is not configured'
    );
  });

  it('returns the upstream body on success', () => {
    expect(readProxyBody('Klaviyo', { ok: true, status: 200, data: { data: [] } })).toEqual({
      data: [],
    });
  });
});

describe('readProxyList', () => {
  it('separates "the call failed" from "there is nothing there"', () => {
    // These two rendered identically before this module existed, and an
    // operator seeing an empty mailing list concludes the audience is empty.
    const refused = readProxyList('Klaviyo', { ok: false, status: 401 });
    const empty = readProxyList('Klaviyo', { ok: true, status: 200, data: [] });

    expect(refused.items).toEqual([]);
    expect(refused.error).toBe('Klaviyo answered 401');

    expect(empty.items).toEqual([]);
    expect(empty.error).toBe('');
  });

  it('reaches the array through a pick, for an upstream that wraps its own payload', () => {
    const { items, error } = readProxyList(
      'Klaviyo',
      { ok: true, status: 200, data: { data: [{ id: 'l1' }] } },
      (body) => body?.data
    );
    expect(items).toEqual([{ id: 'l1' }]);
    expect(error).toBe('');
  });

  it('calls an unreadable 2xx an error, not an empty result', () => {
    // The third way to get an empty list, and the one that is not an empty
    // audience. The call succeeded, so `failed` is false — but nothing was
    // learned, and "there is nothing there" is a claim we cannot support.
    const { items, error } = readProxyList('Klaviyo', { ok: true, status: 200, data: { nope: 1 } });
    expect(items).toEqual([]);
    expect(error).toBe('Klaviyo answered 200 with a body this page cannot read');
  });
});
