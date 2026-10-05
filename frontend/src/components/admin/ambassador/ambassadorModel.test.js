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
  MEMBERSHIP_STATUS,
  MEMBERSHIP_STATUSES,
  UNLOCKING_MEMBERSHIP,
  childProgramsOf,
  latestApplicationFor,
  programById,
  programGate,
  programsInPlay,
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

  it('counts evidence filed under the parent program for the program additional to it', () => {
    expect(evidenceRelevant({ programIds: ['mct'] }, 'rl', 'mct')).toBe(true);
    expect(evidenceRelevant({ programIds: ['mvp'] }, 'rl', 'mct')).toBe(false);
    expect(evidenceRelevant({ programIds: ['mct'] }, 'rl')).toBe(false);
  });
});

describe('additional programs (owner request 2026-10-05)', () => {
  const mct = { id: 'mct', name: 'MCT', order: 2, membershipStatus: 'working' };
  const rl = { id: 'rl', name: 'MCT Regional Lead', order: 3, parentProgramId: 'mct' };
  const mvp = { id: 'mvp', name: 'MVP', order: 1 };

  it('programGate is shut until the parent membership is Active, and names the parent', () => {
    expect(UNLOCKING_MEMBERSHIP).toBe('active');
    const byId = programById([mvp, mct, rl]);
    expect(programGate(mvp, byId)).toEqual({ gated: false, unlocked: true, parent: null });
    expect(programGate(rl, byId)).toEqual({
      gated: true,
      unlocked: false,
      parent: { id: 'mct', name: 'MCT', membershipStatus: 'working' },
    });
    expect(
      programGate(rl, programById([mvp, { ...mct, membershipStatus: 'active' }, rl]))
    ).toMatchObject({ unlocked: true });
    // A parent that is gone keeps the gate shut rather than opening it.
    expect(programGate(rl, programById([mvp, rl]))).toMatchObject({
      unlocked: false,
      parent: { id: 'mct', name: null, membershipStatus: 'none' },
    });
  });

  it('lists the programs in play: top level, each followed by the children its membership opened', () => {
    expect(programsInPlay([rl, mct, mvp]).map((p) => p.id)).toEqual(['mct', 'mvp']);
    const active = { ...mct, membershipStatus: 'active' };
    expect(programsInPlay([rl, active, mvp]).map((p) => p.id)).toEqual(['mct', 'rl', 'mvp']);
    expect(childProgramsOf([rl, mct, mvp], 'mct')).toEqual([rl]);
    expect(childProgramsOf([rl, mct, mvp], 'mvp')).toEqual([]);
  });

  it('shows a program whose parent is itself parented at top level rather than hiding it (#881 review)', () => {
    // A chain the API did not catch in a race: rl → mct → mvp. Nothing vanishes.
    const chained = { ...mct, parentProgramId: 'mvp', membershipStatus: 'active' };
    const activeMvp = { ...mvp, membershipStatus: 'active' };
    expect(
      programsInPlay([rl, chained, activeMvp])
        .map((p) => p.id)
        .sort()
    ).toEqual(['mct', 'mvp', 'rl']);
    // A two-program cycle: both at top level.
    const a = { id: 'a', name: 'A', parentProgramId: 'b', membershipStatus: 'active' };
    const b = { id: 'b', name: 'B', parentProgramId: 'a', membershipStatus: 'active' };
    expect(
      programsInPlay([a, b])
        .map((p) => p.id)
        .sort()
    ).toEqual(['a', 'b']);
  });

  it('carries parentProgramId through the program form both ways, empty as null', () => {
    expect(programForm({ name: 'X', parentProgramId: 'mct' }).parentProgramId).toBe('mct');
    expect(programForm({ name: 'X' }).parentProgramId).toBe('');
    expect(
      programPayload(programForm({ name: 'X', parentProgramId: 'mct' })).value.parentProgramId
    ).toBe('mct');
    expect(programPayload(programForm({ name: 'X' })).value.parentProgramId).toBeNull();
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

describe('membership status (owner request 2026-10-05)', () => {
  it('is a four-word vocabulary with none first, carried through the program form both ways', () => {
    expect(MEMBERSHIP_STATUSES).toEqual(['none', 'working', 'active', 'denied']);
    expect(MEMBERSHIP_STATUS.active.label).toBe('Active');
    expect(programForm({ name: 'X', membershipStatus: 'working' }).membershipStatus).toBe(
      'working'
    );
    expect(programForm({ name: 'X', membershipStatus: 'bogus' }).membershipStatus).toBe('none');
    const payload = programPayload({ ...programForm({ name: 'X' }), membershipStatus: 'denied' });
    expect(payload.value.membershipStatus).toBe('denied');
  });

  it('latestApplicationFor picks the most recently updated application of a program', () => {
    const apps = [
      { id: 'a', programId: 'p1', status: 'interested', updatedAt: '2026-09-01T00:00:00Z' },
      { id: 'b', programId: 'p1', status: 'denied', updatedAt: '2026-10-01T00:00:00Z' },
      { id: 'c', programId: 'p2', status: 'active', updatedAt: '2026-10-02T00:00:00Z' },
    ];
    expect(latestApplicationFor(apps, 'p1')?.id).toBe('b');
    expect(latestApplicationFor(apps, 'p3')).toBeNull();
    expect(latestApplicationFor(undefined, 'p1')).toBeNull();
  });
});
