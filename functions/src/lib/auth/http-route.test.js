/**
 * The shared route registration helper.
 *
 * These assert the properties every route gets for free, because the failure
 * this replaces was not a broken control — `cors.js` was correct and tested —
 * but a control applied at one call site out of fifty-eight (TODO.md T-102).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  httpRoute,
  withPreflight,
  mergeCorsHeaders,
  parseExtraOrigins,
  resetHttpRouteCors,
} from './http-route.js';
import { createCors } from './cors.js';

const context = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };

/** Records registrations the way the Functions host would. */
const recorder = () => {
  const routes = new Map();
  return {
    routes,
    register: { http: (name, options) => routes.set(name, options) },
  };
};

const makeRequest = ({ method = 'GET', origin } = {}) => ({
  method,
  headers: { get: (name) => (name.toLowerCase() === 'origin' && origin ? origin : null) },
});

const cors = () => createCors({ environment: 'production' });

describe('withPreflight', () => {
  it('adds OPTIONS to every method list', () => {
    expect(withPreflight(['GET'])).toEqual(['GET', 'OPTIONS']);
    expect(withPreflight(['PUT', 'DELETE'])).toEqual(['PUT', 'DELETE', 'OPTIONS']);
  });

  it('does not duplicate an OPTIONS the caller already declared', () => {
    expect(withPreflight(['POST', 'OPTIONS'])).toEqual(['POST', 'OPTIONS']);
  });

  it('defaults an empty list to GET', () => {
    expect(withPreflight([])).toEqual(['GET', 'OPTIONS']);
    expect(withPreflight(undefined)).toEqual(['GET', 'OPTIONS']);
  });
});

describe('mergeCorsHeaders', () => {
  it('lets the handler win on collision', () => {
    const merged = mergeCorsHeaders(
      { status: 200, headers: { 'Content-Type': 'image/png' } },
      { 'Content-Type': 'application/json', Vary: 'Origin' }
    );
    expect(merged.headers['Content-Type']).toBe('image/png');
    expect(merged.headers.Vary).toBe('Origin');
  });

  it('survives a handler that returns nothing', () => {
    expect(mergeCorsHeaders(undefined, { Vary: 'Origin' })).toEqual({
      status: 204,
      headers: { Vary: 'Origin' },
    });
  });
});

describe('parseExtraOrigins', () => {
  it('is empty by default', () => {
    expect(parseExtraOrigins({})).toEqual([]);
  });

  it('splits, trims, and drops blanks', () => {
    expect(parseExtraOrigins({ CORS_ALLOWED_ORIGINS: 'https://a.test, ,https://b.test ' })).toEqual(
      ['https://a.test', 'https://b.test']
    );
  });
});

