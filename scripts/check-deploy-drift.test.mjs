/**
 * Drift detection, at the boundaries that decide whether it is worth having.
 *
 * The two incidents this exists to catch were one commit and thirty-five, so
 * the interesting assertions are about AGE and about what counts as a commit at
 * all — not about the happy path, which is a table render.
 */
import { describe, it, expect } from 'vitest';
import {
  SERVICES,
  DEFAULT_THRESHOLD_HOURS,
  parseLastSuccessfulRun,
  parseCommitDate,
  oldestCommit,
  ageHours,
  isStale,
  formatReport,
  driftFor,
} from './check-deploy-drift.mjs';

const NOW = Date.parse('2026-09-01T04:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
const commit = (sha, date, message = 'a change') => ({
  sha,
  commit: { committer: { date }, message },
});

describe('parseLastSuccessfulRun', () => {
  it('reads the head sha of the newest successful run', () => {
    const out = parseLastSuccessfulRun({
      workflow_runs: [{ head_sha: 'abc123', run_number: 82, created_at: hoursAgo(3) }],
    });
    expect(out.sha).toBe('abc123');
    expect(out.runNumber).toBe(82);
  });

  it('returns null for a workflow that has never deployed — a fact, not an error', () => {
    expect(parseLastSuccessfulRun({ workflow_runs: [] })).toBe(null);
  });

  it('throws on a shape it cannot read, rather than reporting it as never-deployed', () => {
    // These are different facts. "Never deployed" sends someone to run a deploy;
    // an unreadable answer sends them to look at the check.
    expect(() => parseLastSuccessfulRun({})).toThrow(/workflow_runs/);
    expect(() => parseLastSuccessfulRun(null)).toThrow(/workflow_runs/);
    expect(() => parseLastSuccessfulRun({ workflow_runs: [{}] })).toThrow(/head_sha/);
  });
});

describe('parseCommitDate', () => {
  it('prefers the committer date and falls back to the author date', () => {
    expect(parseCommitDate({ commit: { committer: { date: 'A' }, author: { date: 'B' } } })).toBe(
      'A'
    );
    expect(parseCommitDate({ commit: { author: { date: 'B' } } })).toBe('B');
  });

  it('throws when neither is present', () => {
    expect(() => parseCommitDate({ commit: {} })).toThrow(/date/);
  });
});

describe('oldestCommit', () => {
  // THE ASSERTION THIS FILE EXISTS FOR. GitHub returns commits newest-first, so
  // the drift is the age of the LAST element. Taking the first would report how
  // recently someone merged — which reads as healthy immediately after the merge
  // that created the drift, i.e. exactly backwards.
  it('takes the LAST element, because GitHub returns newest first', () => {
    const out = oldestCommit([
      commit('new', hoursAgo(1), 'newest'),
      commit('mid', hoursAgo(30), 'middle'),
      commit('old', hoursAgo(50), 'oldest'),
    ]);
    expect(out.sha).toBe('old');
    expect(out.message).toBe('oldest');
  });

  it('takes only the first line of the message', () => {
    expect(oldestCommit([commit('a', hoursAgo(1), 'subject\n\nbody')]).message).toBe('subject');
  });

  it('is null for nothing', () => {
    expect(oldestCommit([])).toBe(null);
    expect(oldestCommit(undefined)).toBe(null);
  });
});

describe('ageHours', () => {
  it('floors to whole hours', () => {
    expect(ageHours(hoursAgo(2), NOW)).toBe(2);
    expect(ageHours(new Date(NOW - 2.9 * 3_600_000).toISOString(), NOW)).toBe(2);
  });

  it('never goes negative for a commit dated in the future', () => {
    // Clock skew between the runner and GitHub is real and a negative age would
    // render as a healthy service.
    expect(ageHours(new Date(NOW + 3_600_000).toISOString(), NOW)).toBe(0);
  });

  it('throws on a value that is not a date', () => {
    expect(() => ageHours('not-a-date', NOW)).toThrow();
  });
});

describe('isStale', () => {
  it('fires AT the threshold, not after it', () => {
    expect(isStale(24, 24)).toBe(true);
    expect(isStale(23, 24)).toBe(false);
    expect(isStale(25, 24)).toBe(true);
  });
});

describe('formatReport', () => {
  it('passes a service that is behind but inside the threshold', () => {
    const { failed, text } = formatReport(
      [{ name: 'Function App', count: 1, oldest: { message: 'x' }, hours: 3 }],
      DEFAULT_THRESHOLD_HOURS
    );
    expect(failed).toBe(false);
    expect(text).toContain('✅');
  });

  // The manifest 404: ONE commit, two days old. A count-based check cannot
  // distinguish this from an ordinary merge; an age-based one does.
  it('fails one commit that is older than the threshold', () => {
    const { failed, text } = formatReport(
      [{ name: 'Function App', count: 1, oldest: { message: 'add the route' }, hours: 49 }],
      DEFAULT_THRESHOLD_HOURS
    );
    expect(failed).toBe(true);
    expect(text).toContain('49h');
  });

  it('passes thirty-five commits merged in the last hour', () => {
    const { failed } = formatReport(
      [{ name: 'Static Web App', count: 35, oldest: { message: 'x' }, hours: 0 }],
      DEFAULT_THRESHOLD_HOURS
    );
    expect(failed).toBe(false);
  });

  it('fails a service that has never deployed', () => {
    const { failed, text } = formatReport([{ name: 'X', neverDeployed: true }], 24);
    expect(failed).toBe(true);
    expect(text).toContain('never deployed');
  });

  it('fails an unreadable service, and marks it differently from drift', () => {
    const { failed, text } = formatReport([{ name: 'X', error: 'GitHub answered 403' }], 24);
    expect(failed).toBe(true);
    expect(text).toContain('⚠️');
    expect(text).toContain('403');
    // A broken check and a stale deploy send someone to different places.
    expect(text).toContain('could not read the answer');
  });

  it('is green when nothing is behind', () => {
    const { failed, text } = formatReport([{ name: 'X', count: 0, oldest: null, hours: 0 }], 24);
    expect(failed).toBe(false);
    expect(text).toContain('within the threshold');
  });
});

describe('driftFor', () => {
  const stub = (map) => async (url) => {
    const key = Object.keys(map).find((k) => url.includes(k));
    if (!key) throw new Error(`unstubbed: ${url}`);
    return { ok: true, status: 200, json: async () => map[key] };
  };

  it('excludes the deployed commit itself from the drift', async () => {
    // `since` is inclusive, so the deployed commit comes back in the list when
    // it touched this path. Counting it would make a service report itself one
    // commit behind seconds after a successful deploy.
    const out = await driftFor(SERVICES[0], {
      token: 't',
      owner: 'o',
      repo: 'r',
      nowMs: NOW,
      fetchImpl: stub({
        '/runs?status=success': { workflow_runs: [{ head_sha: 'deployed', run_number: 1 }] },
        '/commits/deployed': { commit: { committer: { date: hoursAgo(5) } } },
        '/commits?sha=main': [commit('deployed', hoursAgo(5), 'the deployed one')],
      }),
    });
    expect(out.count).toBe(0);
    expect(out.oldest).toBe(null);
    expect(out.hours).toBe(0);
  });

  it('reports the age of the oldest undeployed commit', async () => {
    const out = await driftFor(SERVICES[0], {
      token: 't',
      owner: 'o',
      repo: 'r',
      nowMs: NOW,
      fetchImpl: stub({
        '/runs?status=success': { workflow_runs: [{ head_sha: 'deployed', run_number: 1 }] },
        '/commits/deployed': { commit: { committer: { date: hoursAgo(60) } } },
        '/commits?sha=main': [
          commit('new', hoursAgo(2), 'recent'),
          commit('old', hoursAgo(49), 'add the manifest route'),
        ],
      }),
    });
    expect(out.count).toBe(2);
    expect(out.hours).toBe(49);
    expect(out.oldest.message).toBe('add the manifest route');
  });

  it('returns the failure as a row instead of throwing, so one service cannot hide the others', async () => {
    const out = await driftFor(SERVICES[0], {
      token: 't',
      owner: 'o',
      repo: 'r',
      nowMs: NOW,
      fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }),
    });
    expect(out.error).toContain('403');
  });
});

describe('SERVICES', () => {
  it('covers both dispatch-only deploys', () => {
    expect(SERVICES.map((s) => s.workflow).sort()).toEqual([
      'deploy-azure-frontend.yml',
      'deploy-functions.yml',
    ]);
  });

  it('gives every service at least one path, or drift would always be zero', () => {
    for (const s of SERVICES) expect(s.paths.length).toBeGreaterThan(0);
  });
});
