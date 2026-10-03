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
import { ADMIN_ROLES, ENTRA_ADMIN_APP_ROLE, ENTRA_API_DELEGATED_SCOPE } from './auth/roles.js';
import { ENTRA_REQUIRED_TOKEN_VERSION } from './auth/verify-token.js';
import { ENTRA_LAB_AGENT_APP_ROLE } from './auth/require-agent.js';

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

/**
 * A speaker event's calendar date as plain `YYYY-MM-DD` (ADR 0033 §4).
 *
 * Until 2026-10-03 this produced a UTC-midnight ISO timestamp, which the
 * admin and the public widget then read in local time — a day early west of
 * Greenwich. An event date is a calendar day, so the day is what is stored:
 * the leading day of a string is kept as written, and a Date, epoch or
 * Firestore-shaped `{ seconds }` takes its UTC day. Null for nothing usable.
 */
export function normalizeSpeakerEventDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const head = value.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(head)) {
      const [y, m, d] = head.split('-').map(Number);
      const probe = new Date(Date.UTC(y, m - 1, d));
      return probe.toISOString().slice(0, 10) === head ? head : null;
    }
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    const seconds = value.seconds ?? value._seconds;
    if (typeof seconds === 'number') {
      const nanos = value.nanoseconds ?? value._nanoseconds ?? 0;
      return new Date(seconds * 1000 + Math.floor(nanos / 1e6)).toISOString().slice(0, 10);
    }
  }
  return null;
}

export const SPEAKER_EVENT_STATUSES = Object.freeze([
  'idea',
  'proposed',
  'accepted',
  'declined',
  'delivered',
]);

/**
 * The fields `upsertSpeakerEvent` accepts (ADR 0033 §4). Positive, like the
 * snapshot sanitizer's list: the write side had no allowlist, so anything an
 * editor's client sent was stored, and the sanitizer was the only thing
 * between it and the public snapshot. `images[]` is absent on purpose — the
 * image-mirror trigger writes it from the server, never a client.
 */
export const SPEAKER_EVENT_FIELDS = Object.freeze([
  'eventId',
  'sessionizeId',
  'eventName',
  'name',
  'date',
  'location',
  'location_coords',
  'eventUrl',
  'presentationUrl',
  'eventImageUrl',
  'description',
  'display',
  'status',
  'cfpDeadline',
  'sessions',
  'audience',
  'topic',
  'evidence',
  'feedback',
  'attendance',
]);

const SPEAKER_EVENT_FIELD_SET = new Set(SPEAKER_EVENT_FIELDS);
const SPEAKER_EVENT_DATE_FIELDS = ['date', 'cfpDeadline'];

const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim());
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function cleanSessions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      title: text(s.title, 300),
      abstract: text(s.abstract, 8000),
      slidesUrl: isHttpUrl(s.slidesUrl) ? s.slidesUrl.trim() : null,
      videoUrl: isHttpUrl(s.videoUrl) ? s.videoUrl.trim() : null,
    }))
    .filter((s) => s.title)
    .slice(0, 50);
}

function cleanEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((e) => e && typeof e === 'object' && isHttpUrl(e.url))
    .map((e) => ({ label: text(e.label, 200) || e.url.trim(), url: e.url.trim() }))
    .slice(0, 50);
}

/**
 * The body of `upsertSpeakerEvent` with every key checked: unknown keys are a
 * refusal (`error`), dates become calendar days, URLs must be http(s), the
 * status must be one of SPEAKER_EVENT_STATUSES, and the structured lists are
 * reduced to their declared shape. Returns `{ value }` or `{ error }`.
 */
