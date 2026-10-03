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

// ── ADR 0033: the media library ─────────────────────────────────────────────

import {
  buildBulkPatch,
  buildContentUsageIndex,
  buildGalleryListing,
  buildMetadataPatch,
  cleanFolderList,
  markDuplicates,
  measureImage,
  normalizeGalleryRow,
  parseGalleryListParams,
} from './gallery-images.js';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-02-01T00:00:00.000Z';
const T2 = '2026-03-01T00:00:00.000Z';

describe('parseStorageRef reads the site media route', () => {
  it('maps /api/public/media/{container}/{path} — the URL every AI row carries — so AI blobs can be deleted', () => {
    expect(parseStorageRef('/api/public/media/covers/c1-ai-hero.png')).toEqual({
      container: 'covers',
      blobName: 'c1-ai-hero.png',
    });
    expect(parseStorageRef('/api/public/media/covers/image-gallery/manual/a%20b.png?x=1')).toEqual({
      container: 'covers',
      blobName: 'image-gallery/manual/a b.png',
    });
    expect(parseStorageRef('https://api.example.com/api/public/media/covers/x.png')).toEqual({
      container: 'covers',
      blobName: 'x.png',
    });
    expect(parseStorageRef('/api/public/media/secrets/x.png')).toBeNull();
  });
});

describe('measureImage', () => {
  it('reads PNG, GIF and JPEG headers; null for anything else', () => {
    const png = Buffer.concat([
      Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
      Buffer.from('00000780', 'hex'),
      Buffer.from('00000438', 'hex'),
      Buffer.alloc(8),
    ]);
    expect(measureImage(png, 'image/png')).toEqual({ width: 1920, height: 1080 });
    const gif = Buffer.concat([
      Buffer.from('GIF89a'),
      Buffer.from([0x10, 0x00, 0x08, 0x00]),
      Buffer.alloc(4),
    ]);
    expect(measureImage(gif, 'image/gif')).toEqual({ width: 16, height: 8 });
    // SOI, then an SOF0 segment: FF C0, length 17, precision 8, height 300, width 400.
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90]),
      Buffer.alloc(12),
    ]);
    expect(measureImage(jpeg, 'image/jpeg')).toEqual({ width: 400, height: 300 });
    expect(measureImage(Buffer.from('not an image at all'), 'image/avif')).toBeNull();
    expect(measureImage(null)).toBeNull();
  });
});

describe('buildMetadataPatch', () => {
  const meta = { nowIso: T2, actor: 'e' };
  it('turns archived/trash booleans into stamps and validates license', () => {
    const v = validateGalleryImageMetadataRequest({
      id: 'x',
      archived: true,
      trash: true,
      license: 'cc-by',
      altText: ' Alt ',
      width: '640',
      format: 'image/webp',
    });
    expect(buildMetadataPatch(v, meta)).toMatchObject({
      archived: true,
      archivedAt: T2,
      softDeletedAt: T2,
      license: 'cc-by',
      altText: 'Alt',
      width: 640,
      format: 'webp',
    });
    const cleared = validateGalleryImageMetadataRequest({
      id: 'x',
      archived: false,
      trash: false,
      license: 'made-up',
    });
    expect(buildMetadataPatch(cleared, meta)).toMatchObject({
      archived: false,
      archivedAt: null,
      softDeletedAt: null,
      license: 'other',
    });
  });
  it('accepts `tags` as an alias for customTags and mirrors promptSet into promptSetId', () => {
    const v = validateGalleryImageMetadataRequest({ id: 'x', tags: ['A', ' b '], promptSet: 'S' });
    expect(buildMetadataPatch(v, meta)).toMatchObject({
      customTags: ['a', 'b'],
      promptSet: 'S',
      promptSetId: 'S',
      setId: 'S',
    });
  });
});

