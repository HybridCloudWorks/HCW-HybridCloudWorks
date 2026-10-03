/**
 * The review board's provider picker. A post the classifier filed under no
 * known provider cannot be sent to the publish queue until one is chosen, so
 * every provider an article can be published under has to be offered here.
 * Docker was not until the Docker provider fix, which left a Docker article
 * stuck on the board although /docker/blog/<slug> has existed since #776.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const postJSON = vi.fn();
vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
}));
vi.mock('@/lib/auditLog', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/contentWorkflow', () => ({
  unpublishToInspected: vi.fn(),
  requestContentInspection: vi.fn(),
  saveContentSchedule: vi.fn(),
  resetContentReviewState: vi.fn(),
}));
vi.mock('@/components/admin/ImageOrderManager', () => ({ ImageOrderManager: () => null }));
vi.mock('@/components/admin/ImageGalleryPicker', () => ({ ImageGalleryPicker: () => null }));

import BlogReviewBoard from './BlogReviewBoard';

const renderBoard = (blog) =>
  render(
    <MemoryRouter>
      <BlogReviewBoard blog={{ id: 'c1', Title: 'Compose Basics', ...blog }} blogId="c1" />
    </MemoryRouter>
  );

beforeEach(() => {
  postJSON.mockReset();
  postJSON.mockResolvedValue({ success: true });
});

describe('BlogReviewBoard provider picker', () => {
  it('offers Docker while the post has no provider, and holds the publish queue until one is set', () => {
    renderBoard({ contentStatus: 'inspected' });
    expect(screen.getByRole('button', { name: 'Docker' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to Publish Queue' })).toBeDisabled();
  });

  it('files the post under Docker, the value the server stores', async () => {
    renderBoard({ contentStatus: 'inspected' });
    fireEvent.click(screen.getByRole('button', { name: 'Docker' }));
    await waitFor(() => expect(postJSON).toHaveBeenCalledTimes(1));
    expect(postJSON).toHaveBeenCalledWith('updateContentItem', {
      contentId: 'c1',
      updates: { cloudProvider: 'Docker', 'Cloud Provider': 'Docker' },
    });
  });

  it('lets a Docker post go to the publish queue', () => {
    renderBoard({
      contentStatus: 'inspected',
      'Cloud Provider': 'Docker',
      cloudProvider: 'Docker',
    });
    expect(screen.getByRole('button', { name: 'Send to Publish Queue' })).toBeEnabled();
  });
});
