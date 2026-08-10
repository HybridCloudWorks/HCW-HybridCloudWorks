/**
 * The production composition of the Labs agent guard: real token verifier,
 * real Cosmos lookups, real audit sink. Mirrors default-guard.js, including
 * its lazy initialisation — createTokenVerifier throws without
 * ENTRA_TENANT_ID / ENTRA_API_AUDIENCE, and composing it at import time would
 * take the whole Function App down at cold start.
 *
 * The verifier is the same one the admin guard uses: same tenant, same API
 * audience. What separates an agent from an admin is not the token issuer but
 * the App Role in the token and the registry it is checked against — see
 * require-agent.js.
 */
import { randomUUID } from 'node:crypto';
import { createTokenVerifier } from './verify-token.js';
import { createAgentGuard } from './require-agent.js';
import { readDoc, upsertDoc } from '../cosmos-client.js';

let guard = null;

export function getDefaultAgentGuard() {
  if (guard) return guard;
  guard = createAgentGuard({
    verifier: createTokenVerifier({
      tenantId: process.env.ENTRA_TENANT_ID,
      audience: process.env.ENTRA_API_AUDIENCE,
    }),
    // lab_agents is partitioned on /id, and /agentId is identical to /id by
    // construction (infra/main.tf partition-key rationale).
    lookupAgent: (agentId) => readDoc('lab_agents', agentId, agentId),
    auditDenial: (entry) =>
      upsertDoc('admin_audit_logs', {
        id: randomUUID(),
        kind: 'agent-auth-denial',
        at: new Date().toISOString(),
        ...entry,
      }),
  });
  return guard;
}

/** Test seam: drop the memoised guard so env changes take effect. */
export function resetDefaultAgentGuard() {
  guard = null;
}