describe('buildContentImageRemovalUpdates also scrubs the hero trio and secondaries', () => {
  it('replaces or deletes heroImageUrl/contentImageUrl/coverImage and filters secondaryImageUrls', () => {
    const data = {
      heroImageUrl: 'gone.png',
      contentImageUrl: 'gone.png',
      coverImage: 'other.png',
      secondaryImageUrls: ['a.png', 'gone.png'],
      aiImageHistory: { hero: ['old.png', 'gone.png'] },
    };
    const updates = buildContentImageRemovalUpdates(data, { slot: 'hero', imageUrl: 'gone.png' });
    expect(updates.heroImageUrl).toBe('old.png');
    expect(updates.contentImageUrl).toBe('old.png');
    expect(updates).not.toHaveProperty('coverImage');
    expect(updates.secondaryImageUrls).toEqual(['a.png']);
    const emptied = buildContentImageRemovalUpdates(
      { heroImageUrl: 'gone.png', secondaryImageUrls: ['gone.png'] },
      { slot: 'hero', imageUrl: 'gone.png' }
    );
    expect('heroImageUrl' in emptied && emptied.heroImageUrl === undefined).toBe(true);
    expect('secondaryImageUrls' in emptied && emptied.secondaryImageUrls === undefined).toBe(true);
  });
});

describe('normalizeGalleryRow', () => {
  it('gives curated rows a createdAt from generatedAt and a title from articleTitle', () => {
    const row = normalizeGalleryRow(
      { id: 'a1', articleTitle: 'News', generatedAt: T1, imageUrl: 'u' },
      'curated_article_images'
    );
    expect(row).toMatchObject({
      createdAt: T1,
      title: 'News',
      source: 'curated',
      slot: 'curated',
      folder: 'default',
    });
    const ts = normalizeGalleryRow({ id: 'b', _ts: 1700000000 }, 'generated_content_images');
    expect(ts.createdAt).toBe(new Date(1700000000 * 1000).toISOString());
  });
  it('reads the legacy archived boolean as archivedAt, and names sources', () => {
    expect(
      normalizeGalleryRow({ id: 'x', archived: true, updatedAt: T1 }, 'generated_content_images')
        .archivedAt
    ).toBe(T1);
    const src = (sourceCollection) =>
      normalizeGalleryRow({ id: 'x', sourceCollection }, 'generated_content_images').source;
    expect(src('manual_upload')).toBe('upload');
    expect(src('content')).toBe('ai-cover');
    expect(src('import')).toBe('import');
  });
});

describe('buildGalleryListing', () => {
  const generated = [
    {
      id: 'g1',
      title: 'Alpha hero',
      imageUrl: '/u/1.png',
      createdAt: T0,
      folder: 'aws',
      provider: 'aws',
      slot: 'hero',
      customTags: ['cloud'],
      sourceCollection: 'content',
      prompt: 'lego builders',
    },
    {
      id: 'g2',
      title: 'Beta',
      imageUrl: '/u/2.png',
      createdAt: T2,
      folder: 'default',
      provider: 'azure',
      slot: 'secondary1',
      sourceCollection: 'manual_upload',
      archivedAt: T2,
    },
    { id: 'g3', title: 'Gamma', imageUrl: '/u/3.png', createdAt: T1, softDeletedAt: T2, sourceCollection: 'preview' },
    { id: 'g4', title: 'Alpha dup', imageUrl: '/u/1.png', createdAt: T1, sourceCollection: 'content' },
  ];
  const curated = [{ id: 'c1', articleTitle: 'Curated', imageUrl: '/u/c.png', generatedAt: T1 }];
  const content = [
    {
      id: 'post1',
      Title: 'Post 1',
      heroImageUrl: '/u/1.png',
      aiImageUrls: { hero: '/u/1.png' },
      secondaryImageUrls: ['/u/c.png'],
    },
    { id: 'post2', title: 'Post 2', coverImage: '/u/1.png' },
  ];
  const params = (over = {}) => ({ ...parseGalleryListParams(() => null), ...over });

  it('defaults to active rows newest first, with usage and duplicates attached', () => {
    const out = buildGalleryListing({ generated, curated, content }, params());
    expect(out.items.map((i) => i.id)).toEqual(['g4', 'c1', 'g1']);
    expect(out.total).toBe(3);
    const g1 = out.items.find((i) => i.id === 'g1');
    expect(g1.usageCount).toBe(2);
    expect(g1.usedBy.map((u) => `${u.id}:${u.field}`)).toEqual([
      'post1:heroImageUrl',
      'post1:aiImageUrls.hero',
      'post2:coverImage',
    ]);
    expect(out.items.find((i) => i.id === 'g4').duplicateOf).toBe('g1');
    expect(out.facets.counts).toEqual({ active: 3, archived: 1, trash: 1 });
  });

  it('filters by state, folder, source, provider, slot, tag and free text', () => {
    const ids = (p) =>
      buildGalleryListing({ generated, curated, content }, params(p)).items.map((i) => i.id);
    expect(ids({ state: 'archived' })).toEqual(['g2']);
    expect(ids({ state: 'trash' })).toEqual(['g3']);
    expect(ids({ state: 'all' })).toHaveLength(5);
    expect(ids({ folder: 'aws' })).toEqual(['g1']);
    expect(ids({ source: 'curated' })).toEqual(['c1']);
    expect(ids({ state: 'all', provider: 'azure' })).toEqual(['g2']);
    expect(ids({ slot: 'hero' })).toEqual(['g1']);
    expect(ids({ tag: 'cloud' })).toEqual(['g1']);
    expect(ids({ q: 'lego' })).toEqual(['g1']);
    expect(ids({ q: 'curated' })).toEqual(['c1']);
  });

  it('sorts by title and most-used, and pages with offset/limit', () => {
    const titles = buildGalleryListing(
      { generated, curated, content },
      params({ sort: 'title' })
    ).items.map((i) => i.title);
    expect(titles).toEqual(['Alpha dup', 'Alpha hero', 'Curated']);
    const used = buildGalleryListing(
      { generated, curated, content },
      params({ sort: 'most-used' })
    ).items.map((i) => i.id);
    expect(used.slice(0, 2)).toEqual(['g4', 'g1']);
    const page = buildGalleryListing({ generated, curated, content }, params({ offset: 1, limit: 1 }));
    expect(page.items.map((i) => i.id)).toEqual(['c1']);
    expect(page).toMatchObject({ total: 3, hasMore: true, offset: 1, limit: 1 });
  });

  it('parseGalleryListParams bounds everything', () => {
    const p = parseGalleryListParams(
      (k) => ({ limit: '9999', offset: '-4', state: 'weird', sort: 'nope', usage: '1', q: 'X' })[k]
    );
    expect(p).toMatchObject({
      limit: 200,
      offset: 0,
      state: 'active',
      sort: 'newest',
      usage: true,
      q: 'x',
    });
  });

  it('buildContentUsageIndex and markDuplicates are deterministic on their own', () => {
    expect(buildContentUsageIndex([{ id: 'p', heroImageUrl: 'a' }]).get('a')).toEqual([
      { id: 'p', title: 'p', status: '', type: '', field: 'heroImageUrl' },
    ]);
    const marked = markDuplicates([
      { id: 'later', sha256: 'abc', createdAt: T2 },
      { id: 'first', sha256: 'abc', createdAt: T0 },
    ]);
    expect(marked.find((i) => i.id === 'later').duplicateOf).toBe('first');
  });
});

