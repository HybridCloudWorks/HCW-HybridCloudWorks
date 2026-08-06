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
