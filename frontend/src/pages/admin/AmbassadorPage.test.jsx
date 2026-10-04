/**
 * The Ambassador hub page (ADR 0033 §4). What must hold: the header and five
 * tabs with Settings last; the not-provisioned state names the plan command
 * and nothing else; the Dashboard counts programs and pursuits and asks for
 * readiness; Programs starts an application; the workspace offers only the
 * allowed status moves and attaches evidence; the import picker marks what is
 * already in and posts the chosen ids; Settings disables with a PATCH.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

import AmbassadorPage from './AmbassadorPage';

const getJSON = vi.fn();
const postJSON = vi.fn();
const sendJSON = vi.fn();
const setSearchParams = vi.fn();
let searchParams = '';

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  postJSON: (...args) => postJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
}));
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('react-router', () => ({
  useSearchParams: () => [new URLSearchParams(searchParams), setSearchParams],
  useLocation: () => ({ pathname: '/admin/ambassador' }),
  Link: ({ to, children, ...rest }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const PROGRAMS = [
  {
    id: 'program-mvp',
    docType: 'program',
    name: 'Microsoft MVP',
    provider: 'Microsoft',
    category: 'community-expert',
    description: 'Community leadership.',
    enabled: true,
    order: 1,
    applicationWindow: { opens: null, closes: null, note: 'Rolling.' },
    requirements: [
      {
        id: 'talks',
        label: 'Speaking engagements',
        description: '',
        evidenceTypes: ['speaking'],
        minCount: 2,
        weight: 3,
      },
    ],
    eligibility: ['Nominated'],
    criteria: ['Impact'],
    recommendedActivities: [],
    reminders: { daysBeforeDeadline: 14, daysBeforeRenewal: 30 },
  },
  {
    id: 'program-star',
    docType: 'program',
    name: 'GitHub Star',
    provider: 'GitHub',
    category: 'community-expert',
    description: 'Stars.',
    enabled: false,
    order: 2,
    applicationWindow: { opens: null, closes: null, note: '' },
    requirements: [],
  },
];

const inDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const APPLICATIONS = [
  {
    id: 'application-1',
    docType: 'application',
    programId: 'program-mvp',
    title: 'Microsoft MVP 2026',
    status: 'preparing',
    submissionDeadline: inDays(60),
    evidenceIds: [],
    responses: [],
    files: [],
    links: [],
    history: [
      {
        at: '2026-10-01T10:00:00.000Z',
        by: 'owner',
        from: null,
        to: 'interested',
        note: 'Created',
      },
    ],
    private: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  },
];

const EVIDENCE = [
  {
    id: 'evidence-1',
    docType: 'evidence',
    title: 'KCDC talk',
    date: '2026-08-14',
    sourceModule: 'speaking',
    programIds: [],
    verificationStatus: 'unverified',
  },
];

const READINESS = {
  programId: 'program-mvp',
  score: 0,
  explanation:
    'Score is the weight of met requirements (0) over the total weight (3), as a percentage. Acceptance is decided by the program.',
  requirements: [
    {
      id: 'talks',
      label: 'Speaking engagements',
      minCount: 2,
      weight: 3,
      count: 1,
      met: false,
      items: [],
    },
  ],
  missing: [{ id: 'talks', label: 'Speaking engagements', shortfall: 1 }],
  expiring: [],
};

const routes =
  (over = {}) =>
  async (route) => {
    const table = {
      'cms/ambassador/programs': { items: PROGRAMS },
      'cms/ambassador/applications': { items: APPLICATIONS },
      'cms/ambassador/evidence': { items: EVIDENCE },
      'cms/ambassador/readiness/program-mvp': { readiness: READINESS },
      'cms/ambassador/evidence/sources/speaking': {
        items: [
          { id: 'event-1', title: 'KCDC talk', date: '2026-08-14', imported: true },
          { id: 'event-2', title: 'Meetup talk', date: '2026-09-01', imported: false },
        ],
      },
      ...over,
    };
    if (route in table) return table[route];
    throw new Error(`unexpected route ${route}`);
  };

const hubTabs = () => within(screen.getByRole('tablist', { name: 'Ambassador Hub' }));
const panel = () => within(screen.getByRole('tabpanel'));

beforeEach(() => {
  searchParams = '';
  setSearchParams.mockReset();
  getJSON.mockReset().mockImplementation(routes());
  postJSON
    .mockReset()
    .mockResolvedValue({ success: true, id: 'application-new', item: { id: 'application-new' } });
  sendJSON.mockReset().mockResolvedValue({ success: true, item: {} });
});

describe('header, tabs and the not-provisioned state', () => {
  it('names the hub, explains the goal in its help, and offers five tabs with Settings last', () => {
    render(<AmbassadorPage />);
    expect(screen.getByRole('heading', { name: /Ambassador Hub/ })).toBeInTheDocument();
    expect(
      hubTabs()
        .getAllByRole('tab')
        .map((t) => t.textContent)
    ).toEqual(['Dashboard', 'Programs', 'Applications', 'Evidence', 'Settings']);
    fireEvent.click(screen.getByRole('button', { name: /How this works/ }));
    expect(screen.getByText(/culminate in a credible application/)).toBeInTheDocument();
  });

  it('shows the plan command, and nothing else, when the API says NOT_PROVISIONED', async () => {
    getJSON.mockImplementation(async () => {
      const error = new Error('Run terraform apply for the ambassador container');
      error.status = 503;
      error.code = 'NOT_PROVISIONED';
      throw error;
    });
    render(<AmbassadorPage />);
    expect(await screen.findByText(/not provisioned yet/)).toBeInTheDocument();
    expect(screen.getByText('terraform -chdir=infra plan')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load/)).not.toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Ambassador Hub' })).toBeInTheDocument();
  });
});

describe('Dashboard', () => {
  it('counts programs and pursuits, asks for readiness per pursued program, and lists what to do next', async () => {
    render(<AmbassadorPage />);
    const overview = within(await screen.findByRole('group', { name: 'Overview' }));
    expect(overview.getByText('Programs').nextSibling.textContent).toBe('1');
    expect(overview.getByText('Pursued').nextSibling.textContent).toBe('1');
    expect(await panel().findByText(/1 more speaking engagements needed/)).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith('cms/ambassador/readiness/program-mvp');
    expect(panel().getByText(/submission deadline/)).toBeInTheDocument();
  });
});

describe('Programs', () => {
  it('lists the catalogue with disabled programs marked, and starts an application', async () => {
    searchParams = 'tab=programs';
    render(<AmbassadorPage />);
    const cards = await panel().findAllByTestId('program-card');
    expect(cards).toHaveLength(2);
    expect(panel().getByText('Disabled')).toBeInTheDocument();
    const mvp = within(cards.find((c) => c.textContent.includes('Microsoft MVP')));
    await act(async () => {
      fireEvent.click(mvp.getByRole('button', { name: /Start application/ }));
    });
    expect(postJSON).toHaveBeenCalledWith('cms/ambassador/applications', {
      programId: 'program-mvp',
    });
    await waitFor(() =>
      expect(setSearchParams).toHaveBeenCalledWith({
        tab: 'applications',
        application: 'application-new',
      })
    );
  });
});

describe('Applications', () => {
  it('opens the workspace with the allowed moves only, attaches evidence from the checklist, and records a status change with its note', async () => {
    searchParams = 'tab=applications&application=application-1';
    render(<AmbassadorPage />);
    const workspace = within(await screen.findByTestId('application-workspace'));
    const moves = within(workspace.getByLabelText('Move to'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(moves).toEqual(['Choose…', 'Ready', 'Interested', 'Withdrawn']);

    await act(async () => {
      fireEvent.click(await workspace.findByLabelText(/KCDC talk/));
    });
    expect(sendJSON).toHaveBeenCalledWith('cms/ambassador/applications/application-1', 'PATCH', {
      evidenceIds: ['evidence-1'],
    });

    fireEvent.change(workspace.getByLabelText('Move to'), { target: { value: 'ready' } });
    fireEvent.change(workspace.getByLabelText('Note for the history'), {
      target: { value: 'Two talks in' },
    });
    await act(async () => {
      fireEvent.click(workspace.getByRole('button', { name: 'Apply' }));
    });
    expect(sendJSON).toHaveBeenCalledWith('cms/ambassador/applications/application-1', 'PATCH', {
      status: 'ready',
      statusNote: 'Two talks in',
    });
    expect(workspace.getByText(/— Created/)).toBeInTheDocument(); // the history row
  });
});

describe('Evidence', () => {
  it('imports from Speaking through a picker that marks what is already in', async () => {
    searchParams = 'tab=evidence';
    postJSON.mockResolvedValue({
      success: true,
      created: [{ id: 'evidence-2' }],
      existing: [],
      missing: [],
    });
    render(<AmbassadorPage />);
    await panel().findAllByTestId('evidence-card');
    fireEvent.click(panel().getByRole('button', { name: /Import from Speaking/ }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByText('1 available · 1 already imported')).toBeInTheDocument();
    expect(dialog.getByLabelText(/KCDC talk/)).toBeDisabled();
    fireEvent.click(dialog.getByLabelText(/Meetup talk/));
    await act(async () => {
      fireEvent.click(dialog.getByRole('button', { name: /Import 1 item/ }));
    });
    expect(postJSON).toHaveBeenCalledWith('cms/ambassador/evidence/import', {
      sourceModule: 'speaking',
      ids: ['event-2'],
      programIds: [],
    });
  });
});

describe('Settings', () => {
  it('is last, and disables a program with a PATCH rather than a delete', async () => {
    searchParams = 'tab=settings';
    render(<AmbassadorPage />);
    const row = (await panel().findByText('Microsoft MVP')).closest('tr');
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Disable' }));
    });
    expect(sendJSON).toHaveBeenCalledWith('cms/ambassador/programs/program-mvp', 'PATCH', {
      enabled: false,
    });
    expect(sendJSON).not.toHaveBeenCalledWith(expect.anything(), 'DELETE');
  });
});
