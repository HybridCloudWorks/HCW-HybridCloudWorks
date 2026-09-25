import { afterEach, describe, expect, it, vi } from 'vitest';

import { CACHE_CONTAINER } from '../cloud-tools/history.js';
import {
  CODER_STATUS_CACHE_ID,
  CODER_STATUS_CACHE_SECONDS,
  CODER_TIMEOUT_MS,
  DEFAULT_CODER_MAX_WORKSPACES,
  MAX_TEMPLATES,
  createCoderStatusHandlers,
  readCoderConfig,
  readMaxWorkspaces,
  readSetting,
} from './coder-status.js';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const ENV = {
  CODER_URL: 'https://coder.lab.example/',
  CODER_STATUS_TOKEN: 'read-only-token',
  CODER_MAX_WORKSPACES: '5',
};
const V1 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const V2 = '11111111-2222-4333-8444-555555555555';

const context = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
const request = () => ({ method: 'GET', query: { get: () => null } });
const body = (res) => JSON.parse(res.body);

const makeStore = (over = {}) => ({
  readDoc: vi.fn(async () => null),
  upsertDoc: vi.fn(async (_c, d) => d),
  ...over,
});

const okJson = (data) => ({ ok: true, status: 200, json: async () => data });

/** A Coder that answers by path (plus query string), recording every call. */
function coderFetch(routes, calls = []) {
  const fetchImpl = vi.fn(async (url, options) => {
    calls.push({ url, options });
    const u = new URL(url);
    const hit = routes[`${u.pathname}${u.search}`] ?? routes[u.pathname];
    if (hit === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return typeof hit === 'function' ? hit() : okJson(hit);
  });
  fetchImpl.calls = calls;
  return fetchImpl;
}

const HEALTHY = {
  '/api/v2/templates': [
    { name: 'hcw-lab', active_version_id: V1, display_name: 'HCW Lab' },
    { name: 'scratch', active_version_id: V2 },
  ],
  '/api/v2/workspaces?q=status%3Arunning': { count: 2, workspaces: [{ id: 'w1' }, { id: 'w2' }] },
  [`/api/v2/templateversions/${V1}`]: { name: 'v7', id: V1 },
  [`/api/v2/templateversions/${V2}`]: { name: 'v2', id: V2 },
};

const cachedDoc = (value, ageMs) => ({
  id: CODER_STATUS_CACHE_ID,
  kind: 'labs-coder-status',
  value,
  cachedAt: new Date(NOW - ageMs).toISOString(),
});

const handlers = ({ store = makeStore(), fetchImpl = coderFetch(HEALTHY), env = ENV } = {}) =>
  createCoderStatusHandlers({ store, fetchImpl, env, now: () => NOW });

afterEach(() => {
  vi.useRealTimers();
});

describe('readSetting', () => {
  it('treats an unresolved Key Vault reference as unset, and trims a BOM', () => {
    expect(readSetting({ X: '@Microsoft.KeyVault(SecretUri=https://kv/secrets/X)' }, 'X')).toBe('');
    expect(readSetting({ X: '﻿  value  ' }, 'X')).toBe('value');
    expect(readSetting({}, 'X')).toBe('');
    expect(readSetting({ X: 42 }, 'X')).toBe('');
  });
});

describe('readMaxWorkspaces', () => {
  it('defaults to the Community cap, and only accepts a positive integer', () => {
    expect(readMaxWorkspaces({})).toBe(DEFAULT_CODER_MAX_WORKSPACES);
    expect(readMaxWorkspaces({ CODER_MAX_WORKSPACES: '8' })).toBe(8);
    expect(readMaxWorkspaces({ CODER_MAX_WORKSPACES: '0' })).toBe(DEFAULT_CODER_MAX_WORKSPACES);
    expect(readMaxWorkspaces({ CODER_MAX_WORKSPACES: 'many' })).toBe(DEFAULT_CODER_MAX_WORKSPACES);
  });
});

describe('readCoderConfig', () => {
  it('needs both the URL and the token', () => {
    expect(readCoderConfig({})).toBeNull();
    expect(readCoderConfig({ CODER_URL: ENV.CODER_URL })).toBeNull();
    expect(readCoderConfig({ CODER_STATUS_TOKEN: 't' })).toBeNull();
    expect(readCoderConfig({ ...ENV, CODER_STATUS_TOKEN: '@Microsoft.KeyVault(x)' })).toBeNull();
  });

  it('refuses a URL that is not https, because the token travels in a header', () => {
    expect(readCoderConfig({ ...ENV, CODER_URL: 'http://coder.lab.example' })).toBeNull();
    expect(readCoderConfig({ ...ENV, CODER_URL: 'coder.lab.example' })).toBeNull();
  });

  it('normalises the base: no trailing slash, path prefix kept', () => {
    expect(readCoderConfig(ENV)).toEqual({ base: 'https://coder.lab.example', token: 'read-only-token', max: 5 });
    expect(readCoderConfig({ ...ENV, CODER_URL: 'https://lab.example/coder/' }).base).toBe('https://lab.example/coder');
  });
});

describe('GET /api/public/labs/coder-status', () => {
  it('unconfigured: answers { configured: false } with no store read and no network', async () => {
    const store = makeStore();
    const fetchImpl = vi.fn();
    const res = await handlers({ store, fetchImpl, env: {} }).getCoderStatus(request(), context);

    expect(res.status).toBe(200);
    expect(body(res)).toEqual({ configured: false });
    expect(res.headers['Cache-Control']).toBeUndefined();
    expect(store.readDoc).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('unconfigured with a warning when both settings exist but the URL is not https', async () => {
    const warn = vi.fn();
    const res = await handlers({ env: { ...ENV, CODER_URL: 'http://coder.lab.example' } }).getCoderStatus(
      request(),
      { ...context, warn }
    );
    expect(body(res)).toEqual({ configured: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('https'));
  });

  it('healthy: templates with their active version names, the running count, the cap, cached a minute', async () => {
    const store = makeStore();
    const fetchImpl = coderFetch(HEALTHY);
    const res = await handlers({ store, fetchImpl }).getCoderStatus(request(), context);

    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toBe(`public, max-age=${CODER_STATUS_CACHE_SECONDS}`);
    expect(body(res)).toEqual({
      configured: true,
      reachable: true,
      templates: [
        { name: 'hcw-lab', activeVersion: 'v7' },
        { name: 'scratch', activeVersion: 'v2' },
      ],
      capacity: { running: 2, max: 5 },
      asOf: new Date(NOW).toISOString(),
    });

    // Every call carried the session token header and went to the configured base.
    expect(fetchImpl.calls.length).toBe(4);
    for (const { url, options } of fetchImpl.calls) {
      expect(url.startsWith('https://coder.lab.example/api/v2/')).toBe(true);
      expect(options.headers['Coder-Session-Token']).toBe('read-only-token');
    }

    expect(store.upsertDoc).toHaveBeenCalledWith(
      CACHE_CONTAINER,
      expect.objectContaining({
        id: CODER_STATUS_CACHE_ID,
        value: expect.objectContaining({ reachable: true }),
        ttl: CODER_STATUS_CACHE_SECONDS,
      })
    );
  });

  it('never returns the URL, the token, a workspace or an id', async () => {
    const res = await handlers().getCoderStatus(request(), context);
    const text = res.body;
    expect(text).not.toContain('coder.lab.example');
    expect(text).not.toContain('read-only-token');
    expect(text).not.toContain('w1');
    expect(text).not.toContain(V1);
  });

  it('caps the templates shown, and therefore the version lookups, at MAX_TEMPLATES', async () => {
    const many = Array.from({ length: MAX_TEMPLATES + 2 }, (_, i) => ({ name: `t${i}`, active_version_id: V1 }));
    const fetchImpl = coderFetch({ ...HEALTHY, '/api/v2/templates': many });
    const res = await handlers({ fetchImpl }).getCoderStatus(request(), context);

    expect(body(res).templates).toHaveLength(MAX_TEMPLATES);
    const versionCalls = fetchImpl.calls.filter(({ url }) => url.includes('/templateversions/'));
    expect(versionCalls).toHaveLength(MAX_TEMPLATES);
  });

  it('gives activeVersion null when the version cannot be resolved, never the uuid', async () => {
    const fetchImpl = coderFetch({
      ...HEALTHY,
      '/api/v2/templates': [
        { name: 'hcw-lab', active_version_id: V1 },
        { name: 'odd', active_version_id: 'not-a-uuid' },
        { name: 'broken', active_version_id: V2 },
      ],
      [`/api/v2/templateversions/${V2}`]: () => ({ ok: false, status: 500, json: async () => ({}) }),
    });
    const res = await handlers({ fetchImpl }).getCoderStatus(request(), context);
    expect(body(res)).toMatchObject({
      reachable: true,
      templates: [
        { name: 'hcw-lab', activeVersion: 'v7' },
        { name: 'odd', activeVersion: null },
        { name: 'broken', activeVersion: null },
      ],
    });
  });

  it('falls back to the length of the page when the workspaces answer carries no count', async () => {
    const fetchImpl = coderFetch({
      ...HEALTHY,
      '/api/v2/workspaces?q=status%3Arunning': { workspaces: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
    });
    const res = await handlers({ fetchImpl }).getCoderStatus(request(), context);
    expect(body(res).capacity).toEqual({ running: 3, max: 5 });
  });

  it('unreachable: a thrown fetch answers reachable false with running null, and caches that', async () => {
    const store = makeStore();
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const res = await handlers({ store, fetchImpl }).getCoderStatus(request(), context);

    expect(res.status).toBe(200);
    expect(body(res)).toEqual({
      configured: true,
      reachable: false,
      templates: [],
      capacity: { running: null, max: 5 },
      asOf: new Date(NOW).toISOString(),
    });
    expect(store.upsertDoc).toHaveBeenCalledWith(
      CACHE_CONTAINER,
      expect.objectContaining({ value: expect.objectContaining({ reachable: false }), ttl: 60 })
    );
  });

  it('unreachable: a non-200 from Coder, or a malformed body, is not guessed at', async () => {
    const refused = coderFetch({
      ...HEALTHY,
      '/api/v2/templates': () => ({ ok: false, status: 401, json: async () => ({}) }),
    });
    expect(body(await handlers({ fetchImpl: refused }).getCoderStatus(request(), context)).reachable).toBe(false);

    const odd = coderFetch({ ...HEALTHY, '/api/v2/templates': { not: 'a list' } });
    expect(body(await handlers({ fetchImpl: odd }).getCoderStatus(request(), context)).reachable).toBe(false);

    const noCount = coderFetch({ ...HEALTHY, '/api/v2/workspaces?q=status%3Arunning': { count: 'two' } });
    expect(body(await handlers({ fetchImpl: noCount }).getCoderStatus(request(), context)).reachable).toBe(false);
  });

  it('unreachable: a Coder that does not answer within the timeout', async () => {
    vi.useFakeTimers({ now: NOW });
    const fetchImpl = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );
    const pending = handlers({ fetchImpl }).getCoderStatus(request(), context);
    await vi.advanceTimersByTimeAsync(CODER_TIMEOUT_MS + 1);
    const res = await pending;
    expect(body(res)).toMatchObject({ configured: true, reachable: false, capacity: { running: null, max: 5 } });
  });

  it('cache hit: serves the stored body and does not call Coder', async () => {
    const stored = { configured: true, reachable: true, templates: [], capacity: { running: 1, max: 5 }, asOf: 'x' };
    const store = makeStore({ readDoc: vi.fn(async () => cachedDoc(stored, 30_000)) });
    const fetchImpl = vi.fn();
    const res = await handlers({ store, fetchImpl }).getCoderStatus(request(), context);

    expect(body(res)).toEqual(stored);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('a stale healthy entry is replaced by the failure, so the card never shows old numbers', async () => {
    const stale = { configured: true, reachable: true, templates: [], capacity: { running: 4, max: 5 }, asOf: 'x' };
    const store = makeStore({ readDoc: vi.fn(async () => cachedDoc(stale, 61_000)) });
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    });
    const res = await handlers({ store, fetchImpl }).getCoderStatus(request(), context);

    expect(body(res).reachable).toBe(false);
    expect(body(res).capacity.running).toBeNull();
    expect(store.upsertDoc).toHaveBeenCalledWith(
      CACHE_CONTAINER,
      expect.objectContaining({ value: expect.objectContaining({ reachable: false }) })
    );
  });

  it('readStatus is the same body the route returns, for the estate read', async () => {
    const h = handlers();
    const direct = await h.readStatus(context);
    const routed = body(await h.getCoderStatus(request(), context));
    expect(direct).toEqual(routed);
  });

  it('answers 500 when something outside the guarded paths throws', async () => {
    const error = vi.fn();
    const h = createCoderStatusHandlers({
      store: makeStore(),
      fetchImpl: coderFetch(HEALTHY),
      env: ENV,
      now: () => {
        throw new Error('clock broke');
      },
    });
    const res = await h.getCoderStatus(request(), { ...context, error });
    expect(res.status).toBe(500);
    expect(body(res)).toEqual({ error: 'Failed to read Coder status' });
    expect(error).toHaveBeenCalled();
  });
});
