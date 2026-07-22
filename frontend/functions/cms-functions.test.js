// @vitest-environment node
import { createRequire } from 'module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
const cmsFunctions = require('./cms-functions.js');
let fieldValue;

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createAuthedRequest(body = {}) {
  return {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token',
      'user-agent': 'vitest-agent',
    },
    body,
    ip: '127.0.0.1',
  };
}

describe('cms-functions admin helpers', () => {
  it('normalizes blog and news content into the same admin blog bucket', () => {
    expect(cmsFunctions.getCanonicalContentTypeForAdmin({ type: 'blog' })).toBe('blog');
    expect(cmsFunctions.getCanonicalContentTypeForAdmin({ type: 'news' })).toBe('news');
    expect(cmsFunctions.matchesAdminContentType({ type: 'news' }, 'blog')).toBe(true);
    expect(cmsFunctions.matchesAdminContentType({ type: 'framework' }, 'blog')).toBe(false);
  });

  it('matches queue statuses used by the admin pages', () => {
    expect(cmsFunctions.matchesQueueStatus({ contentStatus: 'ingested' }, 'needs_review')).toBe(
      true
    );
    expect(cmsFunctions.matchesQueueStatus({ contentStatus: 'inspected' }, 'needs_review')).toBe(
      true
    );
    expect(
      cmsFunctions.matchesQueueStatus(
        { contentStatus: 'approved_blog', Live: false },
        'ready_to_publish'
      )
    ).toBe(true);
    expect(
      cmsFunctions.matchesQueueStatus(
        { contentStatus: 'published_blog', Live: true },
        'ready_to_publish'
      )
    ).toBe(false);
    expect(
      cmsFunctions.matchesQueueStatus(
        { contentStatus: 'published_blog', Live: true },
        'published_live'
      )
    ).toBe(true);
  });

  it('summarizes dashboard counts across content types', () => {
    const stats = cmsFunctions.summarizeDashboardItems([
      { type: 'blog', contentStatus: 'ingested', Live: false },
      { type: 'news', contentStatus: 'approved_blog', Live: false },
      { type: 'framework', contentStatus: 'editing', Live: false },
      { type: 'architecture', contentStatus: 'published_blog', Live: true },
      { type: 'coder_corner', contentStatus: 'rejected', Live: false },
    ]);

    expect(stats.blog).toEqual({
      needsReview: 1,
      inProgress: 0,
      published: 0,
      total: 1,
    });
    expect(stats.news).toEqual({
      needsReview: 0,
      inProgress: 1,
      published: 0,
      total: 1,
    });
    expect(stats.framework).toEqual({
      needsReview: 0,
      inProgress: 1,
      published: 0,
      total: 1,
    });
    expect(stats.architecture).toEqual({
      needsReview: 0,
      inProgress: 0,
      published: 1,
      total: 1,
    });
    expect(stats.rejected).toBe(1);
  });

  it('calculates elapsed hours and alert status consistently', () => {
    const now = Date.parse('2026-04-12T12:00:00Z');
    expect(cmsFunctions.toHoursSince(new Date('2026-04-12T06:00:00Z'), now)).toBe(6);
    expect(cmsFunctions.getWorkflowAlertStatus({ status: 'acknowledged' })).toBe('acknowledged');
    expect(cmsFunctions.getWorkflowAlertStatus({ active: false })).toBe('resolved');
    expect(cmsFunctions.getWorkflowAlertStatus({})).toBe('open');
  });

  it('falls back to an unsorted recent needs review fetch when the ordered query fails', async () => {
    const orderedGet = vi.fn().mockRejectedValue(new Error('index not ready'));
    const fallbackGet = vi.fn().mockResolvedValue({
      docs: [
        {
          id: 'older-item',
          data: () => ({
            Title: 'Older item',
            contentStatus: 'ingested',
            fetchedAt: '2026-04-12T10:00:00.000Z',
          }),
        },
        {
          id: 'newer-item',
          data: () => ({
            Title: 'Newer item',
            contentStatus: 'inspected',
            updatedAt: '2026-04-12T11:00:00.000Z',
          }),
        },
      ],
    });
    const select = vi.fn(() => ({ orderBy: vi.fn(() => ({ get: orderedGet })), get: fallbackGet }));
    const limit = vi.fn(() => ({ select }));
    const where = vi.fn(() => ({ limit }));
    const db = {
      collection: vi.fn(() => ({ where })),
    };

    const items = await cmsFunctions.getRecentNeedsReviewItems(db, 10);

    expect(items.map((item) => item.id)).toEqual(['newer-item', 'older-item']);
    expect(orderedGet).toHaveBeenCalledTimes(1);
    expect(fallbackGet).toHaveBeenCalledTimes(1);
  });
});

