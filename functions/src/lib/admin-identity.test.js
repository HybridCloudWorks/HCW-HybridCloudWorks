/**
 * Admin identity + speaker-event RPCs — behavior pinned to the source
 * (:3303/:5010/:5078/:6171/:6236 and lib/admin-auth.js) with the documented
 * Entra adaptations. The load-bearing assertions: bootstrap's three-way gate
 * (locked / allowlisted / super_admin-required), the status endpoint answering
 * from the registry rather than token claims, and the guard cache clear after
 * a role write.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createAdminIdentityHandlers,
  checkBootstrapAllowlist,
  getPermissionsForRole,
  normalizeSpeakerEventDate,
} from './admin-identity.js';

const context = { log: vi.fn(), error: vi.fn() };

const USER = { oid: 'oid-1', email: 'first@hcw.dev', preferred_username: 'first@hcw.dev' };

const guardWith = (over = {}) => ({
  requireUser: vi.fn(async () => ({ user: USER, role: null, error: null })),
  requireRole: vi.fn(async () => ({ user: USER, role: 'editor', error: null })),
  clearCache: vi.fn(),
  ...over,
});
const denyUser = { requireUser: vi.fn(async () => ({ user: null, role: null, error: { status: 401, body: '{}' } })), requireRole: vi.fn(), clearCache: vi.fn() };

const makeRequest = (body) => ({
  method: 'POST',
  headers: { get: (k) => (k === 'user-agent' ? 'vitest' : null) },
  json: async () => {
    if (body === undefined) throw new SyntaxError('no body');
    return body;
  },
});

function makeStore(over = {}) {
  return {
    queryDocs: vi.fn(async () => []),
    readDoc: vi.fn(async () => null),
    upsertDoc: vi.fn(async (_c, d) => d),
    patchDoc: vi.fn(async (_c, id, u) => ({ id, ...u })),
    deleteDoc: vi.fn(async () => {}),
    ...over,
  };
}

const fixed = { now: () => new Date('2026-08-07T02:00:00.000Z'), uuid: () => 'fixed-uuid' };

describe('helpers', () => {
  it('permissions map carries the exact source strings the frontend gates on', () => {
    expect(getPermissionsForRole('editor')).toContain('write:content');
    expect(getPermissionsForRole('publisher')).toContain('publish:content');
    expect(getPermissionsForRole('super_admin')).toContain('manage:admins');
    expect(getPermissionsForRole('viewer')).toEqual(['read:content', 'read:dashboard']);
    expect(getPermissionsForRole('nonsense')).toEqual([]);
  });

  it('bootstrap allowlist: locked with no env, matches oid or lowercased email', () => {
    expect(checkBootstrapAllowlist(USER, {}).status).toBe(503);
    expect(checkBootstrapAllowlist(USER, { CMS_BOOTSTRAP_ALLOWED_UIDS: 'oid-1' }).ok).toBe(true);
    expect(
      checkBootstrapAllowlist(USER, { CMS_BOOTSTRAP_ALLOWED_EMAILS: 'FIRST@hcw.dev' }).ok
    ).toBe(true);
    expect(checkBootstrapAllowlist(USER, { OWNER_ADMIN_UID: 'someone-else' }).status).toBe(403);
  });

  it('speaker date normalizer handles Date, epoch, string, Timestamp-like, junk', () => {
    expect(normalizeSpeakerEventDate(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
    expect(normalizeSpeakerEventDate(1767225600000)).toBe('2026-01-01T00:00:00.000Z');
    expect(normalizeSpeakerEventDate('2026-01-01')).toMatch(/^2026-01-01T/);
    expect(normalizeSpeakerEventDate({ seconds: 1767225600, nanoseconds: 0 })).toBe('2026-01-01T00:00:00.000Z');
    expect(normalizeSpeakerEventDate({ _seconds: 1767225600 })).toBe('2026-01-01T00:00:00.000Z');
    expect(normalizeSpeakerEventDate('junk')).toBeNull();
    expect(normalizeSpeakerEventDate('')).toBeNull();
  });
});

describe('getCurrentAdminStatus', () => {
  it('401s with isAdmin:false on a bad token', async () => {
    const h = createAdminIdentityHandlers({ guard: denyUser, store: makeStore(), ...fixed });
    const res = await h.getCurrentAdminStatus(makeRequest(), context);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body).isAdmin).toBe(false);
  });

  it('answers from the registry record, not token claims', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'oid-1', role: 'PUBLISHER', active: true, permissions: null })),
    });
    const h = createAdminIdentityHandlers({ guard: guardWith(), store, ...fixed });
    const body = JSON.parse((await h.getCurrentAdminStatus(makeRequest(), context)).body);
    expect(body).toMatchObject({ isAdmin: true, uid: 'oid-1', role: 'publisher', active: true });
    expect(body.permissions).toContain('publish:content'); // derived when record has none
    expect(store.readDoc).toHaveBeenCalledWith('admins', 'oid-1', 'oid-1');
  });

  it('an inactive or missing record is not an admin', async () => {
    const inactive = makeStore({ readDoc: vi.fn(async () => ({ id: 'oid-1', role: 'editor', active: false })) });
    const h1 = createAdminIdentityHandlers({ guard: guardWith(), store: inactive, ...fixed });
    expect(JSON.parse((await h1.getCurrentAdminStatus(makeRequest(), context)).body).isAdmin).toBe(false);

    const h2 = createAdminIdentityHandlers({ guard: guardWith(), store: makeStore(), ...fixed });
    expect(JSON.parse((await h2.getCurrentAdminStatus(makeRequest(), context)).body).isAdmin).toBe(false);
  });
});

describe('bootstrapCurrentUserAdmin', () => {
  it('rejects an invalid role before any store access', async () => {
    const store = makeStore();
    const h = createAdminIdentityHandlers({ guard: guardWith(), store, ...fixed });
    expect((await h.bootstrapCurrentUserAdmin(makeRequest({ role: 'godmode' }), context)).status).toBe(400);
    expect(store.queryDocs).not.toHaveBeenCalled();
  });

  it('first admin: locked without allowlist, allowed with it, writes the registry', async () => {
    const env = { CMS_BOOTSTRAP_ALLOWED_UIDS: 'oid-1' };
    const store = makeStore(); // no active admins
    const guard = guardWith();
    const h = createAdminIdentityHandlers({ guard, store, env, ...fixed });

    const res = await h.bootstrapCurrentUserAdmin(makeRequest({}), context);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ success: true, uid: 'oid-1', role: 'super_admin', initialBootstrap: true });
    const doc = store.upsertDoc.mock.calls[0][1];
    expect(doc).toMatchObject({ id: 'oid-1', role: 'super_admin', active: true });
    expect(doc.permissions).toContain('manage:admins');
    expect(guard.clearCache).toHaveBeenCalled(); // stale 60s cache must not survive
    expect(guard.requireRole).not.toHaveBeenCalled(); // no admins yet — allowlist path

    const locked = createAdminIdentityHandlers({ guard: guardWith(), store: makeStore(), env: {}, ...fixed });
    expect((await locked.bootstrapCurrentUserAdmin(makeRequest({}), context)).status).toBe(503);
  });

  it('with existing admins: requires super_admin and patches, not replaces', async () => {
    const store = makeStore({
      queryDocs: vi.fn(async () => [{ id: 'existing-admin' }]),
      readDoc: vi.fn(async () => ({ id: 'oid-1', role: 'editor', createdAt: 'kept' })),
    });
    const guard = guardWith({
      requireRole: vi.fn(async () => ({ user: USER, role: 'super_admin', error: null })),
    });
    const h = createAdminIdentityHandlers({ guard, store, env: {}, ...fixed });
    const res = await h.bootstrapCurrentUserAdmin(makeRequest({ role: 'publisher' }), context);
    expect(JSON.parse(res.body).initialBootstrap).toBe(false);
    expect(guard.requireRole).toHaveBeenCalledWith(expect.anything(), 'super_admin');
    expect(store.patchDoc).toHaveBeenCalled();
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('denies a non-super_admin when admins already exist', async () => {
    const store = makeStore({ queryDocs: vi.fn(async () => [{ id: 'a' }]) });
    const guard = guardWith({
      requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })),
    });
    const h = createAdminIdentityHandlers({ guard, store, env: {}, ...fixed });
    expect((await h.bootstrapCurrentUserAdmin(makeRequest({}), context)).status).toBe(403);
    expect(store.upsertDoc).not.toHaveBeenCalled();
    expect(store.patchDoc).not.toHaveBeenCalled();
  });
});

describe('recordAdminAudit', () => {
  it('validates action and details like the source', async () => {
    const h = createAdminIdentityHandlers({ guard: guardWith(), store: makeStore(), ...fixed });
    expect((await h.recordAdminAudit(makeRequest({}), context)).status).toBe(400);
    expect((await h.recordAdminAudit(makeRequest({ action: 'x'.repeat(121) }), context)).status).toBe(400);
    expect((await h.recordAdminAudit(makeRequest({ action: 'ok', details: [1] }), context)).status).toBe(400);
  });

  it('writes the audit row with the source shape', async () => {
    const store = makeStore();
    const h = createAdminIdentityHandlers({ guard: guardWith(), store, ...fixed });
    const res = await h.recordAdminAudit(
      makeRequest({ action: 'page_view', details: { route: '/admin/queue', sessionId: 's1' } }),
      context
    );
    expect(JSON.parse(res.body)).toEqual({ success: true, auditId: 'fixed-uuid' });
    const [container, doc] = store.upsertDoc.mock.calls[0];
    expect(container).toBe('admin_audit_logs');
    expect(doc).toMatchObject({
      id: 'fixed-uuid',
      action: 'page_view',
      userId: 'oid-1',
      route: '/admin/queue',
      sessionId: 's1',
      userAgent: 'vitest',
      compliance: { schemaVersion: 1 },
    });
  });
});

describe('speaker events', () => {
  it('upsert merges by default (patch when present), normalizing the date', async () => {
    const store = makeStore({ readDoc: vi.fn(async () => ({ id: 'ev1', title: 'kept' })) });
    const h = createAdminIdentityHandlers({ guard: guardWith(), store, ...fixed });
    await h.upsertSpeakerEvent(
      makeRequest({ docId: 'ev1', data: { title: 'Talk', date: { seconds: 1767225600 } } }),
      context
    );
    expect(store.upsertDoc).not.toHaveBeenCalled();
    const patch = store.patchDoc.mock.calls[0][2];
    expect(patch.date).toBe('2026-01-01T00:00:00.000Z');
    expect(patch.updatedBy).toBe('first@hcw.dev');
  });

  it('merge:false replaces wholesale with creation stamps', async () => {
    const store = makeStore();
    const h = createAdminIdentityHandlers({ guard: guardWith(), store, ...fixed });
    await h.upsertSpeakerEvent(
      makeRequest({ docId: 'ev2', data: { title: 'New talk' }, merge: false }),
      context
    );
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(store.upsertDoc.mock.calls[0][1]).toMatchObject({
      id: 'ev2',
      title: 'New talk',
      createdAt: '2026-08-07T02:00:00.000Z',
      createdBy: 'first@hcw.dev',
    });
  });

  it('delete 404s a missing event and reports deletedBy on success', async () => {
    const h404 = createAdminIdentityHandlers({ guard: guardWith(), store: makeStore(), ...fixed });
    expect((await h404.deleteSpeakerEvent(makeRequest({ docId: 'nope' }), context)).status).toBe(404);

    const store = makeStore({ readDoc: vi.fn(async () => ({ id: 'ev1' })) });
    const h = createAdminIdentityHandlers({ guard: guardWith(), store, ...fixed });
    const res = await h.deleteSpeakerEvent(makeRequest({ docId: 'ev1' }), context);
    expect(JSON.parse(res.body)).toEqual({ success: true, docId: 'ev1', deletedBy: 'first@hcw.dev' });
    expect(store.deleteDoc).toHaveBeenCalledWith('speakerevents', 'ev1');
  });

  it('400s malformed upsert/delete requests before touching the store', async () => {
    const store = makeStore();
    const h = createAdminIdentityHandlers({ guard: guardWith(), store, ...fixed });
    expect((await h.upsertSpeakerEvent(makeRequest({ data: {} }), context)).status).toBe(400);
    expect((await h.upsertSpeakerEvent(makeRequest({ docId: 'x', data: [1] }), context)).status).toBe(400);
    expect((await h.deleteSpeakerEvent(makeRequest({}), context)).status).toBe(400);
    expect(store.upsertDoc).not.toHaveBeenCalled();
    expect(store.deleteDoc).not.toHaveBeenCalled();
  });
});
