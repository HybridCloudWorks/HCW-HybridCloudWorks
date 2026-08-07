/**
 * Gallery image-record RPCs — pinned to source :2376-2440, :4967-5330,
 * :7095-7250. Load-bearing: the slot-guard subtlety (absent slot never
 * clears; explicit '' does), storage-ref mapping across Azure and legacy
 * Google URL shapes, slot/history scrubbing on the owning content doc, and
 * the rejected-cleanup age filter.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createGalleryImageHandlers,
  parseStorageRef,
  validateGalleryImageMetadataRequest,
  buildContentImageRemovalUpdates,
} from './gallery-images.js';

const context = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };

const USER = { oid: 'u1', preferred_username: 'editor@hcw.dev' };
const guardAs = (role) => ({ requireRole: vi.fn(async () => ({ user: USER, role, error: null })) });
const denyGuard = { requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })) };

const makeRequest = (body) => ({ headers: { get: () => 'vitest' }, json: async () => body ?? {} });

function makeStore(over = {}) {
  return {
    queryDocs: vi.fn(async () => []),
    readDoc: vi.fn(async () => null),
    upsertDoc: vi.fn(async (_c, d) => d),
    patchDoc: vi.fn(async (_c, id, u) => ({ id, ...u })),
    deleteDoc: vi.fn(async () => {}),
    ...over,
  };
}
const okStorage = () => ({ deleteBlob: vi.fn(async () => {}) });

const NOW = new Date('2026-08-07T05:00:00.000Z');
const fixed = { now: () => NOW, uuid: () => 'fixed-uuid' };

describe('parseStorageRef', () => {
  it('maps Azure blob URLs, legacy Google URLs, and relative paths', () => {
    expect(parseStorageRef('https://hcwstorageprod.blob.core.windows.net/covers/a/b.png')).toEqual({
      container: 'covers', blobName: 'a/b.png',
    });
    expect(parseStorageRef('covers/x.png')).toEqual({ container: 'covers', blobName: 'x.png' });
    expect(
      parseStorageRef('https://storage.googleapis.com/some-bucket/covers/x.png')
    ).toEqual({ container: 'covers', blobName: 'x.png' });
    expect(
      parseStorageRef('https://firebasestorage.googleapis.com/v0/b/bkt/o/covers%2Fx.png?alt=media')
    ).toEqual({ container: 'covers', blobName: 'x.png' });
  });

  it('returns null for unknown containers and junk', () => {
    expect(parseStorageRef('secrets/x.png')).toBeNull();
    expect(parseStorageRef('https://evil.example/covers/x.png')).toBeNull();
    expect(parseStorageRef('')).toBeNull();
  });
});

describe('validateGalleryImageMetadataRequest', () => {
  it('accepts imageId or id, rejects unknown collections', () => {
    expect(validateGalleryImageMetadataRequest({ id: 'x' }).imageId).toBe('x');
    expect(validateGalleryImageMetadataRequest({ imageId: 'y', galleryCollection: 'admins' }).error).toBe(
      'Invalid galleryCollection'
    );
    expect(validateGalleryImageMetadataRequest({}).status).toBe(400);
  });
});

describe('buildContentImageRemovalUpdates', () => {
  it('filters history, falls back the active slot, clears hero altCoverImage', () => {
    const data = {
      aiImageHistory: { hero: ['old.png', 'gone.png'] },
      aiImageUrls: { hero: 'gone.png' },
      altCoverImage: 'gone.png',
    };
    const updates = buildContentImageRemovalUpdates(data, { slot: 'hero', imageUrl: 'gone.png' });
    expect(updates['aiImageHistory.hero']).toEqual(['old.png']);
    expect(updates['aiImageUrls.hero']).toBe('old.png');
    expect(updates.altCoverImage).toBe('old.png');
  });

  it('empties become deletions (undefined) when nothing remains', () => {
    const data = { aiImageHistory: { hero: ['gone.png'] }, aiImageUrls: { hero: 'gone.png' } };
    const updates = buildContentImageRemovalUpdates(data, { slot: 'hero', imageUrl: 'gone.png' });
    expect('aiImageHistory.hero' in updates && updates['aiImageHistory.hero'] === undefined).toBe(true);
    expect('aiImageUrls.hero' in updates && updates['aiImageUrls.hero'] === undefined).toBe(true);
  });
});

describe('updateGalleryImageMetadata', () => {
  it('absent slot never clears; explicit empty slot does', async () => {
    const store = makeStore({ readDoc: vi.fn(async () => ({ id: 'img1', slot: 'hero' })) });
    const h = createGalleryImageHandlers({ guard: guardAs('editor'), store, storage: okStorage(), ...fixed });

    await h.updateGalleryImageMetadata(makeRequest({ imageId: 'img1', title: 'Renamed' }), context);
    expect(store.patchDoc.mock.calls[0][2]).not.toHaveProperty('slot');

    await h.updateGalleryImageMetadata(makeRequest({ imageId: 'img1', slot: '' }), context);
    expect(store.patchDoc.mock.calls[1][2].slot).toBe('');
  });

  it('normalizes fields like the source and 404s missing images', async () => {
    const store = makeStore({ readDoc: vi.fn(async () => ({ id: 'img1' })) });
    const h = createGalleryImageHandlers({ guard: guardAs('editor'), store, storage: okStorage(), ...fixed });
    await h.updateGalleryImageMetadata(
      makeRequest({
        imageId: 'img1',
        provider: ' Vertex ',
        folder: ' Marketing ',
        customTags: [' K8s ', ''],
        approvalStatus: 'bogus',
      }),
      context
    );
    expect(store.patchDoc.mock.calls[0][2]).toMatchObject({
      provider: 'vertex',
      folder: 'marketing',
      customTags: ['k8s'],
      approvalStatus: 'draft', // invalid values fall back to draft
    });

    const h404 = createGalleryImageHandlers({ guard: guardAs('editor'), store: makeStore(), storage: okStorage(), ...fixed });
    expect((await h404.updateGalleryImageMetadata(makeRequest({ imageId: 'x' }), context)).status).toBe(404);
  });
});

describe('createManualGalleryImageRecord', () => {
  it('requires imageUrl and writes the source doc shape with a fresh id', async () => {
    const store = makeStore();
    const h = createGalleryImageHandlers({ guard: guardAs('editor'), store, storage: okStorage(), ...fixed });

    expect((await h.createManualGalleryImageRecord(makeRequest({}), context)).status).toBe(400);

    const res = await h.createManualGalleryImageRecord(
      makeRequest({ imageUrl: ' https://x/img.png ', customTags: ['a', ' '], slot: 'hero' }),
      context
    );
    expect(JSON.parse(res.body)).toEqual({ success: true, imageId: 'fixed-uuid' });
    const doc = store.upsertDoc.mock.calls[0][1];
    expect(doc).toMatchObject({
      id: 'fixed-uuid',
      imageUrl: 'https://x/img.png',
      articleId: 'manual-upload',
      approvalStatus: 'approved',
      sourceCollection: 'manual_upload',
      usageCount: 0,
      customTags: ['a'],
    });
  });
});

describe('image deletions', () => {
  it('curated: deletes blob (when mappable) then the record', async () => {
    const storage = okStorage();
    const store = makeStore({
      readDoc: vi.fn(async () => ({
        id: 'art1',
        imageUrl: 'https://hcw.blob.core.windows.net/covers/c.png',
      })),
    });
    const h = createGalleryImageHandlers({ guard: guardAs('editor'), store, storage, ...fixed });
    const body = JSON.parse(
      (await h.deleteCuratedGeneratedImage(makeRequest({ articleId: 'art1' }), context)).body
    );
    expect(body.storageDeleted).toBe(true);
    expect(storage.deleteBlob).toHaveBeenCalledWith('covers', 'c.png');
    expect(store.deleteDoc).toHaveBeenCalledWith('curated_article_images', 'art1');
  });

  it('curated: unmappable legacy URL still deletes the record, storageDeleted false', async () => {
    const storage = okStorage();
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'art1', imageUrl: 'https://firebasestorage.googleapis.com/v0/b/b/o/unknownprefix%2Fc.png' })),
    });
    const h = createGalleryImageHandlers({ guard: guardAs('editor'), store, storage, ...fixed });
    const body = JSON.parse(
      (await h.deleteCuratedGeneratedImage(makeRequest({ articleId: 'art1' }), context)).body
    );
    expect(body.storageDeleted).toBe(false);
    expect(storage.deleteBlob).not.toHaveBeenCalled();
    expect(store.deleteDoc).toHaveBeenCalled();
  });

  it('generated: scrubs the owning content doc slots before deleting the record', async () => {
    const store = makeStore({
      readDoc: vi.fn(async (container, id) => {
        if (container === 'generated_content_images') {
          return { id, contentId: 'c1', slot: 'hero', imageUrl: 'gone.png', storagePath: 'covers/g.png' };
        }
        if (container === 'content') {
          return { id: 'c1', aiImageUrls: { hero: 'gone.png' }, aiImageHistory: { hero: ['gone.png'] } };
        }
        return null;
      }),
    });
    const h = createGalleryImageHandlers({ guard: guardAs('editor'), store, storage: okStorage(), ...fixed });
    const body = JSON.parse(
      (await h.deleteContentGeneratedImage(makeRequest({ imageId: 'img1' }), context)).body
    );
    expect(body).toMatchObject({ success: true, contentId: 'c1', slot: 'hero', storageDeleted: true });
    const contentPatch = store.patchDoc.mock.calls.find(([c]) => c === 'content');
    expect('aiImageUrls.hero' in contentPatch[2]).toBe(true);
    expect(store.deleteDoc).toHaveBeenCalledWith('generated_content_images', 'img1');
  });
});

describe('deleteRejectedContent', () => {
  it('soft-deletes un-marked rejected docs within the age filter and audits once', async () => {
    const store = makeStore({
      queryDocs: vi.fn(async () => [
        { id: 'old', rejectedAt: '2026-08-01T00:00:00Z' },
        { id: 'fresh', rejectedAt: '2026-08-07T04:30:00Z' },
        { id: 'marked', rejectedAt: '2026-08-01T00:00:00Z', softDeletedAt: 'already' },
      ]),
    });
    const h = createGalleryImageHandlers({ guard: guardAs('publisher'), store, storage: okStorage(), ...fixed });
    const body = JSON.parse(
      (await h.deleteRejectedContent(makeRequest({ olderThanHours: 24 }), context)).body
    );
    expect(body).toMatchObject({ deletedCount: 1, examinedCount: 3, hasMore: false });
    expect(store.patchDoc).toHaveBeenCalledTimes(1);
    expect(store.patchDoc.mock.calls[0][1]).toBe('old');
    expect(store.patchDoc.mock.calls[0][2].softDeletedReason).toBe('rejected_aged_out');
    expect(store.upsertDoc.mock.calls.filter(([c]) => c === 'admin_audit_logs')).toHaveLength(1);
  });

  it('no cutoff marks everything unmarked; empty result skips the audit row', async () => {
    const store = makeStore({ queryDocs: vi.fn(async () => []) });
    const h = createGalleryImageHandlers({ guard: guardAs('publisher'), store, storage: okStorage(), ...fixed });
    const body = JSON.parse((await h.deleteRejectedContent(makeRequest({}), context)).body);
    expect(body.deletedCount).toBe(0);
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });
});

describe('auth', () => {
  it('every handler denies with zero store/storage calls', async () => {
    const store = makeStore();
    const storage = okStorage();
    const h = createGalleryImageHandlers({ guard: denyGuard, store, storage, ...fixed });
    const calls = [
      h.saveContentImageOrder(makeRequest({ contentId: 'c1', imageUrls: [] }), context),
      h.updateGalleryImageMetadata(makeRequest({ imageId: 'x' }), context),
      h.createManualGalleryImageRecord(makeRequest({ imageUrl: 'x' }), context),
      h.deleteCuratedGeneratedImage(makeRequest({ articleId: 'x' }), context),
      h.deleteContentGeneratedImage(makeRequest({ imageId: 'x' }), context),
      h.deleteRejectedContent(makeRequest({}), context),
    ];
    for (const call of calls) expect((await call).status).toBe(403);
    expect(store.readDoc).not.toHaveBeenCalled();
    expect(store.deleteDoc).not.toHaveBeenCalled();
    expect(storage.deleteBlob).not.toHaveBeenCalled();
  });
});
