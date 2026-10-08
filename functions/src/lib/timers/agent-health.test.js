/**
 * The lab agent's outage messages, end to end (#1009).
 *
 * The heartbeat handler (lib/lab-agent.js), the five-minute health timer
 * (./agent-health.js) and the real notifier (lib/notify.js, with its
 * fifteen-minute cooldown per source) run against one in-memory store and one
 * clock, so each case below is a sequence of events as the host would produce
 * them, and the assertion is what reached Telegram.
 *
 * The rules under test: a restart that is back inside five minutes says
 * nothing; an outage that lasts longer says "offline" once and "back online"
 * once; and a timer that runs again does not say either twice.
 */
import { describe, expect, it, vi } from 'vitest';
import { createLabAgentHandlers } from '../lab-agent.js';
import { createNotifier } from '../notify.js';
import {
  AGENT_OFFLINE_SOURCE,
  AGENT_ONLINE_SOURCE,
  OFFLINE_NOTIFY_AFTER_MS,
  createAgentHealthCheck,
  outageMinutes,
  planAgentHealth,
} from './agent-health.js';

const T0 = Date.parse('2026-10-08T04:30:00.000Z');
const MIN = 60_000;

/** Cosmos as these modules use it: point reads, merges, conditional patches, a full scan. */
function memoryStore() {
  const containers = new Map();
  let etag = 0;
  const box = (name) => {
    if (!containers.has(name)) containers.set(name, new Map());
    return containers.get(name);
  };
  return {
    box,
    async readDoc(name, id) {
      const doc = box(name).get(id);
      return doc ? { ...doc } : null;
    },
    async upsertDoc(name, doc) {
      const next = { ...doc, _etag: `"${++etag}"` };
      box(name).set(doc.id, next);
      return { ...next };
    },
    async patchDoc(name, id, updates, options = {}) {
      const current = box(name).get(id);
      if (options.ifMatch && current?._etag !== options.ifMatch) {
        throw Object.assign(new Error('precondition failed'), { code: 412 });
      }
      const next = { ...(current || { id }), ...updates, _etag: `"${++etag}"` };
      box(name).set(id, next);
      return { ...next };
    },
    async queryDocs(name) {
      return [...box(name).values()].map((doc) => ({ ...doc }));
    },
  };
}

/** One registered agent, one clock, the three real parts, and what Telegram received. */
function lab({ active = true } = {}) {
  let clock = T0 - 10 * MIN;
  const now = () => new Date(clock);
  const store = memoryStore();
  store.box('lab_agents').set('vps-1', {
    id: 'vps-1',
    active,
    capabilities: ['terraform-validate'],
    status: 'idle',
    hostname: 'vps-hostinger-01',
    lastSeenAt: new Date(clock).toISOString(),
  });

  const sent = [];
  const fetch = vi.fn(async (_url, init) => {
    sent.push(JSON.parse(init.body).text);
    return { ok: true, status: 200 };
  });
  const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const notifier = createNotifier({
    store,
    env: { TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHAT_ID: 'chat' },
    fetch,
    now,
    log,
  });
  // The real guard point-reads the registry document on every request.
  const guard = {
    requireAgent: async (_request, agentId) => ({
      agent: { ...store.box('lab_agents').get(agentId), agentId },
      identity: { oid: 'oid-1' },
      error: null,
    }),
  };
  const agentApi = createLabAgentHandlers({ guard, store, now, notifier });
  const timer = createAgentHealthCheck({ store, notifier, now, log });

  return {
    sent,
    log,
    store,
    doc: () => store.box('lab_agents').get('vps-1'),
    at(ms) {
      clock = ms;
    },
    async heartbeat(status) {
      const res = await agentApi.heartbeatAgent({ json: async () => ({ agentId: 'vps-1', status }) }, log);
      expect(res.status).toBe(200);
    },
    runTimer: () => timer.run(),
  };
}

