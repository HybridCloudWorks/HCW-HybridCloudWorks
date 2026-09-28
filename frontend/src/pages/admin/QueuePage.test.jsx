import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import QueuePage from './QueuePage';

const postJSON = vi.fn();
const getJSON = vi.fn();
const logAdminAction = vi.fn();

vi.mock('@/hooks/useAuthReady', () => ({
  useAuthReady: () => ({ authReady: true }),
}));

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
  getJSON: (...args) => getJSON(...args),
}));

vi.mock('@/lib/auditLog', () => ({
  logAdminAction: (...args) => logAdminAction(...args),
}));

describe('QueuePage', () => {
  beforeEach(() => {
    postJSON.mockReset();
    getJSON.mockReset();
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

  it('queues a forge-from-url job from the paste box and reports the job id', async () => {
    postJSON.mockImplementation(async (endpoint) => {
      if (endpoint === 'getQueueSnapshot') return { success: true, totalCount: 0, items: [] };
      if (endpoint === 'enqueueJob') return { ok: true, jobId: 'job-77' };
      return {};
    });

    render(
      <MemoryRouter initialEntries={['/admin/queue']}>
        <QueuePage />
      </MemoryRouter>
    );

    const input = await screen.findByPlaceholderText(/paste an article to forge/i);
    fireEvent.change(input, { target: { value: 'https://learn.microsoft.com/azure/aks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Forge' }));

    // The exact payload key matters: the job's worker reads payload.url.
    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith('enqueueJob', {
        type: 'forge-from-url',
        payload: { url: 'https://learn.microsoft.com/azure/aks' },
      })
    );
    expect(await screen.findByText(/Forge queued \(job job-77\)/)).toBeInTheDocument();
    expect(input.value).toBe('');
  });

  it('shows imported repository drafts by switching to In Review and reloading', async () => {
    const path = 'docs/content/blog-lab-01-landing-zone.md';
    getJSON.mockResolvedValue({
      ok: true,
      candidates: [
        {
          path,
          name: 'blog-lab-01-landing-zone.md',
          size: 1,
          imported: null,
          importable: true,
        },
      ],
    });
    postJSON.mockImplementation(async (endpoint, body) => {
      if (endpoint === 'getQueueSnapshot' && body.statusFilter === 'in_review') {
        return {
          success: true,
          totalCount: 1,
          items: [
            {
              id: 'lab-1',
              Title: 'Build a landing zone you can read',
              contentStatus: 'in_review',
              source: 'repo',
              cloudProvider: 'Azure',
            },
          ],
        };
      }
      if (endpoint === 'getQueueSnapshot') return { success: true, totalCount: 0, items: [] };
      if (endpoint === 'cms/content/import-repo') {
        return {
          ok: true,
          results: [
            {
              path,
              outcome: 'created',
              contentId: 'lab-1',
              contentStatus: 'in_review',
              title: 'Build a landing zone you can read',
            },
          ],
          counts: { created: 1 },
        };
      }
      return {};
    });

    render(
      <MemoryRouter initialEntries={['/admin/queue']}>
        <QueuePage />
      </MemoryRouter>
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Import drafts from the repository' })
    );
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Select blog-lab-01-landing-zone.md' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import selected as In Review (1)' }));

    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith('cms/content/import-repo', { paths: [path] })
    );
    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith('getQueueSnapshot', {
        statusFilter: 'in_review',
        contentTypeFilter: 'all',
        itemLimit: 100,
      })
    );
    // The card in the queue itself, not the panel's result line.
    expect(await screen.findByText('Showing 1 of 1 matching items.')).toBeInTheDocument();
    expect(screen.getByText('Repository')).toBeInTheDocument();
    // Nothing on this path asks for a publish.
    const endpoints = postJSON.mock.calls.map(([endpoint]) => endpoint);
    expect(endpoints).not.toContain('publishContent');
    expect(endpoints).not.toContain('transitionContentStatus');
  });

  it('rejects a non-http paste without calling the backend', async () => {
    postJSON.mockImplementation(async (endpoint) => {
      if (endpoint === 'getQueueSnapshot') return { success: true, totalCount: 0, items: [] };
      return {};
    });

    render(
      <MemoryRouter initialEntries={['/admin/queue']}>
        <QueuePage />
      </MemoryRouter>
    );

    const input = await screen.findByPlaceholderText(/paste an article to forge/i);
    fireEvent.change(input, { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByRole('button', { name: 'Forge' }));

    expect(await screen.findByText(/valid http\(s\) article URL/i)).toBeInTheDocument();
    expect(postJSON).not.toHaveBeenCalledWith('enqueueJob', expect.anything());
  });
});