describe('httpRoute', () => {
  it('registers OPTIONS alongside the declared methods', () => {
    const { routes, register } = recorder();
    httpRoute('r', { methods: ['PATCH'], route: 'x', handler: vi.fn() }, { register });

    expect(routes.get('r').methods).toEqual(['PATCH', 'OPTIONS']);
  });

  it('passes route and authLevel through unchanged', () => {
    const { routes, register } = recorder();
    httpRoute(
      'r',
      { methods: ['GET'], authLevel: 'anonymous', route: 'cms/content', handler: vi.fn() },
      { register }
    );

    expect(routes.get('r').route).toBe('cms/content');
    expect(routes.get('r').authLevel).toBe('anonymous');
  });

  it('answers a preflight without invoking the handler', async () => {
    const { routes, register } = recorder();
    const handler = vi.fn();
    httpRoute('r', { methods: ['POST'], route: 'x', handler }, { cors: cors(), register });

    const res = await routes
      .get('r')
      .handler(makeRequest({ method: 'OPTIONS', origin: 'https://hybridcloudworks.com' }), context);

    expect(res.status).toBe(204);
    expect(handler).not.toHaveBeenCalled();
    expect(res.headers['Access-Control-Allow-Methods']).toContain('PATCH');
    expect(res.headers['Access-Control-Allow-Methods']).toContain('DELETE');
  });

  it('refuses a disallowed origin before the handler runs', async () => {
    const { routes, register } = recorder();
    const handler = vi.fn();
    httpRoute('r', { methods: ['POST'], route: 'x', handler }, { cors: cors(), register });

    const res = await routes
      .get('r')
      .handler(makeRequest({ method: 'POST', origin: 'https://evil.test' }), context);

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('merges CORS headers onto a successful response', async () => {
    const { routes, register } = recorder();
    const handler = vi.fn(async () => ({ status: 200, body: '{}' }));
    httpRoute('r', { methods: ['GET'], route: 'x', handler }, { cors: cors(), register });

    const res = await routes
      .get('r')
      .handler(makeRequest({ origin: 'https://hybridcloudworks.com' }), context);

    expect(res.status).toBe(200);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://hybridcloudworks.com');
    expect(res.headers.Vary).toBe('Origin');
  });

  it('merges CORS headers onto an authorization denial', async () => {
    // A 401 with no Allow-Origin reaches the browser as an opaque network
    // error, so the guard's message never gets shown.
    const { routes, register } = recorder();
    const handler = vi.fn(async () => ({
      status: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'Unauthorized' }),
    }));
    httpRoute('r', { methods: ['GET'], route: 'x', handler }, { cors: cors(), register });

    const res = await routes
      .get('r')
      .handler(makeRequest({ origin: 'https://hybridcloudworks.com' }), context);

    expect(res.status).toBe(401);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://hybridcloudworks.com');
    expect(res.headers['Content-Type']).toBe('application/json');
  });

  it('leaves a request with no Origin alone — CORS is not authorization', async () => {
    const { routes, register } = recorder();
    const handler = vi.fn(async () => ({ status: 200, body: 'ok' }));
    httpRoute('r', { methods: ['GET'], route: 'x', handler }, { cors: cors(), register });

    const res = await routes.get('r').handler(makeRequest(), context);

    expect(handler).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('admits an origin added through CORS_ALLOWED_ORIGINS', async () => {
    const { routes, register } = recorder();
    const handler = vi.fn(async () => ({ status: 200 }));
    httpRoute(
      'r',
      { methods: ['GET'], route: 'x', handler },
      {
        cors: createCors({ environment: 'production', extraOrigins: ['https://preview.test'] }),
        register,
      }
    );

    const res = await routes
      .get('r')
      .handler(makeRequest({ origin: 'https://preview.test' }), context);

    expect(res.status).toBe(200);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://preview.test');
  });
});

/**
 * The allowlist diagnostic (T-513).
 *
 * The previous version used `console.log` and produced nothing across two
 * deploys, which cost hours and produced a wrong conclusion — that no worker
 * telemetry reached Application Insights at all. In the Node v4 model only
 * `context.log` is forwarded by the host, arriving under
 * `Function.<name>.User`. These tests hold the line at the three properties
 * that actually failed: it is called with the real context, exactly once per
 * process, and the once-guard is resettable so a test cannot silently consume
 * the single emission for every test after it.
 */
describe('[cors] allowlist diagnostic', () => {
  /** The default evaluator is only used when no `cors` seam is injected. */
  const registerReal = () => {
    resetHttpRouteCors();
    const { routes, register } = recorder();
    httpRoute('r', { methods: ['GET'], route: 'x', handler: async () => ({ status: 200 }) }, { register });
    return routes.get('r');
  };

  it('reaches context.log — not console.log, which the host does not forward', async () => {
    const route = registerReal();
    const log = vi.fn();
    await route.handler(makeRequest({ origin: 'https://hybridcloudworks.com' }), { log });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('[cors] allowlist built');
  });

  it('is emitted once per process, not once per request', async () => {
    const route = registerReal();
    const log = vi.fn();
    const req = () => route.handler(makeRequest({ origin: 'https://hybridcloudworks.com' }), { log });
    await req();
    await req();
    await req();

    expect(log).toHaveBeenCalledTimes(1);
  });

  it('resetHttpRouteCors clears the once-guard, or every later test inherits a used one', async () => {
    const first = registerReal();
    const logA = vi.fn();
    await first.handler(makeRequest({ origin: 'https://hybridcloudworks.com' }), { log: logA });
    expect(logA).toHaveBeenCalledTimes(1);

    const second = registerReal(); // calls resetHttpRouteCors
    const logB = vi.fn();
    await second.handler(makeRequest({ origin: 'https://hybridcloudworks.com' }), { log: logB });
    expect(logB).toHaveBeenCalledTimes(1);
  });

  it('reports UNSET distinctly from an empty string — the two the query must tell apart', async () => {
    const previous = process.env.CORS_ALLOWED_ORIGINS;

    delete process.env.CORS_ALLOWED_ORIGINS;
    const unsetRoute = registerReal();
    const unsetLog = vi.fn();
    await unsetRoute.handler(makeRequest({ origin: 'https://hybridcloudworks.com' }), { log: unsetLog });
    expect(unsetLog.mock.calls[0][0]).toContain('UNSET in this process');

    process.env.CORS_ALLOWED_ORIGINS = '';
    const emptyRoute = registerReal();
    const emptyLog = vi.fn();
    await emptyRoute.handler(makeRequest({ origin: 'https://hybridcloudworks.com' }), { log: emptyLog });
    expect(emptyLog.mock.calls[0][0]).toContain('(0 chars)');
    expect(emptyLog.mock.calls[0][0]).not.toContain('UNSET');

    process.env.CORS_ALLOWED_ORIGINS = 'https://a.example,https://b.example';
    const setRoute = registerReal();
    const setLog = vi.fn();
    await setRoute.handler(makeRequest({ origin: 'https://hybridcloudworks.com' }), { log: setLog });
    expect(setLog.mock.calls[0][0]).toContain('2 extra origin(s)');
    expect(setLog.mock.calls[0][0]).toContain('https://a.example');

    if (previous === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = previous;
    resetHttpRouteCors();
  });

  it('does not fire when a cors seam is injected — a test double has nothing to report', async () => {
    resetHttpRouteCors();
    const { routes, register } = recorder();
    httpRoute('r', { methods: ['GET'], route: 'x', handler: async () => ({ status: 200 }) }, { cors: cors(), register });
    const log = vi.fn();
    await routes.get('r').handler(makeRequest({ origin: 'https://hybridcloudworks.com' }), { log });

    expect(log).not.toHaveBeenCalled();
  });

  it('survives a context without a log function rather than throwing mid-request', async () => {
    const route = registerReal();
    await expect(
      route.handler(makeRequest({ origin: 'https://hybridcloudworks.com' }), {})
    ).resolves.toBeDefined();
  });
});
