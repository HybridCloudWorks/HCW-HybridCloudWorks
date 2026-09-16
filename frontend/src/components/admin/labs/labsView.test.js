/**
 * The Labs Hub's pure helpers (#577).
 *
 * `fleetState` is the one worth the file. It names three states where the page
 * previously computed two-and-a-half inline, and the middle one is the point:
 * an agent that HAS heartbeated and stopped is a different problem from one
 * that never connected, and the Agents tab offers a different fix for each.
 * Collapsing them sent an operator to reinstall something already installed.
 */
import { describe, expect, it } from 'vitest';
import { fleetState, formatDuration, formatTime } from './labsView';

const NOW = Date.parse('2026-09-16T12:00:00Z');
const online = (id) => ({ id, agentId: id, lastSeenAt: new Date(NOW - 5_000).toISOString() });
const stale = (id) => ({ id, agentId: id, lastSeenAt: new Date(NOW - 600_000).toISOString() });

describe('fleetState', () => {
  it('is online when at least one agent has heartbeated recently', () => {
    const fleet = fleetState([online('a1'), stale('a2')], NOW);
    expect(fleet.state).toBe('online');
    expect(fleet.online.map((a) => a.agentId)).toEqual(['a1']);
    expect(fleet.label).toBe('1 agent(s) connected');
  });

  it('is stale when agents exist but none is reachable', () => {
    // The distinction the Agents tab is built on: this is installed and
    // stopped, so the fix is on the box, not another install.
    const fleet = fleetState([stale('a1')], NOW);
    expect(fleet.state).toBe('stale');
    expect(fleet.online).toEqual([]);
    expect(fleet.label).toMatch(/registered but offline/i);
  });

  it('is none when nothing has ever connected', () => {
    const fleet = fleetState([], NOW);
    expect(fleet.state).toBe('none');
    expect(fleet.label).toMatch(/No agent connected yet/i);
  });
});

describe('formatDuration', () => {
  it('is a dash until a job has both ends', () => {
    expect(formatDuration({})).toBe('—');
    expect(formatDuration({ createdAt: '2026-09-16T12:00:00Z' })).toBe('—');
  });

  it('measures from claimedAt when there is one, else createdAt', () => {
    // The queue wait is not the run, so a job that sat queued for an hour and
    // ran for two seconds is a two-second job.
    const job = {
      createdAt: '2026-09-16T11:00:00Z',
      claimedAt: '2026-09-16T12:00:00Z',
      finishedAt: '2026-09-16T12:00:02Z',
    };
    expect(formatDuration(job)).toBe('2.0s');
    expect(formatDuration({ createdAt: job.claimedAt, finishedAt: job.finishedAt })).toBe('2.0s');
  });

  it('switches to minutes past sixty seconds', () => {
    expect(
      formatDuration({ createdAt: '2026-09-16T12:00:00Z', finishedAt: '2026-09-16T12:01:30Z' })
    ).toBe('2m 30s');
  });

  it('refuses a finish before its start rather than reporting a negative', () => {
    expect(
      formatDuration({ createdAt: '2026-09-16T12:00:00Z', finishedAt: '2026-09-16T11:00:00Z' })
    ).toBe('—');
  });
});

describe('formatTime', () => {
  it('is a dash for nothing, rather than "Invalid Date"', () => {
    expect(formatTime(null)).toBe('—');
    expect(formatTime(undefined)).toBe('—');
    expect(formatTime('')).toBe('—');
  });
});
