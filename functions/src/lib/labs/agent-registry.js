/**
 * The lab agent registry's write path (#740): `POST cms/labs/agents` and
 * `PATCH cms/labs/agents/{agentId}`.
 *
 * The agent guard's second gate (auth/require-agent.js) admits a lab agent
 * only when `lab_agents/{agentId}` names it, and until this module nothing
 * could write that container: no route, a read-only Labs page, and a Cosmos
 * firewall that admits only the Function App's subnet. So the agent
 * authenticated and was refused with "Agent access required", and
 * scripts/lab/Register-LabAgent.ps1 could only print the document it needed.
 *
 * ===========================================================================
 * THE DOCUMENT, AS ITS READERS READ IT
 * ===========================================================================
 *
 *   id            the agent id. lab_agents is partitioned on /id, and every
 *                 reader point-reads it as (agentId, agentId):
 *                 default-agent-guard.js, lab-agent.js's heartbeat patch
 *   agentId       the same value (infra/main.tf's partition-key rationale);
 *                 timers/agent-health.js reads `agentId || id`
 *   oid           the agent service principal's object id, which is the `oid`
 *                 claim of its app-only token. require-agent.js compares it
 *                 with `!==`, and Entra writes that claim in lower case, so it
 *                 is stored lower-cased: an upper-case paste would otherwise
 *                 be an oid-mismatch that looks exactly like a missing grant
 *   active        `true` or `false`, never anything else: the guard admits
 *                 only `active === true`
 *   capabilities  the job types the agent may claim. The claim path reads it
 *                 from here and never from the request (lab-agent.js), and
 *                 public-submit.js reads it to decide whether anything online
 *                 can run a public job. Validated against LAB_JOB_TYPES and
 *                 stored in that table's order, so a re-registration with the
 *                 same set in another order is not a change
 *   registeredAt, updatedAt, updatedBy
 *                 when, and which admin's object id. Identifiers, not secrets
 *
 * The heartbeat's fields (hostname, version, status, activeJobs, lastSeenAt)
 * live in the same document and are never written here: an existing document
 * is PATCHED with the registry fields only, so a registration never rewinds a
 * heartbeat that landed in between. Nothing secret is stored, because nothing
 * secret is accepted: the body is exactly { agentId, oid, jobTypes? } and any
 * other key is a 400, not dropped, so a credential pasted into the wrong field
 * cannot reach the container.
 *
 * ===========================================================================
 * WHO MAY WRITE IT
 * ===========================================================================
 * `editor`, the role the other Labs writes require (enqueueLabJob,
 * cancelLabJob). That is enough because this is gate 2 of two, not the whole
 * grant. Gate 1 is the LabAgent app role, which only a tenant administrator
 * can assign (Register-LabAgent.ps1 does it as the owner), so a registry row
 * can bind an agent id only to a principal the tenant already trusts as an
 * agent; it can never mint an agent credential. What an editor can do here,
 * rebind or deactivate an agent, is audited like every other admin mutation.
 *
 * ===========================================================================
 * IDEMPOTENT, AND A REVOCATION STAYS REVOKED
 * ===========================================================================
 * POST creates the document active, or updates `oid` and `capabilities` on
 * one that exists. It does NOT reactivate a deactivated agent: re-running the
 * go-live, or pasting the same values again, must not quietly undo a
 * revocation. Only `PATCH { active: true }` does that, so turning an agent
 * back on is always its own audited act. A POST that changes nothing writes
 * nothing, document or audit row, and answers `changed: false`.
 */
import { randomUUID } from 'node:crypto';
import { LAB_JOB_TYPES } from '../labs.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const CONTAINER = 'lab_agents';

/** The role every write here requires: the level of the other Labs writes. */
export const LAB_AGENT_REGISTRY_ROLE = 'editor';

/**
 * An agent id the way the host spells it: `labs_agent_id`, the certificate's
 * CN, `Test-LabAgentId` in Register-LabAgent.ps1. Lower-case letters, digits
 * and hyphens, 1 to 63 characters, starting and ending with a letter or digit.
 * JavaScript's `$` without the `m` flag matches only at the end of the input,
 * so a trailing newline is refused rather than stored.
 */
export const LAB_AGENT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** An Entra object id: a GUID in its 8-4-4-4-12 form, and nothing else. */
export const OBJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What an agent may claim when the registration names no job types: every
 * LAB_JOB_TYPES entry. scripts/lab-job-types.test.mjs holds that table equal
 * to the agent's own CAPABILITIES (vps-agent/lib/capabilities.js), so this is
 * every type the host has a recipe for.
 */
export const DEFAULT_AGENT_JOB_TYPES = Object.freeze(Object.keys(LAB_JOB_TYPES));

const REGISTER_KEYS = new Set(['agentId', 'oid', 'jobTypes']);
const ACTIVATE_KEYS = new Set(['active']);

