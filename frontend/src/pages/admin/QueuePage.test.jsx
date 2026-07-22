import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import QueuePage from './QueuePage';

const postJSON = vi.fn();
const logAdminAction = vi.fn();

vi.mock('@/hooks/useAuthReady', () => ({
  useAuthReady: () => ({ authReady: true }),
}));

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
}));

vi.mock('@/lib/auditLog', () => ({
  logAdminAction: (...args) => logAdminAction(...args),
}));

describe('QueuePage', () => {
  beforeEach(() => {
    postJSON.mockReset();
    logAdminAction.mockReset();
  });

  it('renders queue totals from the backend snapshot', async () => {
    postJSON.mockResolvedValue({
      success: true,
      totalCount: 2,
      items: [
        {
          id: 'content-1',
          Title: 'First queued item',
          contentStatus: 'ingested',
          cloudProvider: 'AWS',
          summary: 'Summary one',
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/admin/queue']}>
        <QueuePage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Content Queue')).toBeInTheDocument();
    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith('getQueueSnapshot', {
        statusFilter: 'needs_review',
        contentTypeFilter: 'all',
        itemLimit: 100,
      })
    );

    expect(screen.getByText('Showing 1 of 2 matching items.')).toBeInTheDocument();
    expect(screen.getByText('First queued item')).toBeInTheDocument();
  });

  it('approves a queue item into the publish stage with the normalized publish target', async () => {
    postJSON.mockImplementation(async (endpoint) => {
      if (endpoint === 'getQueueSnapshot') {
        return {
          success: true,
          totalCount: 1,
          items: [
            {
              id: 'content-2',
              Title: 'Azure review item',
              contentStatus: 'inspected',
              cloudProvider: 'Azure',
              type: 'blog',
              publishTarget: 'blog',
              summary: 'Ready for publish',
            },
          ],
        };
      }

      if (endpoint === 'transitionContentStatus') {
        return { success: true };
      }

      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    render(
      <MemoryRouter initialEntries={['/admin/queue?status=needs_review']}>
        <QueuePage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Azure review item')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Send to Publish/i }));

    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith('transitionContentStatus', {
        contentId: 'content-2',
        newStatus: 'approved_blog',
        publishTarget: 'blog',
        markLive: false,
        reviewNotes: 'Approved in queue for blog publish stage',
      })
    );

    expect(logAdminAction).toHaveBeenCalledWith('content_approved', {
      contentId: 'content-2',
      publishTarget: 'blog',
      newStatus: 'approved_blog',
    });

    await waitFor(() => {
      expect(screen.queryByText('Azure review item')).not.toBeInTheDocument();
    });
  });
});
