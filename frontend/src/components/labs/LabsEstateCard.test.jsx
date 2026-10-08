/**
 * "The Hybrid Lab right now" (#664): five states, five sentences. The
 * unprovisioned state is the one that matters most — it must be the exact
 * sentence and no fabricated field — and the configured state must show its
 * ages in words, measured from the snapshot's `asOf`, with the Arc status as
 * a word. Arc's status change is never called a heartbeat (#1009).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LabsEstateCard, {
  ESTATE_LOADING_SENTENCE,
  ESTATE_ROUTE_MISSING_SENTENCE,
  NOT_PROVISIONED_SENTENCE,
} from './LabsEstateCard';

const AS_OF = Date.parse('2026-09-25T12:00:00Z');

const CONFIGURED = {
  configured: true,
  arc: {
    status: 'Connected',
    statusSince: new Date(AS_OF - 3 * 86_400_000).toISOString(),
    agentVersion: '1.52.02988.2222',
    osName: 'Ubuntu 24.04.3 LTS',
  },
  policy: { compliant: 12, nonCompliant: 1, notApplicable: 5 },
  agent: { online: true, queued: 2, lastHeartbeatAt: new Date(AS_OF - 20_000).toISOString() },
  coder: { reachable: true, running: 1, max: 5 },
  asOf: new Date(AS_OF).toISOString(),
};

describe('LabsEstateCard', () => {
  it('says the host is not provisioned, and shows no field, for configured: false', () => {
    render(<LabsEstateCard estate={{ configured: false }} loading={false} error={null} />);
    expect(screen.getByText(NOT_PROVISIONED_SENTENCE)).toBeInTheDocument();
    expect(screen.queryByTestId('estate-facts')).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
  });

  it('shows the loading sentence before anything arrives', () => {
    render(<LabsEstateCard estate={undefined} loading error={null} />);
    expect(screen.getByText(ESTATE_LOADING_SENTENCE)).toBeInTheDocument();
  });

  it('distinguishes a missing route from an unprovisioned host', () => {
    render(<LabsEstateCard estate={null} loading={false} error={null} />);
    expect(screen.getByText(ESTATE_ROUTE_MISSING_SENTENCE)).toBeInTheDocument();
    expect(screen.queryByText(NOT_PROVISIONED_SENTENCE)).not.toBeInTheDocument();
  });

  it('says the status could not be loaded on a failure, never what the error said', () => {
    render(
      <LabsEstateCard
        estate={undefined}
        loading={false}
        error={new Error('Resource Graph timed out')}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "The lab host's status couldn't be loaded. Please try again later."
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('Resource Graph');
  });

  it('names nothing the site runs on, in any state', () => {
    const { container } = render(
      <LabsEstateCard estate={CONFIGURED} loading={false} error={null} />
    );
    expect(container.textContent).not.toMatch(
      /hostinger|vps|function app|managed identity|resource graph|production estate|not configured|not provisioned/i
    );
  });

  it('renders every fact of a configured host in words', () => {
    render(<LabsEstateCard estate={CONFIGURED} loading={false} error={null} />);
    expect(screen.getByTestId('estate-arc-status')).toHaveTextContent('connected');
    // Measured from `asOf`, not the wall clock, so this is exact on any day.
    // A host connected for three days changed status three days ago, and the
    // label says that rather than calling it a heartbeat (#1009).
    expect(screen.getByText('Arc status since')).toBeInTheDocument();
    expect(screen.getByTestId('estate-arc-since')).toHaveTextContent('3 days ago');
    expect(screen.queryByText(/last heartbeat/i)).not.toBeInTheDocument();
    expect(screen.getByText('1.52.02988.2222')).toBeInTheDocument();
    expect(screen.getByText('Ubuntu 24.04.3 LTS')).toBeInTheDocument();
    expect(screen.getByTestId('estate-policy')).toHaveTextContent(
      '12 compliant, 1 non-compliant, 5 not applicable to this lab'
    );
    expect(screen.getByTestId('estate-agent')).toHaveTextContent('online, 2 jobs queued');
    expect(screen.getByText('Job runner heartbeat')).toBeInTheDocument();
    expect(screen.getByTestId('estate-runner-heartbeat')).toHaveTextContent('just now');
    expect(screen.getByTestId('estate-coder')).toHaveTextContent(
      'reachable, 1 of 5 workspaces running'
    );
    expect(screen.getByTestId('estate-as-of')).toBeInTheDocument();
  });

  it('says so when policy, the agent or Coder are absent, and when Arc recorded no status change', () => {
    render(
      <LabsEstateCard
        estate={{
          configured: true,
          arc: { status: 'Disconnected', statusSince: null, agentVersion: null, osName: null },
          policy: null,
          agent: null,
          coder: { reachable: false, running: 0, max: 0 },
          asOf: null,
        }}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByTestId('estate-arc-status')).toHaveTextContent('disconnected');
    expect(screen.getByTestId('estate-arc-since')).toHaveTextContent('not recorded');
    expect(screen.getByTestId('estate-policy')).toHaveTextContent('not evaluated');
    expect(screen.getByTestId('estate-agent')).toHaveTextContent('unavailable');
    expect(screen.getByTestId('estate-runner-heartbeat')).toHaveTextContent('unavailable');
    expect(screen.getByTestId('estate-coder')).toHaveTextContent('unreachable');
    expect(screen.queryByTestId('estate-as-of')).not.toBeInTheDocument();
  });

  it('says a running count it does not know is unknown, never zero', () => {
    // What the estate read folds in from the status read when that read
    // could see Coder answer but not count its workspaces.
    render(
      <LabsEstateCard
        estate={{ ...CONFIGURED, coder: { reachable: true, running: null, max: 5 } }}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByTestId('estate-coder')).toHaveTextContent('reachable, capacity unknown');
  });

  it('shows no runner heartbeat for a runner that is offline, rather than the age of its goodbye', () => {
    render(
      <LabsEstateCard
        estate={{ ...CONFIGURED, agent: { online: false, queued: 0, lastHeartbeatAt: null } }}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByTestId('estate-agent')).toHaveTextContent('offline, 0 jobs queued');
    expect(screen.getByTestId('estate-runner-heartbeat')).toHaveTextContent(
      'none in the last 90 seconds'
    );
  });
});
