/**
 * The probe registry (ADR 0033 Platform): one entry per hub dependency, every
 * answer in the shared vocabulary, and the pure evaluators that read the
 * snapshot and the session. The page's use of it is in ../HealthPage.test.jsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getJSON = vi.fn();
const postJSON = vi.fn();
vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  postJSON: (...args) => postJSON(...args),
  sendJSON: vi.fn(),
}));
vi.mock('@/lib/adminSettings', () => ({
  getSessionizeSpeakerId: async () => 'speaker-42',
  DEFAULT_SESSIONIZE_SPEAKER_ID: 'default-speaker',
}));
vi.mock('@/lib/publicApi', () => ({ fetchCloudPricing: vi.fn() }));

import { SERVICES } from '@/components/admin/integrations/serviceRegistry';
import { SYSTEM_STATUS } from '@/lib/status';
import {
  HUBS,
  PROBES,
  PROBE_IDS,
  SERVICE_PROBE_IDS,
  classifyFailure,
  evaluateCosmos,
  evaluateLinkRot,
  evaluateRuntimeConfig,
  evaluateScheduledPublishing,
  evaluateTelegramNotify,
  probeReportLines,
  probesByHub,
  resolveProbe,
  runAiProviders,
  runLabAgents,
  runNewsletterBuild,
  runUnresolvedSecrets,
  safeProbes,
} from './probeRegistry';

const byId = (id) => PROBES.find((probe) => probe.id === id);

describe('the registry', () => {
  it('has unique ids, a hub that exists and the five facts on every entry', () => {
    expect(new Set(PROBE_IDS).size).toBe(PROBE_IDS.length);
    for (const probe of PROBES) {
      expect(Object.keys(HUBS), `${probe.id} hub`).toContain(probe.hub);
      for (const field of ['label', 'covers', 'impact', 'action']) {
        expect(probe[field], `${probe.id} has no ${field}`).toMatch(/\w/);
      }
      expect(probe.href?.to, `${probe.id} has no link`).toMatch(/^\/admin\//);
      expect(['live', 'snapshot', 'session']).toContain(probe.kind);
      if (probe.kind === 'live') expect(typeof probe.run).toBe('function');
      else expect(typeof probe.evaluate).toBe('function');
      expect(typeof probe.safe, `${probe.id} does not say whether Test all may run it`).toBe(
        'boolean'
      );
      if (!probe.safe) expect(probe.costNote, `${probe.id} is unsafe with no reason`).toMatch(/\w/);
    }
  });

  it('covers every hub and every testable Integrations service, by the same test function', () => {
    expect(probesByHub().map((group) => group.id)).toEqual(Object.keys(HUBS));
    // The four language models are one probe here — `ai-providers` asks every
    // ENABLED provider, which is the question Health has — so their cards'
    // tests are covered by it rather than by four more cards.
    const coveredByAiProviders = new Set(['gemini', 'anthropic', 'openai', 'nvidia']);
    const testable = SERVICES.filter((service) => service.test).map((service) => service.id);
    for (const id of testable) {
      if (coveredByAiProviders.has(id)) continue;
      expect(SERVICE_PROBE_IDS, `${id} has a service test but no probe`).toContain(id);
    }
    expect(byId('ai-providers')).toBeTruthy();
  });

  it('keeps the probes that write or spend out of Test all', () => {
    const unsafe = PROBES.filter((probe) => !probe.safe).map((probe) => probe.id);
    expect(unsafe.sort()).toEqual(
      ['rss-fetch', 'batch-inspect', 'reviewer-digest', 'labs-noop', 'youtube'].sort()
    );
    expect(safeProbes().map((probe) => probe.id)).not.toContain('youtube');
  });

  it('answers unknown, never a guess, for a live probe that has not run', () => {
    expect(resolveProbe(byId('publer'), {}, {})).toMatchObject({
      status: 'unknown',
      summary: 'Not tested yet.',
    });
    expect(
      resolveProbe(byId('publer'), {}, { publer: { status: 'healthy', summary: 'ok' } })
    ).toMatchObject({
      status: 'healthy',
    });
  });
});

describe('classifyFailure', () => {
  it('calls a missing key misconfigured and anything else unavailable', () => {
    expect(classifyFailure('Resend is not configured: RESEND_API_KEY is not set')).toBe(
      'misconfigured'
    );
    expect(classifyFailure('Publer answered 403 - Forbidden')).toBe('unavailable');
  });
});

describe('snapshot evaluators', () => {
  const snapshot = {
    lastCheckedAt: '2026-10-03T12:00:00.000Z',
    readiness: {
      functionsConfigured: true,
      configGeneration: 'run-77',
      configWriter: 'azapi-strip',
      unresolvedSecrets: [],
      lastCheckedAt: '2026-10-03T12:00:00.000Z',
    },
    digest: {
      lastCheckedAt: '2026-10-03T12:00:00.000Z',
      publishingOps: {
        status: 'success',
        due: 2,
        published: 2,
        skipped: 0,
        failed: 0,
        lastRunAt: '2026-10-03T11:00:00.000Z',
      },
      publishingWatchdog: { overdueScheduledCount: 0 },
      linkRot: {
        lastRunAt: '2026-10-01T06:00:00.000Z',
        checked: 40,
        broken: 2,
        sampleBroken: [{ url: 'https://x/y', status: 404 }],
      },
    },
    telegramNotifyState: {
      id: 'notify_state',
      lastCheckedAt: '2026-10-03T12:00:00.000Z',
      forge_ready: { lastNotifiedAt: '2026-10-03T10:00:00.000Z' },
    },
  };
  const ctx = { snapshot, ops: { loaded: true, error: '' } };

  it('reads the config stamp and the unresolved references, with the block’s own time', () => {
    expect(evaluateRuntimeConfig(ctx)).toMatchObject({
      status: 'healthy',
      checkedAt: '2026-10-03T12:00:00.000Z',
    });
    expect(
      evaluateRuntimeConfig({
        ...ctx,
        snapshot: {
          readiness: {
            ...snapshot.readiness,
            functionsConfigured: false,
            unresolvedSecrets: ['PUBLER_API_KEY'],
          },
        },
      })
    ).toMatchObject({
      status: 'misconfigured',
      summary: expect.stringContaining('PUBLER_API_KEY'),
    });
    expect(
      evaluateRuntimeConfig({
        ...ctx,
        snapshot: { readiness: { ...snapshot.readiness, configGeneration: 'unset' } },
      })
    ).toMatchObject({ status: 'unavailable' });
  });

  it('judges the scheduler by its status and the watchdog’s overdue count', () => {
    expect(evaluateScheduledPublishing(ctx).status).toBe('healthy');
    const degraded = {
      ...snapshot,
      digest: {
        ...snapshot.digest,
        publishingOps: { ...snapshot.digest.publishingOps, status: 'degraded' },
      },
    };
    expect(evaluateScheduledPublishing({ ...ctx, snapshot: degraded }).status).toBe('degraded');
    const idle = { ...snapshot, digest: { publishingWatchdog: { overdueScheduledCount: 0 } } };
    expect(evaluateScheduledPublishing({ ...ctx, snapshot: idle })).toMatchObject({
      status: 'unknown',
      summary: expect.stringContaining('Idle'),
    });
    const overdue = { ...snapshot, digest: { publishingWatchdog: { overdueScheduledCount: 3 } } };
    expect(evaluateScheduledPublishing({ ...ctx, snapshot: overdue }).status).toBe('degraded');
  });

  it('shows the two blocks that were returned and never rendered: link rot and Telegram notices', () => {
    expect(evaluateLinkRot(ctx)).toMatchObject({
      status: 'degraded',
      summary: '2 of 40 live links are broken.',
      detail: 'https://x/y (404)',
      checkedAt: '2026-10-01T06:00:00.000Z',
    });
    expect(evaluateTelegramNotify(ctx)).toMatchObject({
      status: 'healthy',
      summary: expect.stringContaining('forge_ready'),
    });
    expect(
      evaluateTelegramNotify({
        ...ctx,
        snapshot: { ...snapshot, telegramNotifyState: { lastCheckedAt: 'x' } },
      }).status
    ).toBe('unknown');
  });

  it('calls Cosmos unavailable when the snapshot read failed, and unknown while it loads', () => {
    expect(evaluateCosmos(ctx).status).toBe('healthy');
    expect(
      evaluateCosmos({ snapshot: null, ops: { loaded: false, error: 'HTTP 503' } })
    ).toMatchObject({
      status: 'unavailable',
      summary: expect.stringContaining('HTTP 503'),
    });
    expect(evaluateCosmos({ snapshot: null, ops: { loaded: false, error: '' } }).status).toBe(
      'unknown'
    );
  });
});

describe('live runners', () => {
  beforeEach(() => {
    getJSON.mockReset();
    postJSON.mockReset();
  });

  it('tests every enabled AI provider through testAiProvider and shows the weekly probe’s last result', async () => {
    getJSON.mockResolvedValueOnce({
      items: [
        {
          id: 'gemini',
          enabled: true,
          lastTested: '2026-09-29T06:15:00.000Z',
          lastTestedBy: 'probe',
        },
        { id: 'openai', enabled: true },
        { id: 'nvidia', enabled: false },
      ],
    });
    postJSON.mockImplementation(async (name, body) =>
      body.providerId === 'gemini'
        ? { status: 'connected', latencyMs: 900 }
        : { status: 'error', error: 'timeout' }
    );
    const r = await runAiProviders();
    expect(r.status).toBe('degraded');
    expect(r.summary).toContain('1 of 2 enabled providers answered');
    expect(r.summary).toContain('the weekly probe');
    expect(r.detail).toContain('openai: timeout');
    expect(postJSON).toHaveBeenCalledTimes(2);
    expect(postJSON).not.toHaveBeenCalledWith('testAiProvider', { providerId: 'nvidia' });
  });

  it('calls no enabled provider misconfigured and all answering healthy', async () => {
    getJSON.mockResolvedValueOnce({ items: [{ id: 'gemini', enabled: false }] });
    expect((await runAiProviders()).status).toBe('misconfigured');
    getJSON.mockResolvedValueOnce({ items: [{ id: 'gemini', enabled: true }] });
    postJSON.mockResolvedValue({ status: 'connected', latencyMs: 500 });
    expect((await runAiProviders()).status).toBe('healthy');
  });

  it('judges lab agents by how many are online', async () => {
    postJSON.mockResolvedValueOnce({ agents: [] });
    expect((await runLabAgents()).status).toBe('unknown');
    postJSON.mockResolvedValueOnce({
      agents: [
        { agentId: 'a', online: true, lastSeenAt: '2026-10-03T11:59:00.000Z' },
        { agentId: 'b', online: false, lastSeenAt: '2026-10-01T00:00:00.000Z' },
      ],
    });
    expect(await runLabAgents()).toMatchObject({
      status: 'degraded',
      summary: expect.stringContaining('1 of 2 agents online'),
    });
    expect(postJSON).toHaveBeenCalledWith('getLabsSnapshot', {});
  });

  it('judges the newsletter build by the newest issue’s age against the send day', async () => {
    const recent = new Date(Date.now() - 2 * 86400000).toISOString();
    getJSON.mockImplementation(async (route) =>
      route === 'cms/newsletters'
        ? { ok: true, issues: [{ createdAt: recent }] }
        : { value: { sendDay: 'tuesday' } }
    );
    expect(await runNewsletterBuild()).toMatchObject({
      status: 'healthy',
      summary: expect.stringContaining('tuesday'),
    });
    const stale = new Date(Date.now() - 20 * 86400000).toISOString();
    getJSON.mockImplementation(async (route) =>
      route === 'cms/newsletters' ? { ok: true, issues: [{ createdAt: stale }] } : { value: {} }
    );
    expect((await runNewsletterBuild()).status).toBe('degraded');
    getJSON.mockImplementation(async (route) =>
      route === 'cms/newsletters' ? { issues: [] } : {}
    );
    expect((await runNewsletterBuild()).status).toBe('unknown');
  });

  it('renders the unresolvedSecrets count from /api/health, naming the settings the snapshot knows', async () => {
    getJSON.mockResolvedValueOnce({ status: 'ok', unresolvedSecrets: 0 });
    expect((await runUnresolvedSecrets({})).status).toBe('healthy');
    getJSON.mockResolvedValueOnce({ status: 'ok', unresolvedSecrets: 2 });
    expect(
      await runUnresolvedSecrets({
        snapshot: { readiness: { unresolvedSecrets: ['A_KEY', 'B_KEY'] } },
      })
    ).toMatchObject({
      status: 'misconfigured',
      summary: '2 Key Vault references did not resolve: A_KEY, B_KEY.',
    });
    expect(getJSON).toHaveBeenCalledWith('health');
  });
});

describe('the report section', () => {
  it('lists every probe under its hub with the shared word and the time', () => {
    const lines = probeReportLines(PROBES, (probe) =>
      probe.id === 'publer'
        ? { status: 'healthy', summary: 'Connected.', checkedAt: '2026-10-03T12:00:00.000Z' }
        : { status: 'unknown', summary: 'Not tested yet.', checkedAt: null }
    );
    expect(lines[0]).toBe('### Probe registry');
    expect(lines).toContain('#### Amplify');
    expect(lines).toContain('- Publer: Healthy (2026-10-03T12:00:00.000Z) — Connected.');
    expect(lines).toContain(`- Cosmos DB: ${SYSTEM_STATUS.unknown.label} — Not tested yet.`);
    expect(lines.join('\n')).not.toMatch(/PASS|FAIL|UNKNOWN/);
  });
});
