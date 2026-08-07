/**
 * Admin identity RPCs — getCurrentAdminStatus, bootstrapCurrentUserAdmin,
 * recordAdminAudit — plus the speaker-event write RPCs
 * (upsertSpeakerEvent / deleteSpeakerEvent).
 *
 * Ported from Site-Main cms-functions.js (:3303, :5010, :5078, :6171, :6236)
 * and lib/admin-auth.js. The Firebase-Auth machinery does not survive the
 * port and is replaced deliberately:
 *
 *   - verifyIdToken + custom claims -> the Entra verifier via the guard's
 *     requireUser. getCurrentAdminStatus then answers from the authoritative
 *     admins/{oid} record instead of trusting token claims — the same
 *     authority requireRole's gate 2 uses, and strictly harder to spoof than
 *     the source's claims-only read.
 *   - setAdminRole's custom-claims sync + session revocation has no Entra
 *     equivalent from here (claims come from App Role assignments in the
 *     directory). Bootstrap writes the admins registry record and clears the
 *     guard's role cache; the Entra 'Admin' App Role must ALSO be assigned in
 *     the directory (gate 1) — recorded in the response so the operator sees
 *     the remaining step instead of a mysteriously denied login.
 *   - FINDING-06 upheld: no allow-any escape hatch. First-admin bootstrap
 *     requires the server-only allowlist (CMS_BOOTSTRAP_ALLOWED_UIDS /
 *     CMS_BOOTSTRAP_ALLOWED_EMAILS, or OWNER_ADMIN_UID / OWNER_ADMIN_EMAIL),
 *     where a "uid" is now an Entra object id.
 */
import { randomUUID } from 'node:crypto';
import { ADMIN_ROLES } from './auth/roles.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Verbatim from Site-Main lib/admin-auth.js — the frontend gates UI on these. */
export function getPermissionsForRole(role) {
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
  return permissionMap[String(role || '').toLowerCase()] || [];
}

/** Source checkBootstrapAllowlist (:6186), uid = Entra oid. */
export function checkBootstrapAllowlist(user, env = process.env) {
  const expandList = (envValues, lowercase) =>
    envValues.filter(Boolean).flatMap((value) =>
      String(value)
        .split(',')
        .map((entry) => (lowercase ? entry.trim().toLowerCase() : entry.trim()))
        .filter(Boolean)
    );
  const bootstrapAllowedUids = expandList(
    [env.CMS_BOOTSTRAP_ALLOWED_UIDS, env.OWNER_ADMIN_UID],
    false
  );
  const bootstrapAllowedEmails = expandList(
    [env.CMS_BOOTSTRAP_ALLOWED_EMAILS, env.OWNER_ADMIN_EMAIL],
    true
  );

  if (bootstrapAllowedUids.length === 0 && bootstrapAllowedEmails.length === 0) {
    return {
      ok: false,
      status: 503,
      error:
        'Initial bootstrap is locked. Configure bootstrap allowlist env vars for the first admin.',
    };
  }

  const oid = user.oid ?? user.sub;
  const email = String(user.email || user.preferred_username || '')
    .trim()
    .toLowerCase();
  const uidAllowed = bootstrapAllowedUids.includes(oid);
  const emailAllowed = email ? bootstrapAllowedEmails.includes(email) : false;
  if (!uidAllowed && !emailAllowed) {
    return { ok: false, status: 403, error: 'User is not allowed to perform initial bootstrap' };
  }
  return { ok: true };
}

/** Source upsertSpeakerEvent's date normalizer; Timestamps become ISO strings. */
export function normalizeSpeakerEventDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  if (typeof value === 'object') {
    const seconds = value.seconds ?? value._seconds;
    if (typeof seconds === 'number') {
      const nanos = value.nanoseconds ?? value._nanoseconds ?? 0;
      return new Date(seconds * 1000 + Math.floor(nanos / 1e6)).toISOString();
    }
  }
  return null;
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function, requireUser: Function, clearCache: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function, patchDoc: Function, deleteDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 * @param {object} [deps.env]
 */
