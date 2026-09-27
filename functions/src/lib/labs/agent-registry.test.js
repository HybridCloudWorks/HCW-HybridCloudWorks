/**
 * The lab agent registry's write path (#740). The load-bearing test is the
 * last describe: a document this module writes must pass the agent guard
 * (auth/require-agent.js) for a token carrying the registered object id, and
 * must hand the claim path (lab-agent.js) the job types it was registered
 * with. That is the whole reason the route exists, so it is proved against the
 * real guard and the real claim handler over one in-memory container, not
 * against a description of the shape.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createAgentRegistryHandlers,
  DEFAULT_AGENT_JOB_TYPES,
  LAB_AGENT_ID_PATTERN,
  LAB_AGENT_REGISTRY_ROLE,
  OBJECT_ID_PATTERN,
  parseAgentId,
  parseJobTypes,
  parseObjectId,
  presentAgent,
} from './agent-registry.js';
import { LAB_JOB_TYPES } from '../labs.js';
import { createAgentGuard, ENTRA_LAB_AGENT_APP_ROLE } from '../auth/require-agent.js';
import { createRoleGuard } from '../auth/require-role.js';
import { ENTRA_ADMIN_APP_ROLE, ENTRA_API_DELEGATED_SCOPE } from '../auth/roles.js';
import { createLabAgentHandlers } from '../lab-agent.js';

const AGENT_ID = 'vps-hostinger-01';
const AGENT_OID = '9f8e7d6c-5b4a-4938-8271-605f4e3d2c1b';
const OTHER_OID = '12345678-90ab-4cde-8f01-23456789abcd';
const NOW = new Date('2026-09-27T12:00:00.000Z');
const LATER = new Date('2026-09-27T12:05:00.000Z');
const USER = { oid: 'admin-oid', email: 'owner@hcw.dev', name: 'Owner' };

const context = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });

const allowGuard = () => ({
  requireRole: vi.fn(async () => ({ user: USER, role: 'editor', error: null })),
});
const denyGuard = () => ({
  requireRole: vi.fn(async () => ({
    user: null,
    role: null,
    error: { status: 403, headers: {}, body: JSON.stringify({ ok: false, error: 'Admin access required' }) },
  })),
});

const post = (body, headers = {}) => ({
  method: 'POST',
  params: {},
  headers: { get: (name) => headers[name.toLowerCase()] ?? (name.toLowerCase() === 'user-agent' ? 'vitest' : null) },
  json: async () => body,
});
const patch = (agentId, body, headers = {}) => ({ ...post(body, headers), method: 'PATCH', params: { agentId } });

/**
 * An in-memory `lab_agents` + `admin_audit_logs` with the cosmos-client
 * semantics the handlers rely on: readDoc resolves null when absent, createDoc
 * fails with code 409 on a taken id, patchDoc sets only the fields it is given
 * and fails 404 on a missing document, and every stored document carries the
 * system fields Cosmos adds.
 */
function memoryStore(seed = {}) {
  const containers = new Map();
  const table = (name) => {
    if (!containers.has(name)) containers.set(name, new Map());
    return containers.get(name);
  };
  for (const [name, docs] of Object.entries(seed)) {
    for (const doc of docs) table(name).set(doc.id, { ...doc });
  }
  const stamp = (doc) => ({ ...doc, _rid: 'rid', _etag: '"etag"', _ts: 1 });
  const store = {
    readDoc: vi.fn(async (name, id) => {
      const doc = table(name).get(id);
      return doc ? structuredClone(doc) : null;
    }),
    createDoc: vi.fn(async (name, doc) => {
      if (table(name).has(doc.id)) throw Object.assign(new Error('Conflict'), { code: 409 });
      table(name).set(doc.id, stamp(doc));
      return structuredClone(table(name).get(doc.id));
    }),
    patchDoc: vi.fn(async (name, id, updates) => {
      const doc = table(name).get(id);
      if (!doc) throw Object.assign(new Error('Not found'), { code: 404 });
      table(name).set(id, { ...doc, ...updates });
      return structuredClone(table(name).get(id));
    }),
    upsertDoc: vi.fn(async (name, doc) => {
      table(name).set(doc.id, stamp(doc));
      return doc;
    }),
    queryDocs: vi.fn(async () => []),
    replaceDocIfMatch: vi.fn(async (_name, doc) => doc),
  };
  return {
    store,
    doc: (name, id) => table(name).get(id) ?? null,
    all: (name) => [...table(name).values()],
  };
}