describe('the lab agent outage messages (#1009)', () => {
  it('a reboot back in 43 seconds sends nothing, however often the timer runs', async () => {
    const host = lab();
    host.at(T0);
    await host.heartbeat('stopping');
    await host.heartbeat('offline');
    expect(host.doc()).toMatchObject({ status: 'offline', offlineSince: new Date(T0).toISOString() });

    host.at(T0 + 43_000);
    await host.heartbeat('idle');
    for (const minutes of [5, 10, 15, 20]) {
      host.at(T0 + minutes * MIN);
      await host.heartbeat('idle');
      await host.runTimer();
    }
    expect(host.sent).toEqual([]);
    expect(host.doc()).not.toHaveProperty('offlineNotifiedAt');
  });

  it('a graceful stop that lasts sends one "offline" after five minutes and one "back online" when it returns', async () => {
    const host = lab();
    host.at(T0);
    await host.heartbeat('offline');

    host.at(T0 + 2 * MIN);
    await host.runTimer();
    expect(host.sent).toHaveLength(0);

    host.at(T0 + 5 * MIN);
    expect(await host.runTimer()).toMatchObject({ notifiedOffline: 1 });
    expect(host.sent).toHaveLength(1);
    expect(host.sent[0]).toMatch(/^\u{1F534} Lab agent offline \(1\)/u);
    expect(host.sent[0]).toContain('vps-1 (vps-hostinger-01): offline since 2026-10-08T04:30:00.000Z (5 min)');
    expect(host.doc().offlineNotifiedAt).toBe(new Date(T0 + 5 * MIN).toISOString());

    // Repeated runs, past the notifier's cooldown too: still one message.
    for (const minutes of [10, 15, 20, 25]) {
      host.at(T0 + minutes * MIN);
      expect(await host.runTimer()).toMatchObject({ markedOffline: 0, notifiedOffline: 0 });
    }
    expect(host.sent).toHaveLength(1);

    host.at(T0 + 27 * MIN);
    await host.heartbeat('idle');
    expect(host.sent).toHaveLength(2);
    expect(host.sent[1]).toMatch(/^ℹ️ Lab agent back online after 27 min/);
    expect(host.doc()).toMatchObject({ status: 'idle', offlineNotifiedAt: null, backOnlineAt: null });

    host.at(T0 + 30 * MIN);
    await host.heartbeat('idle');
    await host.runTimer();
    expect(host.sent).toHaveLength(2);
  });

  it('a crash with no goodbye is marked from its last heartbeat and announced once it has been five minutes', async () => {
    const host = lab();
    host.at(T0);
    await host.heartbeat('idle');

    host.at(T0 + 3 * MIN);
    expect(await host.runTimer()).toMatchObject({ markedOffline: 1, notifiedOffline: 0 });
    expect(host.doc()).toMatchObject({ status: 'offline', offlineSince: new Date(T0).toISOString() });
    expect(host.log.warn).toHaveBeenCalledWith(expect.stringMatching(/marked 1 agent\(s\) offline/));

    host.at(T0 + 8 * MIN);
    expect(await host.runTimer()).toMatchObject({ markedOffline: 0, notifiedOffline: 1 });
    host.at(T0 + 13 * MIN);
    await host.runTimer();
    expect(host.sent).toHaveLength(1);

    host.at(T0 + 14 * MIN);
    await host.heartbeat('idle');
    expect(host.sent).toHaveLength(2);
    expect(host.sent[1]).toMatch(/Lab agent back online after 14 min/);
  });

  it('a "back online" the cooldown holds back is sent by the timer, so every "offline" gets its end', async () => {
    const host = lab();
    host.at(T0);
    await host.heartbeat('offline');
    host.at(T0 + 5 * MIN);
    await host.runTimer();
    host.at(T0 + 14 * MIN);
    await host.heartbeat('idle');
    expect(host.sent.map((text) => text.split('\n')[0])).toEqual([
      '\u{1F534} Lab agent offline (1)',
      'ℹ️ Lab agent back online after 14 min',
    ]);

    // Down again thirty seconds later, and long enough to be announced.
    host.at(T0 + 14 * MIN + 30_000);
    await host.heartbeat('offline');
    host.at(T0 + 20 * MIN);
    await host.runTimer();
    expect(host.sent).toHaveLength(3);

    // Back at 21 minutes: seven minutes after the last "back online", inside
    // its cooldown, so the heartbeat cannot send it and the debt stays.
    host.at(T0 + 21 * MIN);
    await host.heartbeat('idle');
    expect(host.sent).toHaveLength(3);
    expect(host.doc()).toMatchObject({ backOnlineAt: new Date(T0 + 21 * MIN).toISOString() });
    expect(host.doc().offlineNotifiedAt).toBeTruthy();

    host.at(T0 + 25 * MIN);
    await host.heartbeat('idle');
    await host.runTimer();
    expect(host.sent).toHaveLength(3);

    host.at(T0 + 30 * MIN);
    await host.heartbeat('idle');
    expect(await host.runTimer()).toMatchObject({ notifiedBack: 1 });
    expect(host.sent).toHaveLength(4);
    // Measured to the heartbeat that ended it, not to the run that said so.
    expect(host.sent[3]).toMatch(/^ℹ️ Lab agent back online after 7 min/);
    expect(host.doc()).toMatchObject({ offlineNotifiedAt: null, backOnlineAt: null });
  });

  it('lets a heartbeat that lands between the timer\'s read and its mark win: no false offline, no message (review of #1018)', async () => {
    const host = lab();
    host.at(T0);
    await host.heartbeat('idle');

    // Ten minutes silent, so the run decides to mark it and to announce it;
    // the agent heartbeats after the read and before the mark.
    host.at(T0 + 10 * MIN);
    const read = host.store.queryDocs;
    host.store.queryDocs = async (...args) => {
      const rows = await read(...args);
      await host.heartbeat('idle');
      return rows;
    };
    expect(await host.runTimer()).toMatchObject({ markedOffline: 0, heartbeatWon: 1, notifiedOffline: 0 });
    expect(host.doc()).toMatchObject({ status: 'idle', lastSeenAt: new Date(T0 + 10 * MIN).toISOString() });
    expect(host.sent).toEqual([]);
    expect(host.log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/1 agent\(s\) heartbeated between this run's read and its mark/)
    );
  });

  it('marks an agent the registry has deactivated, and never announces it', async () => {
    const host = lab({ active: false });
    host.at(T0 + 30 * MIN);
    expect(await host.runTimer()).toMatchObject({ markedOffline: 1, notifiedOffline: 0 });
    host.at(T0 + 60 * MIN);
    await host.runTimer();
    expect(host.sent).toEqual([]);
  });
});

