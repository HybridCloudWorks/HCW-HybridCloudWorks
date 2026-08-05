/**
 * The authorization guard every admin handler must call.
 *
 * Replaces `requireAdminClaims` in `src/lib/auth-middleware.js`, which had two
 * defects in nine lines:
 *
 *   1. `requiredRoles = []` defaulted to an EMPTY array, so the check loop
 *      never executed and the function returned success. Any valid Entra token
 *      in the tenant was an admin. Site-Main defaults to 'viewer' and hard
 *      rejects a token with no admin role (`admin-auth.js:91`, `:107-112`),
 *      with a comment recording that an earlier permissive bridge had been a
 *      privilege-escalation path.
 *   2. `userRoles.includes(role)` is exact-string AND semantics, where the
 *      source is a hierarchy comparison — so `['editor']` DENIED publishers and
 *      super_admins. See roles.js `satisfiesRole`.
 *
 * There is no default here. `requireRole` takes the minimum role as a required
 * argument and throws if it is not a recognised one.
 *
 * ===========================================================================
 * WHY THIS IS ONE SHARED FUNCTION
 * ===========================================================================
 * `firestore.rules` had a default-deny catch-all — `match /{document=**}` with
 * `allow read, write: if false` — that caught every path the API forgot. Azure
 * has no such backstop, and every Function registration defaults to
 * `authLevel: 'anonymous'`. One handler that forgets the check IS the
 * vulnerability.
 *
 * So the check must be structurally unavoidable rather than copy-pasted: one
 * guard, called by every handler, plus a route-inventory test that enumerates
 * every registration and asserts each is either in an explicit public
 * allowlist or invokes this. That test is the replacement for the catch-all
 * rule, and it is the highest-value test in the port.
 */

import { ENTRA_ADMIN_APP_ROLE, ROLE_CACHE_TTL_MS, satisfiesRole, minimumRole } from './roles.js';

/** Uniform JSON error. FIX (A10): the previous 401/403 paths set no
 *  Content-Type, so Azure served them as text/plain and a frontend calling
 *  `res.json()` on a 401 got a parse error instead of the message. */
function deny(status, error) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: false, error }),
  };
}

/**
 * Create the guard.
 *
 * Dependencies are injected rather than imported so the whole thing is
 * testable without a tenant or a database — see DECISION 5 in verify-token.js.
 *
 * @param {object} deps
 * @param {{ verify(token: string): Promise<object> }} deps.verifier
 * @param {(oid: string) => Promise<{role: string, active: boolean}|null>} deps.lookupAdmin
 *        Point-read of `admins/{oid}`. Must resolve null when absent.
 * @param {(entry: object) => void} [deps.auditDenial] Called on every denial.
 * @param {() => number} [deps.now]
 * @returns {{ requireRole: Function, requireUser: Function, clearCache: Function }}
 */
export function createRoleGuard({ verifier, lookupAdmin, auditDenial, now = Date.now }) {
  if (!verifier) throw new Error('createRoleGuard requires a verifier');
  if (!lookupAdmin) throw new Error('createRoleGuard requires lookupAdmin');

  /** @type {Map<string, {value: object|null, expiresAt: number}>} */
  const cache = new Map();

  // FIX (A12): the replaced code logged nothing on the 403 path. Site-Main
  // logs every denial with uid and attempted role and writes admin_audit_logs
  // (`admin-auth.js:109`, `:124-126`, `:405-411`); the container exists on the
  // Azure side with no writer.
  const audit = (entry) => {
    try {
      auditDenial?.(entry);
    } catch {
      // An audit sink failure must never turn a clean 403 into a 500.
    }
  };

  async function resolveAdmin(oid) {
    const cached = cache.get(oid);
    if (cached && cached.expiresAt > now()) return cached.value;

    // Deliberately NOT wrapped in try/catch. A lookup failure must propagate
    // and become a 500, never a fallback to the token's claim — falling back
    // would reinstate the stale-role window the hybrid model exists to close.
    const record = await lookupAdmin(oid);
    cache.set(oid, { value: record ?? null, expiresAt: now() + ROLE_CACHE_TTL_MS });
    return record ?? null;
  }

  /**
   * Authenticate, then require at least `required`.
   *
   * @param {object} request Azure Functions HttpRequest
   * @param {string|string[]} required minimum role, e.g. 'editor'
   * @returns {Promise<{user: object|null, role: string|null, error: object|null}>}
   */
  async function requireRole(request, required) {
    const minimum = minimumRole(required);
    // A typo in a handler ("publishor") must fail loudly at the call, not
    // silently open the endpoint.
    if (!minimum) throw new Error(`requireRole: unknown role requirement ${JSON.stringify(required)}`);

    const auth = await authenticate(request);
    if (auth.error) return auth;

    const { user } = auth;
    const oid = user.oid ?? user.sub;

    // Gate 1: the coarse Entra App Role. No directory assignment means we do
    // not even read the database — a stolen non-admin token cannot cause a
    // lookup.
    const claimRoles = Array.isArray(user.roles) ? user.roles : [];
    if (!claimRoles.includes(ENTRA_ADMIN_APP_ROLE)) {
      audit({ outcome: 'denied', reason: 'missing-app-role', oid, required: minimum });
      return { user: null, role: null, error: deny(403, 'Admin access required') };
    }

    // Gate 2: the authoritative record.
    const record = await resolveAdmin(oid);
    if (!record) {
      audit({ outcome: 'denied', reason: 'no-admin-record', oid, required: minimum });
      return { user: null, role: null, error: deny(403, 'Admin access required') };
    }
    if (record.active !== true) {
      audit({ outcome: 'denied', reason: 'inactive', oid, required: minimum });
      return { user: null, role: null, error: deny(403, 'Admin access required') };
    }

    // Gate 3: the hierarchy.
    if (!satisfiesRole(record.role, minimum)) {
      audit({ outcome: 'denied', reason: 'insufficient-role', oid, required: minimum, actual: record.role });
      return { user: null, role: null, error: deny(403, `Requires ${minimum} or higher`) };
    }

    return { user, role: record.role, error: null };
  }

  /**
   * Authenticate only — no role requirement. For endpoints that need a known
   * caller but not an admin (saveToolWorkspace, exportToolReport).
   */
  async function authenticate(request) {
    const { bearerTokenFrom } = await import('./verify-token.js');
    const token = bearerTokenFrom(request);

    if (!token) {
      return { user: null, role: null, error: deny(401, 'Authentication required') };
    }

    try {
      const user = await verifier.verify(token);
      return { user, role: null, error: null };
    } catch (err) {
      audit({ outcome: 'denied', reason: 'invalid-token', detail: err.message });
      return { user: null, role: null, error: deny(401, 'Authentication required') };
    }
  }

  return {
    requireRole,
    requireUser: authenticate,
    /** Drop cached roles. For tests, and for use immediately after a role change. */
    clearCache: () => cache.clear(),
  };
}
