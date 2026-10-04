/**
 * admin-handler.js — the shared handler pieces: `validBody` and the
 * list-everything handler that the certifications and speaker-events lists
 * are built from.
 */
import { describe, it, expect, vi } from 'vitest';
import { json, listAllHandler, validBody, LIST_WINDOW, MAX_DOC_JSON } from './admin-handler.js';

const context = { log: vi.fn(), error: vi.fn() };

describe('validBody', () => {
  it('accepts a plain object and refuses null, arrays, scalars and oversized bodies', () => {
    expect(validBody({ a: 1 })).toEqual({ a: 1 });
    expect(validBody(null)).toBeNull();
    expect(validBody([1])).toBeNull();
    expect(validBody('x')).toBeNull();
    expect(validBody({ big: 'x'.repeat(MAX_DOC_JSON) })).toBeNull();
  });
});

describe('listAllHandler', () => {
  const spec = { container: 'things', name: 'listThings', failure: 'Failed to list things' };

  it('passes a guard denial through and never touches the store', async () => {
    const store = { queryDocs: vi.fn() };
    const guard = { requireRole: vi.fn(async () => ({ error: json(403, {}) })) };
    const res = await listAllHandler({ guard, store }, spec)({}, context);
    expect(res.status).toBe(403);
    expect(store.queryDocs).not.toHaveBeenCalled();
  });

  it('answers every document of the container with its total', async () => {
    const store = { queryDocs: vi.fn(async () => [{ id: 'a' }, { id: 'b' }]) };
    const guard = { requireRole: vi.fn(async () => ({ error: null, user: {} })) };
    const res = await listAllHandler({ guard, store }, spec)({}, context);
    expect(guard.requireRole).toHaveBeenCalledWith(expect.anything(), 'editor');
    expect(store.queryDocs).toHaveBeenCalledWith(
      'things',
      `SELECT TOP ${LIST_WINDOW} * FROM c`,
      []
    );
    expect(JSON.parse(res.body)).toEqual({
      success: true,
      items: [{ id: 'a' }, { id: 'b' }],
      total: 2,
    });
  });

  it('logs under the handler name and answers 500 with the failure sentence', async () => {
    const error = vi.fn();
    const store = {
      queryDocs: vi.fn(async () => {
        throw new Error('cosmos down');
      }),
    };
    const guard = { requireRole: vi.fn(async () => ({ error: null, user: {} })) };
    const res = await listAllHandler({ guard, store }, spec)({}, { error });
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'Failed to list things' });
    expect(error).toHaveBeenCalledWith('listThings failed:', expect.any(Error));
  });
});
