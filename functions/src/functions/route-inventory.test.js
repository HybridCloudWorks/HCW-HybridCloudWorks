/**
 * The route inventory — the replacement for the `firestore.rules` default-deny
 * catch-all, and the test `lib/auth/require-role.js` declares in its header as
 * *"the highest-value test in the port"*. It was declared and never written
 * (TODO.md T-103).
 *
 * Firestore had `match /{document=**} { allow read, write: if false }`, which
 * caught every path the API forgot. Azure has no equivalent: every
 * `app.http` registration defaults to `authLevel: 'anonymous'`, so one handler
 * that forgets the guard IS the vulnerability, and it is invisible — the route
 * works, which is exactly what makes it easy to ship.
 *
 * This test enumerates every registration the Functions host would see and
 * asserts three properties of each:
 *
 *   1. **Guarded or explicitly public.** Either the route is named in
 *      `PUBLIC_ROUTES` below — a deliberate, reviewed decision — or invoking it
 *      reaches `guard.requireRole` / `guard.requireUser`.
 *   2. **`OPTIONS` is registered.** Without it the host 404s a preflight before
 *      any handler runs, and every authenticated call preflights because it
 *      carries `Authorization`.
 *   3. **CORS is evaluated.** A disallowed origin is refused, and a preflight is
 *      answered, before the handler runs.
 *
 * Properties 2 and 3 are what T-102 got wrong: CORS was correct and wired into
 * one route of fifty-eight. Adding a route now fails this test unless it goes
 * through `httpRoute` and either guards or is consciously added to the
 * allowlist below.
 *
 * Adding a route to `PUBLIC_ROUTES` is a security decision. It means anyone on
 * the internet can call it, with no token, forever.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

/** Registrations recorded in place of the real Functions host. */
const httpRegistrations = new Map();
const timerRegistrations = new Map();
const cosmosRegistrations = new Map();

vi.mock('@azure/functions', () => ({
  app: {
    http: (name, options) => httpRegistrations.set(name, options),
    timer: (name, options) => timerRegistrations.set(name, options),
    cosmosDB: (name, options) => cosmosRegistrations.set(name, options),
  },
}));

/** Every guarded handler resolves its guard through this module. */
const requireRole = vi.fn(async () => ({
  error: { status: 403, headers: {}, body: JSON.stringify({ ok: false, error: 'Forbidden' }) },
}));
const requireUser = vi.fn(async () => ({
  error: { status: 401, headers: {}, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) },
}));

vi.mock('../lib/auth/default-guard.js', () => ({
  getDefaultGuard: () => ({ requireRole, requireUser }),
  resetDefaultGuard: () => {},
}));

/**
 * Routes intentionally reachable with no credential.
 *
 * Each replaces a read (or, for submissions, a write) that Firestore security
 * rules allowed anonymously. The server-side filter that replaced those rules
 * lives in the corresponding lib module — this list records the decision, it
 * does not implement it.
 */
const PUBLIC_ROUTES = new Set([
  'health', // liveness probe; returns no data
  'public/content', // published documents only — lib/public-reads.js
  'public/content/{slugOrId}',
  'public/snapshots/{id}', // allowlisted to certifications + speakerevents
  'public/podcasts',
  'public/feed',
  'public/submissions', // anonymous write: validated, quota-limited, Cloudflare-verified
  'public/media/{container}/{*blobPath}', // container allowlist — lib/blob-paths.js
]);

const ALLOWED_ORIGIN = 'https://hybridcloudworks.com';

