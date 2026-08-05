/**
 * Entra ID token verification.
 *
 * Replaces the verification half of `src/lib/auth-middleware.js`, which had
 * three defects that together were a full admin bypass for any tenant member.
 * Each fix is annotated with the finding it closes.
 *
 * ===========================================================================
 * DECISION 3 — app registration topology: TWO registrations
 * ===========================================================================
 * A public-client SPA registration, and a separate API registration exposing
 * `api://<api-client-id>`. The API validates `aud` against its OWN identifier.
 *
 * With a single registration, an ID token minted for the SPA carries
 * `aud = <client-id>` — indistinguishable from an access token for the API. So
 * a token the browser was never meant to send to an API is accepted by it.
 * Two registrations make the audience meaningful, and let us additionally
 * reject anything without a `scp`/`roles` claim.
 *
 * `ENTRA_API_AUDIENCE` is therefore REQUIRED and has no default.
 *
 * ===========================================================================
 * DECISION 5 — JWKS must be injectable
 * ===========================================================================
 * `createTokenVerifier()` is a factory, not a module-scope singleton. The
 * previous module built its `jwksClient` at import time against a hardcoded
 * URI, which made it untestable without a live tenant — and retrofitting that
 * after eleven handlers exist means touching all eleven.
 *
 * Tests generate an RSA keypair, serve a local JWKS document, and point the
 * verifier at it. That is the direct analogue of Site-Main's
 * `roleUserContext(role)` emulator helper, and it is the only way to exercise
 * the role hierarchy without a directory.
 */

import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

/** Only RS256. See "algorithm pinning" below. */
const ALLOWED_ALGORITHMS = ['RS256'];

/**
 * Seconds of clock skew tolerated on `exp`/`nbf`.
 *
 * Entra sets `nbf` to approximately now, so with zero tolerance a freshly
 * issued token is intermittently rejected on a host with a slightly fast
 * clock. Kept small — tolerance is added token lifetime.
 */
const CLOCK_TOLERANCE_SECONDS = 60;

/**
 * Build a token verifier.
 *
 * @param {object} config
 * @param {string} config.tenantId  Entra tenant GUID. REQUIRED — no 'common'.
 * @param {string} config.audience  The API's application ID URI or client id.
 * @param {string} [config.jwksUri] Override for tests.
 * @returns {{ verify: (token: string) => Promise<object> }}
 */
export function createTokenVerifier({ tenantId, audience, jwksUri } = {}) {
  // FIX (A1): fail fast on missing configuration.
  //
  // The previous code read `process.env.ENTRA_CLIENT_ID` with no validation and
  // passed it straight to `jwt.verify` as `audience`. jsonwebtoken only applies
  // the audience check when the option is truthy, so an unset or misspelled app
  // setting did not throw — it SKIPPED audience validation entirely and
  // successfully verified any Microsoft-signed token whose issuer matched the
  // tenant. A Graph token. A token for any other app in the directory.
  if (!tenantId) throw new Error('ENTRA_TENANT_ID is required — refusing to start without it');
  if (!audience) throw new Error('ENTRA_API_AUDIENCE is required — refusing to start without it');

  // FIX (A4): no 'common' fallback.
  //
  // `tenantId || 'common'` pointed JWKS at the common endpoint, which serves
  // signing keys for every tenant on earth, leaving the issuer string as the
  // only barrier to cross-tenant token acceptance. It also produced issuer
  // values no real token carries, so it failed closed into a total lockout that
  // reads as "auth is broken" — the state in which someone loosens the check.
  const issuers = [
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://sts.windows.net/${tenantId}/`,
  ];

  const client = jwksClient({
    jwksUri: jwksUri ?? `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
    cache: true,
    // FIX (A8): Microsoft typically publishes 6–8 signing keys. A cache of 5
    // guarantees eviction thrash during normal rotation.
    cacheMaxEntries: 16,
    cacheMaxAge: 600_000,
    // FIX (A8): without rate limiting, an unauthenticated caller sending tokens
    // with random `kid` values forces one JWKS round trip per unique kid — a
    // pre-auth outbound amplification path that also injects latency into every
    // admin request.
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });

  const getKey = (header, callback) => {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) return callback(err, null);
      callback(null, key.publicKey || key.rsaPublicKey);
    });
  };

  return {
    /**
     * Verify a raw bearer token.
     * Resolves the decoded payload, or rejects with an Error.
     *
     * @param {string} token
     * @returns {Promise<object>}
     */
    verify(token) {
      return new Promise((resolve, reject) => {
        jwt.verify(
          token,
          getKey,
          {
            audience,
            issuer: issuers,
            // FIX (A3): pin the algorithm.
            //
            // The previous code omitted this and was safe only as a property of
            // the installed dependency — jsonwebtoken 9.x derives permitted
            // algorithms from the key type, defeating `alg: none` and HS256 key
            // confusion. package.json pins `^9.0.3`, a RANGE. Do not depend on a
            // transitive default for the classic JWT bypass.
            algorithms: ALLOWED_ALGORITHMS,
            clockTolerance: CLOCK_TOLERANCE_SECONDS, // FIX (A7)
          },
          (err, decoded) => (err ? reject(err) : resolve(decoded))
        );
      });
    },
  };
}

/**
 * Extract a bearer token from a request.
 *
 * FIX (A11): matched case-insensitively and sliced rather than split. The
 * previous `split('Bearer ')[1]` also mangles any token containing the literal
 * substring "Bearer ". Site-Main used `/^Bearer (.+)$/i`; this matches it.
 *
 * @param {{ headers: { get(name: string): string|null } }} request
 * @returns {string|null}
 */
export function bearerTokenFrom(request) {
  const header = request?.headers?.get?.('authorization');
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() || null : null;
}