/** A body of three short fields; anything near this is not a registration. */
const MAX_BODY_JSON = 4096;

const AGENT_ID_RULE =
  'agentId must be the CN of the agent certificate, such as vps-hostinger-01: lower-case letters, digits and hyphens, at most 63 characters, starting and ending with a letter or digit';
const OID_RULE =
  'oid must be the object id of the agent service principal, a GUID such as 00000000-0000-0000-0000-000000000000 (Register-LabAgent.ps1 prints it)';

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Keys the body carries that the route does not accept, or an empty list. */
const unknownKeys = (body, allowed) => Object.keys(body).filter((key) => !allowed.has(key));

/** The parsed body, or `{ error }` for anything that is not a small JSON object. */
async function readBody(request, allowed) {
  const body = await request.json().catch(() => null);
  if (!isPlainObject(body) || JSON.stringify(body).length > MAX_BODY_JSON) {
    return { error: 'Body must be a JSON object' };
  }
  const extra = unknownKeys(body, allowed);
  if (extra.length > 0) {
    return { error: `Unknown field(s): ${extra.join(', ')}. Allowed: ${[...allowed].join(', ')}` };
  }
  return { body };
}

/** A trimmed agent id, or null when it is not one. */
export function parseAgentId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return LAB_AGENT_ID_PATTERN.test(id) ? id : null;
}

/** A lower-cased object id, or null when it is not a GUID. */
export function parseObjectId(value) {
  const oid = typeof value === 'string' ? value.trim() : '';
  return OBJECT_ID_PATTERN.test(oid) ? oid.toLowerCase() : null;
}

/**
 * The job types in LAB_JOB_TYPES order, or `{ error }`.
 *
 * Omitted means all of them. An empty list is refused rather than stored: an
 * agent that may claim nothing still heartbeats and looks healthy, and the way
 * to stop an agent claiming work is to deactivate it, which says so.
 */
export function parseJobTypes(value) {
  if (value === undefined) return { jobTypes: [...DEFAULT_AGENT_JOB_TYPES] };
  if (!Array.isArray(value) || value.some((type) => typeof type !== 'string')) {
    return { error: 'jobTypes must be a list of job type names' };
  }
  const unknown = value.filter((type) => !Object.hasOwn(LAB_JOB_TYPES, type));
  if (unknown.length > 0) {
    return {
      error: `Unknown job type(s): ${unknown.join(', ')}. Allowed: ${DEFAULT_AGENT_JOB_TYPES.join(', ')}`,
    };
  }
  if (value.length === 0) {
    return {
      error:
        'jobTypes must name at least one job type. Omit it for all of them; deactivate the agent to stop it claiming work',
    };
  }
  const chosen = new Set(value);
  return { jobTypes: DEFAULT_AGENT_JOB_TYPES.filter((type) => chosen.has(type)) };
}

/** `{ agentId, oid, jobTypes }` from a POST body, or `{ error }`. */
export function parseRegistration(body) {
  const agentId = parseAgentId(body.agentId);
  if (!agentId) return { error: AGENT_ID_RULE };
  const oid = parseObjectId(body.oid);
  if (!oid) return { error: OID_RULE };
  const { jobTypes, error } = parseJobTypes(body.jobTypes);
  if (error) return { error };
  return { value: { agentId, oid, jobTypes } };
}

const sameList = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The registry fields a POST would change on an existing document, or an
 * empty object when it already says exactly this.
 */
export function registryChanges(existing, { agentId, oid, jobTypes }) {
  const changes = {};
  if (existing.agentId !== agentId) changes.agentId = agentId;
  if (existing.oid !== oid) changes.oid = oid;
  if (!sameList(existing.capabilities, jobTypes)) changes.capabilities = jobTypes;
  return changes;
}

/**
 * The stored document as the API answers it: every field but Cosmos's own
 * `_rid`, `_self`, `_etag`, `_attachments` and `_ts`.
 */
