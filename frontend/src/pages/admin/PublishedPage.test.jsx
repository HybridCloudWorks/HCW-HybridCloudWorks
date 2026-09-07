import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PublishedPage, { getPrePublishFailures } from './PublishedPage';

const postJSON = vi.fn();
const getJSON = vi.fn();
const logAdminAction = vi.fn();
const unpublishToInspected = vi.fn();

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
      Summary: 'A summary that satisfies the pre-publish checklist.',
      altCoverImage: 'https://cdn.example/hero.png',
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

/**
 * Drive the publish flow as an admin does since the pre-publish checklist
 * landed: the row button VALIDATES (fetching the full document for the body
 * check) and opens a modal; the modal's "Publish Now" is what publishes. A
 * test that clicked the row button and expected publishContent was asserting
 * a flow that no longer exists (TODO.md T-320).
 */
async function publishFirstCandidate() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Publish' })[0]);
  expect(await screen.findByText('Ready to publish')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Publish Now' }));
}

describe('getPrePublishFailures — the modal gate', () => {
  const passing = {
    Title: 'T',
    Summary: 'S',
    altCoverImage: 'https://cdn.example/hero.png',
    slug: 's',
    blogDraft: 'x'.repeat(201),
  };

  it('passes a complete item', () => {
    expect(getPrePublishFailures(passing)).toEqual([]);
  });

  it('names each missing prerequisite', () => {
    // The publish flow's only guard between the row button and publishContent
    // is this checklist; if a check silently disappears, the happy-path tests
    // above would still pass, so each check is pinned here.
    expect(getPrePublishFailures({ ...passing, altCoverImage: '' }).join()).toMatch(/hero image/i);
    expect(getPrePublishFailures({ ...passing, Title: ' ' }).join()).toMatch(/title/i);
    expect(getPrePublishFailures({ ...passing, Summary: '' }).join()).toMatch(/summary/i);
    expect(getPrePublishFailures({ ...passing, blogDraft: 'short' }).join()).toMatch(/too short/i);
    expect(getPrePublishFailures({ ...passing, slug: '' }).join()).toMatch(/slug/i);
  });
});

describe('PublishedPage', () => {
  beforeEach(() => {
    postJSON.mockReset();
    logAdminAction.mockReset();
    unpublishToInspected.mockReset();
    getJSON.mockReset();
    // The validation step's full-document fetch: the body-length check reads
    // blogDraft, which the snapshot row deliberately omits.
    getJSON.mockResolvedValue({
      item: {
        id: 'content-1',
        blogDraft: 'A body well past the two-hundred character floor. '.repeat(8),
      },
    });
  });

  it('publishes a staged item and surfaces publish diagnostics', async () => {
    postJSON.mockImplementation(async (endpoint) => {
      if (endpoint === 'getPublishSnapshot') {
        return sampleSnapshot;
      }

      if (endpoint === 'publishContent') {
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

    await publishFirstCandidate();

    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith('publishContent', {
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

      if (endpoint === 'publishContent') {
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

    await publishFirstCandidate();

    expect(
      await screen.findByText(
        'Publish completed but published URL is missing. Check landingProvider/slug mapping in publish response.'
      )
    ).toBeInTheDocument();
  });

  it('carries the "Images: re-host hotlinked" action, which reads its candidates only when opened (#374)', async () => {
    postJSON.mockImplementation(async (endpoint) => {
      if (endpoint === 'getPublishSnapshot') return sampleSnapshot;
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });
    getJSON.mockImplementation(async (endpoint) => {
      if (endpoint === 'cms/content/rehost-images') {
        return {
          success: true,
          scanned: 22,
          candidates: [
            {
              id: 'content-2',
              title: 'Existing live article',
              live: true,
              fields: ['content'],
              urlCount: 8,
              hosts: ['techcommunity.microsoft.com'],
              lastRun: null,
            },
          ],
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
    expect(getJSON).not.toHaveBeenCalledWith('cms/content/rehost-images');

    fireEvent.click(screen.getByRole('button', { name: 'Images: re-host hotlinked' }));
    expect(
      await screen.findByText('1 of 22 published articles hotlink third-party images.')
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Existing live article' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Re-host selected (1)' })).toBeEnabled();
  });

  it("sets a published article's slug from its own row, and the row's live link follows (#400)", async () => {
    // The placement decision, pinned: the control is in the ALREADY-LIVE list,
    // beside the "View Live" link it changes — not in the editor, and not in
    // the staged list where the article is not yet on a URL at all.
    postJSON.mockImplementation(async (endpoint, body) => {
      if (endpoint === 'getPublishSnapshot') return sampleSnapshot;
      if (endpoint === 'cms/content/slug') {
        expect(body).toEqual({ contentId: 'content-2', slug: 'existing-live-article' });
        return {
          contentId: 'content-2',
          requested: 'existing-live-article',
          changed: true,
          previousSlug: 'stale-slug',
          slug: 'existing-live-article',
          curatedSubpagePath: '/aws/blog/existing-live-article',
          publicUrl: 'https://hybridcloudworks.com/aws/blog/existing-live-article',
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

    fireEvent.click(screen.getByRole('button', { name: 'Slug' }));
    fireEvent.click(screen.getByRole('button', { name: /Set slug/ }));

    expect(await screen.findByText(/Moved from "stale-slug"/)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('link', { name: 'View Live' })
          .some(
            (link) =>
              link.getAttribute('href') ===
              'https://hybridcloudworks.com/aws/blog/existing-live-article'
          )
      ).toBe(true)
    );
  });
});