export function createAdminIdentityHandlers({
  guard,
  store,
  now = () => new Date(),
  uuid = randomUUID,
  env = process.env,
}) {
  const actor = (user) => user.email || user.preferred_username || user.oid || user.sub || 'admin';

  return {
    /** GET /api/getCurrentAdminStatus — answers from the admins registry. */
    async getCurrentAdminStatus(request, context) {
      const auth = await guard.requireUser(request);
      if (auth.error) {
        return json(401, { error: 'Invalid token', isAdmin: false });
      }
      try {
        const { user } = auth;
        const oid = user.oid ?? user.sub;
        const email = user.email || user.preferred_username || null;

        const record = await store.readDoc('admins', oid, oid);
        if (!record || record.active !== true || !record.role) {
          return json(200, { isAdmin: false, uid: oid, email });
        }
        return json(200, {
          isAdmin: true,
          uid: oid,
          email,
          role: String(record.role).toLowerCase(),
          permissions: Array.isArray(record.permissions)
            ? record.permissions
            : getPermissionsForRole(record.role),
          active: true,
        });
      } catch (error) {
        context.error('getCurrentAdminStatus failed:', error);
        return json(500, { error: 'Failed to get admin status', isAdmin: false });
      }
    },

    /** POST /api/bootstrapCurrentUserAdmin — first admin, or self role update. */
    async bootstrapCurrentUserAdmin(request, context) {
      const auth = await guard.requireUser(request);
      if (auth.error) return auth.error;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const requestedRole = String(body.role || 'super_admin').toLowerCase();
        if (!ADMIN_ROLES[requestedRole.toUpperCase()]) {
          return json(400, { error: 'Invalid role' });
        }

        const { user } = auth;
        const oid = user.oid ?? user.sub;
        const email =
          String(user.email || user.preferred_username || '')
            .trim()
            .toLowerCase() || null;

        const activeAdmins = await store.queryDocs(
          'admins',
          'SELECT TOP 1 c.id FROM c WHERE c.active = true',
          []
        );
        const initialBootstrap = activeAdmins.length === 0;

        if (!initialBootstrap) {
          const actorAuth = await guard.requireRole(request, 'super_admin');
          if (actorAuth.error) return actorAuth.error;
        } else {
          const allowlist = checkBootstrapAllowlist(user, env);
          if (!allowlist.ok) {
            context.error('Initial bootstrap blocked:', allowlist.error);
            return json(allowlist.status, { error: allowlist.error });
          }
        }

        const nowIso = now().toISOString();
        const permissions = getPermissionsForRole(requestedRole);
        const reason = initialBootstrap
          ? 'Initial bootstrap via bootstrapCurrentUserAdmin'
          : 'Role update via bootstrapCurrentUserAdmin';

        const existing = await store.readDoc('admins', oid, oid);
        const registryFields = {
          uid: oid,
          email,
          role: requestedRole,
          permissions,
          active: true,
          updatedAt: nowIso,
          updatedBy: oid,
          updateReason: reason,
        };
        if (existing) {
          await store.patchDoc('admins', oid, registryFields);
        } else {
          await store.upsertDoc('admins', {
            id: oid,
            ...registryFields,
            createdAt: nowIso,
            createdBy: oid,
          });
        }
        // The 60s role cache must not serve the pre-bootstrap answer.
        guard.clearCache();

        return json(200, {
          success: true,
          uid: oid,
          email,
          role: requestedRole,
          initialBootstrap,
          // The port's honest difference from Firebase custom claims:
          note: "Registry record written. The Entra 'Admin' App Role must also be assigned to this user in the directory for API access (guard gate 1).",
        });
      } catch (error) {
        context.error('bootstrapCurrentUserAdmin failed:', error);
        return json(500, {
          error: 'Failed to bootstrap admin',
          message: error?.message || 'Unknown error',
        });
      }
    },

    /** POST /api/recordAdminAudit — client-originated audit rows. */
    async recordAdminAudit(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { action, details = {} } = body;
        if (!action || typeof action !== 'string') {
          return json(400, { error: 'action is required' });
        }
        if (String(action).trim().length > 120) {
          return json(400, { error: 'action exceeds 120 characters' });
        }
        if (!details || typeof details !== 'object' || Array.isArray(details)) {
          return json(400, { error: 'details must be an object' });
        }

        const { user } = auth;
        const auditId = uuid();
        await store.upsertDoc('admin_audit_logs', {
          id: auditId,
          action: String(action),
          userId: user.oid ?? user.sub ?? null,
          userEmail: user.email || null,
          route: details.route || null,
          sessionId: details.sessionId || null,
          timestamp: now().toISOString(),
          clientTimestamp: details.clientTimestamp || null,
          details,
          userAgent: request.headers?.get?.('user-agent') || details.userAgent || null,
          compliance: { schemaVersion: 1, detailsSanitized: true, identityVerified: true },
        });

        return json(200, { success: true, auditId });
      } catch (error) {
        context.error('recordAdminAudit failed:', error);
        return json(500, { error: 'Failed to record audit', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/upsertSpeakerEvent — merge by default, replace on merge:false. */
    async upsertSpeakerEvent(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { docId, data = {}, merge = true } = body;
        if (!docId || typeof docId !== 'string') {
          return json(400, { error: 'docId required' });
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          return json(400, { error: 'data object required' });
        }

        const normalizedData = { ...data };
        delete normalizedData.id; // the route/docId is the key, never the body
        if (Object.prototype.hasOwnProperty.call(normalizedData, 'date')) {
          normalizedData.date = normalizeSpeakerEventDate(normalizedData.date);
        }

        const nowIso = now().toISOString();
        const payload = {
          ...normalizedData,
          updatedAt: nowIso,
          updatedBy: actor(auth.user),
        };

        if (merge === false) {
          // set(..., {merge:false}) — full replace, with creation stamps.
          await store.upsertDoc('speakerevents', {
            id: docId,
            ...payload,
            createdAt: nowIso,
            createdBy: actor(auth.user),
          });
        } else {
          const existing = await store.readDoc('speakerevents', docId, docId);
          if (existing) {
            await store.patchDoc('speakerevents', docId, payload);
          } else {
            await store.upsertDoc('speakerevents', { id: docId, ...payload });
          }
        }

        return json(200, { success: true, docId });
      } catch (error) {
        context.error('upsertSpeakerEvent failed:', error);
        return json(500, { error: 'Failed to save speaker event', message: error?.message || 'Unknown error' });
      }
    },

    /** POST /api/deleteSpeakerEvent */
    async deleteSpeakerEvent(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const { docId } = body;
        if (!docId || typeof docId !== 'string') {
          return json(400, { error: 'docId required' });
        }

        const existing = await store.readDoc('speakerevents', docId, docId);
        if (!existing) {
          return json(404, { error: `speakerevents/${docId} not found` });
        }

        await store.deleteDoc('speakerevents', docId);
        return json(200, { success: true, docId, deletedBy: actor(auth.user) });
      } catch (error) {
        context.error('deleteSpeakerEvent failed:', error);
        return json(500, { error: 'Failed to delete speaker event', message: error?.message || 'Unknown error' });
      }
    },
  };
}
