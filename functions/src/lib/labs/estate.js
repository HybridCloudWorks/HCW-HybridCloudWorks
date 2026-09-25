/**
 * GET /api/public/labs/estate — "The Hybrid Lab right now" (#664, Phase 4 of
 * #656; ADR 0032 decision 3).
 *
 * The public, live view of the hybrid estate: the Arc-enabled lab host's state
 * as Azure sees it, its policy compliance, whether the `vps-agent` job runner
 * is heartbeating and how deep its queue is, and Coder's capacity from the
 * status proxy beside this module. Read by the Function App's managed identity
 * through Azure Resource Graph under a Reader grant on `rg-lab-hybrid-prod-cus`
 * alone (infra/lab-hybrid.tf) — the browser never sees Azure, and no new
 * credential exists anywhere in the path.
 *
 * Two shapes, both 200, each cached for a minute in `tool_service_cache`:
 *
 *   { configured: false }
 *       Resource Graph returned no Arc machine in the lab resource group —
 *       because the group does not exist yet, or exists and holds no machine.
 *       Both read the same to a visitor: the card says "not yet provisioned",
 *       and nothing is invented to fill it.
 *   { configured: true, arc, policy, agent, coder, asOf }
 *       arc    { status, lastHeartbeatAt, agentVersion, osName } — always present
 *       policy { compliant, nonCompliant } | null
 *       agent  { online, queued } | null      online: any lab agent heartbeating
 *       coder  { reachable, running, max } | null
 *
 * NULL MEANS UNKNOWN, NOT ZERO. The three side reads — policy, agent queue,
 * Coder — are independent of the Arc row and of each other, and one of them
 * failing must not sink the others or, worse, become a number. `policy` is
 * `{ compliant: 0, nonCompliant: 0 }` only when Resource Graph answered and
 * counted nothing; a failed policy query is `null`. The same rule applies to
 * `agent` (a store failure) and `coder` (its own module says unconfigured, or
 * threw).
 *
 * When the Arc read itself fails — ARM refused, the token could not be minted,
 * the call timed out — the route answers **503**, not `{ configured: false }`:
 * "we cannot see the estate" and "there is no estate" are different sentences
 * and the card should say the first. That 503 is cached for the same minute
 * as a success, so an outage never turns anonymous page loads into a stream
 * of management-plane calls.
 *
 * ABOUT `lastHeartbeatAt`. Azure Resource Manager exposes no heartbeat
 * timestamp on an Arc machine; the row's `properties.lastStatusChange` is the
 * time the agent's status last changed, and the agent's status becomes
 * Disconnected on its own once heartbeats stop. So the field is the moment
 * Azure last saw the machine change state — an honest "as of" for the status
 * beside it, and the closest the management plane offers. The Log Analytics
 * `Heartbeat` table would be exact, and would need a workspace grant this
 * route does not have (ADR 0032 decision 3 keeps the identity's reach to the
 * one resource group).
 *
 * The response names no host. The machine's `name` is its hostname, and the
 * queries here never project it: status, timestamps, an agent version and an
 * OS name are the entire disclosure, and each of those is already public on
 * the lab's pages by design.
 *
 * KQL, checked against the Resource Graph references on 2026-09-25 —
 * https://learn.microsoft.com/azure/azure-arc/servers/resource-graph-samples
 * (`properties.status`, `properties.osName`, `type =~
 * 'microsoft.hybridcompute/machines'`), the `@azure/arm-hybridcompute`
 * MachineProperties reference (`lastStatusChange`, `status`, `agentVersion`),
 * and https://learn.microsoft.com/azure/governance/policy/samples/resource-graph-samples
 * (`policyresources`, `microsoft.policyinsights/policystates`,
 * `tostring(properties.complianceState)`). String literals are single-quoted
 * throughout, as KQL requires.
 */

import { isAgentOnline } from '../labs.js';
import { createMinuteCache, MINUTE_CACHE_SECONDS } from './minute-cache.js';

export const ESTATE_CACHE_ID = 'labs:estate';
export const ESTATE_CACHE_SECONDS = MINUTE_CACHE_SECONDS;
/** Fixed by ADR 0032 decision 3 and created by infra/lab-hybrid.tf. */
export const LAB_RESOURCE_GROUP = 'rg-lab-hybrid-prod-cus';

/** The one Arc machine row the card is built from. Never projects `name`. */
export const ARC_MACHINE_QUERY = [
  'resources',
  `| where type =~ 'microsoft.hybridcompute/machines' and resourceGroup =~ '${LAB_RESOURCE_GROUP}'`,
  '| project status = tostring(properties.status), lastStatusChange = tostring(properties.lastStatusChange), agentVersion = tostring(properties.agentVersion), osName = tostring(properties.osName)',
  '| take 1',
].join(' ');

/** Policy state counts for resources in the lab group, one row per compliance state. */
export const POLICY_COMPLIANCE_QUERY = [
  'policyresources',
  `| where type =~ 'microsoft.policyinsights/policystates' and tostring(properties.resourceGroup) =~ '${LAB_RESOURCE_GROUP}'`,
  '| summarize count() by complianceState = tostring(properties.complianceState)',
].join(' ');

