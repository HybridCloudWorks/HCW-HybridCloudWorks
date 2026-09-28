/**
 * What the lab agent registry routes accept, and the document they write
 * (#740). Pure: no store, no guard, no clock, so each rule is testable on its
 * own. The handlers that apply them are agent-registry.js.
 *
 * The rules are the readers' rules, not new ones. The agent id is the shape
 * the host gives it (`labs_agent_id`, the certificate CN, `Test-LabAgentId` in
 * Register-LabAgent.ps1). The object id is lower-cased because
 * require-agent.js compares it with the token's `oid` claim by `!==` and Entra
 * writes that claim in lower case. The job types are LAB_JOB_TYPES, in that
 * table's order, because the claim path hands them to the job query as they
 * are stored.
 *
 * Bodies are exact: a key the route does not name is a 400, not dropped, so
 * a credential pasted into the wrong field cannot reach the container.
 */
import { LAB_JOB_TYPES } from '../labs.js';

/** The role every registry write requires: the level of the other Labs writes. */
export const LAB_AGENT_REGISTRY_ROLE = 'editor';

/**
 * An agent id the way the host spells it: lower-case letters, digits and
 * hyphens, 1 to 63 characters, starting and ending with a letter or digit.
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

export const AGENT_ID_RULE =
  'agentId must be the CN of the agent certificate, such as vps-hostinger-01: lower-case letters, digits and hyphens, at most 63 characters, starting and ending with a letter or digit';
const OID_RULE =
  'oid must be the object id of the agent service principal, a GUID such as 00000000-0000-0000-0000-000000000000 (Register-LabAgent.ps1 prints it)';
const EMPTY_JOB_TYPES_RULE =
  'jobTypes must name at least one job type. Omit it for all of them; deactivate the agent to stop it claiming work';

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The parsed body, or `{ error }` for anything that is not a small JSON object. */
async function readBody(request, allowed) {
  const body = await request.json().catch(() => null);
  if (!isPlainObject(body) || JSON.stringify(body).length > MAX_BODY_JSON) {
    return { error: 'Body must be a JSON object' };
  }
  const extra = Object.keys(body).filter((key) => !allowed.has(key));
  return extra.length > 0
    ? { error: `Unknown field(s): ${extra.join(', ')}. Allowed: ${[...allowed].join(', ')}` }
    : { body };
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

/** Why a supplied job type list cannot be stored, or null when it can. */
function jobTypesError(value) {
  if (!Array.isArray(value) || value.some((type) => typeof type !== 'string')) {
    return 'jobTypes must be a list of job type names';
  }
  const unknown = value.filter((type) => !Object.hasOwn(LAB_JOB_TYPES, type));
  if (unknown.length > 0) {
    return `Unknown job type(s): ${unknown.join(', ')}. Allowed: ${DEFAULT_AGENT_JOB_TYPES.join(', ')}`;
  }
  // Refused rather than stored: an agent that may claim nothing still
  // heartbeats and looks healthy, and deactivating is the way to stop one.
  return value.length === 0 ? EMPTY_JOB_TYPES_RULE : null;
}

/**
 * The job types in LAB_JOB_TYPES order, deduplicated, or `{ error }`.
 * Omitted means all of them.
 */
export function parseJobTypes(value) {
  if (value === undefined) return { jobTypes: [...DEFAULT_AGENT_JOB_TYPES] };
  const error = jobTypesError(value);
  if (error) return { error };
  const chosen = new Set(value);
  return { jobTypes: DEFAULT_AGENT_JOB_TYPES.filter((type) => chosen.has(type)) };
}

/** `{ value: { agentId, oid, jobTypes } }` from a POST body, or `{ error }`. */
export function parseRegistration(body) {
  const agentId = parseAgentId(body.agentId);
  const oid = parseObjectId(body.oid);
  const jobs = parseJobTypes(body.jobTypes);
  const error = (!agentId && AGENT_ID_RULE) || (!oid && OID_RULE) || jobs.error;
  return error ? { error } : { value: { agentId, oid, jobTypes: jobs.jobTypes } };
}

/** POST cms/labs/agents: the registration, or `{ error }` for a 400. */
export async function readRegistration(request) {
  const { body, error } = await readBody(request, REGISTER_KEYS);
  return error ? { error } : parseRegistration(body);
}

/** PATCH cms/labs/agents/{agentId}: `{ value: { agentId, active } }`, or `{ error }`. */
export async function readActivation(request) {
  const agentId = parseAgentId(request.params?.agentId);
  if (!agentId) return { error: AGENT_ID_RULE };
  const { body, error } = await readBody(request, ACTIVATE_KEYS);
  if (error) return { error };
  return typeof body.active === 'boolean'
    ? { value: { agentId, active: body.active } }
    : { error: 'active must be true or false' };
}

/**
 * DELETE cms/labs/agents/{agentId}: `{ value: { agentId } }`, or `{ error }`.
 * The agent id is the whole request; no body is read.
 */
export async function readRemoval(request) {
  const agentId = parseAgentId(request.params?.agentId);
  return agentId ? { value: { agentId } } : { error: AGENT_ID_RULE };
}

/**
 * The audit row's details for a removed document: enough to say which agent
 * it was and when it was last heard from, since the document itself is gone.
 * `agentId || id` because that is how timers/agent-health.js reads it.
 */
export function removalDetails(doc) {
  return {
    agentId: doc.agentId || doc.id,
    oid: doc.oid ?? null,
    lastSeenAt: doc.lastSeenAt ?? null,
    version: doc.version ?? null,
  };
}

const sameList = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The registry fields a POST would change on an existing document, or an
 * empty object when it already says exactly this. Never `active`: only the
 * PATCH changes that, so a registration cannot undo a revocation.
 */
export function registryChanges(existing, { agentId, oid, jobTypes }) {
  const changes = {};
  if (existing.agentId !== agentId) changes.agentId = agentId;
  if (existing.oid !== oid) changes.oid = oid;
  if (!sameList(existing.capabilities, jobTypes)) changes.capabilities = jobTypes;
  return changes;
}

/**
 * A new registry document. `id` and `agentId` are the same value, as every
 * reader expects (default-agent-guard.js point-reads (agentId, agentId);
 * timers/agent-health.js reads `agentId || id`).
 */
export function newAgentDocument({ agentId, oid, jobTypes }, at, updatedBy) {
  return {
    id: agentId,
    agentId,
    oid,
    active: true,
    capabilities: jobTypes,
    registeredAt: at,
    updatedAt: at,
    updatedBy,
  };
}

/**
 * The stored document as the API answers it: every field but Cosmos's own
 * `_rid`, `_self`, `_etag`, `_attachments` and `_ts`.
 */
export function presentAgent(doc) {
  return Object.fromEntries(Object.entries(doc || {}).filter(([key]) => !key.startsWith('_')));
}