describe('buildBulkPatch toggles tags against each item’s own tags', () => {
  const meta = { nowIso: T2, actor: 'e' };
  it('adds and removes without touching the tags it was not told about', () => {
    const patch = buildBulkPatch(
      'tag',
      { customTags: ['keep', 'drop'] },
      { addTags: ['New'], removeTags: ['drop'] },
      meta
    );
    expect(patch.customTags).toEqual(['keep', 'new']);
  });
  it('maps the other actions onto stamps and folders', () => {
    expect(buildBulkPatch('archive', {}, {}, meta)).toMatchObject({ archivedAt: T2, archived: true });
    expect(buildBulkPatch('restore', {}, {}, meta)).toMatchObject({
      archivedAt: null,
      softDeletedAt: null,
    });
    expect(buildBulkPatch('trash', {}, {}, meta)).toMatchObject({ softDeletedAt: T2 });
    expect(buildBulkPatch('untrash', {}, {}, meta)).toMatchObject({ softDeletedAt: null });
    expect(buildBulkPatch('move', {}, { folder: ' Marketing ' }, meta)).toMatchObject({
      folder: 'marketing',
    });
    expect(
      buildBulkPatch('set', { id: 'x' }, { fields: { provider: 'AWS', slot: 'hero' } }, meta)
    ).toMatchObject({ provider: 'aws', slot: 'hero' });
    expect(buildBulkPatch('nonsense', {}, {}, meta)).toBeNull();
  });
});

