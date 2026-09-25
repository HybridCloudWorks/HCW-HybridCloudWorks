/**
 * The Coder status card (#680): "not yet provisioned", "unreachable", and
 * the healthy state with templates and capacity, plus the loading, missing-
 * route and failure sentences.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CoderStatusCard, {
  CODER_LOADING_SENTENCE,
  CODER_NOT_PROVISIONED_SENTENCE,
  CODER_ROUTE_MISSING_SENTENCE,
  CODER_UNREACHABLE_SENTENCE,
} from './CoderStatusCard';

const HEALTHY = {
  configured: true,
  reachable: true,
  templates: [{ name: 'hcw-lab', activeVersion: 'v0.3.1' }],
  capacity: { running: 1, max: 5 },
  asOf: '2026-09-25T12:00:00Z',
};

describe('CoderStatusCard', () => {
  it('says Coder is not yet provisioned for configured: false', () => {
    render(<CoderStatusCard status={{ configured: false }} loading={false} error={null} />);
    expect(screen.getByText(CODER_NOT_PROVISIONED_SENTENCE)).toBeInTheDocument();
    expect(screen.queryByTestId('coder-templates')).not.toBeInTheDocument();
  });

  it('says unreachable, and shows no numbers, when the proxy could not reach Coder', () => {
    render(
      <CoderStatusCard
        status={{ ...HEALTHY, reachable: false, templates: [], capacity: { running: 0, max: 0 } }}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByTestId('coder-status')).toHaveTextContent(CODER_UNREACHABLE_SENTENCE);
    expect(screen.queryByTestId('coder-templates')).not.toBeInTheDocument();
    expect(screen.queryByText(/workspaces running/)).not.toBeInTheDocument();
  });

  it('lists templates and capacity when healthy', () => {
    render(<CoderStatusCard status={HEALTHY} loading={false} error={null} />);
    expect(screen.getByTestId('coder-status')).toHaveTextContent(
      'Coder is reachable: 1 of 5 workspaces running.'
    );
    const templates = screen.getByTestId('coder-templates');
    expect(within(templates).getByText('hcw-lab')).toBeInTheDocument();
    expect(within(templates).getByText('active version v0.3.1')).toBeInTheDocument();
    expect(screen.getByTestId('coder-as-of')).toBeInTheDocument();
  });

  it('says when no template is published yet', () => {
    render(<CoderStatusCard status={{ ...HEALTHY, templates: [] }} loading={false} error={null} />);
    expect(screen.getByTestId('coder-templates')).toHaveTextContent(
      'No template is published yet.'
    );
  });

  it('has a sentence for loading, a missing route and a failure', () => {
    const { rerender } = render(<CoderStatusCard status={undefined} loading error={null} />);
    expect(screen.getByText(CODER_LOADING_SENTENCE)).toBeInTheDocument();

    rerender(<CoderStatusCard status={null} loading={false} error={null} />);
    expect(screen.getByText(CODER_ROUTE_MISSING_SENTENCE)).toBeInTheDocument();

    rerender(<CoderStatusCard status={undefined} loading={false} error={new Error('HTTP 502')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 502');
  });
});
