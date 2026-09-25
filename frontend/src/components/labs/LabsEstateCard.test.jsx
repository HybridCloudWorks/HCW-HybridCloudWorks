/**
 * "The Hybrid Lab right now" (#664): five states, five sentences. The
 * unprovisioned state is the one that matters most — it must be the exact
 * sentence and no fabricated field — and the configured state must show a
 * heartbeat age in words, measured from the snapshot's `asOf`, with the Arc
 * status as a word.
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
    lastHeartbeatAt: new Date(AS_OF - 4 * 60_000).toISOString(),
    agentVersion: '1.52.02988.2222',
    osName: 'Ubuntu 24.04.3 LTS',
  },
  policy: { compliant: 12, nonCompliant: 1 },
  agent: { online: true, queued: 2 },
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

  it('shows the server sentence on a failure', () => {
    render(
      <LabsEstateCard
        estate={undefined}
        loading={false}
        error={new Error('Resource Graph timed out')}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Resource Graph timed out');
  });

  it('renders every fact of a configured host in words', () => {
    render(<LabsEstateCard estate={CONFIGURED} loading={false} error={null} />);
    expect(screen.getByTestId('estate-arc-status')).toHaveTextContent('connected');
    // Measured from `asOf`, not the wall clock, so this is exact on any day.
    expect(screen.getByTestId('estate-heartbeat')).toHaveTextContent('4 minutes ago');
    expect(screen.getByText('1.52.02988.2222')).toBeInTheDocument();
    expect(screen.getByText('Ubuntu 24.04.3 LTS')).toBeInTheDocument();
    expect(screen.getByTestId('estate-policy')).toHaveTextContent('12 compliant, 1 non-compliant');
    expect(screen.getByTestId('estate-agent')).toHaveTextContent('online, 2 jobs queued');
    expect(screen.getByTestId('estate-coder')).toHaveTextContent(
      'reachable, 1 of 5 workspaces running'
    );
    expect(screen.getByTestId('estate-as-of')).toBeInTheDocument();
  });

  it('says so when policy, the agent or Coder are absent, and when Arc has no heartbeat', () => {
    render(
      <LabsEstateCard
        estate={{
          configured: true,
          arc: { status: 'Disconnected', lastHeartbeatAt: null, agentVersion: null, osName: null },
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
    expect(screen.getByTestId('estate-heartbeat')).toHaveTextContent('no heartbeat recorded');
    expect(screen.getByTestId('estate-policy')).toHaveTextContent('not evaluated');
    expect(screen.getByTestId('estate-agent')).toHaveTextContent('not registered');
    expect(screen.getByTestId('estate-coder')).toHaveTextContent('unreachable');
    expect(screen.queryByTestId('estate-as-of')).not.toBeInTheDocument();
  });
});