describe('bulkGalleryImages', () => {
  it('patches each item against its own document and reports per item', async () => {
    const docs = new Map([
      ['a', { id: 'a', customTags: ['x'] }],
      ['b', { id: 'b', customTags: ['y'] }],
    ]);
    const store = makeStore({
      readDoc: vi.fn(async (_c, id) => docs.get(id) || null),
      patchDoc: vi.fn(async (_c, id, u) => {
        docs.set(id, { ...docs.get(id), ...u });
        return docs.get(id);
      }),
    });
    const h = createGalleryImageHandlers({ guard: guardAs('editor'), store, storage: okStorage(), ...fixed });
    const res = await h.bulkGalleryImages(
      makeRequest({ action: 'tag', addTags: ['z'], items: [{ id: 'a' }, { id: 'b' }, { id: 'missing' }] }),
      context
    );
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ success: true, updated: 2, failed: 1 });
    expect(docs.get('a').customTags).toEqual(['x', 'z']);
    expect(docs.get('b').customTags).toEqual(['y', 'z']);
    expect(body.results[2]).toMatchObject({ id: 'missing', ok: false });
  });

  it('rejects an unknown action and an empty selection', async () => {
    const h = createGalleryImageHandlers({ guard: guardAs('editor'), store: makeStore(), storage: okStorage(), ...fixed });
    expect(
      (await h.bulkGalleryImages(makeRequest({ action: 'explode', items: [{ id: 'a' }] }), context)).status
    ).toBe(400);
    expect((await h.bulkGalleryImages(makeRequest({ action: 'archive', items: [] }), context)).status).toBe(400);
  });

  it('delete leaves the blob alone when another row still points at it', async () => {
    const store = makeStore({
      readDoc: vi.fn(async (c, id) =>
        c === 'generated_content_images' && id === 'a'
          ? { id: 'a', imageUrl: '/api/public/media/covers/shared.png' }
          : null
      ),
      queryDocs: vi.fn(async () => [{ id: 'other' }]),
    });
    const storage = okStorage();
    const h = createGalleryImageHandlers({ guard: guardAs('editor'), store, storage, ...fixed });
    const res = await h.bulkGalleryImages(makeRequest({ action: 'delete', items: [{ id: 'a' }] }), context);
    expect(JSON.parse(res.body).results[0]).toMatchObject({ ok: true, storageDeleted: false });
    expect(storage.deleteBlob).not.toHaveBeenCalled();
    expect(store.deleteDoc).toHaveBeenCalledWith('generated_content_images', 'a');
  });
});

describe('deleteContentGeneratedImage deletes an AI row’s blob through the media URL', () => {
  it('derives the blob from imageUrl when storagePath is absent and nothing else shares it', async () => {
    const url = '/api/public/media/covers/c1-ai-hero.png';
    const store = makeStore({
      readDoc: vi.fn(async (c, id) => {
        if (c === 'generated_content_images' && id === 'g1')
          return { id: 'g1', contentId: 'c1', slot: 'hero', imageUrl: url };
        if (c === 'content') return { id: 'c1', heroImageUrl: url, aiImageUrls: { hero: url } };
        return null;
      }),
    });
    const storage = okStorage();
    const h = createGalleryImageHandlers({ guard: guardAs('editor'), store, storage, ...fixed });
    const res = await h.deleteContentGeneratedImage(makeRequest({ imageId: 'g1' }), context);
    expect(JSON.parse(res.body)).toMatchObject({ success: true, storageDeleted: true, sharedWith: 0 });
    expect(storage.deleteBlob).toHaveBeenCalledWith('covers', 'c1-ai-hero.png');
    const contentPatch = store.patchDoc.mock.calls.find(([c]) => c === 'content')[2];
    expect('heroImageUrl' in contentPatch && contentPatch.heroImageUrl === undefined).toBe(true);
  });
});

describe('folders', () => {
  it('cleanFolderList lowercases, dedupes and keeps default first', () => {
    expect(cleanFolderList(['Marketing', 'marketing', ' AWS ', ''])).toEqual(['default', 'marketing', 'aws']);
  });
  it('GET merges the seeds with the stored list; PUT creates the admin_config doc with its partition', async () => {
    const store = makeStore();
    const h = createGalleryImageHandlers({ guard: guardAs('editor'), store, storage: okStorage(), ...fixed });
    const got = JSON.parse((await h.getGalleryFolders(makeRequest(), context)).body);
    expect(got.folders).toEqual(['default', 'aws', 'azure', 'gcp', 'finops', 'architecture']);
    const put = await h.putGalleryFolders(makeRequest({ folders: ['Marketing'] }), context);
    expect(JSON.parse(put.body).folders).toContain('marketing');
    expect(store.upsertDoc).toHaveBeenCalledWith(
      'admin_config',
      expect.objectContaining({
        id: 'gallery_folders',
        configScope: 'admin_config',
        folders: ['default', 'marketing'],
      })
    );
    expect((await h.putGalleryFolders(makeRequest({ folders: 'nope' }), context)).status).toBe(400);
  });
});

