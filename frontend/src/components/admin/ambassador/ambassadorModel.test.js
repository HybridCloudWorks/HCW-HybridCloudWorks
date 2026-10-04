/**
 * The Ambassador hub's pure rules (ADR 0033 §4): the status table matches the
 * API's, the Dashboard's dated items and warnings are computed from the
 * records, and the export carries the application with its evidence.
 */
import { describe, it, expect } from 'vitest';
import {
  AMBASSADOR_STATUS,
  APPLICATION_STATUSES,
  allowedTransitions,
  applicationExport,
  daysUntil,
  evidenceRelevant,
  expiringEvidence,
  programForm,
  programPayload,
  recommendedActions,
  statusCounts,
  upcomingDeadlines,
  windowState,
} from './ambassadorModel';

const TODAY = '2026-10-03';

describe('statuses', () => {
  it('has a badge for every status and a transition row for each', () => {
    for (const status of APPLICATION_STATUSES) {
      expect(AMBASSADOR_STATUS[status].label).toBeTruthy();
      expect(Array.isArray(allowedTransitions(status))).toBe(true);
    }
    expect(allowedTransitions('interested')).toEqual(['preparing', 'withdrawn']);
    expect(allowedTransitions('nope')).toEqual([]);
  });
});

describe('dates on the dashboard', () => {
  const programs = [
    { id: 'p1', name: 'MVP', applicationWindow: { opens: null, closes: null } },
    { id: 'p2', name: 'vExpert', applicationWindow: { opens: '2026-11-01', closes: '2026-12-15' } },
    {
      id: 'p3',
      name: 'Off',
      enabled: false,
      applicationWindow: { opens: '2026-10-10', closes: null },
    },
  ];
  const applications = [
    {
      id: 'a1',
      programId: 'p1',
      status: 'preparing',
      submissionDeadline: '2026-10-20',
      evidenceIds: [],
    },
    {
      id: 'a2',
      programId: 'p2',
      status: 'active',
      renewalDate: '2027-01-15',
      expirationDate: '2026-09-01',
    },
  ];

  it('lists deadlines, renewals and open windows soonest first, skipping the past and disabled programs', () => {
    const items = upcomingDeadlines(applications, programs, { today: TODAY });
    expect(items.map((i) => [i.date, i.kind])).toEqual([
      ['2026-10-20', 'deadline'],
      ['2026-11-01', 'window'],
      ['2026-12-15', 'window'],
      ['2027-01-15', 'renewal'],
    ]);
    expect(items[0].daysLeft).toBe(17);
    expect(daysUntil('2026-10-04', TODAY)).toBe(1);
    expect(daysUntil(null, TODAY)).toBeNull();
  });

  it('knows whether a window is open', () => {
    expect(windowState(programs[0], TODAY)).toBe('rolling');
    expect(windowState(programs[1], TODAY)).toBe('closed');
    expect(windowState(programs[1], '2026-11-20')).toBe('open');
  });

  it('flags evidence ten to twelve months old as about to stop counting', () => {
    const evidence = [
      { id: 'old', date: '2025-10-15' },
      { id: 'edge', date: '2025-11-20' },
      { id: 'fresh', date: '2026-06-01' },
      { id: 'gone', date: '2024-01-01' },
    ];
    expect(expiringEvidence(evidence, { today: TODAY }).map((e) => e.id)).toEqual(['old', 'edge']);
  });

  it('counts statuses and recommends the next actions in words', () => {
    expect(statusCounts(applications)).toMatchObject({ preparing: 1, active: 1, denied: 0 });
    const actions = recommendedActions({
      applications,
      programs,
      evidence: [{ id: 'e', verificationStatus: 'unverified' }],
      readinessById: { p1: { missing: [{ id: 'talks', label: 'Talks', shortfall: 2 }] } },
      today: TODAY,
    });
    expect(actions).toEqual([
      'MVP: 2 more talks needed.',
      'MVP: attach evidence from the Evidence tab.',
      'MVP: submission closes in 17 days.',
      '1 evidence item still unverified.',
    ]);
  });
});

describe('export and relevance', () => {
  it('carries the application, the program outline and only the attached evidence', () => {
    const out = applicationExport(
      { id: 'a1', programId: 'p1', evidenceIds: ['e1'] },
      { id: 'p1', name: 'MVP', provider: 'Microsoft', requirements: [], secret: 'no' },
      [{ id: 'e1' }, { id: 'e2' }]
    );
    expect(out.evidence).toEqual([{ id: 'e1' }]);
    expect(out.program).toEqual({ id: 'p1', name: 'MVP', provider: 'Microsoft', requirements: [] });
    expect(out.exportedAt).toMatch(/^\d{4}-/);
  });

  it('treats evidence naming no program as relevant to every program', () => {
    expect(evidenceRelevant({ programIds: [] }, 'p1')).toBe(true);
    expect(evidenceRelevant({ programIds: ['p2'] }, 'p1')).toBe(false);
  });
});

describe('program form', () => {
  it('round-trips a program through the form and refuses a missing name or label', () => {
    const form = programForm({
      name: 'MVP',
      eligibility: ['A', 'B'],
      requirements: [
        {
          id: 'talks',
          label: 'Talks',
          evidenceTypes: ['speaking', 'bogus'],
          minCount: '2',
          weight: 3,
        },
      ],
      applicationWindow: { opens: '2026-01-01' },
    });
    expect(form.eligibility).toBe('A\nB');
    const payload = programPayload(form).value;
    expect(payload).toMatchObject({
      name: 'MVP',
      eligibility: ['A', 'B'],
      applicationWindow: { opens: '2026-01-01', closes: null, note: '' },
      requirements: [
        { id: 'talks', label: 'Talks', evidenceTypes: ['speaking'], minCount: 2, weight: 3 },
      ],
    });
    expect(programPayload({ ...form, name: ' ' }).error).toMatch(/name/);
    expect(programPayload({ ...form, requirements: [{ label: '' }] }).error).toMatch(
      /Requirement 1/
    );
    expect(programPayload({ ...form, applicationUrl: 'mvp.microsoft.com' }).error).toMatch(/http/);
  });
});
