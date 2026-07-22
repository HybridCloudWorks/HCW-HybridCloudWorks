/**
 * Modern Admin Authentication System
 *
 * Uses Firebase Custom Claims as single source of truth.
 * All admin checks delegate to Firebase Auth Custom Claims.
 * Removes manual allowlists and keeps everything in Firestore.
 *
 * Flow:
 * 1. Admin operations happen via setAdminClaim() function
 * 2. Custom claims are automatically synced to user tokens
 * 3. HTTP functions verify claims on every request
 * 4. Firestore stores audit trail in admins/{uid} docs
 */

const admin = require('./firebase-admin');
const { logger } = require('firebase-functions');

// ============================================================================
// ADMIN ROLE DEFINITIONS
// ============================================================================

/**
 * Role hierarchy (higher number = more permissions)
 */
const ADMIN_ROLES = {
  VIEWER: { level: 1, name: 'viewer', description: 'View-only access to admin portal' },
  EDITOR: { level: 2, name: 'editor', description: 'Can edit and review content' },
  PUBLISHER: { level: 3, name: 'publisher', description: 'Can publish content to live' },
  SUPER_ADMIN: {
    level: 4,
    name: 'super_admin',
    description: 'Full access including user management',
  },
};

// ============================================================================
// FIRESTORE ADMIN REGISTRY
// ============================================================================

const ADMIN_REGISTRY_PATH = 'admins';
// FINDING-07: was 'admin_audit_log' (singular) — mismatched the Firestore Security
// Rules and cms-functions.js which both reference 'admin_audit_logs' (plural).
// Mismatch caused audit writes to land in an unprotected collection.
const AUDIT_LOG_PATH = 'admin_audit_logs';

/**
 * Admin registry document structure:
 * {
 *   uid: 'user-uid',
 *   email: 'user@example.com',
 *   role: 'super_admin' | 'publisher' | 'editor' | 'viewer',
 *   permissions: ['read:content', 'write:content', 'publish:content'],
 *   createdAt: timestamp,
 *   createdBy: 'admin-uid',
 *   updatedAt: timestamp,
 *   updatedBy: 'admin-uid',
 *   active: true,
 *   notes: 'Optional notes about this admin',
 *   customClaims: { // Synced to Firebase Auth automatically
 *     adminRole: 'super_admin',
 *     permissions: ['read:content', 'write:content', 'publish:content'],
 *     syncedAt: timestamp,
 *   }
 * }
 */

// ============================================================================
// MAIN AUTH FUNCTIONS
// ============================================================================

/**
 * Verify that a request contains valid admin claims.
 * This is the authoritative check for all admin endpoints.
 *
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {string|Array<string>} requiredRole - Required role(s): 'viewer'|'editor'|'publisher'|'super_admin'
 * @returns {Promise<Object|null>} Decoded token with claims, or null if unauthorized
 */
async function requireAdminClaims(req, res, requiredRole = 'viewer') {
  const authHeader = req.headers.authorization || '';
  const [, token] = authHeader.match(/^Bearer (.+)$/i) || [];

  if (!token) {
    res.status(401).json({ error: 'Missing Authorization bearer token' });
    return null;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token, true);

    // FINDING-08 (HIGH): Legacy claims bridge removed. The bridge promoted any token
    // with decoded.admin===true or decoded.role==='admin' to super_admin — a privilege
    // escalation path for any custom-token issuer that sets those fields.
    // All users must now carry the explicit adminRole custom claim set by setAdminRole().
    const adminRole = String(decoded.adminRole || '');
    if (!adminRole) {
      logger.warn(`User ${decoded.uid} attempted admin access without adminRole claim`);
      res.status(403).json({ error: 'Admin access required' });
      return null;
    }

    // Check role hierarchy if required
    const requiredRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    const userRoleLevel = ADMIN_ROLES[adminRole.toUpperCase()]?.level || 0;
    const minRequiredLevel = Math.min(
      ...requiredRoles.map((r) => ADMIN_ROLES[r.toUpperCase()]?.level || 999)
    );

    if (userRoleLevel < minRequiredLevel) {
      logger.warn(
        `User ${decoded.uid} (role: ${adminRole}) attempted to access endpoint requiring ${requiredRoles.join('|')}`
      );
      res.status(403).json({ error: `${requiredRoles.join(' or ')} access required` });
      return null;
    }

    return decoded;
  } catch (err) {
    logger.warn(`ID token verification failed: ${err.message}`);
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}

/**
 * Get current admin status for the authenticated user.
 * Used by frontend to discover permissions dynamically.
 * Reads only verified custom claims so admin shell load does not depend on Firestore.
 *
 * @param {Request} req
 * @param {Response} res
 */
async function getCurrentAdminStatus(req, res) {
  const authHeader = req.headers.authorization || '';
  const [, token] = authHeader.match(/^Bearer (.+)$/i) || [];

  if (!token) {
    res.status(401).json({ error: 'Missing token', isAdmin: false });
    return;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token, true);
    const adminRole = String(decoded.adminRole || '')
      .trim()
      .toLowerCase();
    const tokenPermissions = Array.isArray(decoded.permissions) ? decoded.permissions : [];

    if (!adminRole) {
      res.json({ isAdmin: false, uid: decoded.uid, email: decoded.email });
      return;
    }

    res.json({
      isAdmin: true,
      uid: decoded.uid,
      email: decoded.email,
      role: adminRole,
      permissions: tokenPermissions,
      active: true,
    });
  } catch (err) {
    logger.warn(`Error getting admin status: ${err.message}`);
    res.status(401).json({ error: 'Invalid token', isAdmin: false });
  }
}