describe('importGalleryImage', () => {
  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
    Buffer.from('00000002', 'hex'),
    Buffer.from('00000003', 'hex'),
    Buffer.alloc(8),
  ]);
  const deps = (over = {}) => ({
    guard: guardAs('editor'),
    store: makeStore(),
    storage: { ...okStorage(), uploadBlob: vi.fn(async () => 'u') },
    fetchImage: vi.fn(async () => ({ buffer: png, contentType: 'image/png' })),
    ...fixed,
    ...over,
  });

  it('fetches, stores under covers/image-gallery/imports, measures and records the row', async () => {
    const d = deps();
    const h = createGalleryImageHandlers(d);
    const res = await h.importGalleryImage(
      makeRequest({ url: 'https://example.com/pics/Diagram.png?sig=1', folder: 'AWS', tags: ['Arch'] }),
      context
    );
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ success: true, width: 2, height: 3, format: 'png', bytes: png.length });
    expect(d.storage.uploadBlob.mock.calls[0][1]).toBe('image-gallery/imports/20260807050000-diagram.png');
    const row = d.store.upsertDoc.mock.calls[0][1];
    expect(row).toMatchObject({
      sourceCollection: 'import',
      sourceUrl: 'https://example.com/pics/Diagram.png',
      folder: 'aws',
      customTags: ['arch'],
      title: 'Diagram',
      credit: 'example.com',
      storagePath: 'covers/image-gallery/imports/20260807050000-diagram.png',
    });
    expect(row.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('answers 409 with the existing record for a byte- or URL-identical image, unless forced', async () => {
    const d = deps({
      store: makeStore({ queryDocs: vi.fn(async () => [{ id: 'dup', imageUrl: '/u', title: 'Already' }]) }),
    });
    const h = createGalleryImageHandlers(d);
    const res = await h.importGalleryImage(makeRequest({ url: 'https://example.com/a.png' }), context);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body)).toMatchObject({ duplicateOf: 'dup' });
    const forced = await h.importGalleryImage(
      makeRequest({ url: 'https://example.com/a.png', force: true }),
      context
    );
    expect(forced.status).toBe(200);
  });

  it('refuses non-http URLs, non-images and unreachable sources with the right status', async () => {
    expect(
      (await createGalleryImageHandlers(deps()).importGalleryImage(makeRequest({ url: 'ftp://x/y.png' }), context))
        .status
    ).toBe(400);
    const refused = deps({
      fetchImage: vi.fn(async () => ({
        refused: 'not-an-image',
        contentType: 'text/html',
        reason: 'Content-Type text/html is not an image',
      })),
    });
    expect(
      (await createGalleryImageHandlers(refused).importGalleryImage(makeRequest({ url: 'https://x/y' }), context))
        .status
    ).toBe(415);
    const down = deps({
      fetchImage: vi.fn(async () => {
        throw new Error('HTTP 503 fetching https://x/y');
      }),
    });
    const res = await createGalleryImageHandlers(down).importGalleryImage(
      makeRequest({ url: 'https://x/y' }),
      context
    );
    expect(res.status).toBe(422);
    expect(JSON.parse(res.body).error).not.toContain('https://x/y');
  });
});

describe('getImageUsage', () => {
  it('returns the content documents using the image and its sibling variants', async () => {
    const store = makeStore({
      readDoc: vi.fn(async () => ({ id: 'g1', contentId: 'c1', slot: 'hero', imageUrl: '/u/1.png' })),
      queryDocs: vi.fn(async (c) =>
        c === 'content'
          ? [{ id: 'p1', Title: 'Post', heroImageUrl: '/u/1.png' }]
          : [{ id: 'g0', imageUrl: '/u/0.png', createdAt: T0 }]
      ),
    });
    const h = createGalleryImageHandlers({ guard: guardAs('editor'), store, storage: okStorage(), ...fixed });
    const req = { ...makeRequest(), params: { id: 'g1' }, query: { get: () => null } };
    const body = JSON.parse((await h.getImageUsage(req, context)).body);
    expect(body.usedBy).toEqual([{ id: 'p1', title: 'Post', status: '', type: '', field: 'heroImageUrl' }]);
    expect(body.variants.map((v) => v.id)).toEqual(['g0']);
  });
});
