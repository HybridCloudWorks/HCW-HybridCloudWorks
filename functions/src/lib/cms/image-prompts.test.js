/**
 * manageImagePromptConfig RPC + image-prompt read/keyword endpoints —
 * behavior pinned to the source handlers (:5329-5507) and useImagePrompts.js.
 * The delicate parts: the partitioned containers (prompts by /setName,
 * legacy sets by /pageId), merge-vs-replace on every save, and the
 * page-assignment allowlist.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createImagePromptHandlers,
  normalizePromptConfigKey,
  pathToPromptPageDocId,
  hasLegacyPromptFields,
  ADMIN_PROMPT_PAGE_ALLOWLIST,
} from './image-prompts.js';

const context = { log: vi.fn(), error: vi.fn() };

const allowGuard = {
  requireRole: vi.fn(async () => ({
    user: { oid: 'u1', preferred_username: 'editor@hcw.dev' },
    role: 'editor',
    error: null,
  })),
};
const denyGuard = {
  requireRole: vi.fn(async () => ({ user: null, role: null, error: { status: 403, body: '{}' } })),
};

const makeRequest = ({ query = {}, params = {}, body } = {}) => ({
  query: { get: (k) => query[k] ?? null },
  params,
  json: async () => {
    if (body === undefined) throw new SyntaxError('no body');
    return body;
  },
});

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

const fixed = { now: () => new Date('2026-08-06T12:00:00.000Z') };

const rpc = (body) => makeRequest({ body });

describe('helpers', () => {
  it('pathToPromptPageDocId flattens paths the way the source did', () => {
    expect(pathToPromptPageDocId('/aws/news')).toBe('aws_news');
    expect(pathToPromptPageDocId('/github')).toBe('github');
  });

  it('hasLegacyPromptFields matches any of the three legacy markers', () => {
    expect(hasLegacyPromptFields({ primaryPrompt: 'x' })).toBe(true);
    expect(hasLegacyPromptFields({ title: 'x' })).toBe(true);
    expect(hasLegacyPromptFields({ setName: 'x' })).toBe(false);
  });

  it('normalizePromptConfigKey trims only', () => {
    expect(normalizePromptConfigKey('  Hero Set ')).toBe('Hero Set');
  });
});

describe('manageConfig auth and validation', () => {
  it('passes guard denials through and requires an action', async () => {
    const store = makeStore();
    const h = createImagePromptHandlers({ guard: denyGuard, store, ...fixed });
    expect((await h.manageConfig(rpc({ action: 'saveSet' }), context)).status).toBe(403);

    const h2 = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    expect((await h2.manageConfig(rpc({}), context)).status).toBe(400);
    expect((await h2.manageConfig(rpc({ action: 'nonsense' }), context)).status).toBe(400);
    expect(
      (await h2.manageConfig(rpc({ action: 'saveSet', setName: 'x'.repeat(121) }), context)).status
    ).toBe(400);
  });
});

describe('saveSet', () => {
  it('requires setName and a non-empty primaryPrompt', async () => {
    const h = createImagePromptHandlers({ guard: allowGuard, store: makeStore(), ...fixed });
    expect((await h.manageConfig(rpc({ action: 'saveSet' }), context)).status).toBe(400);
    expect(
      (await h.manageConfig(rpc({ action: 'saveSet', setName: 'hero', primaryPrompt: '  ' }), context))
        .status
    ).toBe(400);
  });

  it('merge-saves: patches an existing set, creates a missing one', async () => {
    const existingStore = makeStore({
      readDoc: vi.fn(async () => ({ id: 'hero', extra: 'kept' })),
    });
    const h = createImagePromptHandlers({ guard: allowGuard, store: existingStore, ...fixed });
    await h.manageConfig(rpc({ action: 'saveSet', setName: 'hero', primaryPrompt: 'P' }), context);
    expect(existingStore.upsertDoc).not.toHaveBeenCalled();
    expect(existingStore.patchDoc).toHaveBeenCalledWith(
      'image_prompt_sets',
      'hero',
      expect.objectContaining({ primaryPrompt: 'P', updatedBy: 'editor@hcw.dev' }),
      { partitionKey: 'hero' }
    );

    const freshStore = makeStore();
    const h2 = createImagePromptHandlers({ guard: allowGuard, store: freshStore, ...fixed });
    await h2.manageConfig(rpc({ action: 'saveSet', setName: 'hero', primaryPrompt: 'P' }), context);
    expect(freshStore.upsertDoc.mock.calls[0][1]).toMatchObject({ id: 'hero', name: 'hero' });
  });
});

describe('savePrompt', () => {
  it('writes the prompt into the /setName-partitioned container', async () => {
    const store = makeStore();
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.manageConfig(
      rpc({
        action: 'savePrompt',
        setName: 'hero',
        promptName: 'cover',
        additionalParameters: 'moody light',
        slotTemplates: { hero: 'T1', bogus: '' },
      }),
      context
    );
    expect(res.status).toBe(200);
    // Prompt doc created fresh with the partition field on it.
    const promptDoc = store.upsertDoc.mock.calls.find(
      ([c]) => c === 'image_prompt_sets_prompts'
    )[1];
    expect(promptDoc).toMatchObject({
      id: 'cover',
      setName: 'hero',
      additionalParameters: 'moody light',
      slotTemplates: { hero: 'T1' }, // empty slots dropped by normalizeSlotTemplates
    });
    // Existence check used the set partition, not the id.
    expect(store.readDoc).toHaveBeenCalledWith('image_prompt_sets_prompts', 'cover', 'hero');
  });

  it('patches an existing prompt at the set partition', async () => {
    const store = makeStore({
      readDoc: vi.fn(async (container) =>
        container === 'image_prompt_sets_prompts' ? { id: 'cover', setName: 'hero' } : null
      ),
    });
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    await h.manageConfig(rpc({ action: 'savePrompt', setName: 'hero', promptName: 'cover' }), context);
    const call = store.patchDoc.mock.calls.find(([c]) => c === 'image_prompt_sets_prompts');
    expect(call[3]).toEqual({ partitionKey: 'hero' });
  });

  it('rejects oversized slot templates', async () => {
    const h = createImagePromptHandlers({ guard: allowGuard, store: makeStore(), ...fixed });
    const res = await h.manageConfig(
      rpc({
        action: 'savePrompt',
        setName: 'hero',
        promptName: 'cover',
        slotTemplates: { hero: 'x'.repeat(2001) },
      }),
      context
    );
    expect(res.status).toBe(400);
  });
});

describe('deleteSet', () => {
  it('deletes prompts by partition, the set, matching legacy docs, and clears assignments', async () => {
    const store = makeStore({
      queryDocs: vi.fn(async (container) => {
        if (container === 'image_prompt_sets_prompts') return [{ id: 'cover', setName: 'hero' }];
        if (container === 'image_prompts') return [{ id: 'aws_news', title: 'hero', primaryPrompt: 'x' }];
        if (container === 'image_prompt_pages')
          return [
            { id: 'aws_news', setName: 'hero' },
            { id: 'gcp_news', setName: 'other' },
          ];
        return [];
      }),
      readDoc: vi.fn(async (container) =>
        container === 'image_prompts_sets' ? { id: 'hero', pageId: 'aws_news' } : null
      ),
    });
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.manageConfig(rpc({ action: 'deleteSet', setName: 'hero' }), context);
    expect(res.status).toBe(200);

    // Prompt deleted at its set partition; set doc deleted at /id.
    expect(store.deleteDoc).toHaveBeenCalledWith('image_prompt_sets_prompts', 'cover', 'hero');
    expect(store.deleteDoc).toHaveBeenCalledWith('image_prompt_sets', 'hero', 'hero');
    // Legacy set at its page partition + the matching legacy page itself.
    expect(store.deleteDoc).toHaveBeenCalledWith('image_prompts_sets', 'hero', 'aws_news');
    expect(store.deleteDoc).toHaveBeenCalledWith('image_prompts', 'aws_news', 'aws_news');
    // Only the assignment referencing the set is cleared.
    const cleared = store.patchDoc.mock.calls.filter(([c]) => c === 'image_prompt_pages');
    expect(cleared.map(([, id]) => id)).toEqual(['aws_news']);
    expect(cleared[0][2]).toMatchObject({ setName: '', promptName: '' });
  });

  it('treats missing docs as no-ops, like Firestore batch.delete', async () => {
    const store = makeStore({
      deleteDoc: vi.fn(async () => {
        const err = new Error('NotFound');
        err.code = 404;
        throw err;
      }),
    });
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.manageConfig(rpc({ action: 'deleteSet', setName: 'hero' }), context);
    expect(res.status).toBe(200);
  });
});

describe('savePageAssignment', () => {
  it('rejects any page outside the allowlist', async () => {
    const store = makeStore();
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.manageConfig(
      rpc({ action: 'savePageAssignment', pagePath: '/admin/secret', setName: 'hero' }),
      context
    );
    expect(res.status).toBe(400);
    expect(store.upsertDoc).not.toHaveBeenCalled();
    expect(ADMIN_PROMPT_PAGE_ALLOWLIST.has('/aws/news')).toBe(true);
  });

  it('merge-saves the assignment at the flattened page id', async () => {
    const store = makeStore();
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.manageConfig(
      rpc({ action: 'savePageAssignment', pagePath: '/aws/news', setName: 'hero', promptName: 'cover' }),
      context
    );
    expect(JSON.parse(res.body)).toMatchObject({ pagePath: '/aws/news', setName: 'hero' });
    expect(store.upsertDoc.mock.calls[0][1]).toMatchObject({
      id: 'aws_news',
      pagePath: '/aws/news',
      setName: 'hero',
      promptName: 'cover',
    });
  });
});

describe('reads and keyword docs', () => {
  it('getConfigTree returns all five collections', async () => {
    const store = makeStore({ queryDocs: vi.fn(async (c) => [{ id: `${c}-1` }]) });
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    const body = JSON.parse((await h.getConfigTree(makeRequest(), context)).body);
    expect(body.pages[0].id).toBe('image_prompt_pages-1');
    expect(body.sets[0].id).toBe('image_prompt_sets-1');
    expect(body.prompts[0].id).toBe('image_prompt_sets_prompts-1');
    expect(body.legacyPages[0].id).toBe('image_prompts-1');
    expect(body.legacySets[0].id).toBe('image_prompts_sets-1');
  });

  it('keyword config sorts synonyms and augmentations like the hook', async () => {
    const store = makeStore({
      queryDocs: vi.fn(async (c) =>
        c === 'prompt_keyword_synonyms'
          ? [{ id: 'b', canonical: 'zebra' }, { id: 'a', canonical: 'alpha' }]
          : [{ id: 'y', label: 'Zoom' }, { id: 'x', label: 'Aspect' }]
      ),
    });
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    const body = JSON.parse((await h.getKeywordConfig(makeRequest(), context)).body);
    expect(body.synonyms.map((s) => s.canonical)).toEqual(['alpha', 'zebra']);
    expect(body.augmentations.map((a) => a.label)).toEqual(['Aspect', 'Zoom']);
  });

  it('keyword PUT merge-saves under the allowlisted collections only', async () => {
    const store = makeStore();
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });

    const denied = await h.putKeywordDoc(
      makeRequest({ params: { collection: 'admins', id: 'x' }, body: { a: 1 } }),
      context
    );
    expect(denied.status).toBe(404);

    await h.putKeywordDoc(
      makeRequest({
        params: { collection: 'synonyms', id: 'kubernetes' },
        body: { canonical: 'kubernetes', patterns: ['k8s'] },
      }),
      context
    );
    expect(store.upsertDoc.mock.calls[0][1]).toMatchObject({
      id: 'kubernetes',
      canonical: 'kubernetes',
      patterns: ['k8s'],
    });

    await h.deleteKeywordDoc(
      makeRequest({ params: { collection: 'augmentations', id: 'zoom' } }),
      context
    );
    expect(store.deleteDoc).toHaveBeenCalledWith('prompt_keyword_augmentations', 'zoom', 'zoom');
  });
});

// ── ADR 0033: the set as an image set ───────────────────────────────────────

import {
  applyKeywordMatrix,
  buildSetSaveFields,
  composeSetPrompt,
  keywordMatrixLines,
  pagePathsForContent,
  promptTemplateVersionFor,
  resolvePromptSetForContent,
  SET_HISTORY_LIMIT,
} from './image-prompts.js';

describe('buildSetSaveFields', () => {
  const meta = { nowIso: '2026-10-03T00:00:00.000Z', updatedBy: 'e' };

  it('starts a new set at version 1 with the creative fields it was given', () => {
    const fields = buildSetSaveFields(
      null,
      {
        primaryPrompt: 'P',
        purpose: ' Covers for AKS posts ',
        styleRules: 'isometric',
        aspectRatio: '16:9',
        tags: ['Azure', 'azure', ' k8s '],
      },
      meta
    );
    expect(fields).toMatchObject({
      primaryPrompt: 'P',
      purpose: 'Covers for AKS posts',
      styleRules: 'isometric',
      aspectRatio: '16:9',
      tags: ['azure', 'k8s'],
      version: 1,
      history: [],
      createdAt: meta.nowIso,
    });
  });

  it('bumps the version and keeps the prior prompt when the text changes, not otherwise', () => {
    const existing = { primaryPrompt: 'P1', version: 2, updatedAt: 't1', updatedBy: 'a', history: [] };
    const same = buildSetSaveFields(existing, { primaryPrompt: 'P1', theme: 'x' }, meta);
    expect(same.version).toBeUndefined();
    expect(same.history).toBeUndefined();
    const changed = buildSetSaveFields(existing, { primaryPrompt: 'P2' }, meta);
    expect(changed.version).toBe(3);
    expect(changed.history).toEqual([
      { version: 2, primaryPrompt: 'P1', savedAt: 't1', savedBy: 'a' },
    ]);
  });

  it('caps history at the limit, newest first', () => {
    const history = Array.from({ length: SET_HISTORY_LIMIT }, (_, i) => ({
      version: i + 1,
      primaryPrompt: `v${i + 1}`,
    }));
    const fields = buildSetSaveFields(
      { primaryPrompt: 'old', version: 11, history },
      { primaryPrompt: 'new' },
      meta
    );
    expect(fields.history).toHaveLength(SET_HISTORY_LIMIT);
    expect(fields.history[0]).toMatchObject({ version: 11, primaryPrompt: 'old' });
  });

  it('never blanks a field the body does not name, and refuses unknown ratios', () => {
    const fields = buildSetSaveFields(
      { primaryPrompt: 'P', styleRules: 'keep' },
      { primaryPrompt: 'P' },
      meta
    );
    expect(fields).not.toHaveProperty('styleRules');
    expect(() => buildSetSaveFields(null, { primaryPrompt: 'P', aspectRatio: '7:1' }, meta)).toThrow(
      /aspectRatio/
    );
  });

  it('promptTemplateVersionFor names the set and its version', () => {
    expect(promptTemplateVersionFor({ name: 'S', version: 4 })).toBe('S@v4');
    expect(promptTemplateVersionFor({ id: 'S' })).toBe('S@v1');
  });
});

describe('saveSet writes the creative fields and the version', () => {
  it('creates with version 1, then bumps on a prompt change', async () => {
    const docs = new Map();
    const store = makeStore({
      readDoc: vi.fn(async (_c, id) => docs.get(id) || null),
      upsertDoc: vi.fn(async (_c, d) => {
        docs.set(d.id, d);
        return d;
      }),
      patchDoc: vi.fn(async (_c, id, u) => {
        const next = { ...docs.get(id), ...u };
        docs.set(id, next);
        return next;
      }),
    });
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    const first = await h.manageConfig(
      rpc({ action: 'saveSet', setName: 'S', primaryPrompt: 'P1', purpose: 'why' }),
      context
    );
    expect(JSON.parse(first.body)).toMatchObject({ success: true, version: 1 });
    const second = await h.manageConfig(
      rpc({ action: 'saveSet', setName: 'S', primaryPrompt: 'P2' }),
      context
    );
    expect(JSON.parse(second.body).version).toBe(2);
    expect(docs.get('S')).toMatchObject({ purpose: 'why', primaryPrompt: 'P2', version: 2 });
    expect(docs.get('S').history[0].primaryPrompt).toBe('P1');
  });
});

describe('renameSet / duplicateSet / archiveSet', () => {
  function libraryStore() {
    const docs = {
      image_prompt_sets: new Map([
        [
          'Old',
          {
            id: 'Old',
            name: 'Old',
            primaryPrompt: 'P',
            version: 2,
            history: [{ version: 1, primaryPrompt: 'P0' }],
          },
        ],
      ]),
      image_prompt_sets_prompts: new Map([
        ['Hero', { id: 'Hero', name: 'Hero', setName: 'Old', slotTemplates: { hero: 'h' } }],
      ]),
      image_prompt_pages: new Map([
        ['aws_blog', { id: 'aws_blog', pagePath: '/aws/blog', setName: 'Old', promptName: 'Hero' }],
      ]),
      generated_content_images: new Map([['img1', { id: 'img1', promptSet: 'Old' }]]),
      curated_article_images: new Map(),
      image_prompts: new Map(),
    };
    const get = (c) => (docs[c] ||= new Map());
    return {
      docs,
      store: makeStore({
        readDoc: vi.fn(async (c, id) => get(c).get(id) || null),
        upsertDoc: vi.fn(async (c, d) => {
          get(c).set(d.id, d);
          return d;
        }),
        patchDoc: vi.fn(async (c, id, u) => {
          const next = { ...get(c).get(id), ...u };
          get(c).set(id, next);
          return next;
        }),
        deleteDoc: vi.fn(async (c, id) => get(c).delete(id)),
        queryDocs: vi.fn(async (c, query, params = []) => {
          const rows = [...get(c).values()];
          const set = params.find((p) => p.name === '@set')?.value;
          if (c === 'image_prompt_sets_prompts' && set) return rows.filter((r) => r.setName === set);
          if (set) return rows.filter((r) => r.promptSet === set || r.promptSetId === set);
          return rows;
        }),
      }),
    };
  }

  it('renameSet moves the set, its prompts, the page assignments and the gallery rows, keeping an alias', async () => {
    const { store, docs } = libraryStore();
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.manageConfig(
      rpc({ action: 'renameSet', setName: 'Old', newSetName: 'New' }),
      context
    );
    expect(JSON.parse(res.body)).toMatchObject({ success: true, prompts: 1, pages: 1, images: 1 });
    expect(docs.image_prompt_sets.has('Old')).toBe(false);
    expect(docs.image_prompt_sets.get('New')).toMatchObject({
      name: 'New',
      version: 2,
      aliases: ['Old'],
    });
    expect(docs.image_prompt_sets_prompts.get('Hero').setName).toBe('New');
    expect(docs.image_prompt_pages.get('aws_blog').setName).toBe('New');
    expect(docs.generated_content_images.get('img1')).toMatchObject({
      promptSet: 'New',
      promptSetId: 'New',
    });
  });

  it('duplicateSet copies the set and prompts at version 1 and leaves the original alone', async () => {
    const { store, docs } = libraryStore();
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.manageConfig(
      rpc({ action: 'duplicateSet', setName: 'Old', newSetName: 'Copy' }),
      context
    );
    expect(JSON.parse(res.body)).toMatchObject({ success: true, prompts: 1, pages: 0, images: 0 });
    expect(docs.image_prompt_sets.get('Old')).toBeTruthy();
    expect(docs.image_prompt_sets.get('Copy')).toMatchObject({
      version: 1,
      history: [],
      duplicatedFrom: 'Old',
    });
    expect(docs.image_prompt_pages.get('aws_blog').setName).toBe('Old');
  });

  it('refuses a clash, a self-rename and a missing source', async () => {
    const { store } = libraryStore();
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    expect(
      (await h.manageConfig(rpc({ action: 'renameSet', setName: 'Old', newSetName: 'Old' }), context))
        .status
    ).toBe(400);
    expect(
      (await h.manageConfig(rpc({ action: 'renameSet', setName: 'Nope', newSetName: 'X' }), context))
        .status
    ).toBe(404);
    // Duplicating onto a name that exists is refused, not an overwrite.
    const clash = await h.manageConfig(
      rpc({ action: 'duplicateSet', setName: 'Old', newSetName: 'Old' }),
      context
    );
    expect(clash.status).toBe(400);
  });

  it('archiveSet stamps archivedAt and clears the assignments; restoreSet clears the stamp', async () => {
    const { store, docs } = libraryStore();
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    await h.manageConfig(rpc({ action: 'archiveSet', setName: 'Old' }), context);
    expect(docs.image_prompt_sets.get('Old').archivedAt).toBe(fixed.now().toISOString());
    expect(docs.image_prompt_pages.get('aws_blog').setName).toBe('');
    await h.manageConfig(rpc({ action: 'restoreSet', setName: 'Old' }), context);
    expect(docs.image_prompt_sets.get('Old').archivedAt).toBeNull();
  });
});

describe('keyword matrix', () => {
  const matrix = {
    synonyms: [{ canonical: 'Database', patterns: ['aurora', 'postgres'] }],
    augmentations: [{ label: 'kiro', patterns: ['kiro'], directive: 'Include the Kiro icon.' }],
  };
  it('collapses patterns to canonical tags and collects directives, case-insensitively', () => {
    const result = applyKeywordMatrix('Migrating Aurora Postgres with KIRO', matrix);
    expect(result).toEqual({ canonical: ['Database'], directives: ['Include the Kiro icon.'] });
    expect(keywordMatrixLines(result)).toEqual([
      'Key concepts: Database.',
      'Include the Kiro icon.',
    ]);
  });
  it('is empty for empty text or no matches', () => {
    expect(applyKeywordMatrix('', matrix)).toEqual({ canonical: [], directives: [] });
    expect(keywordMatrixLines(applyKeywordMatrix('nothing here', matrix))).toEqual([]);
  });
});

describe('pagePathsForContent / resolvePromptSetForContent / composeSetPrompt', () => {
  it('maps provider and type onto allowlisted pages, most specific first', () => {
    expect(pagePathsForContent({ 'Cloud Provider': 'Google Cloud', type: 'news' })).toEqual([
      '/gcp/news',
      '/gcp',
    ]);
    expect(pagePathsForContent({ cloudProvider: 'VMware', type: 'architecture' })).toEqual([
      '/vmware/architecture-designs',
      '/vmware',
    ]);
    expect(pagePathsForContent({ cloudProvider: 'Docker', type: 'framework' })).toEqual(['/docker']);
    expect(pagePathsForContent({ cloudProvider: 'Oracle' })).toEqual([]);
  });

  it('falls through to the landing page when the type page has no assignment', async () => {
    const store = makeStore({
      readDoc: vi.fn(async (c, id) => {
        if (c === 'image_prompt_pages' && id === 'aws') return { setName: 'S' };
        if (c === 'image_prompt_sets' && id === 'S') return { id: 'S', name: 'S', primaryPrompt: 'P' };
        return null;
      }),
    });
    const resolved = await resolvePromptSetForContent(store, { cloudProvider: 'AWS', type: 'blog' });
    expect(resolved).toMatchObject({ pagePath: '/aws', source: 'page' });
    expect(resolved.set.name).toBe('S');
  });

  it('composeSetPrompt ends with the no-text rule and includes only what is set', () => {
    const text = composeSetPrompt({ set: { primaryPrompt: 'P' }, article: { title: 'T' } });
    expect(text.split('\n')).toEqual([
      'P',
      'Subject: T.',
      'No text overlays, labels, or written words in the image.',
    ]);
  });
});

describe('getConfigTree images and resolveForContent', () => {
  it('returns gallery rows with lineage tagged by collection, and the allowlist', async () => {
    const store = makeStore({
      queryDocs: vi.fn(async (c, query) => {
        if (query.includes('promptSet'))
          return c === 'generated_content_images' ? [{ id: 'g1', promptSet: 'S' }] : [];
        return [];
      }),
    });
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    const body = JSON.parse((await h.getConfigTree(makeRequest(), context)).body);
    expect(body.images).toEqual([
      { id: 'g1', promptSet: 'S', galleryCollection: 'generated_content_images' },
    ]);
    expect(body.allowedPages).toContain('/vmware/blog');
    expect(body.allowedPages).toContain('/ansible/code');
  });

  it('resolveForContent names the set a document would use, or builtin', async () => {
    const store = makeStore({
      readDoc: vi.fn(async (c, id) => {
        if (c === 'content') return { id, cloudProvider: 'Azure', type: 'blog', Title: 'T' };
        if (c === 'image_prompt_pages' && id === 'azure_blog')
          return { setName: 'S', promptName: 'Hero' };
        if (c === 'image_prompt_sets' && id === 'S')
          return { id: 'S', name: 'S', primaryPrompt: 'P', version: 2 };
        if (c === 'image_prompt_sets_prompts' && id === 'Hero')
          return { id: 'Hero', name: 'Hero', slotTemplates: { hero: 'wide' } };
        return null;
      }),
    });
    const h = createImagePromptHandlers({ guard: allowGuard, store, ...fixed });
    const res = await h.resolveForContent(makeRequest({ query: { contentId: 'c1' } }), context);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({
      setName: 'S',
      promptName: 'Hero',
      source: 'page',
      pagePath: '/azure/blog',
      promptTemplateVersion: 'S@v2',
    });
    expect(body.prompt).toContain('Slot composition: wide');

    const none = createImagePromptHandlers({
      guard: allowGuard,
      store: makeStore({
        readDoc: vi.fn(async (c, id) => (c === 'content' ? { id, cloudProvider: 'AWS' } : null)),
      }),
      ...fixed,
    });
    expect(
      JSON.parse(
        (await none.resolveForContent(makeRequest({ query: { contentId: 'c1' } }), context)).body
      ).source
    ).toBe('builtin');
    expect((await none.resolveForContent(makeRequest({ query: {} }), context)).status).toBe(400);
  });
});