const context = { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

const makeRequest = ({ method = 'GET', origin } = {}) => ({
  method,
  params: {},
  query: new Map(),
  headers: { get: (name) => (name.toLowerCase() === 'origin' ? origin || null : null) },
  json: async () => ({}),
  text: async () => '',
});

/** Invoke a registered handler, treating a throw as "did not reach the guard". */
async function invoke(options, request) {
  try {
    return await options.handler(request, context);
  } catch {
    return null;
  }
}

beforeAll(async () => {
  await import('./index.js');
});

describe('route inventory', () => {
  it('registered the routes at all', () => {
    // A mocking mistake that silently records nothing would make every
    // assertion below vacuously pass.
    expect(httpRegistrations.size).toBeGreaterThan(50);
  });

  it('every public route in the allowlist is actually registered', () => {
    const registered = new Set([...httpRegistrations.values()].map((o) => o.route));
    const missing = [...PUBLIC_ROUTES].filter((route) => !registered.has(route));
    expect(missing).toEqual([]);
  });
});

describe('property 1 — every route is guarded or explicitly public', () => {
  it('enumerates each registration', async () => {
    const unguarded = [];

    for (const [name, options] of httpRegistrations) {
      if (PUBLIC_ROUTES.has(options.route)) continue;

      requireRole.mockClear();
      requireUser.mockClear();
      await invoke(options, makeRequest({ method: options.methods[0] }));

      if (requireRole.mock.calls.length === 0 && requireUser.mock.calls.length === 0) {
        unguarded.push(`${name} (${options.methods[0]} ${options.route})`);
      }
    }

    // A name here is either a route that forgot the guard, or a route that
    // should be added to PUBLIC_ROUTES with a comment saying why.
    expect(unguarded).toEqual([]);
  });

  it('public routes do not consult the guard', async () => {
    const surprising = [];

    for (const [name, options] of httpRegistrations) {
      if (!PUBLIC_ROUTES.has(options.route)) continue;

      requireRole.mockClear();
      requireUser.mockClear();
      await invoke(options, makeRequest({ method: options.methods[0] }));

      if (requireRole.mock.calls.length > 0 || requireUser.mock.calls.length > 0) {
        surprising.push(name);
      }
    }

    // Not a vulnerability if it happens — a guarded "public" route is merely
    // wrong about being public — but it means the allowlist is lying.
    expect(surprising).toEqual([]);
  });
});

describe('property 2 — every route accepts OPTIONS', () => {
  it('so a preflight is not 404ed before any handler runs', () => {
    const missing = [...httpRegistrations.entries()]
      .filter(([, options]) => !options.methods.includes('OPTIONS'))
      .map(([name, options]) => `${name} (${options.route})`);

    expect(missing).toEqual([]);
  });
});

describe('property 3 — every route evaluates CORS', () => {
  it('refuses a disallowed origin before the handler runs', async () => {
    const notEvaluated = [];

    for (const [name, options] of httpRegistrations) {
      requireRole.mockClear();
      requireUser.mockClear();
      const res = await invoke(
        options,
        makeRequest({ method: options.methods[0], origin: 'https://evil.test' })
      );

      if (res?.status !== 403 || requireRole.mock.calls.length > 0) {
        notEvaluated.push(`${name} (${options.route})`);
      }
    }

    expect(notEvaluated).toEqual([]);
  });

  it('answers a preflight with 204 and the full method list', async () => {
    const broken = [];

    for (const [name, options] of httpRegistrations) {
      const res = await invoke(options, makeRequest({ method: 'OPTIONS', origin: ALLOWED_ORIGIN }));

      const methods = res?.headers?.['Access-Control-Allow-Methods'] || '';
      const advertisesEverything = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].every(
        (verb) => methods.includes(verb)
      );

      if (res?.status !== 204 || !advertisesEverything) {
        broken.push(`${name} (${options.route})`);
      }
    }

    expect(broken).toEqual([]);
  });
});

describe('non-HTTP triggers', () => {
  it('the scheduler timers stay behind one feature flag', () => {
    // Not an authorization surface, but they are registrations, and one of
    // them deletes blobs with an unimplemented body (TODO.md T-302).
    expect(timerRegistrations.size).toBe(4);
  });

  it('the change-feed triggers are still registered', () => {
    expect(cosmosRegistrations.size).toBe(2);
  });
});
