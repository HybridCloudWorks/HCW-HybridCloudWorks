/**
 * Admin role model — the authorization decisions for the Azure port.
 *
 * Ported from Site-Main `functions/lib/admin-auth.js` (commit 07f3123).
 *
 * ===========================================================================
 * DECISION 1 — role source of truth: HYBRID
 * ===========================================================================
 * An Entra App Role is a coarse gate; the `admins` container in Cosmos is the
 * authoritative role of record.
 *
 * The deciding constraint is REVOCATION, and it is the whole reason not to use
 * Entra App Roles alone. Firebase's model is claim-authoritative because
 * Firebase supplies a revocation primitive: `admin-auth.js:101` verifies with
 * `checkRevoked = true`, and `admin-auth.js:250-253` calls
 * `revokeRefreshTokens()` on every downgrade, with a comment stating exactly
 * why — "without this the old, higher role keeps passing until the token
 * expires (up to an hour)".
 *
 * Entra offers no equivalent for a custom API. Access tokens stay valid until
 * expiry (60–90 min) and Continuous Access Evaluation does not cover us. Using
 * App Roles alone would therefore port the model MINUS the mitigation its
 * author deliberately added — which is precisely the silent authorization loss
 * Migration-Plan §8 warns about.
 *
 * So, per request:
 *   1. Verify the JWT.
 *   2. Require the `Admin` App Role in `roles`. No directory assignment means
 *      403 before any database read — a stolen non-admin token cannot even
 *      cause a lookup.
 *   3. Point-read `admins/{oid}` and require `active === true`.
 *   4. Compare `roleLevel(doc.role) >= requiredLevel`.
 *
 * Fail CLOSED at every step. Never fall back to the token's claim if the
 * lookup fails: that would reintroduce the stale-role window this design
 * exists to close.
 *
 * The cache TTL below IS the revocation SLA. It is stated as a number so it
 * cannot quietly drift to fifteen minutes.
 *
 * ===========================================================================
 * DECISION 4 — App Role value string
 * ===========================================================================
 * Exactly one role value, `Admin`, defined once here. Entra role values are
 * case-sensitive and compared as exact strings; a second spelling anywhere is
 * a silent authorization bypass or a silent lockout.
 *
 * The four-level hierarchy is NOT expressed as Entra roles. Four ordered
 * levels do not map cleanly onto flat role strings — you would either assign
 * three roles to a publisher or reimplement the level table anyway. The table
 * lives here, in one place.
 */

/**
 * Role hierarchy. Higher level = more permission.
 * Transcribed from `admin-auth.js:25-45`; the level numbers are load-bearing
 * and must not be reordered.
 */
export const ADMIN_ROLES = Object.freeze({
  VIEWER: { level: 1, name: 'viewer', description: 'View-only access to admin portal' },
  EDITOR: { level: 2, name: 'editor', description: 'Can edit and review content' },
  PUBLISHER: { level: 3, name: 'publisher', description: 'Can publish content to live' },
  SUPER_ADMIN: { level: 4, name: 'super_admin', description: 'Full access including user management' },
});

/**
 * The single Entra App Role value. Coarse gate only — it says "this principal
 * may reach the admin API", not what they may do once there.
 */
export const ENTRA_ADMIN_APP_ROLE = 'Admin';

/**
 * How long a resolved role may be cached, in milliseconds.
 *
 * This is the revocation SLA: a demoted or deactivated admin keeps their old
 * level for at most this long. Sixty seconds is a deliberate trade against ~1
 * RU per admin request. Raising it is a security decision, not a tuning knob.
 */
export const ROLE_CACHE_TTL_MS = 60_000;

/**
 * How many resolved roles may be held at once.
 *
 * Not a tuning knob either, but for a duller reason: the cache had no eviction
 * at all, so on a long-lived instance it grew with every distinct principal
 * that ever signed in (TODO.md T-408). Entries are only created for tokens that
 * verified, so this is bounded by real admins in practice — the limit exists so
 * that "in practice" is not the only thing bounding it. Well above any
 * plausible admin count, and small enough that a full sweep is trivial.
 */
export const ROLE_CACHE_MAX_ENTRIES = 500;

/**
 * Hierarchy level for a role name, or 0 when the name is unknown or empty.
 *
 * Unknown names must sort BELOW every real role so they never satisfy a check.
 * Ported from `admin-auth.js:roleLevel`, including the case-insensitive lookup.
 *
 * @param {string} role
 * @returns {number}
 */
export function roleLevel(role) {
  return ADMIN_ROLES[String(role || '').toUpperCase()]?.level ?? 0;
}

/**
 * Does `actualRole` satisfy a requirement of `requiredRole`?
 *
 * This is a HIERARCHY comparison, not set membership — the single most
 * important difference from the code this replaces. Site-Main's
 * `requireAdminClaims(req, res, 'editor')` admits editor, publisher AND
 * super_admin (`admin-auth.js:116-123`, `userRoleLevel >= minRequiredLevel`).
 *
 * The Azure middleware being replaced used `userRoles.includes(role)` — an
 * exact, case-sensitive string match with AND semantics across the array — so
 * `['editor']` DENIED publishers and super_admins. That is the inverse of the
 * source, and it was live at six call sites.
 *
 * @param {string} actualRole   role from the admins record
 * @param {string} requiredRole minimum role required
 * @returns {boolean}
 */
export function satisfiesRole(actualRole, requiredRole) {
  const required = roleLevel(requiredRole);
  // An unrecognised requirement must never be satisfiable — otherwise a typo
  // in a handler ("publishor") silently opens the endpoint to everyone.
  if (required === 0) return false;
  return roleLevel(actualRole) >= required;
}

/**
 * The minimum role a caller needs, given one or more acceptable roles.
 * Mirrors `admin-auth.js`'s `Math.min(...levels)`: passing several roles means
 * "any of these", i.e. the least privileged one is the bar.
 *
 * @param {string|string[]} required
 * @returns {string|null} canonical role name, or null if none is recognised
 */
export function minimumRole(required) {
  const list = Array.isArray(required) ? required : [required];
  const known = list.map((r) => ({ name: String(r || '').toLowerCase(), level: roleLevel(r) })).filter((r) => r.level > 0);

  if (known.length === 0) return null;
  return known.reduce((lowest, r) => (r.level < lowest.level ? r : lowest)).name;
}

/** Canonical role names, lowest privilege first. */
export const ROLE_NAMES = Object.freeze(
  Object.values(ADMIN_ROLES)
    .sort((a, b) => a.level - b.level)
    .map((r) => r.name)
);
