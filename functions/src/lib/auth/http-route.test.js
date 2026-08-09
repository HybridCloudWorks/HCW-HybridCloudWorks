/**
 * The shared route registration helper.
 *
 * These assert the properties every route gets for free, because the failure
 * this replaces was not a broken control — `cors.js` was correct and tested —
 * but a control applied at one call site out of fifty-eight (TODO.md T-102).
 */
import { describe, it, expect, vi } from 'vitest';
import { httpRoute, withPreflight, mergeCorsHeaders, parseExtraOrigins } from './http-route.js';
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