export function validateSpeakerEventData(data) {
  const unknown = Object.keys(data).filter(
    (key) => key !== 'id' && !SPEAKER_EVENT_FIELD_SET.has(key)
  );
  if (unknown.length) return { error: `Unknown speaker event field(s): ${unknown.join(', ')}` };
  const out = { ...data };
  delete out.id;
  for (const key of SPEAKER_EVENT_DATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(out, key))
      out[key] = normalizeSpeakerEventDate(out[key]);
  }
  for (const key of ['eventUrl', 'presentationUrl', 'eventImageUrl']) {
    if (out[key] === undefined || out[key] === null || out[key] === '') continue;
    if (!isHttpUrl(out[key])) return { error: `${key} must be an http(s) URL` };
    out[key] = out[key].trim();
  }
  if (
    out.status !== undefined &&
    out.status !== null &&
    !SPEAKER_EVENT_STATUSES.includes(out.status)
  ) {
    return { error: `status must be one of ${SPEAKER_EVENT_STATUSES.join(', ')}` };
  }
  if ('sessions' in out) out.sessions = cleanSessions(out.sessions);
  if ('evidence' in out) out.evidence = cleanEvidence(out.evidence);
  if ('attendance' in out) {
    const n = Number(out.attendance);
    out.attendance =
      out.attendance === null || out.attendance === '' || !Number.isFinite(n)
        ? null
        : Math.max(0, Math.floor(n));
  }
  if ('display' in out) out.display = out.display === true;
  return { value: out };
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

  /**
   * Would `bootstrapCurrentUserAdmin` actually succeed for this caller?
   *
   * The frontend used to offer "Bootstrap My Admin Access" to anyone it failed
   * to confirm as an admin, which is how the owner — already holding an
   * `admins` record — was invited to re-provision himself after nothing worse
   * than an expired token (#503). The UI cannot guess this: the gate is the
   * allowlist env vars and the state of the registry, neither of which the
   * browser can see. So it asks, and this answers with the same three-way gate
   * the POST enforces.
   *
   * `record` short-circuits it. An account with a row in `admins` is either an
   * admin already (never on this screen) or one that was deliberately
   * deactivated, and offering the second one a self-promotion to `super_admin`
   * is the opposite of what the deactivation meant.
   */
  async function canBootstrapSelf(user, record) {
    if (record) return false;
    if (!checkBootstrapAllowlist(user, env).ok) return false;
    const activeAdmins = await store.queryDocs(
      'admins',
      'SELECT TOP 1 c.id FROM c WHERE c.active = true',
      []
    );
    return activeAdmins.length === 0;
  }

  return {
    /**
     * GET /api/getCurrentAdminStatus — answers from the admins registry.
     *
     * A 200 is an ANSWER: `isAdmin` is true or false because the registry was
     * read. A 401 or a 500 is a check that could not run, and the frontend is
     * required to render those differently (#503) — `requireUser` only ever
     * denies with 401, so a non-200 here is never an authorization verdict.
     *
     * The `isAdmin: false` answer carries `canBootstrap` so the UI can offer
     * the bootstrap button only when it would work.
     */
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
          return json(200, {
            isAdmin: false,
            uid: oid,
            email,
            canBootstrap: await canBootstrapSelf(user, record),
          });
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

    /**
     * GET /api/getAuthExpectations — what the guard actually enforces, for
     * the Admin → Diagnostics page (#355).
     *
     * The page decodes the caller's own access token in the browser and needs
     * something to compare `aud`, `tid` and `roles` against. Building those
     * values into the frontend would only prove the frontend agrees with
     * itself; this returns the audience and tenant the verifier is configured
     * with and the App Role value `requireRole` looks for, so the comparison
     * is against the API as deployed.
     *
     * requireUser, not requireRole: the whole point is diagnosing a caller
     * who holds the App Role but is missing from the registry, and that caller
     * would be refused by the role guard before learning anything. Nothing
     * here is secret — the audience is in every token's `aud`, the tenant is
     * in the SPA's build, and the role and scope values are in this
     * repository. It is an inventory of what the guard checks, not of what it
     * checks against.
     */
    async getAuthExpectations(request) {
      const auth = await guard.requireUser(request);
      if (auth.error) return auth.error;
      return json(200, {
        expectedAudience: env.ENTRA_API_AUDIENCE || null,
        tenantId: env.ENTRA_TENANT_ID || null,
        adminAppRole: ENTRA_ADMIN_APP_ROLE,
        registryContainer: 'admins',
        // Added with the configuration review surface (#519). Each is a value
        // the guard enforces and the SPA cannot know, so a page that compares
        // against them is comparing against the API as deployed rather than
        // against a frontend constant that agrees with itself.
        requiredScope: ENTRA_API_DELEGATED_SCOPE,
        requiredTokenVersion: ENTRA_REQUIRED_TOKEN_VERSION,
        labAgentAppRole: ENTRA_LAB_AGENT_APP_ROLE,
      });
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
        return json(500, {
          error: 'Failed to record audit',
          message: error?.message || 'Unknown error',
        });
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

        // The route/docId is the key, never the body; every other key must be
        // one the hub declares (ADR 0033 §4), or the write is refused.
        const checked = validateSpeakerEventData(data);
        if (checked.error) return json(400, { error: checked.error });

        const nowIso = now().toISOString();
        const payload = {
          ...checked.value,
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
            // A merge that creates is still a creation, so it is stamped as one.
            await store.upsertDoc('speakerevents', {
              id: docId,
              ...payload,
              createdAt: nowIso,
              createdBy: actor(auth.user),
            });
          }
        }

        return json(200, { success: true, docId });
      } catch (error) {
        context.error('upsertSpeakerEvent failed:', error);
        return json(500, {
          error: 'Failed to save speaker event',
          message: error?.message || 'Unknown error',
        });
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
        return json(500, {
          error: 'Failed to delete speaker event',
          message: error?.message || 'Unknown error',
        });
      }
    },
  };
}