const json = (status, body, cacheSeconds = 0) => ({
  status,
  headers: {
    'Content-Type': 'application/json',
    ...(cacheSeconds > 0 ? { 'Cache-Control': `public, max-age=${cacheSeconds}` } : {}),
  },
  body: JSON.stringify(body),
});

const UNAVAILABLE = { status: 503, body: { error: 'Labs estate status is unavailable' } };

const toIsoOrNull = (value) => {
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const toTextOrNull = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** The card's `arc` block from one Resource Graph row. */
export function shapeArcRow(row) {
  return {
    status: toTextOrNull(row?.status),
    lastHeartbeatAt: toIsoOrNull(row?.lastStatusChange),
    agentVersion: toTextOrNull(row?.agentVersion),
    osName: toTextOrNull(row?.osName),
  };
}

/** `{ compliant, nonCompliant }` from the summarize rows; other states are neither. */
export function shapePolicyRows(rows) {
  const totals = { compliant: 0, nonCompliant: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    const count = Number(row?.count_);
    if (!Number.isFinite(count)) continue;
    const state = String(row?.complianceState ?? '').toLowerCase();
    if (state === 'compliant') totals.compliant += count;
    else if (state === 'noncompliant') totals.nonCompliant += count;
  }
  return totals;
}

/**
 * @param {object} deps
 * @param {{ readDoc: Function, upsertDoc: Function, queryDocs: Function }} deps.store
 * @param {{ query: (kql: string) => Promise<object[]> }} deps.arm - Resource Graph (resource-graph.js)
 * @param {{ readStatus: (context: object) => Promise<object> }} deps.coderStatus - coder-status.js
 * @param {() => number} [deps.now] - epoch ms
 */
export function createEstateHandlers({ store, arm, coderStatus, now = () => Date.now() }) {
  const cache = createMinuteCache({
    store,
    id: ESTATE_CACHE_ID,
    kind: 'labs-estate',
    now,
    seconds: ESTATE_CACHE_SECONDS,
  });

  /** { kind: 'present', arc } | { kind: 'absent' } | { kind: 'unavailable' } */
  async function readArc(context) {
    try {
      const rows = await arm.query(ARC_MACHINE_QUERY);
      if (!Array.isArray(rows) || rows.length === 0) return { kind: 'absent' };
      return { kind: 'present', arc: shapeArcRow(rows[0]) };
    } catch (error) {
      // No subscription to scope the read to: a local or test process. There is
      // no estate this process could see, and the reason is not an outage.
      if (error?.code === 'ARG_UNSCOPED') return { kind: 'absent' };
      context?.warn?.(`labs-estate: Arc read failed: ${error?.message ?? error}`);
      return { kind: 'unavailable' };
    }
  }

  async function readPolicy(context) {
    try {
      return shapePolicyRows(await arm.query(POLICY_COMPLIANCE_QUERY));
    } catch (error) {
      context?.warn?.(`labs-estate: policy read failed: ${error?.message ?? error}`);
      return null;
    }
  }

  /** The same two reads getLabsSnapshot makes (lib/labs.js), reduced to a boolean and a count. */
  async function readAgent(context) {
    try {
      const [agents, queued] = await Promise.all([
        store.queryDocs('lab_agents', 'SELECT TOP 200 c.lastSeenAt FROM c', []),
        store.queryDocs('lab_jobs', "SELECT VALUE COUNT(1) FROM c WHERE c.status = 'queued'", []),
      ]);
      const nowMs = now();
      return {
        online: (Array.isArray(agents) ? agents : []).some((a) => isAgentOnline(a?.lastSeenAt, nowMs)),
        queued: Number(queued?.[0]) || 0,
      };
    } catch (error) {
      context?.warn?.(`labs-estate: agent read failed: ${error?.message ?? error}`);
      return null;
    }
  }

  async function readCoder(context) {
    try {
      const status = await coderStatus.readStatus(context);
      if (!status?.configured) return null;
      return {
        reachable: status.reachable === true,
        running: Number.isInteger(status.capacity?.running) ? status.capacity.running : null,
        max: Number.isInteger(status.capacity?.max) ? status.capacity.max : null,
      };
    } catch (error) {
      context?.warn?.(`labs-estate: Coder read failed: ${error?.message ?? error}`);
      return null;
    }
  }

  /** The `{ status, body }` the route answers with, built live. */
  async function buildEstate(context) {
    const machine = await readArc(context);
    if (machine.kind === 'unavailable') return UNAVAILABLE;
    if (machine.kind === 'absent') return { status: 200, body: { configured: false } };

    const [policy, agent, coder] = await Promise.all([
      readPolicy(context),
      readAgent(context),
      readCoder(context),
    ]);

    return {
      status: 200,
      body: {
        configured: true,
        arc: machine.arc,
        policy,
        agent,
        coder,
        asOf: new Date(now()).toISOString(),
      },
    };
  }

  return {
    /** GET /api/public/labs/estate */
    async getEstate(request, context) {
      try {
        let result = await cache.read(context);
        if (!result) {
          result = await buildEstate(context);
          await cache.write(result, context);
        }
        return json(result.status, result.body, result.status === 200 ? ESTATE_CACHE_SECONDS : 0);
      } catch (error) {
        context.error('publicGetLabsEstate failed:', error);
        return json(500, { error: 'Failed to read the labs estate' });
      }
    },
  };
}