export function presentAgent(doc) {
  return Object.fromEntries(Object.entries(doc || {}).filter(([key]) => !key.startsWith('_')));
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function, createDoc: Function, patchDoc: Function, upsertDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createAgentRegistryHandlers({ guard, store, now = () => new Date(), uuid = randomUUID }) {
  /**
   * One admin_audit_logs row, the shape platform-settings.js writes. Best
   * effort, as there: the registry is already written, so a failed audit row
   * must not become a 500 that makes the page report a failure (and the owner
   * retry) for a write that took.
   */
  async function audit(request, context, user, action, details) {
    try {
      await store.upsertDoc('admin_audit_logs', {
        id: uuid(),
        action,
        userId: user?.oid || user?.sub || null,
        userName: user?.name || null,
        userEmail: user?.email || user?.preferred_username || null,
        timestamp: now().toISOString(),
        details,
        userAgent: request.headers?.get?.('user-agent') || null,
        compliance: { schemaVersion: 1, detailsSanitized: true, identityVerified: true },
      });
    } catch (error) {
      context.warn?.(`${action} for ${details.agentId} saved but the audit row failed: ${error?.message || error}`);
    }
  }

  const actorOf = (user) => user?.oid || user?.sub || null;

  /** A new document, active, written with create so a racing POST has a loser. */
  async function createAgent(request, context, user, value) {
    const at = now().toISOString();
    const doc = {
      id: value.agentId,
      agentId: value.agentId,
      oid: value.oid,
      active: true,
      capabilities: value.jobTypes,
      registeredAt: at,
      updatedAt: at,
      updatedBy: actorOf(user),
    };
    try {
      const stored = await store.createDoc(CONTAINER, doc);
      await audit(request, context, user, 'lab_agent_registered', {
        agentId: value.agentId,
        oid: value.oid,
        capabilities: value.jobTypes,
        active: true,
      });
      return json(201, { ok: true, created: true, changed: true, agent: presentAgent(stored || doc) });
    } catch (error) {
      if (error?.code !== 409) throw error;
      return json(409, {
        ok: false,
        error: `${value.agentId} was registered by another request at the same moment. Submit again to update it.`,
      });
    }
  }

  /** The registry fields on an existing document, and nothing else. */
  async function updateAgent(request, context, user, existing, value) {
    const changes = registryChanges(existing, value);
    if (Object.keys(changes).length === 0) {
      return json(200, { ok: true, created: false, changed: false, agent: presentAgent(existing) });
    }
    const stored = await store.patchDoc(
      CONTAINER,
      value.agentId,
      { ...changes, updatedAt: now().toISOString(), updatedBy: actorOf(user) },
      { partitionKey: value.agentId }
    );
    await audit(request, context, user, 'lab_agent_updated', {
      agentId: value.agentId,
      oid: value.oid,
      previousOid: existing.oid ?? null,
      capabilities: value.jobTypes,
      previousCapabilities: Array.isArray(existing.capabilities) ? existing.capabilities : null,
      active: existing.active === true,
    });
    return json(200, { ok: true, created: false, changed: true, agent: presentAgent(stored) });
  }

  /** POST /api/cms/labs/agents — { agentId, oid, jobTypes? }. */
  async function registerAgent(request, context) {
    const auth = await guard.requireRole(request, LAB_AGENT_REGISTRY_ROLE);
    if (auth.error) return auth.error;

    const { body, error } = await readBody(request, REGISTER_KEYS);
    if (error) return json(400, { ok: false, error });
    const parsed = parseRegistration(body);
    if (parsed.error) return json(400, { ok: false, error: parsed.error });

    try {
      const existing = await store.readDoc(CONTAINER, parsed.value.agentId, parsed.value.agentId);
      if (!existing) return await createAgent(request, context, auth.user, parsed.value);
      return await updateAgent(request, context, auth.user, existing, parsed.value);
    } catch (err) {
      context.error(`registerLabAgent(${parsed.value.agentId}) failed: ${err?.message || err}`);
      return json(500, { ok: false, error: 'Failed to register the lab agent' });
    }
  }

  /** PATCH /api/cms/labs/agents/{agentId} — { active }. */
  async function setAgentActive(request, context) {
    const auth = await guard.requireRole(request, LAB_AGENT_REGISTRY_ROLE);
    if (auth.error) return auth.error;

    const agentId = parseAgentId(request.params?.agentId);
    if (!agentId) return json(400, { ok: false, error: AGENT_ID_RULE });
    const { body, error } = await readBody(request, ACTIVATE_KEYS);
    if (error) return json(400, { ok: false, error });
    if (typeof body.active !== 'boolean') {
      return json(400, { ok: false, error: 'active must be true or false' });
    }

    try {
      const existing = await store.readDoc(CONTAINER, agentId, agentId);
      if (!existing) return json(404, { ok: false, error: `No lab agent ${agentId} is registered` });
      if (existing.active === body.active) {
        return json(200, { ok: true, changed: false, agent: presentAgent(existing) });
      }
      const stored = await store.patchDoc(
        CONTAINER,
        agentId,
        { active: body.active, updatedAt: now().toISOString(), updatedBy: actorOf(auth.user) },
        { partitionKey: agentId }
      );
      await audit(request, context, auth.user, body.active ? 'lab_agent_activated' : 'lab_agent_deactivated', {
        agentId,
        oid: existing.oid ?? null,
        active: body.active,
      });
      return json(200, { ok: true, changed: true, agent: presentAgent(stored) });
    } catch (err) {
      context.error(`setLabAgentActive(${agentId}) failed: ${err?.message || err}`);
      return json(500, { ok: false, error: 'Failed to update the lab agent' });
    }
  }

  return { registerAgent, setAgentActive };
}
