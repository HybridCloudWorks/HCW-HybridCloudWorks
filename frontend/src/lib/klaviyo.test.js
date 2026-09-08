/**
 * Reading Klaviyo through the proxy envelope.
 *
 * Two bugs are pinned here, and the second is the one that had never been
 * seen: the page read the collection one level too shallow, so it was empty
 * on SUCCESS as well as on failure. See the module header.
 */
import { describe, it, expect } from 'vitest';
import { INTEGRATION_NOT_CONFIGURED } from './integrationEnvelope';
import {
  connectionMessage,
  klaviyoCollection,
  pickKlaviyoCollection,
  requireKlaviyoCollection,
} from './klaviyo';

/** The proxy envelope, which is HTTP 200 whatever Klaviyo said. */
const envelope = (ok, status, data) => ({ ok, status, data });
/** Klaviyo's own body: JSON:API, so the collection is under `data`. */
const klaviyoBody = (items) => ({ data: items, links: { self: 'https://a.klaviyo.com/…' } });

describe('pickKlaviyoCollection', () => {
  it('reaches the collection inside a JSON:API body', () => {
    expect(pickKlaviyoCollection(klaviyoBody([{ id: 'l1' }]))).toEqual([{ id: 'l1' }]);
  });

  it('accepts a bare array, so an already-unwrapped caller still reads', () => {
    expect(pickKlaviyoCollection([{ id: 'l1' }])).toEqual([{ id: 'l1' }]);
  });

  it('returns null for a shape it cannot read, rather than an empty list', () => {
    // Null so the caller can tell "unreadable" from "empty" — the whole
    // distinction this file exists to defend.
    expect(pickKlaviyoCollection({ errors: [{ detail: 'nope' }] })).toBeNull();
    expect(pickKlaviyoCollection(null)).toBeNull();
  });
});

describe('klaviyoCollection', () => {
  it('reads the collection two levels down, which is where it actually is', () => {
    // THE BUG BEHIND THE BUG. The page tested `Array.isArray(res.data)`, where
    // `res` is the envelope — so `res.data` is Klaviyo's body, an object, and
    // the check was false on every successful call. The lists had never
    // rendered.
    const { items, error } = klaviyoCollection(
      envelope(true, 200, klaviyoBody([{ id: 'l1' }, { id: 'l2' }]))
    );
    expect(items).toHaveLength(2);
    expect(error).toBe('');
  });

  it('reports a refused key as a failure, not as an empty audience', () => {
    const { items, error } = klaviyoCollection(envelope(false, 401, { errors: [] }));
    expect(items).toEqual([]);
    expect(error).toBe('Klaviyo answered 401');
  });

  it('keeps a genuinely empty list distinguishable from a refused one', () => {
    const { items, error } = klaviyoCollection(envelope(true, 200, klaviyoBody([])));
    expect(items).toEqual([]);
    expect(error).toBe('');
  });

  it('reports an unreadable 2xx body as an error rather than an empty audience', () => {
    // Three ways to get an empty list; only one of them is an empty audience.
    // A body this page cannot parse says nothing about the audience, so
    // rendering "No lists found" would be a claim the data does not support.
    const { items, error } = klaviyoCollection(envelope(true, 200, { unexpected: 'shape' }));
    expect(items).toEqual([]);
    expect(error).toBe('Klaviyo answered 200 with a body this page cannot read');
  });

  it('agrees with requireKlaviyoCollection about what counts as a failure', () => {
    // The throwing and non-throwing readers are one implementation, so a
    // future change cannot make Test Connection and the Lists tab disagree
    // about whether the same response worked.
    const unreadable = envelope(true, 200, { unexpected: 'shape' });
    expect(() => requireKlaviyoCollection(unreadable)).toThrow(klaviyoCollection(unreadable).error);
  });

  it('reports an unconfigured key without calling it a fault', () => {
    const { error } = klaviyoCollection({
      ok: false,
      code: INTEGRATION_NOT_CONFIGURED,
      error: 'KLAVIYO_PRIVATE_KEY is not set',
    });
    expect(error).toBe('KLAVIYO_PRIVATE_KEY is not set');
  });
});

describe('requireKlaviyoCollection', () => {
  it('throws for a rejected key, so Test Connection cannot report success', () => {
    // #430 exactly: the proxy resolves for a 401, so only an explicit throw
    // stops `setResult({ ok: true })` from running.
    expect(() => requireKlaviyoCollection(envelope(false, 401, {}))).toThrow(
      'Klaviyo answered 401'
    );
  });

  it('throws on a 2xx whose body it cannot read', () => {
    // A connection test claims Klaviyo answered AND was understood. A body
    // this page cannot read is not a working connection, credential aside.
    expect(() => requireKlaviyoCollection(envelope(true, 200, { unexpected: true }))).toThrow(
      /body this page cannot read/
    );
  });

  it('returns the collection when the call really did work', () => {
    expect(requireKlaviyoCollection(envelope(true, 200, klaviyoBody([{ id: 'l1' }])))).toEqual([
      { id: 'l1' },
    ]);
  });
});

describe('connectionMessage', () => {
  it('counts in English', () => {
    expect(connectionMessage([{ id: 'l1' }])).toBe('Connected to Klaviyo — 1 list visible.');
    expect(connectionMessage([{ id: 'l1' }, { id: 'l2' }])).toBe(
      'Connected to Klaviyo — 2 lists visible.'
    );
  });

  it('can still say zero, because zero lists is a real answer', () => {
    // It just cannot be reached by a refused key any more — that path throws
    // before this is called.
    expect(connectionMessage([])).toBe('Connected to Klaviyo — 0 lists visible.');
  });
});
