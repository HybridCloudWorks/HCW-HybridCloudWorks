/**
 * The Labs Hub's shell and its two new tabs (#577).
 *
 * This page had no tests at all before #577 — 693 lines, including the agent
 * staleness rendering that T-309 was filed against. These cover what the
 * reorganisation decides: which panel a `?tab=` picks, that a job's output is
 * reachable outside the Console, and that a stale agent is told to restart
 * rather than reinstall.
 *
 * react-router is mocked rather than wrapped, as the other hub tests do, so a
 * tab click can be asserted as the `setSearchParams` call it is.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LabsPage from './LabsPage';

const postJSON = vi.fn();
let searchParams = '';
const setSearchParams = vi.fn();

vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ postJSON: (...args) => postJSON(...args) }));
vi.mock('react-router', () => ({
  useSearchParams: () => [new URLSearchParams(searchParams), setSearchParams],
}));

const RECENT = new Date(Date.now() - 5_000).toISOString();
const LONG_AGO = new Date(Date.now() - 600_000).toISOString();

const snapshot = (over = {}) => ({
  agents: [{ id: 'vps-1', agentId: 'vps-1', lastSeenAt: RECENT }],
  jobs: [
    {
      id: 'job-1',
      type: 'shell-echo',
      status: 'succeeded',
      agentId: 'vps-1',
      createdAt: '2026-09-16T12:00:00Z',
      claimedAt: '2026-09-16T12:00:00Z',
      finishedAt: '2026-09-16T12:00:02Z',
      exitCode: 0,
      output: 'hello vps',
    },
  ],
  jobTypes: [{ type: 'shell-echo' }],
  ...over,
});

beforeEach(() => {
  searchParams = '';
  setSearchParams.mockReset();
  postJSON.mockReset().mockResolvedValue(snapshot());
});

const hubTabs = () => screen.getByRole('tablist', { name: 'Labs Hub' });

describe('which panel the page shows', () => {
  it('opens on Dashboard when there is no ?tab=', async () => {
    render(<LabsPage />);
    expect(await screen.findByText('Jobs queued')).toBeInTheDocument();
  });

  it('sends the old `setup` id to Settings, where the steps went', async () => {
    // `setup` was a real tab id, so links naming it exist. It used to fall
    // through to Dashboard silently.
    searchParams = 'tab=setup';
    render(<LabsPage />);
    expect(await screen.findByText(/Harden the Hostinger VPS/)).toBeInTheDocument();
  });

  it('shows Dashboard for an unknown tab', async () => {
    searchParams = 'tab=nope';
    render(<LabsPage />);
    expect(await screen.findByText('Jobs queued')).toBeInTheDocument();
  });

  it('puts the selected tab in the URL rather than local state', async () => {
    render(<LabsPage />);
    await screen.findByText('Jobs queued');
    fireEvent.click(within(hubTabs()).getByRole('tab', { name: 'Jobs' }));
    expect(setSearchParams).toHaveBeenCalledWith({ tab: 'jobs' });
  });
});

describe('the Jobs tab (new in #577)', () => {
  it('lists a run and expands it to what it printed', async () => {
    searchParams = 'tab=jobs';
    render(<LabsPage />);

    expect(await screen.findByText('shell-echo')).toBeInTheDocument();
    expect(screen.getByText('2.0s')).toBeInTheDocument();
    // The output is the point: before #577 it existed only for whichever job
    // the Console had just submitted.
    expect(screen.queryByText('hello vps')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Show output for shell-echo/i }));
    expect(await screen.findByText('hello vps')).toBeInTheDocument();
  });

  it('says a finished job printed nothing, rather than showing an empty box', async () => {
    postJSON.mockResolvedValue(
      snapshot({
        jobs: [{ id: 'j2', type: 'terraform-plan', status: 'succeeded', exitCode: 0 }],
      })
    );
    searchParams = 'tab=jobs';
    render(<LabsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Show output for terraform-plan/i }));
    expect(await screen.findByText('(no output)')).toBeInTheDocument();
  });

  it('distinguishes a running job from one that finished silently', async () => {
    postJSON.mockResolvedValue(
      snapshot({ jobs: [{ id: 'j3', type: 'shell-echo', status: 'running' }] })
    );
    searchParams = 'tab=jobs';
    render(<LabsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Show output for shell-echo/i }));
    expect(await screen.findByText(/Still running/)).toBeInTheDocument();
  });

  it('is empty, not broken, when no job has ever run', async () => {
    postJSON.mockResolvedValue(snapshot({ jobs: [] }));
    searchParams = 'tab=jobs';
    render(<LabsPage />);
    expect(await screen.findByText(/No jobs yet/)).toBeInTheDocument();
  });
});

describe('the Agents tab (new in #577)', () => {
  it('tells a stale agent to restart, not to reinstall', async () => {
    // The distinction the tab exists for: this agent IS installed. Sending an
    // operator through six provisioning steps is the wrong fix.
    postJSON.mockResolvedValue(
      snapshot({ agents: [{ id: 'vps-1', agentId: 'vps-1', lastSeenAt: LONG_AGO }] })
    );
    searchParams = 'tab=agents';
    render(<LabsPage />);

    expect(await screen.findByText(/registered but offline/i)).toBeInTheDocument();
    expect(screen.getByText(/systemctl restart hcw-labs-agent/)).toBeInTheDocument();
    expect(screen.getAllByText(/journalctl/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Harden the Hostinger VPS/)).not.toBeInTheDocument();
  });

  it('sends a never-connected estate to the provisioning steps instead', async () => {
    postJSON.mockResolvedValue(snapshot({ agents: [] }));
    searchParams = 'tab=agents';
    render(<LabsPage />);

    expect(await screen.findByText(/Nothing has ever connected/)).toBeInTheDocument();
    // No reconnect advice: there is nothing to reconnect.
    expect(screen.queryByText(/systemctl restart/)).not.toBeInTheDocument();
  });

  it('says nothing to fix when an agent is heartbeating', async () => {
    searchParams = 'tab=agents';
    render(<LabsPage />);

    expect(await screen.findByText(/1 agent\(s\) connected/)).toBeInTheDocument();
    expect(screen.queryByText(/systemctl restart/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing has ever connected/)).not.toBeInTheDocument();
  });
});

describe('the snapshot', () => {
  it('is read once for the whole page', async () => {
    render(<LabsPage />);
    await screen.findByText('Jobs queued');
    await waitFor(() => expect(postJSON).toHaveBeenCalledWith('getLabsSnapshot', {}));
  });
});
