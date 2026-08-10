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
 *      reaches one of the recognised guards (`requireRole`, `requireUser`, or
 *      the Labs agent's `requireAgent`).
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
import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';

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

/**
 * Every guarded handler resolves its guard through one of these two modules.
 *
 * There are two, not one, and that is deliberate: the Labs VPS agent is a
 * machine identity authorized by its own App Role and its own registry, not by
 * the admin role hierarchy (lib/auth/require-agent.js). A third guard must be
 * added HERE before its routes count as guarded — that is the whole point of
 * this test, and adding one should be a visible, reviewed act.
 */
const requireRole = vi.fn(async () => ({
  error: { status: 403, headers: {}, body: JSON.stringify({ ok: false, error: 'Forbidden' }) },
}));
const requireUser = vi.fn(async () => ({
  error: { status: 401, headers: {}, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) },
}));
const requireAgent = vi.fn(async () => ({
  agent: null,
  identity: null,
  error: {
    status: 403,
    headers: {},
    body: JSON.stringify({ ok: false, error: 'Agent access required' }),
  },
}));

/** Every gate the inventory recognises. A route must reach at least one. */
const GUARDS = [requireRole, requireUser, requireAgent];
const guardCalls = () => GUARDS.reduce((n, g) => n + g.mock.calls.length, 0);
const clearGuards = () => GUARDS.forEach((g) => g.mockClear());

vi.mock('../lib/auth/default-guard.js', () => ({
  getDefaultGuard: () => ({ requireRole, requireUser }),
  resetDefaultGuard: () => {},
}));

vi.mock('../lib/auth/default-agent-guard.js', () => ({
  getDefaultAgentGuard: () => ({ requireAgent }),
  resetDefaultAgentGuard: () => {},
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
  // Reads no database, returns four enum values. The reason it is here rather
  // than guarded is that it backs indicators rendered to every anonymous
  // visitor on the landing page; the reason it is safe is that its cache bounds
  // what it can be made to do to the upstream status APIs — lib/platform-health.js
  'public/platform-health',
]);

const ALLOWED_ORIGIN = 'https://hybridcloudworks.com';

const context = { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

const makeRequest = ({ method = 'GET', origin } = {}) => ({
  method,
  params: {},
  query: new Map(),
  headers: { get: (name) => (name.toLowerCase() === 'origin' ? origin || null : null) },
  json: async () => ({ agentId: 'inventory-probe' }),
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

/**
 * No test in this file may touch the network.
 *
 * The properties below work by *invoking* every registered handler, and
 * `public/platform-health` really does call four third-party status APIs. On a
 * runner without egress those sockets hang until the handler's own 8 s abort
 * fires — past vitest's 5 s test timeout — so the suite failed in CI while
 * passing locally, where the connections are refused immediately. CI was right:
 * a route-inventory test that reaches the internet is not testing route
 * inventory.
 *
 * Rejecting rather than resolving is deliberate. It exercises the degradation
 * path, and it means a handler that starts making outbound calls cannot quietly
 * make this suite slow or flaky.
 */
beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network disabled in route-inventory tests');
    })
  );
  await import('./index.js');
});

afterAll(() => {
  vi.unstubAllGlobals();
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

      clearGuards();
      await invoke(options, makeRequest({ method: options.methods[0] }));

      if (guardCalls() === 0) {
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

      clearGuards();
      await invoke(options, makeRequest({ method: options.methods[0] }));

      if (guardCalls() > 0) {
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
      clearGuards();
      const res = await invoke(
        options,
        makeRequest({ method: options.methods[0], origin: 'https://evil.test' })
      );

      if (res?.status !== 403 || guardCalls() > 0) {
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

  it('registers no change-feed trigger', () => {
    // Both handlers were empty TODOs, and a registered change-feed trigger runs
    // its processor continuously whether or not the handler does anything —
    // billing lease-container RU to log a document id. Their only reason to
    // exist was the reason COSMOS_CONNECTION_STRING, and therefore the account
    // primary key, sat in app settings (TODO.md T-315).
    //
    // Bringing them back means the identity-based binding form, not that
    // setting. This assertion is the thing that makes reinstating it visible.
    expect(cosmosRegistrations.size).toBe(0);
  });
});
