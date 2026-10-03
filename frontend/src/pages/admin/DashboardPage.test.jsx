import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import DashboardPage, { PIPELINE_STAGES } from './DashboardPage';

const postJSON = vi.fn();

vi.mock('@/hooks/useAuthReady', () => ({
  useAuthReady: () => ({ authReady: true }),
}));

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
}));

const SNAPSHOT = {
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
      source: 'rss',
    },
  ],
};

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    postJSON.mockReset();
    postJSON.mockResolvedValue(SNAPSHOT);
  });

  it('renders backend snapshot totals and recent review items', async () => {
    renderDashboard();
    expect(await screen.findByText('6 items waiting for you')).toBeInTheDocument();
    await waitFor(() => expect(postJSON).toHaveBeenCalledWith('getAdminDashboardSnapshot', {}));
    expect(screen.getByText('Blogs')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
    expect(screen.getAllByText('9').length).toBeGreaterThan(0);
    expect(screen.getByText('Queued article')).toBeInTheDocument();
    // 14 pieces live across the four published buckets.
    expect(screen.getByText(/14 pieces live · 8 in editor/)).toBeInTheDocument();
  });

  it('shows ONE pipeline graphic, with six stages from New Content to Live Pages (ADR 0033)', async () => {
    renderDashboard();
    await screen.findByText('6 items waiting for you');
    expect(PIPELINE_STAGES.map((s) => s.label)).toEqual([
      'New Content',
      'Drafts',
      'Review Queue',
      'Editor',
      'Publish',
      'Live Pages',
    ]);
    // The quick-action row that duplicated the pipeline is gone: the Review
    // Queue is linked once in the pipeline and once in the Explore strip, and
    // nowhere describes itself as "Triage incoming".
    expect(screen.queryByText('Triage incoming')).not.toBeInTheDocument();
    expect(screen.queryByText('Polish drafts')).not.toBeInTheDocument();
    const pipeline = screen.getByText('The pipeline').closest('[data-slot="card"], div');
    expect(pipeline).toBeTruthy();
    const review = screen.getByRole('link', { name: /^Review Queue: .*6 items$/ });
    expect(within(review).getByText('6')).toBeInTheDocument();
    const live = screen.getByRole('link', { name: /^Live Pages: .*14 items$/ });
    expect(live).toHaveAttribute('href', '/admin/live-pages');
  });

  it('explains every menu group on the first screen', async () => {
    renderDashboard();
    await screen.findByText('6 items waiting for you');
    const explore = screen.getByRole('region', { name: 'Explore ContentForge' });
    for (const label of ['Pipeline', 'Enhanced', 'Creative', 'Amplify', 'Spotlight', 'Platform']) {
      expect(within(explore).getByText(label)).toBeInTheDocument();
    }
    expect(within(explore).getByRole('link', { name: /Ambassador/ })).toHaveAttribute(
      'href',
      '/admin/ambassador'
    );
  });

  it('labels a queued item with its derived idea origin and a readable status', async () => {
    renderDashboard();
    const row = await screen.findByText('Queued article');
    const link = row.closest('a');
    expect(within(link).getByText(/RSS or external feed/)).toBeInTheDocument();
    expect(within(link).getByText('Ingested')).toBeInTheDocument();
  });

  it('recounts through the backend and re-reads the snapshot', async () => {
    renderDashboard();
    await screen.findByText('6 items waiting for you');
    postJSON.mockClear();
    postJSON.mockResolvedValue(SNAPSHOT);
    screen.getByRole('button', { name: /Recount/ }).click();
    await waitFor(() => expect(postJSON).toHaveBeenCalledWith('recalculateDashboardStats', {}));
    await waitFor(() => expect(postJSON).toHaveBeenCalledWith('getAdminDashboardSnapshot', {}));
  });
});
