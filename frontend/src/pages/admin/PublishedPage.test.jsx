import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PublishedPage from './PublishedPage';

const postJSON = vi.fn();
const logAdminAction = vi.fn();
const unpublishToInspected = vi.fn();

vi.mock('@/hooks/useAuthReady', () => ({
  useAuthReady: () => ({ authReady: true }),
}));

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
}));

vi.mock('@/lib/auditLog', () => ({
  logAdminAction: (...args) => logAdminAction(...args),
}));

vi.mock('@/lib/contentWorkflow', () => ({
  unpublishToInspected: (...args) => unpublishToInspected(...args),
}));

vi.mock('@/components/admin/ImageOrderManager', () => ({
  ImageOrderManager: () => <div>Image Order Manager</div>,
}));

vi.mock('@/components/admin/ImageGalleryPicker', () => ({
  ImageGalleryPicker: () => <div>Image Gallery Picker</div>,
}));

const sampleSnapshot = {
  success: true,
  readyTotal: 1,
  publishedTotal: 1,
  readyCandidates: [
    {
      id: 'content-1',
      Title: 'Azure publish candidate',
      title: 'Azure publish candidate',
      contentStatus: 'approved_blog',
      type: 'blog',
      publishTarget: 'blog',
      cloudProvider: 'Azure',
      slug: 'azure-publish-candidate',
      curatedSubpagePath: '/azure/blog/azure-publish-candidate',
      updatedAt: { toMillis: () => 200 },
      blogPublishedAt: { toDate: () => new Date('2026-04-20T12:00:00Z') },
      secondaryImageUrls: [],
      Live: false,
    },
  ],
  publishedItems: [
    {
      id: 'content-2',
      Title: 'Existing live article',
      contentStatus: 'published_blog',
      cloudProvider: 'AWS',
      slug: 'existing-live-article',
      curatedSubpagePath: '/aws/blog/existing-live-article',
      blogPublishedAt: { toDate: () => new Date('2026-04-19T12:00:00Z') },
      updatedAt: { toMillis: () => 100 },
      Live: true,
    },
  ],
};

describe('PublishedPage', () => {
  beforeEach(() => {
    postJSON.mockReset();
    logAdminAction.mockReset();
    unpublishToInspected.mockReset();
  });

  it('publishes a staged item and surfaces publish diagnostics', async () => {
    postJSON.mockImplementation(async (endpoint) => {
      if (endpoint === 'getPublishSnapshot') {
        return sampleSnapshot;
      }

      if (endpoint === 'publishContentToBlogs') {
        return {
          success: true,
          mappings: [
            {
              contentId: 'content-1',
              blogId: 'blog-1',
              reused: false,
              landingProvider: 'Azure',
              slug: 'azure-publish-candidate',
              curatedSubpagePath: '/azure/blog/azure-publish-candidate',
              expectedPublicUrl: 'https://hybridcloudworks.com/azure/blog/azure-publish-candidate',
              sourceUrl: 'https://source.example.com/article',
            },
          ],
          warnings: [],
        };
      }

      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    render(
      <MemoryRouter>
        <PublishedPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.getByText('Azure publish candidate')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Publish' })[0]);

    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith('publishContentToBlogs', {
        contentIds: ['content-1'],
        publishTarget: 'blog',
        cloudProvider: 'Azure',
        markLive: true,
        createSlugPageTrigger: true,
        addToCurated: true,
      })
    );

    await waitFor(() =>
      expect(logAdminAction).toHaveBeenCalledWith('content_published_live', {
        contentId: 'content-1',
        title: 'Azure publish candidate',
        publishTarget: 'blog',
        publishMapping: {
          contentId: 'content-1',
          blogId: 'blog-1',
          reused: false,
          landingProvider: 'Azure',
          slug: 'azure-publish-candidate',
          curatedSubpagePath: '/azure/blog/azure-publish-candidate',
          expectedPublicUrl: 'https://hybridcloudworks.com/azure/blog/azure-publish-candidate',
          sourceUrl: 'https://source.example.com/article',
        },
      })
    );

    expect(screen.getByText('Latest Publish Diagnostics')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Expected URL: https://hybridcloudworks.com/azure/blog/azure-publish-candidate'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('No items are currently staged for publishing.')).toBeInTheDocument();
  });

  it('surfaces a mapping error when publish succeeds without an expected public URL', async () => {
    postJSON.mockImplementation(async (endpoint) => {
      if (endpoint === 'getPublishSnapshot') {
        return sampleSnapshot;
      }

      if (endpoint === 'publishContentToBlogs') {
        return {
          success: true,
          mappings: [
            {
              contentId: 'content-1',
              blogId: 'blog-1',
              reused: false,
              landingProvider: 'Azure',
              slug: 'azure-publish-candidate',
              curatedSubpagePath: '/azure/blog/azure-publish-candidate',
              expectedPublicUrl: null,
              sourceUrl: 'https://source.example.com/article',
            },
          ],
          warnings: [],
        };
      }

      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    render(
      <MemoryRouter>
        <PublishedPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Azure publish candidate')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Publish' })[0]);

    expect(
      await screen.findByText(
        'Publish completed but published URL is missing. Check landingProvider/slug mapping in publish response.'
      )
    ).toBeInTheDocument();
  });
});
