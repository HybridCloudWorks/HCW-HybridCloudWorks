import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PipelineStepper, {
  PIPELINE_STAGES,
  getPipelineStageIndex,
  isPipelineRejected,
} from './PipelineStepper';
import { CONTENT_STATUS } from '@/lib/status';

describe('PipelineStepper stages', () => {
  it('draws the six stages the dashboard draws, in its order', () => {
    expect(PIPELINE_STAGES.map((s) => s.label)).toEqual([
      'New Content',
      'Drafts',
      'Review',
      'Editor',
      'Publish',
      'Live',
    ]);
  });

  it('places every stored status at the stage lib/status.js names', () => {
    expect(getPipelineStageIndex('drafting')).toBe(1);
    for (const status of ['draft', 'ingested', 'inspected', 'in_review']) {
      expect(getPipelineStageIndex(status), status).toBe(2);
    }
    for (const status of ['approved', 'editing', 'needs_rework']) {
      expect(getPipelineStageIndex(status), status).toBe(3);
    }
    expect(getPipelineStageIndex('forge_ready')).toBe(4);
    expect(getPipelineStageIndex('published')).toBe(5);
    // Every status in the vocabulary resolves to a real stage.
    for (const id of Object.keys(CONTENT_STATUS)) {
      expect(getPipelineStageIndex(id)).toBeGreaterThanOrEqual(0);
      expect(getPipelineStageIndex(id)).toBeLessThan(PIPELINE_STAGES.length);
    }
  });

  it('reads the legacy spellings and the Live flag', () => {
    expect(getPipelineStageIndex('approved_blog')).toBe(3);
    expect(getPipelineStageIndex('published_blog')).toBe(5);
    expect(getPipelineStageIndex({ contentStatus: 'editing', Live: true })).toBe(5);
  });

  it('marks a rejected item instead of a stage', () => {
    expect(isPipelineRejected('rejected')).toBe(true);
    expect(isPipelineRejected({ contentStatus: 'approved' })).toBe(false);
    render(<PipelineStepper status="rejected" />);
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.queryByRole('listitem', { current: 'step', name: /Review/ })).toBeNull();
  });

  it('renders the current stage as the current step', () => {
    render(<PipelineStepper item={{ contentStatus: 'approved' }} />);
    const current = screen.getByRole('listitem', { current: 'step' });
    expect(current).toHaveTextContent('Editor');
    expect(screen.getByText('Drafts').closest('[role="listitem"]')).not.toHaveAttribute(
      'aria-current'
    );
  });
});