function handlersOver(memory, { guard = allowGuard(), now = () => NOW } = {}) {
  let n = 0;
  return createAgentRegistryHandlers({ guard, store: memory.store, now, uuid: () => `audit-${++n}` });
}

const bodyOf = (res) => JSON.parse(res.body);
const writes = (memory) => memory.store.createDoc.mock.calls.length + memory.store.patchDoc.mock.calls.length;

describe('the validators', () => {
  it('take the agent id the way the certificate CN spells it', () => {
    expect(parseAgentId(AGENT_ID)).toBe(AGENT_ID);
    expect(parseAgentId(`  ${AGENT_ID} `)).toBe(AGENT_ID);
    expect(parseAgentId('a')).toBe('a');
    expect(parseAgentId('a'.repeat(63))).toBe('a'.repeat(63));
    for (const bad of [
      'VPS-hostinger-01',
      `${AGENT_ID}\n-evil`,
      '-vps',
      'vps-',
      'vps hostinger',
      'vps/01',
      'vps_01',
      'a'.repeat(64),
      '',
      42,
      null,
      undefined,
    ]) {
      expect(parseAgentId(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('take an object id as a GUID, lower-cased the way the token claim is', () => {
    expect(parseObjectId(AGENT_OID)).toBe(AGENT_OID);
    expect(parseObjectId(AGENT_OID.toUpperCase())).toBe(AGENT_OID);
    expect(parseObjectId(` ${AGENT_OID}\n`)).toBe(AGENT_OID);
    for (const bad of [
      `{${AGENT_OID}}`,
      AGENT_OID.replace(/-/g, ''),
      `${AGENT_OID}0`,
      `${AGENT_OID}\n${OTHER_OID}`,
      'not-a-guid',
      '',
      123,
      null,
    ]) {
      expect(parseObjectId(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('default the job types to every LAB_JOB_TYPES entry, in its order', () => {
    expect(DEFAULT_AGENT_JOB_TYPES).toEqual(Object.keys(LAB_JOB_TYPES));
    expect(parseJobTypes(undefined)).toEqual({ jobTypes: Object.keys(LAB_JOB_TYPES) });
    expect(parseJobTypes(['kubeconform', 'shell-echo', 'kubeconform'])).toEqual({
      jobTypes: ['shell-echo', 'kubeconform'],
    });
  });

  it('refuse an unknown job type, an empty list and anything that is not a list of names', () => {
    expect(parseJobTypes(['shell-echo', 'rm-rf']).error).toMatch(/Unknown job type\(s\): rm-rf/);
    expect(parseJobTypes(['constructor']).error).toMatch(/Unknown job type/);
    expect(parseJobTypes([]).error).toMatch(/at least one/);
    expect(parseJobTypes('shell-echo').error).toMatch(/list/);
    expect(parseJobTypes([1]).error).toMatch(/list/);
    expect(parseJobTypes(null).error).toMatch(/list/);
  });

  it('are the patterns the admin form checks before it sends', () => {
    // frontend/src/components/admin/labs/labsView.js repeats both so the form
    // can refuse early, and its test pins the same two literals. A change to
    // either side fails that side's test, which names the other file.
    expect(LAB_AGENT_ID_PATTERN.source).toBe('^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$');
    expect(OBJECT_ID_PATTERN.source).toBe('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
    expect(OBJECT_ID_PATTERN.flags).toBe('i');
  });

  it('answer the stored document without the Cosmos system fields', () => {
    expect(presentAgent({ id: 'a', oid: 'b', _rid: 'r', _etag: 'e', _ts: 1, _self: 's' })).toEqual({ id: 'a', oid: 'b' });
  });
});

describe('POST cms/labs/agents — validation', () => {
  it.each([
    ['a bad agent id', { agentId: 'VPS-01', oid: AGENT_OID }, /agentId must be the CN/],
    ['a missing agent id', { oid: AGENT_OID }, /agentId must be the CN/],
    ['a bad GUID', { agentId: AGENT_ID, oid: 'not-a-guid' }, /oid must be the object id/],
    ['a GUID in braces', { agentId: AGENT_ID, oid: `{${AGENT_OID}}` }, /oid must be the object id/],
    ['a missing oid', { agentId: AGENT_ID }, /oid must be the object id/],
    ['an unknown job type', { agentId: AGENT_ID, oid: AGENT_OID, jobTypes: ['shell-echo', 'rm-rf'] }, /Unknown job type/],
    ['an empty job type list', { agentId: AGENT_ID, oid: AGENT_OID, jobTypes: [] }, /at least one/],
    ['an unknown field', { agentId: AGENT_ID, oid: AGENT_OID, clientSecret: 'x' }, /Unknown field\(s\): clientSecret/],
    ['the active flag, which only PATCH sets', { agentId: AGENT_ID, oid: AGENT_OID, active: true }, /Unknown field\(s\): active/],
    ['a list body', [AGENT_ID, AGENT_OID], /JSON object/],
    ['a null body', null, /JSON object/],
    ['an oversized body', { agentId: AGENT_ID, oid: AGENT_OID, jobTypes: Array(2000).fill('shell-echo') }, /JSON object/],
  ])('refuses %s with 400 and writes nothing', async (_label, body, message) => {
    const memory = memoryStore();
    const res = await handlersOver(memory).registerAgent(post(body), context());

    expect(res.status).toBe(400);
    expect(bodyOf(res).error).toMatch(message);
    expect(memory.store.readDoc).not.toHaveBeenCalled();
    expect(writes(memory)).toBe(0);
    expect(memory.store.upsertDoc).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON', async () => {
    const memory = memoryStore();
    const request = { ...post({}), json: async () => { throw new SyntaxError('Unexpected token'); } };
    const res = await handlersOver(memory).registerAgent(request, context());
    expect(res.status).toBe(400);
    expect(writes(memory)).toBe(0);
  });
});

describe('POST cms/labs/agents — the write', () => {
  it('creates the document active, with every job type, and one audit row', async () => {
    const memory = memoryStore();
    const res = await handlersOver(memory).registerAgent(post({ agentId: AGENT_ID, oid: AGENT_OID }), context());

    expect(res.status).toBe(201);
    const body = bodyOf(res);
    expect(body).toMatchObject({ ok: true, created: true, changed: true });
    const expected = {
      id: AGENT_ID,
      agentId: AGENT_ID,
      oid: AGENT_OID,
      active: true,
      capabilities: Object.keys(LAB_JOB_TYPES),
      registeredAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      updatedBy: USER.oid,
    };
    // The answer is the stored document, minus Cosmos's own fields.
    expect(body.agent).toEqual(expected);
    expect(presentAgent(memory.doc('lab_agents', AGENT_ID))).toEqual(expected);

    const audit = memory.all('admin_audit_logs');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'lab_agent_registered',
      userId: USER.oid,
      userEmail: USER.email,
      timestamp: NOW.toISOString(),
      details: { agentId: AGENT_ID, oid: AGENT_OID, capabilities: Object.keys(LAB_JOB_TYPES), active: true },
      compliance: { schemaVersion: 1, detailsSanitized: true, identityVerified: true },
    });
  });

  it('is idempotent: the same registration again writes nothing and says so', async () => {
    const memory = memoryStore();
    const handlers = handlersOver(memory, { now: () => LATER });
    await handlers.registerAgent(post({ agentId: AGENT_ID, oid: AGENT_OID }), context());
    const first = structuredClone(memory.doc('lab_agents', AGENT_ID));

    // The same set in another order, an upper-case paste of the same GUID
    // and whitespace around the id are all the same registration.
    for (const body of [
      { agentId: AGENT_ID, oid: AGENT_OID },
      { agentId: ` ${AGENT_ID} `, oid: AGENT_OID.toUpperCase() },
      { agentId: AGENT_ID, oid: AGENT_OID, jobTypes: [...Object.keys(LAB_JOB_TYPES)].reverse() },
    ]) {
      const res = await handlers.registerAgent(post(body), context());
      expect(res.status).toBe(200);
      expect(bodyOf(res)).toMatchObject({ ok: true, created: false, changed: false });
      expect(bodyOf(res).agent).toEqual(presentAgent(first));
    }
    expect(memory.store.createDoc).toHaveBeenCalledTimes(1);
    expect(memory.store.patchDoc).not.toHaveBeenCalled();
    expect(memory.all('admin_audit_logs')).toHaveLength(1);
    expect(memory.doc('lab_agents', AGENT_ID)).toEqual(first);
  });

  it('rebinds an existing agent with only the registry fields, leaving the heartbeat alone', async () => {
    const heartbeat = { hostname: 'srv1', version: '1.0.0', status: 'idle', activeJobs: 0, lastSeenAt: NOW.toISOString() };
    const memory = memoryStore({
      lab_agents: [{ id: AGENT_ID, agentId: AGENT_ID, oid: OTHER_OID, active: true, capabilities: ['shell-echo'], ...heartbeat }],
    });
    const res = await handlersOver(memory, { now: () => LATER }).registerAgent(
      post({ agentId: AGENT_ID, oid: AGENT_OID, jobTypes: ['shell-echo', 'terraform-validate'] }),
      context()
    );

    expect(res.status).toBe(200);
    expect(bodyOf(res)).toMatchObject({ created: false, changed: true });
    const [, id, updates, options] = memory.store.patchDoc.mock.calls[0];
    expect(id).toBe(AGENT_ID);
    expect(options).toEqual({ partitionKey: AGENT_ID });
    expect(updates).toEqual({
      oid: AGENT_OID,
      capabilities: ['shell-echo', 'terraform-validate'],
      updatedAt: LATER.toISOString(),
      updatedBy: USER.oid,
    });
    expect(memory.doc('lab_agents', AGENT_ID)).toMatchObject({ ...heartbeat, oid: AGENT_OID, active: true });
    expect(memory.all('admin_audit_logs')[0]).toMatchObject({
      action: 'lab_agent_updated',
      details: {
        agentId: AGENT_ID,
        oid: AGENT_OID,
        previousOid: OTHER_OID,
        capabilities: ['shell-echo', 'terraform-validate'],
        previousCapabilities: ['shell-echo'],
        active: true,
      },
    });
  });

  it('does not reactivate a deactivated agent: only PATCH undoes a revocation', async () => {
    const memory = memoryStore({
      lab_agents: [{ id: AGENT_ID, agentId: AGENT_ID, oid: OTHER_OID, active: false, capabilities: ['shell-echo'] }],
    });
    const res = await handlersOver(memory).registerAgent(post({ agentId: AGENT_ID, oid: AGENT_OID }), context());

    expect(res.status).toBe(200);
    expect(bodyOf(res).agent).toMatchObject({ oid: AGENT_OID, active: false });
    expect(memory.store.patchDoc.mock.calls[0][2]).not.toHaveProperty('active');
    expect(memory.doc('lab_agents', AGENT_ID).active).toBe(false);
  });

  it('answers 409 when another request created the same agent between the read and the write', async () => {
    const memory = memoryStore();
    memory.store.readDoc.mockResolvedValueOnce(null);
    memory.store.createDoc.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { code: 409 }));
    const res = await handlersOver(memory).registerAgent(post({ agentId: AGENT_ID, oid: AGENT_OID }), context());

    expect(res.status).toBe(409);
    expect(bodyOf(res).error).toMatch(/Submit again/);
    expect(memory.all('admin_audit_logs')).toHaveLength(0);
  });

  it('keeps a registration that was saved when only its audit row fails', async () => {
    const memory = memoryStore();
    const upsert = memory.store.upsertDoc;
    memory.store.upsertDoc = vi.fn(async () => {
      throw new Error('audit sink down');
    });
    const ctx = context();
    const res = await handlersOver(memory).registerAgent(post({ agentId: AGENT_ID, oid: AGENT_OID }), ctx);

    expect(res.status).toBe(201);
    expect(memory.doc('lab_agents', AGENT_ID)).not.toBeNull();
    expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining('audit row failed'));
    expect(upsert).not.toHaveBeenCalled();
  });

  it('answers 500 without a stack or a store message when the store fails', async () => {
    const memory = memoryStore();
    memory.store.readDoc.mockRejectedValueOnce(new Error('cosmos said something internal'));
    const ctx = context();
    const res = await handlersOver(memory).registerAgent(post({ agentId: AGENT_ID, oid: AGENT_OID }), ctx);

    expect(res.status).toBe(500);
    expect(res.body).not.toContain('internal');
    expect(ctx.error).toHaveBeenCalled();
  });
});

describe('PATCH cms/labs/agents/{agentId}', () => {
  const seeded = (active = true) =>
    memoryStore({
      lab_agents: [
        { id: AGENT_ID, agentId: AGENT_ID, oid: AGENT_OID, active, capabilities: ['shell-echo'], lastSeenAt: NOW.toISOString() },
      ],
    });

  it('deactivates, then activates, with an audit row each, touching nothing else', async () => {
    const memory = seeded(true);
    const handlers = handlersOver(memory, { now: () => LATER });

    const off = await handlers.setAgentActive(patch(AGENT_ID, { active: false }), context());
    expect(off.status).toBe(200);
    expect(bodyOf(off)).toMatchObject({ ok: true, changed: true, agent: { active: false, oid: AGENT_OID } });
    expect(memory.store.patchDoc.mock.calls[0][2]).toEqual({
      active: false,
      updatedAt: LATER.toISOString(),
      updatedBy: USER.oid,
    });

    const on = await handlers.setAgentActive(patch(AGENT_ID, { active: true }), context());
    expect(bodyOf(on).agent.active).toBe(true);
    expect(memory.doc('lab_agents', AGENT_ID)).toMatchObject({ capabilities: ['shell-echo'], lastSeenAt: NOW.toISOString() });

    expect(memory.all('admin_audit_logs').map((row) => [row.action, row.details])).toEqual([
      ['lab_agent_deactivated', { agentId: AGENT_ID, oid: AGENT_OID, active: false }],
      ['lab_agent_activated', { agentId: AGENT_ID, oid: AGENT_OID, active: true }],
    ]);
  });

  it('writes nothing when the agent is already in that state', async () => {
    const memory = seeded(true);
    const res = await handlersOver(memory).setAgentActive(patch(AGENT_ID, { active: true }), context());
    expect(res.status).toBe(200);
    expect(bodyOf(res).changed).toBe(false);
    expect(writes(memory)).toBe(0);
    expect(memory.all('admin_audit_logs')).toHaveLength(0);
  });

  it('answers 404 for an agent nobody registered', async () => {
    const memory = memoryStore();
    const res = await handlersOver(memory).setAgentActive(patch('vps-other-01', { active: false }), context());
    expect(res.status).toBe(404);
    expect(writes(memory)).toBe(0);
  });

  it.each([
    ['a bad agent id in the path', 'VPS-01', { active: false }, /agentId must be the CN/],
    ['an active that is not a boolean', AGENT_ID, { active: 'false' }, /true or false/],
    ['no active at all', AGENT_ID, {}, /true or false/],
    ['another field', AGENT_ID, { active: false, oid: OTHER_OID }, /Unknown field\(s\): oid/],
  ])('refuses %s with 400', async (_label, agentId, body, message) => {
    const memory = seeded(true);
    const res = await handlersOver(memory).setAgentActive(patch(agentId, body), context());
    expect(res.status).toBe(400);
    expect(bodyOf(res).error).toMatch(message);
    expect(writes(memory)).toBe(0);
  });
});

describe('auth', () => {
  it('requires the level of the other Labs writes', () => {
    expect(LAB_AGENT_REGISTRY_ROLE).toBe('editor');
  });

  it('a refused caller gets the 403 of the guard and reaches no store call, on both routes', async () => {
    const memory = memoryStore();
    const guard = denyGuard();
    const handlers = handlersOver(memory, { guard });

    const registered = await handlers.registerAgent(post({ agentId: AGENT_ID, oid: AGENT_OID }), context());
    const toggled = await handlers.setAgentActive(patch(AGENT_ID, { active: false }), context());

    expect(registered.status).toBe(403);
    expect(toggled.status).toBe(403);
    expect(guard.requireRole).toHaveBeenCalledWith(expect.anything(), 'editor');
    for (const fn of Object.values(memory.store)) expect(fn).not.toHaveBeenCalled();
  });

  describe('through the real admin guard', () => {
    const TOKENS = {
      // A signed-in user with no Admin app role: not an admin at all.
      'no-app-role': { oid: 'user-1', roles: [], scp: ENTRA_API_DELEGATED_SCOPE },
      // An admin whose record is viewer: below the Labs write level.
      viewer: { oid: 'viewer-1', roles: [ENTRA_ADMIN_APP_ROLE], scp: ENTRA_API_DELEGATED_SCOPE },
      editor: { oid: 'editor-1', roles: [ENTRA_ADMIN_APP_ROLE], scp: ENTRA_API_DELEGATED_SCOPE },
      // The lab agent's own app-only token must not reach an admin route.
      agent: { oid: AGENT_OID, roles: [ENTRA_LAB_AGENT_APP_ROLE] },
    };
    const ADMINS = { 'viewer-1': { role: 'viewer', active: true }, 'editor-1': { role: 'editor', active: true } };
    const guard = createRoleGuard({
      verifier: {
        verify: async (token) => {
          if (!TOKENS[token]) throw new Error('bad token');
          return TOKENS[token];
        },
      },
      lookupAdmin: async (oid) => ADMINS[oid] ?? null,
      auditDenial: () => {},
    });
    const as = (token) => ({ authorization: `Bearer ${token}` });

    it.each([
      ['no token', {}, 401],
      ['a non-admin', as('no-app-role'), 403],
      ['a viewer', as('viewer'), 403],
      ['the agent itself', as('agent'), 401],
    ])('refuses %s, writing nothing', async (_label, headers, status) => {
      const memory = memoryStore();
      const handlers = handlersOver(memory, { guard });
      const res = await handlers.registerAgent(post({ agentId: AGENT_ID, oid: AGENT_OID }, headers), context());
      const off = await handlers.setAgentActive(patch(AGENT_ID, { active: false }, headers), context());

      expect(res.status).toBe(status);
      expect(off.status).toBe(status);
      expect(memory.store.readDoc).not.toHaveBeenCalled();
      expect(writes(memory)).toBe(0);
    });

    it('admits an editor', async () => {
      const memory = memoryStore();
      const res = await handlersOver(memory, { guard }).registerAgent(
        post({ agentId: AGENT_ID, oid: AGENT_OID }, as('editor')),
        context()
      );
      expect(res.status).toBe(201);
    });
  });
});

describe('what the agent guard and the claim path read', () => {
  const agentToken = { authorization: 'Bearer agent-token' };
  const agentRequest = (body) => ({
    headers: { get: (name) => agentToken[name.toLowerCase()] ?? null },
    json: async () => body,
  });

  /** The production composition of require-agent, over the same container. */
  function agentGuardOver(memory, tokenOid = AGENT_OID) {
    const auditDenial = vi.fn();
    const guard = createAgentGuard({
      verifier: { verify: async () => ({ oid: tokenOid, roles: [ENTRA_LAB_AGENT_APP_ROLE] }) },
      // default-agent-guard.js: readDoc('lab_agents', agentId, agentId).
      lookupAgent: (agentId) => memory.store.readDoc('lab_agents', agentId, agentId),
      auditDenial,
    });
    return { guard, auditDenial };
  }

  it('a registered document passes require-agent for a token carrying that oid', async () => {
    const memory = memoryStore();
    // Pasted in upper case: the token's claim is lower case, and the guard
    // compares with !==, so the write must normalise it.
    await handlersOver(memory).registerAgent(post({ agentId: AGENT_ID, oid: AGENT_OID.toUpperCase() }), context());

    const { guard } = agentGuardOver(memory);
    const auth = await guard.requireAgent(agentRequest({ agentId: AGENT_ID }), AGENT_ID);

    expect(auth.error).toBeNull();
    expect(auth.agent).toMatchObject({ agentId: AGENT_ID, oid: AGENT_OID, active: true });
    expect(auth.agent.capabilities).toEqual(Object.keys(LAB_JOB_TYPES));
  });

  it('refuses a token for another principal, and an agent that was deactivated', async () => {
    const memory = memoryStore();
    const handlers = handlersOver(memory);
    await handlers.registerAgent(post({ agentId: AGENT_ID, oid: AGENT_OID }), context());

    const other = agentGuardOver(memory, OTHER_OID);
    expect((await other.guard.requireAgent(agentRequest({}), AGENT_ID)).error.status).toBe(403);
    expect(other.auditDenial).toHaveBeenCalledWith(expect.objectContaining({ reason: 'oid-mismatch' }));

    await handlers.setAgentActive(patch(AGENT_ID, { active: false }), context());
    const same = agentGuardOver(memory);
    expect((await same.guard.requireAgent(agentRequest({}), AGENT_ID)).error.status).toBe(403);
    expect(same.auditDenial).toHaveBeenCalledWith(expect.objectContaining({ reason: 'inactive' }));

    await handlers.setAgentActive(patch(AGENT_ID, { active: true }), context());
    expect((await agentGuardOver(memory).guard.requireAgent(agentRequest({}), AGENT_ID)).error).toBeNull();
  });

  it('the claim path claims only the job types the registration named', async () => {
    const memory = memoryStore();
    await handlersOver(memory).registerAgent(
      post({ agentId: AGENT_ID, oid: AGENT_OID, jobTypes: ['terraform-validate', 'shell-echo'] }),
      context()
    );

    const { guard } = agentGuardOver(memory);
    const claim = createLabAgentHandlers({ guard, store: memory.store, now: () => NOW });
    const res = await claim.claimLabJob(agentRequest({ agentId: AGENT_ID }), context());

    expect(res.status).toBe(200);
    const [container, , parameters] = memory.store.queryDocs.mock.calls[0];
    expect(container).toBe('lab_jobs');
    expect(parameters.find((p) => p.name === '@types').value).toEqual(['shell-echo', 'terraform-validate']);
  });

  it('the heartbeat lands on the registered document, which it could not create', async () => {
    const memory = memoryStore();
    const { guard } = agentGuardOver(memory);
    const agent = createLabAgentHandlers({ guard, store: memory.store, now: () => LATER });

    // Before registration: refused at gate 2, and nothing is written.
    expect((await agent.heartbeatAgent(agentRequest({ agentId: AGENT_ID }), context())).status).toBe(403);
    expect(memory.doc('lab_agents', AGENT_ID)).toBeNull();

    await handlersOver(memory).registerAgent(post({ agentId: AGENT_ID, oid: AGENT_OID }), context());
    const beat = await agent.heartbeatAgent(agentRequest({ agentId: AGENT_ID, hostname: 'srv1' }), context());
    expect(beat.status).toBe(200);
    expect(memory.doc('lab_agents', AGENT_ID)).toMatchObject({
      oid: AGENT_OID,
      active: true,
      hostname: 'srv1',
      lastSeenAt: LATER.toISOString(),
    });
  });
});
