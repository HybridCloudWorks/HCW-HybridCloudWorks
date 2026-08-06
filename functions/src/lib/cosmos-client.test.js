import { describe, expect, it } from 'vitest';

import {
  MAX_PATCH_OPERATIONS,
  applyFieldPath,
  planPatch,
  toJsonPointer,
} from './cosmos-client.js';

/**
 * These cover `patchDoc`'s decision rules, which exist because Cosmos cannot
 * express Firestore's `.update()` semantics directly:
 *
 *   - a patch specification is capped at ten operations
 *   - `remove` fails on an absent path, while Firestore's field delete is a
 *     no-op on a missing field
 *   - property names escape `~` and `/` per RFC 6902, per path segment
 *
 * Getting any of these wrong is silent. The old `upsertDoc` comment claimed
 * merge semantics for a full replace, and nothing in the suite noticed; this
 * file is the check that the replacement does not repeat it.
 */

describe('toJsonPointer', () => {
  it('converts a flat field', () => {
    expect(toJsonPointer('title')).toBe('/title');
  });

  it("converts Firestore's dotted nesting to pointer segments", () => {
    expect(toJsonPointer('meta.author.name')).toBe('/meta/author/name');
  });

  it('escapes ~ and / inside a property name, per RFC 6902', () => {
    expect(toJsonPointer('a~b')).toBe('/a~0b');
    expect(toJsonPointer('a/b')).toBe('/a~1b');
  });

  it('escapes a property name while dots still separate segments', () => {
    // Characterisation, not a guard: escape-then-split and split-then-escape
    // are equivalent here, because neither escape sequence introduces a '.'.
    // Checked by writing the "wrong" order and watching all 20 tests still
    // pass. Recorded so the next reader does not mistake this for an
    // ordering constraint that needs defending.
    expect(toJsonPointer('outer.in/ner')).toBe('/outer/in~1ner');
  });
});

describe('planPatch', () => {
  it('treats an empty update as a no-op rather than an empty patch', () => {
    expect(planPatch({}).strategy).toBe('noop');
    expect(planPatch(undefined).strategy).toBe('noop');
  });

  it('builds set operations for a small update', () => {
    const plan = planPatch({ title: 'x', 'meta.slug': 'y' });
    expect(plan.strategy).toBe('patch');
    expect(plan.operations).toEqual([
      { op: 'set', path: '/title', value: 'x' },
      { op: 'set', path: '/meta/slug', value: 'y' },
    ]);
  });

  it('patches at exactly the ten-operation ceiling', () => {
    const updates = Object.fromEntries(
      Array.from({ length: MAX_PATCH_OPERATIONS }, (_, i) => [`f${i}`, i])
    );
    expect(planPatch(updates).strategy).toBe('patch');
  });

  it('falls back to read-modify-write one operation past the ceiling', () => {
    // Cosmos rejects an 11-operation specification outright. Chunking would
    // drop atomicity silently, so the fallback is a guarded whole-document
    // write instead.
    const updates = Object.fromEntries(
      Array.from({ length: MAX_PATCH_OPERATIONS + 1 }, (_, i) => [`f${i}`, i])
    );
    const plan = planPatch(updates);
    expect(plan.strategy).toBe('rmw');
    expect(plan.reason).toBe('exceeds-operation-limit');
  });

  it('routes deletions through read-modify-write even when small', () => {
    // Cosmos `remove` errors with "Node(PATH) to be removed is absent";
    // Firestore's FieldValue.delete() on a missing field is a no-op. RMW keeps
    // the Firestore behaviour the 48 ported call sites rely on.
    const plan = planPatch({ draft: undefined });
    expect(plan.strategy).toBe('rmw');
    expect(plan.reason).toBe('deletion');
  });

  it('refuses to modify system properties', () => {
    for (const prop of ['id', '_etag', '_ts', '_rid']) {
      expect(() => planPatch({ [prop]: 'x' })).toThrow(/system property/);
    }
  });

  it('refuses a system property reached through a dotted path root', () => {
    expect(() => planPatch({ '_etag.nested': 'x' })).toThrow(/system property/);
  });

  it('allows a field that merely starts with an underscore', () => {
    expect(planPatch({ _draftNote: 'x' }).strategy).toBe('patch');
  });
});

describe('applyFieldPath', () => {
  it('sets a flat field', () => {
    const doc = { a: 1 };
    applyFieldPath(doc, ['b'], 2);
    expect(doc).toEqual({ a: 1, b: 2 });
  });

  it('leaves sibling fields untouched — the whole point of a partial write', () => {
    const doc = { keep: 'me', change: 'old' };
    applyFieldPath(doc, ['change'], 'new');
    expect(doc).toEqual({ keep: 'me', change: 'new' });
  });

  it('creates intermediate objects', () => {
    const doc = {};
    applyFieldPath(doc, ['meta', 'author', 'name'], 'Ada');
    expect(doc).toEqual({ meta: { author: { name: 'Ada' } } });
  });

  it('replaces a non-object intermediate rather than throwing', () => {
    const doc = { meta: 'scalar' };
    applyFieldPath(doc, ['meta', 'slug'], 'x');
    expect(doc).toEqual({ meta: { slug: 'x' } });
  });

  it('replaces a null intermediate', () => {
    // typeof null === 'object', so a null check has to be explicit or this
    // throws on property assignment.
    const doc = { meta: null };
    applyFieldPath(doc, ['meta', 'slug'], 'x');
    expect(doc).toEqual({ meta: { slug: 'x' } });
  });

  it('deletes on undefined', () => {
    const doc = { a: 1, b: 2 };
    applyFieldPath(doc, ['b'], undefined);
    expect(doc).toEqual({ a: 1 });
    expect('b' in doc).toBe(false);
  });

  it('deleting an absent field is a no-op, matching Firestore', () => {
    const doc = { a: 1 };
    expect(() => applyFieldPath(doc, ['nope'], undefined)).not.toThrow();
    expect(doc).toEqual({ a: 1 });
  });

  it('preserves null as a value rather than treating it as a delete', () => {
    const doc = { a: 1 };
    applyFieldPath(doc, ['a'], null);
    expect(doc).toEqual({ a: null });
  });
});
