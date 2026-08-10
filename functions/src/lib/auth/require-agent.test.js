/**
 * The agent guard. The load-bearing assertions are the negative ones: this
 * guard is the entire authorization boundary for a credential that lives on a
 * third-party VPS, and every denial must happen before any write.
 */
import { describe, it, expect, vi } from 'vitest';
import { createAgentGuard, ENTRA_LAB_AGENT_APP_ROLE } from './require-agent.js';

const AGENT_OID = '11111111-1111-1111-1111-111111111111';
const OTHER_OID = '22222222-2222-2222-2222-222222222222';

const request = (token = 'good') => ({
  headers: { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : null) },
});

const verifier = (claims = {}) => ({
  verify: vi.fn(async (token) => {
    if (token !== 'good') throw new Error('bad token');
    return { oid: AGENT_OID, roles: [ENTRA_LAB_AGENT_APP_ROLE], ...claims };
  }),
});

const record = (over = {}) => ({
  oid: AGENT_OID,
  active: true,
  capabilities: ['shell-echo'],
  ...over,
});

const guardWith = ({ claims, agentRecord = record(), lookup } = {}) => {
  const lookupAgent = lookup || vi.fn(async () => agentRecord);
  const auditDenial = vi.fn();
  return {
    guard: createAgentGuard({ verifier: verifier(claims), lookupAgent, auditDenial }),
    lookupAgent,
    auditDenial,
  };
};

describe('construction', () => {
  it('refuses to build without its dependencies', () => {
    expect(() => createAgentGuard({ lookupAgent: vi.fn() })).toThrow(/verifier/);
    expect(() => createAgentGuard({ verifier: {} })).toThrow(/lookupAgent/);
  });
});

describe('authentication', () => {
  it('401s with no bearer token, without reading the registry', async () => {
    const { guard, lookupAgent } = guardWith();
    const res = await guard.requireAgent({ headers: { get: () => null } }, 'vps-1');

    expect(res.error.status).toBe(401);
    expect(lookupAgent).not.toHaveBeenCalled();
  });

  it('401s on an unverifiable token, without reading the registry', async () => {
    const { guard, lookupAgent, auditDenial } = guardWith();
    const res = await guard.requireAgent(request('forged'), 'vps-1');

    expect(res.error.status).toBe(401);
    expect(lookupAgent).not.toHaveBeenCalled();
    expect(auditDenial).toHaveBeenCalled();
  });
});

describe('gate 1 — the App Role', () => {
  it('403s without the LabAgent role, without reading the registry', async () => {
    const { guard, lookupAgent } = guardWith({ claims: { roles: [] } });
    const res = await guard.requireAgent(request(), 'vps-1');

    expect(res.error.status).toBe(403);
    expect(lookupAgent).not.toHaveBeenCalled();
  });

  it('does not accept the admin App Role as a substitute', async () => {
    // The two guards are disjoint on purpose: an admin session must not be
    // able to write job results attributed to an agent.
    const { guard, lookupAgent } = guardWith({ claims: { roles: ['Admin'] } });
    const res = await guard.requireAgent(request(), 'vps-1');

    expect(res.error.status).toBe(403);
    expect(lookupAgent).not.toHaveBeenCalled();
  });
});

describe('gate 2 — the registry binding', () => {
  it('admits a registered, active agent whose oid matches', async () => {
    const { guard } = guardWith();
    const res = await guard.requireAgent(request(), 'vps-1');

    expect(res.error).toBeNull();
    expect(res.agent.agentId).toBe('vps-1');
    expect(res.agent.capabilities).toEqual(['shell-echo']);
  });

  it('400s when no agentId is supplied — there is no default agent', async () => {
    const { guard, lookupAgent } = guardWith();
    const res = await guard.requireAgent(request(), '   ');

    expect(res.error.status).toBe(400);
    expect(lookupAgent).not.toHaveBeenCalled();
  });

  it('403s for an unregistered agentId', async () => {
    const { guard } = guardWith({ lookup: vi.fn(async () => null) });
    const res = await guard.requireAgent(request(), 'ghost');

    expect(res.error.status).toBe(403);
  });

  it('403s for a revoked agent', async () => {
    const { guard } = guardWith({ agentRecord: record({ active: false }) });
    const res = await guard.requireAgent(request(), 'vps-1');

    expect(res.error.status).toBe(403);
  });

  it('403s when the token oid does not own the claimed agentId', async () => {
    // Without this, any holder of a LabAgent token could claim another host's
    // jobs or forge its results.
    const { guard, auditDenial } = guardWith({ agentRecord: record({ oid: OTHER_OID }) });
    const res = await guard.requireAgent(request(), 'vps-1');

    expect(res.error.status).toBe(403);
    expect(auditDenial).toHaveBeenCalledWith(expect.objectContaining({ reason: 'oid-mismatch' }));
  });

  it('reveals nothing about which gate failed', async () => {
    // Unregistered, revoked and mis-bound all answer identically, so the
    // response cannot be used to enumerate agent ids.
    const bodies = [];
    for (const setup of [
      { lookup: vi.fn(async () => null) },
      { agentRecord: record({ active: false }) },
      { agentRecord: record({ oid: OTHER_OID }) },
    ]) {
      const { guard } = guardWith(setup);
      const res = await guard.requireAgent(request(), 'vps-1');
      bodies.push(res.error.body);
    }
    expect(new Set(bodies).size).toBe(1);
  });
});

describe('revocation', () => {
  it('reads the registry on every call — no cache between revoke and effect', async () => {
    const lookup = vi.fn(async () => record());
    const { guard } = guardWith({ lookup });

    await guard.requireAgent(request(), 'vps-1');
    await guard.requireAgent(request(), 'vps-1');
    await guard.requireAgent(request(), 'vps-1');

    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it('propagates a lookup failure rather than falling back to the token', async () => {
    const lookup = vi.fn(async () => {
      throw new Error('cosmos unavailable');
    });
    const { guard } = guardWith({ lookup });

    await expect(guard.requireAgent(request(), 'vps-1')).rejects.toThrow(/cosmos unavailable/);
  });
});
