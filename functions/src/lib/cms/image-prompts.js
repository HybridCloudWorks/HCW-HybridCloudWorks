/**
 * Image-prompt configuration — the manageImagePromptConfig RPC (ported from
 * Site-Main cms-functions.js :5329-5507) plus the read/keyword endpoints that
 * replace useImagePrompts.js's direct Firestore access.
 *
 * The reconciliation the contract asked for: WRITES to sets/prompts/page
 * assignments already went through the RPC — that is ported verbatim here,
 * five actions and all. What the hook still did directly was READ the config
 * tree and WRITE the keyword synonym/augmentation collections; those get
 * plain endpoints, and the hook's legacy-merge logic stays client-side where
 * it lives today.
 *
 * Container mapping (scripts/lib/migration-manifest.mjs):
 *   image_prompt_sets          /id       doc id = set name
 *   image_prompt_sets_prompts  /setName  doc id = prompt name (unique per set)
 *   image_prompt_pages         /id       doc id = pathToPromptPageDocId(path)
 *   image_prompts              /id       legacy pages
 *   image_prompts_sets         /pageId   legacy per-page sets (set-name ids)
 *   prompt_keyword_synonyms, prompt_keyword_augmentations  /id
 *
 * Firestore `set(..., {merge:true})` becomes read-then-patch/upsert (the
 * settings-endpoint pattern); batch deletes become sequential deletes with
 * 404s tolerated — Firestore's batch.delete on a missing doc is a no-op and
 * this port keeps that behavior.
 */
import { normalizeSlotTemplates } from './content-quality.js';
import { assertStringLength } from './content-update-validation.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function normalizePromptConfigKey(value = '') {
  return String(value || '').trim();
}

