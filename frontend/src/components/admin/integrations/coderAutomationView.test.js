/**
 * The Hybrid Lab card's "Automatic renewal" sentences and status, from the
 * lab host's last report (2026-10-08). Pure: every row and every colour is
 * decided here, and CoderAutomation.jsx only lays them out.
 */
import { describe, it, expect } from 'vitest';

import { NOT_SET_UP, SILENT_AFTER_DAYS, describeCoderAutomation } from './coderAutomationView';

const NOW = Date.parse('2026-10-08T12:00:00.000Z');
const DAY = 86_400_000;
const iso = (offsetDays) => new Date(NOW + offsetDays * DAY).toISOString();

const report = (over = {}) => ({
  agentId: 'vps-hostinger-01',
  reportedAt: iso(-0.1),
  checkedAt: iso(-0.1),
  statusTokenRotatedAt: '2026-10-08T04:30:00.000Z',
  statusTokenExpiresAt: '2027-10-08T04:30:00.000Z',
  rotationTokenExpiresAt: '2027-04-01T00:00:00.000Z',
  templatePushedAt: '2026-10-07T21:00:00.000Z',
  templateVersion: 'brave_turing4',
  lastError: null,
  ...over,
});

const read = (over) => ({ report: report(over), warningDays: 30 });

describe('before the first report', () => {
  it('says automatic renewal is not set up yet, with no status and nothing to colour', () => {
    for (const answer of [{ report: null, warningDays: 30 }, null, undefined, {}]) {
      expect(describeCoderAutomation(answer, NOW)).toEqual({
        setUp: false,
        status: null,
        rows: [],
        problems: [],
        note: NOT_SET_UP,
      });
    }
    expect(NOT_SET_UP).toBe('Automatic renewal not set up yet');
  });
});

describe('the rows', () => {
  it('lists renewal, rotation credential, template and last check, in that order', () => {
    const view = describeCoderAutomation(read(), NOW);
    expect(view.setUp).toBe(true);
    expect(view.rows).toEqual([
      {
        id: 'renewed',
        text: 'Status token renewed on 2026-10-08 (by the lab host); it expires on 2027-10-08.',
      },
      { id: 'rotation', text: 'Rotation credential expires on 2027-04-01.' },
      { id: 'template', text: 'Template last published 2026-10-07 (brave_turing4).' },
      { id: 'checked', text: 'Last automation check 2026-10-08 (2 h ago).' },
    ]);
  });

  it('says what has not happened yet, rather than leaving a row out', () => {
    const view = describeCoderAutomation(
      read({
        statusTokenRotatedAt: null,
        statusTokenExpiresAt: null,
        rotationTokenExpiresAt: null,
        templatePushedAt: null,
        templateVersion: null,
      }),
      NOW
    );
    expect(view.rows.map((row) => row.text)).toEqual([
      'Status token not renewed by the lab host yet.',
      'Rotation credential expiry not reported.',
      'Template not published by the lab host yet.',
      'Last automation check 2026-10-08 (2 h ago).',
    ]);
  });
});

describe('the status, lib/status.js’s, worst first', () => {
  it('is healthy when the last check went well and nothing is near expiry', () => {
    const view = describeCoderAutomation(read(), NOW);
    expect(view.status).toBe('healthy');
    expect(view.problems).toEqual([]);
  });

  it('is degraded (amber) for a failed check while the token is well inside its life', () => {
    const view = describeCoderAutomation(read({ lastError: 'template push failed' }), NOW);
    expect(view.status).toBe('degraded');
    expect(view.problems).toEqual([
      { status: 'degraded', text: 'Last check failed: template push failed' },
    ]);
  });

  it('is critical (red) for a failed check once the token is inside the renewal window', () => {
    const view = describeCoderAutomation(
      read({
        lastError: 'Coder refused the token (HTTP 401); the token was not stored',
        statusTokenExpiresAt: iso(12),
      }),
      NOW
    );
    expect(view.status).toBe('critical');
    expect(view.problems[0]).toEqual({
      status: 'critical',
      text: 'Last check failed: Coder refused the token (HTTP 401); the token was not stored',
    });
  });

  it('is critical once the status token or the rotation credential has expired', () => {
    expect(describeCoderAutomation(read({ statusTokenExpiresAt: iso(-1) }), NOW).problems).toEqual([
      { status: 'critical', text: `The status token expired on ${iso(-1).slice(0, 10)}.` },
    ]);
    const rotation = describeCoderAutomation(read({ rotationTokenExpiresAt: iso(-2) }), NOW);
    expect(rotation.status).toBe('critical');
    expect(rotation.problems[0].text).toMatch(/can no longer renew the status token/);
  });

  it('is degraded while the rotation credential is inside the window', () => {
    const view = describeCoderAutomation(read({ rotationTokenExpiresAt: iso(10.5) }), NOW);
    expect(view.status).toBe('degraded');
    expect(view.problems).toEqual([
      {
        status: 'degraded',
        text: 'The rotation credential expires in 10 days; renew it on the lab host before then.',
      },
    ]);
  });

  it('is degraded once the host has been silent for a week, whatever it last said', () => {
    const quiet = describeCoderAutomation(
      read({ checkedAt: iso(-(SILENT_AFTER_DAYS - 0.5)) }),
      NOW
    );
    expect(quiet.status).toBe('healthy');
    const silent = describeCoderAutomation(
      read({ checkedAt: iso(-(SILENT_AFTER_DAYS + 0.5)) }),
      NOW
    );
    expect(silent.status).toBe('degraded');
    expect(silent.problems).toEqual([
      { status: 'degraded', text: `The lab host has not reported for ${SILENT_AFTER_DAYS} days.` },
    ]);
  });

  it('takes the worst of several problems', () => {
    const view = describeCoderAutomation(
      read({ lastError: 'x', rotationTokenExpiresAt: iso(-1), checkedAt: iso(-30) }),
      NOW
    );
    expect(view.status).toBe('critical');
    expect(view.problems.map((p) => p.status)).toEqual(['critical', 'degraded', 'degraded']);
  });
});
