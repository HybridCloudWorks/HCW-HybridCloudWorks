import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import DashboardPage from './DashboardPage';

const postJSON = vi.fn();

vi.mock('@/hooks/useAuthReady', () => ({
  useAuthReady: () => ({ authReady: true }),
}));

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
}));

describe('DashboardPage', () => {
  beforeEach(() => {
    postJSON.mockReset();
  });

  it('renders backend snapshot totals and recent review items', async () => {
    postJSON.mockResolvedValue({
      success: true,
      stats: {
        blog: { needsReview: 3, inProgress: 4, published: 5, total: 12 },
        framework: { needsReview: 1, inProgress: 2, published: 3, total: 6 },
        architecture: { needsReview: 2, inProgress: 1, published: 4, total: 7 },
        coder_corner: { needsReview: 0, inProgress: 1, published: 2, total: 3 },
        rejected: 9,
      },
      recentNeedsReview: [
        {
          id: 'content-1',
          Title: 'Queued article',
          contentStatus: 'ingested',
          cloudProvider: 'Azure',
          type: 'blog',
        },
      ],
    });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('6 items waiting for you')).toBeInTheDocument();
    await waitFor(() => expect(postJSON).toHaveBeenCalledWith('getAdminDashboardSnapshot', {}));

    expect(screen.getByText('Blogs')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
    expect(screen.getAllByText('9').length).toBeGreaterThan(0);
    expect(screen.getByText('Queued article')).toBeInTheDocument();
  });
});