export function pathToPromptPageDocId(pagePath = '') {
  return String(pagePath || '')
    .replace(/\//g, '_')
    .replace(/^_/, '');
}

export function hasLegacyPromptFields(data = {}) {
  return Boolean(data?.primaryPrompt || data?.secondaryPrompt || data?.title);
}

/** Verbatim from the source — the pages a prompt set may be assigned to. */
export const ADMIN_PROMPT_PAGE_ALLOWLIST = new Set([
  '/aws', '/aws/news', '/aws/blog', '/aws/architecture-designs', '/aws/frameworks',
  '/aws/education', '/aws/audio-architecture',
  '/azure', '/azure/news', '/azure/blog', '/azure/architecture-designs', '/azure/frameworks',
  '/azure/education', '/azure/audio-architecture',
  '/gcp', '/gcp/news', '/gcp/blog', '/gcp/architecture-designs', '/gcp/frameworks',
  '/gcp/education', '/gcp/audio-architecture',
  '/finops', '/finops/news', '/finops/blog', '/finops/architecture-designs',
  '/finops/frameworks', '/finops/education', '/finops/tools', '/finops/focus',
  '/vmware', '/vmware/news', '/vmware/blog', '/vmware/architecture-designs',
  '/vmware/frameworks', '/vmware/education', '/vmware/audio-architecture',
  '/terraform', '/terraform/news', '/terraform/blog', '/terraform/code',
  '/terraform/modules', '/terraform/tools',
  '/ansible', '/ansible/news', '/ansible/blog', '/ansible/code', '/ansible/education',
  '/github', '/github/news', '/github/blog', '/github/workflows', '/github/code',
  '/github/tools',
]);

export function assertAllowedPromptPage(pagePath) {
  const normalized = String(pagePath || '').trim();
  if (!normalized) {
    throw new Error('pagePath is required');
  }
  if (!ADMIN_PROMPT_PAGE_ALLOWLIST.has(normalized)) {
    throw new Error(`pagePath is not allowed: ${normalized}`);
  }
  return normalized;
}

const KEYWORD_COLLECTIONS = {
  synonyms: 'prompt_keyword_synonyms',
  augmentations: 'prompt_keyword_augmentations',
};

const LIST_WINDOW = 1000;

/** Firestore set(..., {merge:true}): patch when present, create when absent. */
async function mergeSet(store, container, id, fields, partitionKey = id) {
  const existing = await store.readDoc(container, id, partitionKey);
  if (existing) {
    return store.patchDoc(container, id, fields, { partitionKey });
  }
  return store.upsertDoc(container, { id, ...fields });
}

/** Firestore batch.delete tolerance: a missing doc is a no-op, not an error. */
async function deleteIgnoringMissing(store, container, id, partitionKey = id) {
  try {
    await store.deleteDoc(container, id, partitionKey);
  } catch (err) {
    if (err?.code !== 404) throw err;
  }
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function, patchDoc: Function, deleteDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 */
export function createImagePromptHandlers({ guard, store, now = () => new Date() }) {
  const actor = (user) => user.email || user.preferred_username || user.oid || 'admin';

  async function clearAssignmentsForSet(setName, nowIso) {
    const assignments = await store.queryDocs(
      'image_prompt_pages',
      `SELECT TOP ${LIST_WINDOW} * FROM c`,
      []
    );
    for (const entry of assignments) {
      if (normalizePromptConfigKey(entry.setName) !== setName) continue;
      await store.patchDoc('image_prompt_pages', entry.id, {
        setName: '',
        promptName: '',
        updatedAt: nowIso,
      });
    }
  }

  /** Source deleteImagePromptSetArtifacts (:1072). */
  async function deleteSetArtifacts(setName, nowIso) {
    // Scoped to one logical partition rather than fanned out: this container
    // is partitioned on /setName and the predicate IS the partition key, so the
    // fan-out was buying nothing (TODO.md T-312).
    const prompts = await store.queryDocs(
      'image_prompt_sets_prompts',
      'SELECT c.id, c.setName FROM c WHERE c.setName = @set',
      [{ name: '@set', value: setName }],
      { partitionKey: setName }
    );
    for (const prompt of prompts) {
      await deleteIgnoringMissing(store, 'image_prompt_sets_prompts', prompt.id, setName);
    }
    await deleteIgnoringMissing(store, 'image_prompt_sets', setName);

    const legacyPages = await store.queryDocs(
      'image_prompts',
      `SELECT TOP ${LIST_WINDOW} * FROM c`,
      []
    );
    for (const page of legacyPages) {
      const legacySet = await store.readDoc('image_prompts_sets', setName, page.id);
      if (legacySet) {
        await deleteIgnoringMissing(store, 'image_prompts_sets', setName, page.id);
      }
      if (
        hasLegacyPromptFields(page) &&
        normalizePromptConfigKey(page.title || setName) === setName
      ) {
        await deleteIgnoringMissing(store, 'image_prompts', page.id);
      }
    }

    await clearAssignmentsForSet(setName, nowIso);
  }

  /** Source deleteLegacyImagePromptIfNeeded (:1107). */
  async function deleteLegacyPromptIfNeeded(setName, promptName) {
    if (!setName || !promptName) return;
    const legacyPages = await store.queryDocs(
      'image_prompts',
      `SELECT TOP ${LIST_WINDOW} * FROM c`,
      []
    );
    for (const page of legacyPages) {
      const legacySet = await store.readDoc('image_prompts_sets', setName, page.id);
      if (legacySet) {
        if (normalizePromptConfigKey(legacySet.title || setName) === promptName) {
          await deleteIgnoringMissing(store, 'image_prompts_sets', setName, page.id);
        }
        continue;
      }
      if (
        hasLegacyPromptFields(page) &&
        normalizePromptConfigKey(page.title || setName) === setName &&
        normalizePromptConfigKey(page.title || 'default') === promptName
      ) {
        await deleteIgnoringMissing(store, 'image_prompts', page.id);
      }
    }
  }

  return {
    /** POST /api/manageImagePromptConfig — the five-action RPC, verbatim. */
    async manageConfig(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const normalizedAction = String(body.action || '').trim();
        const normalizedSetName = normalizePromptConfigKey(body.setName);
        const normalizedPromptName = normalizePromptConfigKey(body.promptName);

        if (!normalizedAction) {
          return json(400, { error: 'action is required' });
        }
        if (normalizedSetName.length > 120 || normalizedPromptName.length > 120) {
          return json(400, { error: 'setName/promptName exceeds 120 characters' });
        }

        const nowIso = now().toISOString();
        const updatedBy = actor(user);

        switch (normalizedAction) {
          case 'saveSet': {
            if (!normalizedSetName) return json(400, { error: 'setName is required' });
            try {
              assertStringLength(body.primaryPrompt, 'primaryPrompt', 12000, { allowEmpty: false });
            } catch (error) {
              return json(400, { error: String(error.message || error) });
            }
            await mergeSet(store, 'image_prompt_sets', normalizedSetName, {
              name: normalizedSetName,
              primaryPrompt: String(body.primaryPrompt || '').trim(),
              updatedAt: nowIso,
              updatedBy,
            });
            return json(200, { success: true, action: 'saveSet', setName: normalizedSetName });
          }

          case 'deleteSet': {
            if (!normalizedSetName) return json(400, { error: 'setName is required' });
            await deleteSetArtifacts(normalizedSetName, nowIso);
            return json(200, { success: true, action: 'deleteSet', setName: normalizedSetName });
          }

          case 'savePrompt': {
            if (!normalizedSetName || !normalizedPromptName) {
              return json(400, { error: 'setName and promptName are required' });
            }
            let slotTemplates;
            try {
              assertStringLength(body.additionalParameters, 'additionalParameters', 12000, {
                allowEmpty: true,
              });
              slotTemplates = normalizeSlotTemplates(body.slotTemplates);
              Object.values(slotTemplates).forEach((value) => {
                assertStringLength(value, 'slotTemplate', 2000, { allowEmpty: true });
              });
            } catch (error) {
              return json(400, { error: String(error.message || error) });
            }
            await mergeSet(store, 'image_prompt_sets', normalizedSetName, {
              name: normalizedSetName,
              updatedAt: nowIso,
              updatedBy,
            });
            // Prompt names are unique only within a set — /setName partition.
            const existingPrompt = await store.readDoc(
              'image_prompt_sets_prompts',
              normalizedPromptName,
              normalizedSetName
            );
            const promptFields = {
              setName: normalizedSetName,
              name: normalizedPromptName,
              additionalParameters: String(body.additionalParameters || '').trim(),
              slotTemplates,
              updatedAt: nowIso,
              updatedBy,
            };
            if (existingPrompt) {
              await store.patchDoc('image_prompt_sets_prompts', normalizedPromptName, promptFields, {
                partitionKey: normalizedSetName,
              });
            } else {
              await store.upsertDoc('image_prompt_sets_prompts', {
                id: normalizedPromptName,
                ...promptFields,
              });
            }
            return json(200, {
              success: true,
              action: 'savePrompt',
              setName: normalizedSetName,
              promptName: normalizedPromptName,
            });
          }

          case 'deletePrompt': {
            if (!normalizedSetName || !normalizedPromptName) {
              return json(400, { error: 'setName and promptName are required' });
            }
            await deleteIgnoringMissing(
              store,
              'image_prompt_sets_prompts',
              normalizedPromptName,
              normalizedSetName
            );
            await deleteLegacyPromptIfNeeded(normalizedSetName, normalizedPromptName);
            return json(200, {
              success: true,
              action: 'deletePrompt',
              setName: normalizedSetName,
              promptName: normalizedPromptName,
            });
          }

          case 'savePageAssignment': {
            let normalizedPagePath;
            try {
              normalizedPagePath = assertAllowedPromptPage(body.pagePath);
            } catch (error) {
              return json(400, { error: String(error.message || error) });
            }
            const pageDocId = pathToPromptPageDocId(normalizedPagePath);
            await mergeSet(store, 'image_prompt_pages', pageDocId, {
              pagePath: normalizedPagePath,
              setName: normalizedSetName || '',
              promptName: normalizedPromptName || '',
              updatedAt: nowIso,
              updatedBy,
            });
            return json(200, {
              success: true,
              action: 'savePageAssignment',
              pagePath: normalizedPagePath,
              setName: normalizedSetName || '',
              promptName: normalizedPromptName || '',
            });
          }

          default:
            return json(400, { error: `Unsupported action: ${normalizedAction}` });
        }
      } catch (error) {
        context.error('manageImagePromptConfig failed:', error);
        return json(500, {
          error: 'Failed to manage image prompt config',
          message: error?.message || 'Unknown error',
        });
      }
    },

    /**
     * GET /api/cms/image-prompts — the whole config tree in one response.
     * The hook's legacy-merge logic (findLegacySetByName etc.) stays
     * client-side; this hands it the same five collections it read directly.
     */
    async getConfigTree(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const all = (container) =>
          store.queryDocs(container, `SELECT TOP ${LIST_WINDOW} * FROM c`, []);
        const [pages, sets, prompts, legacyPages, legacySets] = await Promise.all([
          all('image_prompt_pages'),
          all('image_prompt_sets'),
          all('image_prompt_sets_prompts'),
          all('image_prompts'),
          all('image_prompts_sets'),
        ]);
        return json(200, { success: true, pages, sets, prompts, legacyPages, legacySets });
      } catch (error) {
        context.error('getImagePromptConfig failed:', error);
        return json(500, { error: 'Failed to load image prompt config' });
      }
    },

    /** GET /api/cms/keyword-config — synonyms + augmentations, sorted. */
    async getKeywordConfig(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const [synonyms, augmentations] = await Promise.all([
          store.queryDocs('prompt_keyword_synonyms', `SELECT TOP ${LIST_WINDOW} * FROM c`, []),
          store.queryDocs('prompt_keyword_augmentations', `SELECT TOP ${LIST_WINDOW} * FROM c`, []),
        ]);
        synonyms.sort((a, b) => String(a.canonical || '').localeCompare(String(b.canonical || '')));
        augmentations.sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
        return json(200, { success: true, synonyms, augmentations });
      } catch (error) {
        context.error('getKeywordConfig failed:', error);
        return json(500, { error: 'Failed to load keyword config' });
      }
    },

    /** PUT /api/cms/keyword-config/{collection}/{id} — setDoc merge:true. */
    async putKeywordDoc(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const container = KEYWORD_COLLECTIONS[request.params.collection];
      if (!container) return json(404, { error: 'Unknown keyword collection' });
      try {
        const id = normalizePromptConfigKey(request.params.id);
        if (!id || id.length > 120) return json(400, { error: 'valid id required' });
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return json(400, { error: 'Body must be a JSON object' });
        }
        const { id: _ignored, ...fields } = body;
        const saved = await mergeSet(store, container, id, {
          ...fields,
          updatedAt: now().toISOString(),
        });
        return json(200, { success: true, item: saved });
      } catch (error) {
        context.error('putKeywordDoc failed:', error);
        return json(500, { error: 'Failed to save keyword doc' });
      }
    },

    /** DELETE /api/cms/keyword-config/{collection}/{id} */
    async deleteKeywordDoc(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const container = KEYWORD_COLLECTIONS[request.params.collection];
      if (!container) return json(404, { error: 'Unknown keyword collection' });
      try {
        const id = normalizePromptConfigKey(request.params.id);
        if (!id) return json(400, { error: 'id required' });
        await deleteIgnoringMissing(store, container, id);
        return json(200, { success: true });
      } catch (error) {
        context.error('deleteKeywordDoc failed:', error);
        return json(500, { error: 'Failed to delete keyword doc' });
      }
    },
  };
}
