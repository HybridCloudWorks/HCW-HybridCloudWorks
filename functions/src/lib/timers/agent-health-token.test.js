/**
 * checkAgentHealth's hourly Coder status-token check (#1009; CodeRabbit,
 * #1056).
 *
 * checkAgentHealth is armed and runs every five minutes, so the check rides
 * on it rather than on the lab canary, which is off until the owner arms it:
 * with the canary off, the coder-token probe still gets evidence that no
 * warm cache can hide. It runs last, after the marks and messages, and never
 * fails the run.
 */
import { describe, it, expect, vi } from 'vitest';

import { createAgentHealthCheck } from './agent-health.js';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const now = () => NOW;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

const stale = { id: 'vps-1', agentId: 'vps-1', active: true, status: 'idle', lastSeenAt: ago(10 * 60_000) };
const store = (agents = [stale]) => ({
  queryDocs: vi.fn(async () => agents),
  patchDoc: vi.fn(async (_c, id, updates) => ({ id, ...updates })),
});

describe('checkAgentHealth checks the Coder status token', () => {
  it('runs the check after the marks, and reports what it found', async () => {
    const s = store();
    const coderTokenCheck = vi.fn(async () => ({ checked: true, refusedStatus: 401 }));
    const summary = await createAgentHealthCheck({ store: s, now, coderTokenCheck }).run();
    expect(summary).toMatchObject({ markedOffline: 1, tokenCheck: 'refused' });
    expect(s.patchDoc.mock.invocationCallOrder[0]).toBeLessThan(coderTokenCheck.mock.invocationCallOrder[0]);
  });

  it.each([
    [{ checked: true, refusedStatus: null }, 'accepted'],
    [{ checked: false, reason: 'not due' }, 'not due'],
    [{ checked: false, reason: 'unset' }, 'skipped'],
    [{ checked: false, reason: 'error' }, 'skipped'],
  ])('reports %j as %s', async (outcome, word) => {
    const summary = await createAgentHealthCheck({
      store: store([]),
      now,
      coderTokenCheck: async () => outcome,
    }).run();
    expect(summary.tokenCheck).toBe(word);
  });

  it('never fails the run, and logs only a code', async () => {
    const log = { warn: vi.fn() };
    const summary = await createAgentHealthCheck({
      store: store(),
      now,
      log,
      coderTokenCheck: async () => {
        throw Object.assign(new Error('token AbCdEf1234-x refused at https://coder.lab.example'), { code: 'BOOM' });
      },
    }).run();
    expect(summary).toMatchObject({ markedOffline: 1, tokenCheck: 'failed' });
    expect(log.warn).toHaveBeenCalledWith('[checkAgentHealth] the status token check failed (BOOM)');
    expect(log.warn.mock.calls.flat().join('\n')).not.toMatch(/AbCdEf1234|coder\.lab\.example/);
  });

  it('is wired in schedulers.js with the hourly check, not the bare one', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../functions/schedulers.js', import.meta.url), 'utf8');
    const wiring = /timer\('checkAgentHealth'[\s\S]*?\.run\(\)\n\);/.exec(source)?.[0] ?? '';
    expect(wiring).toMatch(/coderTokenCheck: \(\) => createCoderStatusHandlers\(\{ store \}\)\.checkTokenIfDue\(context\)/);
    const canary = /timer\('labCanary'[\s\S]*?\n\}\);/.exec(source)?.[0] ?? '';
    expect(canary).not.toMatch(/checkToken/);
  });
});
