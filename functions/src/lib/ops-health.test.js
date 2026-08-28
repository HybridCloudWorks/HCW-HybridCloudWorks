/**
 * Ops-health snapshot + workflow-alert RPCs — pinned to source
 * buildOpsHealthSnapshot (:6470-6597) and updateWorkflowAlert (:5907-6037).
 * Load-bearing: the latest-digest lookup orders by DOC ID (the source's own
 * bug fix), reopen writes explicit nulls (not deletions), and resolve
 * requires a note and auto-acknowledges.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createOpsHealthHandlers,
  buildWorkflowAlertUpdates,
  getWorkflowAlertStatus,
  toHoursSince,
} from './ops-health.js';

const context = { log: vi.fn(), error: vi.fn() };

const allowGuard = (role = 'viewer') => ({
  requireRole: vi.fn(async () => ({
    user: { oid: 'u1', preferred_username: 'ops@hcw.dev' },
    role,
    error: null,
  })),
});
const denyGuard = {
  requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })),
};

const makeRequest = (body) => ({
  headers: { get: (k) => (k === 'user-agent' ? 'vitest' : null) },
  json: async () => {
    if (body === undefined) throw new SyntaxError('no body');
    return body;
  },
});

const NOW = new Date('2026-08-07T04:00:00.000Z');
const fixed = { now: () => NOW, uuid: () => 'fixed-uuid' };

describe('helpers', () => {
  it('getWorkflowAlertStatus falls back through status -> active flag -> open', () => {
    expect(getWorkflowAlertStatus({ status: 'acknowledged' })).toBe('acknowledged');
    expect(getWorkflowAlertStatus({ active: false })).toBe('resolved');
    expect(getWorkflowAlertStatus({})).toBe('open');
  });

  it('toHoursSince rounds to a tenth and rejects unparseable values', () => {
    const nowMs = NOW.getTime();
    expect(toHoursSince(new Date(nowMs - 90 * 60 * 1000), nowMs)).toBe(1.5);
    expect(toHoursSince('junk', nowMs)).toBeNull();
  });

  it('buildWorkflowAlertUpdates: resolve auto-acknowledges, reopen nulls out', () => {
    const resolve = buildWorkflowAlertUpdates({
      action: 'resolve', nowIso: 'T', actor: 'a', normalizedResolutionNote: 'done', alertData: {},
    });
    expect(resolve).toMatchObject({
      active: false, status: 'resolved', resolutionNote: 'done',
      acknowledgedAt: 'T', // was never acknowledged — resolve fills it
    });

    const alreadyAcked = buildWorkflowAlertUpdates({
      action: 'resolve', nowIso: 'T', actor: 'a', normalizedResolutionNote: 'done',
      alertData: { acknowledgedAt: 'earlier' },
    });
    expect(alreadyAcked).not.toHaveProperty('acknowledgedAt');

    const reopen = buildWorkflowAlertUpdates({
      action: 'reopen', nowIso: 'T', actor: 'a', normalizedResolutionNote: '', alertData: {},
    });
    // Explicit nulls — a deletion (undefined) would be a different write.
    expect(reopen.resolvedAt).toBeNull();
    expect(reopen.resolutionNote).toBeNull();
    expect(reopen.active).toBe(true);
  });
});

describe('getOpsHealthSnapshot', () => {
  function opsStore() {
    return {
      queryDocs: vi.fn(async (container, query, params) => {
        if (query.includes('VALUE COUNT')) {
          if (query.includes("'published'")) return [12];
          if (query.includes("'rss'")) return [3];
          return [2]; // queue breach
        }
        if (container === 'content' && query.includes('c["slug"]')) {
          return [{ id: 'p1', slug: 'has-slug' }, { id: 'p2' }]; // one missing slug
        }
        // Orphan probe (T-711): one batched existence check in place of a
        // point read per generated image. Only 'c-exists' exists, matching the
        // readDoc branch below that this replaced.
        if (container === 'content' && query.includes('ARRAY_CONTAINS(@ids, c.id)')) {
          const ids = params?.[0]?.value || [];
          return ids.filter((id) => id === 'c-exists').map((id) => ({ id }));
        }
        if (container === 'content') {
          // staged rows
          return [
            { id: 's1', contentStatus: 'approved', updatedAt: '2026-08-06T04:00:00Z' },
            { id: 's-live', contentStatus: 'published', Live: true, updatedAt: '2026-08-07T03:00:00Z' },
          ];
        }
        if (container === 'workflow_digests') {
          expect(query).toContain('ORDER BY c.id DESC'); // the source's bug fix
          return [{ id: '2026-08-06', publishingOps: { status: 'success', lastRunAt: 'run-ts' } }];
        }
        if (container === 'workflow_alerts') {
          return [
            { id: 'a-open', alertType: 'scheduled_publish_failures', updatedAt: '2026-08-07T02:00:00Z' },
            { id: 'a-resolved', status: 'resolved', updatedAt: '2026-08-07T03:00:00Z' },
          ];
        }
        if (container === 'generated_content_images') {
          return [
            { id: 'img-ok', contentId: 'c-exists' },
            { id: 'img-orphan', contentId: 'c-gone' },
            { id: 'img-noid', contentId: '' },
          ];
        }
        return [];
      }),
      readDoc: vi.fn(async (container, id) => {
        if (container === 'workflow_digests') return null; // today's digest absent
        if (container === 'system') return { telegram: 'state' };
        if (container === 'content') return id === 'c-exists' ? { id } : null;
        return null;
      }),
      upsertDoc: vi.fn(),
      patchDoc: vi.fn(),
    };
  }

  it('assembles the full source response shape', async () => {
    const store = opsStore();
    const h = createOpsHealthHandlers({ guard: allowGuard(), store, ...fixed });
    const body = JSON.parse((await h.getOpsHealthSnapshot(makeRequest({}), context)).body);

    expect(body.readiness).toEqual({
      functionsConfigured: true,
      publishedItems: 12,
      missingSlugCount: 1,
      rssSources: 3,
    });
    // Today's digest missing -> latest-by-id fallback used.
    expect(body.digest.id).toBe('2026-08-06');
    expect(body.alerts.map((a) => a.id)).toEqual(['a-resolved', 'a-open']); // updatedAt desc
    expect(body.operationalSignals).toMatchObject({
      queueBreachCount: 2,
      publishFailureCount: 1, // the open scheduled_publish_failures alert
      orphanedGeneratedImages: 2, // c-gone + missing contentId
      lastSchedulerSuccessAt: 'run-ts',
    });
    expect(body.operationalSignals.oldestStagedHours).toBe(24); // staged Live item excluded
    expect(body.telegramNotifyState).toEqual({ telegram: 'state' });
  });

  it('denies without touching the store', async () => {
    const store = opsStore();
    const h = createOpsHealthHandlers({ guard: denyGuard, store, ...fixed });
    expect((await h.getOpsHealthSnapshot(makeRequest({}), context)).status).toBe(403);
    expect(store.queryDocs).not.toHaveBeenCalled();
  });
});

describe('updateWorkflowAlert', () => {
  const alertStore = (alert = { id: 'a1', alertType: 'link_rot', active: true }) => ({
    queryDocs: vi.fn(),
    readDoc: vi.fn(async () => alert),
    upsertDoc: vi.fn(async (_c, d) => d),
    patchDoc: vi.fn(async (_c, id, u) => ({ id, ...u })),
  });

  it('validates action, requires a note to resolve, 404s missing alerts', async () => {
    const h = createOpsHealthHandlers({ guard: allowGuard('publisher'), store: alertStore(), ...fixed });
    expect((await h.updateWorkflowAlert(makeRequest({ alertId: 'a1' }), context)).status).toBe(400);
    expect((await h.updateWorkflowAlert(makeRequest({ alertId: 'a1', action: 'nuke' }), context)).status).toBe(400);
    expect((await h.updateWorkflowAlert(makeRequest({ alertId: 'a1', action: 'resolve' }), context)).status).toBe(400);

    const missing = createOpsHealthHandlers({
      guard: allowGuard('publisher'),
      store: { ...alertStore(), readDoc: vi.fn(async () => null) },
      ...fixed,
    });
    expect(
      (await missing.updateWorkflowAlert(makeRequest({ alertId: 'x', action: 'acknowledge' }), context)).status
    ).toBe(404);
  });

  it('patches the alert and writes the audit row with the before/after diff', async () => {
    const store = alertStore();
    const h = createOpsHealthHandlers({ guard: allowGuard('publisher'), store, ...fixed });
    const res = await h.updateWorkflowAlert(
      makeRequest({ alertId: 'a1', action: 'resolve', resolutionNote: 'fixed the feed' }),
      context
    );
    expect(JSON.parse(res.body)).toEqual({ success: true, alertId: 'a1', action: 'resolve' });

    const patch = store.patchDoc.mock.calls[0];
    expect(patch[0]).toBe('workflow_alerts');
    expect(patch[2]).toMatchObject({ status: 'resolved', resolutionNote: 'fixed the feed' });

    const audit = store.upsertDoc.mock.calls.find(([c]) => c === 'audits')[1];
    expect(audit).toMatchObject({
      action: 'workflow_alert_resolve',
      resourceId: 'a1',
      resourceTitle: 'link_rot',
      changes: { before: { active: true, status: 'open' }, notes: 'fixed the feed' },
      metadata: { alertType: 'link_rot' },
    });
  });
});
