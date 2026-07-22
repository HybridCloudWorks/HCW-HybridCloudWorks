import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import OpsHealthPage from './OpsHealthPage';

const postJSON = vi.fn();

vi.mock('@/hooks/useAuthReady', () => ({
  useAuthReady: () => ({ authReady: true }),
}));

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
}));

describe('OpsHealthPage', () => {
  beforeEach(() => {
    postJSON.mockReset();
  });

  it('renders readiness and publishing metrics from the backend snapshot', async () => {
    postJSON.mockResolvedValue({
      success: true,
      readiness: {
        functionsConfigured: true,
        publishedItems: 14,
        missingSlugCount: 2,
        rssSources: 11,
      },
      digest: {
        digestDate: '2026-04-12',
        totalQueued: 8,
        recentRssCount: 5,
        publishingOps: {
          status: 'degraded',
          due: 4,
          published: 3,
          skipped: 1,
          failed: 1,
          lastRunAt: { toDate: () => new Date('2026-04-12T10:00:00Z') },
        },
        publishingWatchdog: {
          overdueScheduledCount: 2,
          stagedTooLongCount: 1,
        },
      },
      alerts: [],
      operationalSignals: {
        queueBreachCount: 3,
        oldestStagedHours: 18,
        openAlertAgeHours: 6,
        publishFailureCount: 1,
        orphanedGeneratedImages: 2,
        lastSchedulerSuccessAt: { toDate: () => new Date('2026-04-12T09:00:00Z') },
      },
    });

    render(<OpsHealthPage />);

    expect(await screen.findByText('Operations Health')).toBeInTheDocument();
    await waitFor(() => expect(postJSON).toHaveBeenCalledWith('getOpsHealthSnapshot', {}));

    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('degraded')).toBeInTheDocument();
    expect(screen.getByText('Queue SLA Breaches')).toBeInTheDocument();
    expect(screen.getByText('18h')).toBeInTheDocument();
    expect(screen.getByText('No alerts in this filter.')).toBeInTheDocument();
  });
});
