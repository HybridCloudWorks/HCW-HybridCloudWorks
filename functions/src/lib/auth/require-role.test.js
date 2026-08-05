import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';

import { createTokenVerifier, bearerTokenFrom } from './verify-token.js';
import { createRoleGuard } from './require-role.js';
import { ENTRA_ADMIN_APP_ROLE, ROLE_CACHE_TTL_MS } from './roles.js';

/**
 * A real local JWKS endpoint, not a mocked verifier.
 *
 * This is the analogue of Site-Main's emulator-backed `roleUserContext(role)`
 * (`firestore.rules.test.js:137-151`) and it is why DECISION 5 made the JWKS
 * URI injectable: signatures are genuinely verified here, so the tests cover
 * algorithm pinning, audience and issuer enforcement — the things that were
 * broken — rather than trusting a stub.
 */

const TENANT = '11111111-2222-3333-4444-555555555555';
const AUDIENCE = 'api://99999999-8888-7777-6666-555555555555';
const KID = 'test-key-1';

let server;
let jwksUri;
let privateKey;

beforeAll(async () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;

  // generateKeyPairSync returns KeyObjects when no encoding is given, so the
  // public key exports to JWK directly.
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const document = JSON.stringify({ keys: [{ ...jwk, kid: KID, use: 'sig', alg: 'RS256' }] });

  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(document);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  jwksUri = `http://127.0.0.1:${server.address().port}/keys`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

/** Mint a token the local JWKS can verify. */
function mintToken(claims = {}, options = {}) {
  return jwt.sign(
    {
      oid: 'oid-default',
      roles: [ENTRA_ADMIN_APP_ROLE],
      aud: AUDIENCE,
      iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      ...claims,
    },
    privateKey,
    { algorithm: 'RS256', keyid: KID, expiresIn: '10m', ...options }
  );
}

const requestWith = (token) => ({
  headers: { get: (n) => (n.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null) },
});

function buildGuard({ admins = {}, now } = {}) {
  const verifier = createTokenVerifier({ tenantId: TENANT, audience: AUDIENCE, jwksUri });
  const denials = [];
  const lookupAdmin = vi.fn(async (oid) => admins[oid] ?? null);
  const guard = createRoleGuard({
    verifier,
    lookupAdmin,
    auditDenial: (e) => denials.push(e),
    ...(now ? { now } : {}),
  });
  return { ...guard, lookupAdmin, denials };
}

// ---------------------------------------------------------------------------

describe('configuration', () => {
  it('refuses to start without a tenant or audience (A1, A4)', () => {
    // The replaced code read an unvalidated env var straight into
    // `audience`, and jsonwebtoken SKIPS the audience check when it is
    // undefined — silently accepting any tenant-signed token.
    expect(() => createTokenVerifier({ audience: AUDIENCE })).toThrow(/ENTRA_TENANT_ID/);
    expect(() => createTokenVerifier({ tenantId: TENANT })).toThrow(/ENTRA_API_AUDIENCE/);
  });
});

describe('token verification', () => {
  it('accepts a well-formed token', async () => {
    const g = buildGuard({ admins: { 'oid-default': { role: 'editor', active: true } } });
    const { error } = await g.requireRole(requestWith(mintToken()), 'editor');
    expect(error).toBeNull();
  });

  it('rejects a token for a different audience (A1)', async () => {
    const g = buildGuard();
    const { error } = await g.requireRole(requestWith(mintToken({ aud: 'api://someone-else' })), 'editor');
    expect(error.status).toBe(401);
  });

  it('rejects a token from a different tenant (A4)', async () => {
    const g = buildGuard();
    const foreign = mintToken({ iss: 'https://login.microsoftonline.com/other-tenant/v2.0' });
    expect((await g.requireRole(requestWith(foreign), 'editor')).error.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const g = buildGuard({ admins: { 'oid-default': { role: 'super_admin', active: true } } });
    const expired = mintToken({}, { expiresIn: '-5m' });
    expect((await g.requireRole(requestWith(expired), 'viewer')).error.status).toBe(401);
  });

  it('rejects a token signed by a foreign key', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const forged = jwt.sign({ oid: 'oid-default', roles: [ENTRA_ADMIN_APP_ROLE], aud: AUDIENCE }, other, {
      algorithm: 'RS256',
      keyid: KID,
      issuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    });
    const g = buildGuard({ admins: { 'oid-default': { role: 'super_admin', active: true } } });
    expect((await g.requireRole(requestWith(forged), 'viewer')).error.status).toBe(401);
  });

  it('rejects alg:none (A3)', async () => {
    const none = jwt.sign({ oid: 'oid-default', roles: [ENTRA_ADMIN_APP_ROLE], aud: AUDIENCE }, '', {
      algorithm: 'none',
    });
    const g = buildGuard({ admins: { 'oid-default': { role: 'super_admin', active: true } } });
    expect((await g.requireRole(requestWith(none), 'viewer')).error.status).toBe(401);
  });

  it('rejects a missing or malformed Authorization header', async () => {
    const g = buildGuard();
    expect((await g.requireRole(requestWith(null), 'viewer')).error.status).toBe(401);
    expect((await g.requireRole({ headers: { get: () => 'Bearer   ' } }, 'viewer')).error.status).toBe(401);
  });
});

describe('authorization', () => {
  it('rejects a token with no roles claim — the empty-array bypass (A2)', async () => {
    // The replaced code defaulted requiredRoles to [], so the check loop never
    // ran and ANY valid tenant token was an admin.
    const g = buildGuard({ admins: { 'oid-default': { role: 'super_admin', active: true } } });
    const { error } = await g.requireRole(requestWith(mintToken({ roles: [] })), 'viewer');
    expect(error.status).toBe(403);
    expect(g.lookupAdmin).not.toHaveBeenCalled(); // gated before the database read
  });

  it('admits a publisher where editor is required (A2 — inverted semantics)', async () => {
    const g = buildGuard({ admins: { p: { role: 'publisher', active: true } } });
    const { error, role } = await g.requireRole(requestWith(mintToken({ oid: 'p' })), 'editor');
    expect(error).toBeNull();
    expect(role).toBe('publisher');
  });

  it('denies a viewer where editor is required', async () => {
    const g = buildGuard({ admins: { v: { role: 'viewer', active: true } } });
    const { error } = await g.requireRole(requestWith(mintToken({ oid: 'v' })), 'editor');
    expect(error.status).toBe(403);
  });

  it('denies a caller with the App Role but no admins record', async () => {
    const g = buildGuard({ admins: {} });
    expect((await g.requireRole(requestWith(mintToken()), 'viewer')).error.status).toBe(403);
  });

  it('denies a deactivated admin — the revocation path', async () => {
    const g = buildGuard({ admins: { d: { role: 'super_admin', active: false } } });
    expect((await g.requireRole(requestWith(mintToken({ oid: 'd' })), 'viewer')).error.status).toBe(403);
  });

  it('throws on an unrecognised role requirement rather than allowing it', async () => {
    const g = buildGuard({ admins: { 'oid-default': { role: 'super_admin', active: true } } });
    await expect(g.requireRole(requestWith(mintToken()), 'publishor')).rejects.toThrow(/unknown role/);
  });

  it('propagates a lookup failure instead of falling back to the claim', async () => {
    // Falling back would reinstate the stale-role window the hybrid exists to
    // close, so this must surface as a 500, not a quiet allow.
    const verifier = createTokenVerifier({ tenantId: TENANT, audience: AUDIENCE, jwksUri });
    const guard = createRoleGuard({
      verifier,
      lookupAdmin: async () => {
        throw new Error('cosmos unavailable');
      },
    });
    await expect(guard.requireRole(requestWith(mintToken()), 'viewer')).rejects.toThrow(/cosmos unavailable/);
  });
});

describe('role cache — the revocation SLA', () => {
  it('caches within the TTL', async () => {
    const g = buildGuard({ admins: { 'oid-default': { role: 'editor', active: true } } });
    await g.requireRole(requestWith(mintToken()), 'editor');
    await g.requireRole(requestWith(mintToken()), 'editor');
    expect(g.lookupAdmin).toHaveBeenCalledTimes(1);
  });

  it('re-reads after the TTL, bounding how long a demotion takes effect', async () => {
    let clock = 1_000_000;
    const admins = { 'oid-default': { role: 'publisher', active: true } };
    const g = buildGuard({ admins, now: () => clock });

    expect((await g.requireRole(requestWith(mintToken()), 'publisher')).error).toBeNull();

    admins['oid-default'] = { role: 'viewer', active: true }; // demoted
    clock += ROLE_CACHE_TTL_MS + 1;

    expect((await g.requireRole(requestWith(mintToken()), 'publisher')).error.status).toBe(403);
    expect(g.lookupAdmin).toHaveBeenCalledTimes(2);
  });
});

describe('error responses', () => {
  it('are JSON with a Content-Type and the ok:false envelope (A10)', async () => {
    const g = buildGuard();
    const { error } = await g.requireRole(requestWith(null), 'viewer');
    expect(error.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(error.body)).toEqual({ ok: false, error: 'Authentication required' });
  });

  it('do not leak whether the caller exists as an admin', async () => {
    // No-record, inactive and missing-app-role all return the same body.
    const g = buildGuard({ admins: { inactive: { role: 'super_admin', active: false } } });
    const a = await g.requireRole(requestWith(mintToken({ oid: 'ghost' })), 'viewer');
    const b = await g.requireRole(requestWith(mintToken({ oid: 'inactive' })), 'viewer');
    expect(a.error.body).toBe(b.error.body);
  });
});

describe('audit trail (A12)', () => {
  it('records every denial with a reason', async () => {
    const g = buildGuard({ admins: { v: { role: 'viewer', active: true } } });
    await g.requireRole(requestWith(mintToken({ oid: 'v' })), 'publisher');

    expect(g.denials).toHaveLength(1);
    expect(g.denials[0]).toMatchObject({
      outcome: 'denied',
      reason: 'insufficient-role',
      oid: 'v',
      required: 'publisher',
      actual: 'viewer',
    });
  });

  it('does not let an audit-sink failure turn a 403 into a 500', async () => {
    const verifier = createTokenVerifier({ tenantId: TENANT, audience: AUDIENCE, jwksUri });
    const guard = createRoleGuard({
      verifier,
      lookupAdmin: async () => null,
      auditDenial: () => {
        throw new Error('sink down');
      },
    });
    expect((await guard.requireRole(requestWith(mintToken()), 'viewer')).error.status).toBe(403);
  });
});

describe('bearerTokenFrom (A11)', () => {
  it('is case-insensitive and tolerates extra whitespace', () => {
    expect(bearerTokenFrom({ headers: { get: () => 'bearer abc' } })).toBe('abc');
    expect(bearerTokenFrom({ headers: { get: () => 'BEARER  abc' } })).toBe('abc');
  });

  it('does not mangle a token containing the substring "Bearer "', () => {
    // `split('Bearer ')[1]` truncated these.
    expect(bearerTokenFrom({ headers: { get: () => 'Bearer xxBearer yy' } })).toBe('xxBearer yy');
  });

  it('returns null for absent or empty headers', () => {
    expect(bearerTokenFrom({ headers: { get: () => null } })).toBeNull();
    expect(bearerTokenFrom({ headers: { get: () => 'Bearer' } })).toBeNull();
    expect(bearerTokenFrom({})).toBeNull();
  });
});
