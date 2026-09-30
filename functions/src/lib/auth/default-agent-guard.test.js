/**
 * The production wiring of the LabAgent guard (#817).
 *
 * Every other test mocks this module away (route-inventory.test.js,
 * api-contract.test.js), so what it composes had never been checked: that it
 * builds nothing at import (the verifier throws without its settings, and
 * building it at import would take the Function App down at cold start), that
 * it builds once, and that the registry lookup and the denial audit write to
 * the containers the rest of the platform reads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createTokenVerifier = vi.fn((options) => ({ kind: 'verifier', options }));
const createAgentGuard = vi.fn((deps) => ({ kind: 'guard', deps }));
const readDoc = vi.fn(async () => ({ id: 'agent-1' }));
const upsertDoc = vi.fn(async (_c, doc) => doc);

vi.mock('./verify-token.js', () => ({ createTokenVerifier: (o) => createTokenVerifier(o) }));
vi.mock('./require-agent.js', () => ({ createAgentGuard: (d) => createAgentGuard(d) }));
vi.mock('../cosmos-client.js', () => ({
  readDoc: (...args) => readDoc(...args),
  upsertDoc: (...args) => upsertDoc(...args),
}));

const { getDefaultAgentGuard, resetDefaultAgentGuard } = await import('./default-agent-guard.js');

beforeEach(() => {
  resetDefaultAgentGuard();
  createTokenVerifier.mockClear();
  createAgentGuard.mockClear();
  readDoc.mockClear();
  upsertDoc.mockClear();
});

describe('getDefaultAgentGuard', () => {
  it('builds nothing at import, only on first use', () => {
    expect(createTokenVerifier).not.toHaveBeenCalled();
    expect(createAgentGuard).not.toHaveBeenCalled();
  });

  it('builds the verifier from the same tenant and audience as the admin guard, once', () => {
    process.env.ENTRA_TENANT_ID = 'tenant-1';
    process.env.ENTRA_API_AUDIENCE = 'api://audience-1';
    const first = getDefaultAgentGuard();
    const second = getDefaultAgentGuard();

    expect(second).toBe(first);
    expect(createAgentGuard).toHaveBeenCalledTimes(1);
    expect(createTokenVerifier).toHaveBeenCalledWith({ tenantId: 'tenant-1', audience: 'api://audience-1' });
  });

  it('looks an agent up in lab_agents, partitioned on its own id', async () => {
    const { deps } = getDefaultAgentGuard();
    await deps.lookupAgent('vps-hostinger-01');
    expect(readDoc).toHaveBeenCalledWith('lab_agents', 'vps-hostinger-01', 'vps-hostinger-01');
  });

  it('audits a denial into admin_audit_logs as an agent-auth-denial', async () => {
    const { deps } = getDefaultAgentGuard();
    await deps.auditDenial({ reason: 'unknown agent', agentId: 'x' });

    const [container, doc] = upsertDoc.mock.calls[0];
    expect(container).toBe('admin_audit_logs');
    expect(doc).toMatchObject({ kind: 'agent-auth-denial', reason: 'unknown agent', agentId: 'x' });
    expect(doc.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(doc.at))).toBe(false);
  });

  it('builds again after a reset, so a settings change takes effect', () => {
    getDefaultAgentGuard();
    resetDefaultAgentGuard();
    getDefaultAgentGuard();
    expect(createAgentGuard).toHaveBeenCalledTimes(2);
  });
});
