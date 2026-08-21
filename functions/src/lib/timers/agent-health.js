/**
 * agent-health.js — `checkAgentHealth`, every 5 minutes (T-401).
 *
 * The Labs VPS agent heartbeats every 30 s (lib/lab-agent.js writes
 * `lastSeenAt`). An agent whose last heartbeat is older than STALE_AFTER_MS —
 * the same 90 s (three missed beats) the Labs snapshot uses to draw the
 * "connected" indicator — is marked `offline`, with `offlineSince` so the
 * admin page can say how long. Partition key is the agent id.
 */

export const STALE_AFTER_MS = 90 * 1000;

export function createAgentHealthCheck({ store, now = () => new Date(), log = {} }) {
  async function run() {
    const at = now();
    const cutoff = new Date(at.getTime() - STALE_AFTER_MS).toISOString();
    const stale = await store.queryDocs(
      'lab_agents',
      "SELECT TOP 100 c.id, c.agentId, c.status, c.lastSeenAt FROM c WHERE c.status != 'offline' AND (NOT IS_DEFINED(c.lastSeenAt) OR c.lastSeenAt = null OR c.lastSeenAt < @cutoff)",
      [{ name: '@cutoff', value: cutoff }]
    );
    const marked = [];
    for (const agent of stale || []) {
      const agentId = agent.agentId || agent.id;
      await store.patchDoc(
        'lab_agents',
        agentId,
        { status: 'offline', offlineSince: at.toISOString() },
        { partitionKey: agentId }
      );
      marked.push(agentId);
    }
    log.log?.(`[checkAgentHealth] ${marked.length} agent(s) marked offline`);
    return { markedOffline: marked.length, agentIds: marked };
  }
  return { run };
}
