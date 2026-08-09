import { describe, it, expect, vi } from 'vitest';
import { createSubmissionsHandler } from './public-submissions.js';
import { createCors } from '../lib/auth/cors.js';
import { httpRoute } from '../lib/auth/http-route.js';
import { createClientIdentity } from '../lib/auth/client-identity.js';
import { SUBMISSIONS_PER_HOUR } from '../lib/submissions.js';

const ORIGIN = 'https://hybridcloudworks.com';
const SECRET = 'cf-secret';

const makeRequest = ({
  method = 'POST',
  origin = ORIGIN,
  cfSecret = SECRET,
  ip = '203.0.113.7',
  body,
  invalidJson = false,
} = {}) => ({
  method,
  headers: {
    get: (name) => {
      const h = {
        origin,
        'x-hcw-origin-secret': cfSecret,
        'cf-connecting-ip': ip,
      };
      return h[String(name).toLowerCase()] ?? null;
    },
  },
  json: async () => {
    if (invalidJson) throw new SyntaxError('bad json');
    return body;
  },
});

const context = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

const blogBody = {
  type: 'blog',
  title: 'A post',
  summary: 'A summary long enough.',
  provider: 'Azure',
  content: 'Body content.',
};

function makeHandler({ existingQuota, environment = 'production' } = {}) {
  const writes = [];
  const handler = createSubmissionsHandler({
    identity: createClientIdentity({
      originSecret: SECRET,
      ipSalt: 'salt',
      allowUnverifiedOrigin: environment !== 'production',
    }),
    store: {
      readDoc: async () => existingQuota,
      upsertDoc: async (container, doc) => writes.push({ container, doc }),
    },
    now: () => 1_754_000_000_000,
  });
  return { handler, writes };
}

/**
 * CORS moved out of the handler and into httpRoute, which applies it to every
 * route rather than to this one. These two cases still matter for this route
 * specifically — it is the only anonymous write path — so they now exercise
 * the registered composition rather than the bare handler.
 */
function makeRegisteredRoute(options = {}) {
  const { handler, writes } = makeHandler(options);
  let registered;
  httpRoute(
    'publicSubmissions',
    { methods: ['POST'], authLevel: 'anonymous', route: 'public/submissions', handler },
    {
      cors: createCors({ environment: options.environment || 'production' }),
      register: { http: (_name, opts) => (registered = opts) },
    }
  );
  return { route: registered, writes };
}

describe('public submissions handler', () => {
  it('answers preflight with 204 and CORS headers, without running the handler', async () => {
    const { route, writes } = makeRegisteredRoute();
    const res = await route.handler(makeRequest({ method: 'OPTIONS' }), context);
    expect(res.status).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe(ORIGIN);
    expect(writes).toHaveLength(0);
  });

  it('403s a disallowed origin without touching identity or storage', async () => {
    const { route, writes } = makeRegisteredRoute();
    const res = await route.handler(makeRequest({ origin: 'https://evil.example' }), context);
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('registers OPTIONS so the preflight can reach it at all', async () => {
    const { route } = makeRegisteredRoute();
    expect(route.methods).toContain('OPTIONS');
  });

  it('405s non-POST', async () => {
    const { handler } = makeHandler();
    const res = await handler(makeRequest({ method: 'GET' }), context);
    expect(res.status).toBe(405);
  });

  it('FAILS CLOSED in production when the Cloudflare secret is absent', async () => {
    const { handler, writes } = makeHandler();
    const res = await handler(makeRequest({ cfSecret: null, body: blogBody }), context);
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
    expect(context.warn).toHaveBeenCalledWith(expect.stringContaining('unverified origin'));
  });

  it('400s invalid JSON and validation failures', async () => {
    const { handler } = makeHandler();
    expect((await handler(makeRequest({ invalidJson: true }), context)).status).toBe(400);
    const res = await handler(makeRequest({ body: { type: 'blog' } }), context);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Title is required/);
  });

  it('429s over quota with Retry-After, and stores nothing', async () => {
    const { handler, writes } = makeHandler({
      existingQuota: { windowStartMs: 1_754_000_000_000 - 1000, count: SUBMISSIONS_PER_HOUR },
    });
    const res = await handler(makeRequest({ body: blogBody }), context);
    expect(res.status).toBe(429);
    expect(res.headers['Retry-After']).toBe('3600');
    expect(writes.filter((w) => w.container === 'content')).toHaveLength(0);
  });

  it('201s a valid submission: quota incremented, doc written with pipeline fields', async () => {
    const { handler, writes } = makeHandler();
    const res = await handler(makeRequest({ body: blogBody }), context);
    expect(res.status).toBe(201);

    const quota = writes.find((w) => w.container === 'submission_quota');
    expect(quota.doc.count).toBe(1);
    // The quota key is the salted hash, never the raw address.
    expect(quota.doc.id).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(quota.doc)).not.toContain('203.0.113.7');

    const content = writes.find((w) => w.container === 'content');
    expect(content.doc).toMatchObject({
      type: 'blog',
      contentStatus: 'ingested',
      Live: false,
      submittedVia: 'public-api',
    });
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, id: content.doc.id });
  });
});