describe('cms-functions admin handlers', () => {
  beforeEach(() => {
    fieldValue = {
      serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
      delete: vi.fn(() => 'DELETE_FIELD'),
    };
    admin.firestore.FieldValue = fieldValue;

    vi.spyOn(admin, 'auth').mockReturnValue({
      verifyIdToken: vi.fn().mockResolvedValue({
        uid: 'admin-uid',
        email: 'admin@example.com',
        adminRole: 'super_admin',
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFirestore(mockDb) {
    vi.spyOn(admin, 'firestore').mockImplementation(() => mockDb);
    admin.firestore.FieldValue = fieldValue;
  }

  it('recordAdminAudit writes sanitized audit records through the backend handler', async () => {
    const auditSet = vi.fn().mockResolvedValue(undefined);
    const mockDb = {
      collection: vi.fn((name) => {
        expect(name).toBe('admin_audit_logs');
        return {
          doc: vi.fn(() => ({ id: 'audit-1', set: auditSet })),
        };
      }),
    };
    mockFirestore(mockDb);

    const req = createAuthedRequest({
      action: 'draft_saved',
      details: { contentId: 'content-1', route: '/admin/editor/content-1' },
    });
    const res = createResponse();

    await cmsFunctions.recordAdminAudit(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, auditId: 'audit-1' });
    expect(auditSet).toHaveBeenCalledTimes(1);
    expect(auditSet.mock.calls[0][0]).toMatchObject({
      action: 'draft_saved',
      userId: 'admin-uid',
      userEmail: 'admin@example.com',
      route: '/admin/editor/content-1',
      userAgent: 'vitest-agent',
    });
  });

  it('saveEditorDraft enforces the transaction contract and writes the audit inside the handler', async () => {
    const contentDocRef = { id: 'content-1' };
    const auditDocRef = { id: 'audit-2' };
    const transaction = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          Title: 'Existing title',
          title: 'Existing title',
          contentStatus: 'inspected',
          blogEditedAt: { toMillis: () => 111 },
          aiImageUrls: { content: 'https://cdn.example.com/content.png' },
        }),
      }),
      update: vi.fn(),
      set: vi.fn(),
    };
    const mockDb = {
      collection: vi.fn((name) => {
        if (name === 'content') {
          return { doc: vi.fn(() => contentDocRef) };
        }
        if (name === 'admin_audit_logs') {
          return { doc: vi.fn(() => auditDocRef) };
        }
        throw new Error(`Unexpected collection ${name}`);
      }),
      runTransaction: vi.fn(async (callback) => callback(transaction)),
    };
    mockFirestore(mockDb);

    const req = createAuthedRequest({
      contentId: 'content-1',
      expectedEditedAtMs: 111,
      force: false,
      draft: '## Intro\n\nBody',
      title: 'Updated title',
      authorName: 'Editor Name',
      publishedDate: '2026-04-12',
      summary: 'Updated summary',
      tags: 'cloud, ai',
      sidebarContent: 'Sidebar body',
      orderedImageUrls: [
        'https://cdn.example.com/hero.png',
        'https://cdn.example.com/secondary.png',
      ],
    });
    const res = createResponse();

    await cmsFunctions.saveEditorDraft(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      contentId: 'content-1',
      editorAuthor: 'Editor Name',
      tagCount: 2,
    });
    expect(transaction.update).toHaveBeenCalledTimes(1);
    expect(transaction.set).toHaveBeenCalledTimes(1);

    const [[, updatePayload]] = transaction.update.mock.calls;
    expect(updatePayload).toMatchObject({
      Title: 'Updated title',
      title: 'Updated title',
      editorAuthor: 'Editor Name',
      siteAuthor: 'Editor Name',
      Summary: 'Updated summary',
      summary: 'Updated summary',
      sidebarContent: 'Sidebar body',
      Tags: ['cloud', 'ai'],
      contentStatus: 'editing',
      updatedBy: 'admin@example.com',
      heroImageUrl: 'https://cdn.example.com/hero.png',
      contentImageUrl: 'https://cdn.example.com/hero.png',
      altCoverImage: 'https://cdn.example.com/hero.png',
      secondaryImageUrls: ['https://cdn.example.com/secondary.png'],
    });
    expect(updatePayload.blogDraft).toContain('## TL;DR :)');

    const [[, auditPayload]] = transaction.set.mock.calls;
    expect(auditPayload).toMatchObject({
      action: 'draft_saved',
      contentId: 'content-1',
      contentTitle: 'Existing title',
      userEmail: 'admin@example.com',
    });
  });

  it('unpublishContentToInspected preserves publish timestamps while recalling live content', async () => {
    const contentDocRef = { id: 'content-2' };
    const auditDocRef = { id: 'audit-3' };
    const transaction = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          Title: 'Published article',
          title: 'Published article',
          contentStatus: 'published_blog',
          publishedAt: '2026-04-01T12:00:00.000Z',
          blogPublishedAt: '2026-04-01T12:00:00.000Z',
        }),
      }),
      update: vi.fn(),
      set: vi.fn(),
    };
    const mockDb = {
      collection: vi.fn((name) => {
        if (name === 'content') {
          return { doc: vi.fn(() => contentDocRef) };
        }
        if (name === 'admin_audit_logs') {
          return { doc: vi.fn(() => auditDocRef) };
        }
        throw new Error(`Unexpected collection ${name}`);
      }),
      runTransaction: vi.fn(async (callback) => callback(transaction)),
    };
    mockFirestore(mockDb);

    const req = createAuthedRequest({
      contentId: 'content-2',
      reviewNotes: 'Recall to inspection',
    });
    const res = createResponse();

    await cmsFunctions.unpublishContentToInspected(req, res);

    expect(res.statusCode).toBe(200);
    const [[, updatePayload]] = transaction.update.mock.calls;
    expect(updatePayload).toMatchObject({
      contentStatus: 'inspected',
      Live: false,
      scheduledPublishDate: null,
      reviewNotes: 'Recall to inspection',
      reviewedBy: 'admin@example.com',
    });
    expect(updatePayload).not.toHaveProperty('publishedAt');
    expect(updatePayload).not.toHaveProperty('blogPublishedAt');
  });

  it('processPublishContent rejects missing provider metadata before creating a blog mapping', async () => {
    const contentUpdate = vi.fn().mockResolvedValue(undefined);
    const blogAdd = vi.fn().mockResolvedValue({ id: 'blog-1' });
    const queryGet = vi.fn().mockResolvedValue({ empty: true, docs: [] });

    const mockDb = {
      collection: vi.fn((name) => {
        if (name === 'content') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({
                  Title: 'Providerless article',
                  title: 'Providerless article',
                  contentStatus: 'approved_blog',
                  publishTarget: 'blog',
                }),
              }),
              update: contentUpdate,
            })),
          };
        }

        if (name === 'blogs') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                get: queryGet,
              })),
            })),
            add: blogAdd,
          };
        }

        throw new Error(`Unexpected collection ${name}`);
      }),
    };

    const result = await cmsFunctions.processPublishContent(mockDb, 'content-3', {
      user: { email: 'admin@example.com', uid: 'admin-uid' },
      publishTarget: 'blog',
      markLive: true,
      createSlugPageTrigger: true,
      addToCurated: true,
    });

    expect(result).toEqual({
      error: expect.stringContaining(
        'Publish metadata validation failed: Missing or invalid cloud provider'
      ),
    });
    expect(blogAdd).not.toHaveBeenCalled();
    expect(contentUpdate).not.toHaveBeenCalled();
  });

  it('manageImagePromptConfig saves page assignments through the backend handler', async () => {
    const pageSet = vi.fn().mockResolvedValue(undefined);
    const mockDb = {
      collection: vi.fn((name) => {
        expect(name).toBe('image_prompt_pages');
        return {
          doc: vi.fn((docId) => {
            expect(docId).toBe('aws_blog');
            return { set: pageSet };
          }),
        };
      }),
    };
    mockFirestore(mockDb);

    const req = createAuthedRequest({
      action: 'savePageAssignment',
      pagePath: '/aws/blog',
      setName: 'default-set',
      promptName: 'hero-prompt',
    });
    const res = createResponse();

    await cmsFunctions.manageImagePromptConfig(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      action: 'savePageAssignment',
      pagePath: '/aws/blog',
      setName: 'default-set',
      promptName: 'hero-prompt',
    });
    expect(pageSet).toHaveBeenCalledWith(
      expect.objectContaining({
        pagePath: '/aws/blog',
        setName: 'default-set',
        promptName: 'hero-prompt',
        updatedBy: 'admin@example.com',
      }),
      { merge: true }
    );
  });
});
