/**
 * agent-health.js — `checkAgentHealth`, every 5 minutes (T-401).
 *
 * The Labs VPS agent heartbeats every 30 s (lib/lab-agent.js writes
 * `lastSeenAt`). An agent whose last heartbeat is older than STALE_AFTER_MS —
 * the same 90 s (three missed beats) the Labs snapshot uses to draw the
 * "connected" indicator — is marked `offline`, with `offlineSince` so the
 * admin page can say how long. Partition key is the agent id.
 *
 * Since the 2026-10-06 estate review (LAB-2) the mark is also a message: the
 * owner is told on Telegram, through the shared notifier, the moment an
 * agent is marked offline. Before that the only reader of `offline` was the
 * admin Labs page and the public status card, so a visitor learned the lab
 * was closed before the owner did. The notifier's 15-minute cooldown per
 * source keeps a flapping agent to one message a quarter-hour, and a
 * notifier that is absent or unconfigured changes nothing about the mark.
 */

export const STALE_AFTER_MS = 90 * 1000;
export const AGENT_OFFLINE_SOURCE = 'lab_agent_offline';

export function createAgentHealthCheck({ store, notifier = null, now = () => new Date(), log = {} }) {
  async function tellOwner(agents, at) {
    if (!notifier?.notifyTelegram || agents.length === 0) return;
    const lines = agents.map((a) => {
      const last = a.lastSeenAt ? `last heartbeat ${a.lastSeenAt}` : 'never heartbeated';
      return `${a.agentId || a.id} (${a.hostname || 'host unknown'}): ${last}`;
    });
    try {
      await notifier.notifyTelegram({
        title: `Lab agent offline (${agents.length})`,
        message: `Marked offline at ${at.toISOString()} after ${STALE_AFTER_MS / 1000}s without a heartbeat. Public lab submission fails closed until it is back.\n${lines.join('\n')}`,
        // 'critical' draws the red marker; 'error' is not a level the notifier
        // knows and fell through to the informational one (review of #910).
        severity: 'critical',
        source: AGENT_OFFLINE_SOURCE,
      });
    } catch (error) {
      log.warn?.(`[checkAgentHealth] owner notification failed: ${error?.message || error}`);
    }
  }

  async function run() {
    const at = now();
    const cutoff = new Date(at.getTime() - STALE_AFTER_MS).toISOString();
    const stale = await store.queryDocs(
      'lab_agents',
      "SELECT TOP 100 c.id, c.agentId, c.status, c.lastSeenAt, c.hostname FROM c WHERE c.status != 'offline' AND (NOT IS_DEFINED(c.lastSeenAt) OR c.lastSeenAt = null OR c.lastSeenAt < @cutoff)",
      [{ name: '@cutoff', value: cutoff }]
    );
    const marked = [];
    const markedAgents = [];
    for (const agent of stale || []) {
      const agentId = agent.agentId || agent.id;
      await store.patchDoc(
        'lab_agents',
        agentId,
        { status: 'offline', offlineSince: at.toISOString() },
        { partitionKey: agentId }
      );
      marked.push(agentId);
      markedAgents.push(agent);
    }
    log.log?.(`[checkAgentHealth] ${marked.length} agent(s) marked offline`);
    await tellOwner(markedAgents, at);
    return { markedOffline: marked.length, agentIds: marked };
  }
  return { run };
}
