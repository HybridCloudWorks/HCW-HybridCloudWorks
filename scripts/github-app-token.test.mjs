/**
 * The App token minter (T-726).
 *
 * ## Why the JWT is verified rather than snapshotted
 *
 * Every part of an RS256 JWT is easy to get subtly wrong in a way that still
 * *looks* right: base64 instead of base64url, the signature over the wrong
 * string, a payload field named for the wrong spec. A snapshot of the output
 * would pass for all of those. So the test generates a real key pair, signs
 * with it, and verifies the signature back — which fails on any of them.
 *
 * ## Why `fetch` is injected
 *
 * There is no App to call yet; the owner creates it. Injecting fetch lets the
 * two-hop flow — installation lookup, then token mint — be exercised offline,
 * including the scoping of the request body, which is the part that decides
 * how much power the token carries.
 */
import { describe, it, expect } from 'vitest';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import {
  buildJwt,
  mintInstallationToken,
  parseInstallation,
  parseTokenResponse,
} from './github-app-token.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
}

describe('buildJwt', () => {
  const NOW = 1_767_225_600;

  it('signs a verifiable RS256 token over header.payload', () => {
    const jwt = buildJwt({ appId: '12345', privateKey, nowSeconds: NOW });
    const [header, payload, signature] = jwt.split('.');

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    verifier.end();

    const raw = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expect(verifier.verify(publicKey, raw)).toBe(true);
  });

  it('is base64url, not base64 — GitHub rejects + and / in a JWT', () => {
    const jwt = buildJwt({ appId: '12345', privateKey, nowSeconds: NOW });
    expect(jwt).not.toMatch(/[+/=]/);
  });

  // Backdating is not cosmetic: a jwt whose iat is even slightly ahead of
  // GitHub's clock is refused outright, and a runner's clock is not ours.
  it('backdates iat and keeps exp inside the ten-minute ceiling', () => {
    const [, payload] = buildJwt({ appId: '12345', privateKey, nowSeconds: NOW }).split('.');
    const claims = decodeSegment(payload);

    expect(claims.iat).toBeLessThan(NOW);
    expect(claims.exp).toBeGreaterThan(NOW);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    expect(claims.iss).toBe('12345');
  });

  it('refuses to build without the inputs rather than signing something empty', () => {
    expect(() => buildJwt({ privateKey, nowSeconds: NOW })).toThrow(/appId/);
    expect(() => buildJwt({ appId: '1', nowSeconds: NOW })).toThrow(/privateKey/);
    expect(() => buildJwt({ appId: '1', privateKey })).toThrow(/nowSeconds/);
  });
});

describe('response parsing', () => {
  // "Not installed" and "I could not read the answer" are different facts, and
  // reporting the second as the first sends someone to reinstall a working App.
  it('throws rather than returning null on an unreadable installation', () => {
    expect(() => parseInstallation({})).toThrow(/integer `id`/);
    expect(() => parseInstallation(null)).toThrow(/integer `id`/);
    expect(() => parseInstallation({ id: 'not-a-number' })).toThrow(/integer `id`/);
  });

  it('reads the installation id', () => {
    expect(parseInstallation({ id: 42 })).toBe(42);
  });

  it('throws on a token payload with no token', () => {
    expect(() => parseTokenResponse({})).toThrow(/no `token` string/);
    expect(() => parseTokenResponse({ token: '' })).toThrow(/no `token` string/);
  });

  it('reads the token and its expiry', () => {
    expect(parseTokenResponse({ token: 'ghs_x', expires_at: '2026-08-31T21:00:00Z' })).toEqual({
      token: 'ghs_x',
      expiresAt: '2026-08-31T21:00:00Z',
    });
  });
});

describe('mintInstallationToken', () => {
  function fakeFetch(steps) {
    const calls = [];
    const impl = async (url, init) => {
      calls.push({ url, init });
      const next = steps.shift();
      if (!next) throw new Error(`unexpected call to ${url}`);
      return next;
    };
    impl.calls = calls;
    return impl;
  }

  const ok = (body) => ({ ok: true, status: 200, json: async () => body });

  it('looks up the installation, then mints, and returns the token', async () => {
    const fetchImpl = fakeFetch([ok({ id: 7 }), ok({ token: 'ghs_abc', expires_at: 'later' })]);

    const result = await mintInstallationToken({
      appId: '1',
      privateKey,
      owner: 'HybridCloudWorks',
      repo: 'HCW-HybridCloudWorks',
      nowSeconds: 1_767_225_600,
      fetchImpl,
    });

    expect(result.token).toBe('ghs_abc');
    expect(fetchImpl.calls[0].url).toContain('/repos/HybridCloudWorks/HCW-HybridCloudWorks/installation');
    expect(fetchImpl.calls[1].url).toContain('/app/installations/7/access_tokens');
  });

  // THE PART THAT DECIDES HOW MUCH POWER THE TOKEN CARRIES. An installation
  // token defaults to everything the installation was granted; this narrows it
  // to one repository and two permissions, and neither should silently widen.
  it('scopes the token to one repository and two permissions', async () => {
    const fetchImpl = fakeFetch([ok({ id: 7 }), ok({ token: 'ghs_abc' })]);
    await mintInstallationToken({
      appId: '1',
      privateKey,
      owner: 'HybridCloudWorks',
      repo: 'HCW-HybridCloudWorks',
      fetchImpl,
    });

    expect(JSON.parse(fetchImpl.calls[1].init.body)).toEqual({
      repositories: ['HCW-HybridCloudWorks'],
      permissions: { contents: 'write', pull_requests: 'write' },
    });
  });

  it('says which failure it is when the installation lookup fails', async () => {
    const fetchImpl = fakeFetch([{ ok: false, status: 404, json: async () => ({}) }]);
    await expect(
      mintInstallationToken({ appId: '1', privateKey, owner: 'o', repo: 'r', fetchImpl })
    ).rejects.toThrow(/not installed on this repository/);
  });

  it('names the likely cause when the mint is refused', async () => {
    const fetchImpl = fakeFetch([ok({ id: 7 }), { ok: false, status: 422, json: async () => ({}) }]);
    await expect(
      mintInstallationToken({ appId: '1', privateKey, owner: 'o', repo: 'r', fetchImpl })
    ).rejects.toThrow(/not granted one of the permissions/);
  });
});