describe('planAgentHealth', () => {
  const at = T0 + 10 * MIN;
  const iso = (ms) => new Date(ms).toISOString();

  it('keeps the start of an outage the owner is still owed the end of', () => {
    const plan = planAgentHealth(
      [
        {
          id: 'vps-1',
          active: true,
          status: 'idle',
          lastSeenAt: iso(at - 3 * MIN),
          offlineSince: iso(T0),
          offlineNotifiedAt: iso(T0 + 5 * MIN),
          backOnlineAt: iso(at - 4 * MIN),
        },
      ],
      at
    );
    expect(plan.marks).toEqual([
      expect.objectContaining({ updates: { status: 'offline', offlineSince: iso(T0), backOnlineAt: null } }),
    ]);
    // Owed its end already: not announced a second time, and not "back".
    expect(plan.notifyOffline).toEqual([]);
    expect(plan.notifyBack).toEqual([]);
  });

  it('announces at exactly five minutes, not a second before', () => {
    const agent = (offlineSince) => ({ id: 'vps-1', active: true, status: 'offline', offlineSince, lastSeenAt: offlineSince });
    expect(planAgentHealth([agent(iso(at - OFFLINE_NOTIFY_AFTER_MS))], at).notifyOffline).toHaveLength(1);
    expect(planAgentHealth([agent(iso(at - OFFLINE_NOTIFY_AFTER_MS + 1000))], at).notifyOffline).toHaveLength(0);
  });

  it('treats a stopping agent with a fresh heartbeat as neither stale nor back', () => {
    const plan = planAgentHealth(
      [{ id: 'vps-1', active: true, status: 'stopping', lastSeenAt: iso(at - 10_000), offlineNotifiedAt: iso(T0) }],
      at
    );
    expect(plan).toEqual({ marks: [], notifyOffline: [], notifyBack: [] });
  });

  it('counts minutes from the outage start, at least one, and says null when the start is unknown', () => {
    expect(outageMinutes(iso(T0), T0 + 43_000)).toBe(1);
    expect(outageMinutes(iso(T0), T0 + 27 * MIN)).toBe(27);
    expect(outageMinutes(undefined, T0)).toBeNull();
    expect(outageMinutes('not a date', T0)).toBeNull();
  });

  it('uses two notifier sources, so the cooldown on "offline" never holds back its "back online"', () => {
    expect(AGENT_ONLINE_SOURCE).not.toBe(AGENT_OFFLINE_SOURCE);
  });
});