/**
 * Set or update admin role for a user.
 * Called by super-admin functions or one-time setup.
 * Automatically syncs to Firebase Custom Claims.
 *
 * @param {string} uid - Firebase UID
 * @param {string} role - 'viewer'|'editor'|'publisher'|'super_admin'
 * @param {string} actorUid - UID of person making this change (for audit)
 * @param {string} reason - Why this change was made
 * @returns {Promise<void>}
 */
async function setAdminRole(uid, role, actorUid = 'system', reason = '') {
  const db = admin.firestore();
  const auth = admin.auth();

  if (!ADMIN_ROLES[role.toUpperCase()]) {
    throw new Error(
      `Invalid role: ${role}. Must be one of: ${Object.keys(ADMIN_ROLES).join(', ')}`
    );
  }

  const normalizedRole = role.toLowerCase();
  const permissions = getPermissionsForRole(normalizedRole);
  const now = new Date();
  const userRecord = await auth.getUser(uid);
  const email = String(userRecord?.email || '').toLowerCase() || null;
  const existingClaims = userRecord?.customClaims || {};
  const nextClaims = {
    ...existingClaims,
    adminRole: normalizedRole,
    permissions,
  };

  // Update Firestore registry
  await db
    .collection(ADMIN_REGISTRY_PATH)
    .doc(uid)
    .set(
      {
        uid,
        email,
        role: normalizedRole,
        permissions,
        active: true,
        createdAt: now,
        createdBy: actorUid,
        updatedAt: now,
        updatedBy: actorUid,
        updateReason: reason,
        customClaims: {
          adminRole: normalizedRole,
          permissions,
          syncedAt: now,
        },
      },
      { merge: true }
    );

  // Sync to Firebase Custom Claims (this makes it available in ID tokens)
  await auth.setCustomUserClaims(uid, nextClaims);

  // Log the audit event
  await logAdminAudit({
    action: 'ROLE_ASSIGNED',
    targetUid: uid,
    actorUid,
    role: normalizedRole,
    reason,
  });

  logger.info(`Admin role ${normalizedRole} assigned to ${uid}`);
}

/**
 * Remove admin access from a user.
 *
 * @param {string} uid - Firebase UID
 * @param {string} actorUid - UID of person making this change
 * @param {string} reason - Why access was removed
 */
async function removeAdminRole(uid, actorUid = 'system', reason = '') {
  const db = admin.firestore();
  const auth = admin.auth();

  // Soft-delete: mark as inactive in Firestore
  await db.collection(ADMIN_REGISTRY_PATH).doc(uid).update({
    active: false,
    updatedAt: new Date(),
    updatedBy: actorUid,
    updateReason: reason,
  });

  // Remove only admin claims while preserving unrelated claims.
  const userRecord = await auth.getUser(uid);
  const existingClaims = { ...(userRecord?.customClaims || {}) };
  delete existingClaims.adminRole;
  delete existingClaims.permissions;
  await auth.setCustomUserClaims(
    uid,
    Object.keys(existingClaims).length > 0 ? existingClaims : null
  );

  // Log the audit event
  await logAdminAudit({
    action: 'ROLE_REMOVED',
    targetUid: uid,
    actorUid,
    reason,
  });

  logger.info(`Admin role removed from ${uid}`);
}

/**
 * List all active admins.
 * Only accessible to super-admins.
 */
async function listAdmins() {
  const db = admin.firestore();
  const admins = await db
    .collection(ADMIN_REGISTRY_PATH)
    .where('active', '==', true)
    .orderBy('role', 'desc')
    .orderBy('createdAt', 'desc')
    .get();

  return admins.docs.map((doc) => {
    const data = doc.data();
    return {
      uid: data.uid,
      email: data.email,
      role: data.role,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  });
}

/**
 * Get audit log entries.
 * Filtered to last N days.
 */
async function getAdminAuditLog(days = 30) {
  const db = admin.firestore();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const entries = await db
    .collection(AUDIT_LOG_PATH)
    .where('timestamp', '>=', since)
    .orderBy('timestamp', 'desc')
    .limit(1000)
    .get();

  return entries.docs.map((doc) => doc.data());
}

// ============================================================================
// PERMISSION SYSTEM
// ============================================================================

/**
 * Define what permissions come with each role.
 * Synced to custom claims so frontend can make UX decisions.
 */
function getPermissionsForRole(role) {
  const permissionMap = {
    viewer: ['read:content', 'read:dashboard'],
    editor: ['read:content', 'read:dashboard', 'write:content', 'review:content'],
    publisher: [
      'read:content',
      'read:dashboard',
      'write:content',
      'review:content',
      'publish:content',
    ],
    super_admin: [
      'read:content',
      'read:dashboard',
      'write:content',
      'review:content',
      'publish:content',
      'manage:admins',
      'manage:settings',
    ],
  };
  return permissionMap[role.toLowerCase()] || [];
}

/**
 * Check if decoded token has a specific permission.
 */
function hasPermission(decoded, permission) {
  if (!decoded?.permissions || !Array.isArray(decoded.permissions)) {
    return false;
  }
  return decoded.permissions.includes(permission);
}

// ============================================================================
// AUDIT LOGGING
// ============================================================================

/**
 * Log admin actions for compliance.
 */
async function logAdminAudit(entry) {
  const db = admin.firestore();
  await db.collection(AUDIT_LOG_PATH).add({
    ...entry,
    timestamp: new Date(),
  });
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Auth checks
  requireAdminClaims,
  getCurrentAdminStatus,
  hasPermission,

  // Admin management
  setAdminRole,
  removeAdminRole,
  listAdmins,
  getAdminAuditLog,

  // Constants
  ADMIN_ROLES,
  ADMIN_REGISTRY_PATH,
  AUDIT_LOG_PATH,

  // Internal utils
  getPermissionsForRole,
  logAdminAudit,
};
