/**
 * An in-memory Cosmos for tests, with real ETag semantics: a replace with a
 * stale `_etag` is a 412 and a create over an existing id a 409, as
 * cosmos-client.js's verbs answer. Documents are keyed by container and id;
 * every read returns a copy, so a test cannot change the store by accident.
 *
 * `fail(container, id, verb)` makes the next calls of one verb on one
 * document throw (a read that fails, a write that loses a race), for the
 * paths a real store reaches only under load. The same shape as
 * labs/coder-automation.test.js's makeStore, across containers.
 */
import { vi } from 'vitest';

export function memoryStore(initial = {}) {
  const docs = new Map();
  const failures = new Map();
  let etag = 0;
  const key = (container, id) => `${container}/${id}`;
  const stamp = (doc) => ({ ...structuredClone(doc), _etag: `"e${++etag}"` });
  for (const [path, doc] of Object.entries(initial)) docs.set(path, stamp(doc));

  const maybeFail = (container, id, verb) => {
    const queue = failures.get(`${verb}:${key(container, id)}`);
    const error = queue?.shift();
    if (error) throw error;
  };

  const store = {
    docs,
    audit: [],
    get: (container, id) => docs.get(key(container, id)) ?? null,
    /** Queue errors for the next `times` calls of `verb` on one document. */
    fail(container, id, verb, error, times = 1) {
      const name = `${verb}:${key(container, id)}`;
      failures.set(name, [...(failures.get(name) ?? []), ...Array.from({ length: times }, () => error)]);
    },
    readDoc: vi.fn(async (container, id) => {
      maybeFail(container, id, 'readDoc');
      const doc = docs.get(key(container, id));
      return doc ? structuredClone(doc) : null;
    }),
    createDoc: vi.fn(async (container, doc) => {
      maybeFail(container, doc.id, 'createDoc');
      if (docs.has(key(container, doc.id))) throw Object.assign(new Error('conflict'), { code: 409 });
      docs.set(key(container, doc.id), stamp(doc));
      return structuredClone(docs.get(key(container, doc.id)));
    }),
    replaceDocIfMatch: vi.fn(async (container, doc) => {
      maybeFail(container, doc.id, 'replaceDocIfMatch');
      if (docs.get(key(container, doc.id))?._etag !== doc._etag) {
        throw Object.assign(new Error('precondition'), { code: 412 });
      }
      docs.set(key(container, doc.id), stamp(doc));
      return structuredClone(docs.get(key(container, doc.id)));
    }),
    upsertDoc: vi.fn(async (container, doc) => {
      maybeFail(container, doc.id, 'upsertDoc');
      if (container === 'admin_audit_logs') store.audit.push(structuredClone(doc));
      else docs.set(key(container, doc.id), stamp(doc));
      return doc;
    }),
  };
  return store;
}
