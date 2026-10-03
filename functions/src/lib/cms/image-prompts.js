/**
 * Image-prompt configuration — the manageImagePromptConfig RPC (ported from
 * Site-Main cms-functions.js :5329-5507) plus the read/keyword endpoints that
 * replace useImagePrompts.js's direct Firestore access.
 *
 * ADR 0033 (Creative slice): a prompt set IS an image set. The set document
 * grew the fields that make it a creative object rather than a bare prompt —
 * `purpose`, `theme`, `styleRules`, `negativePrompt`, `aspectRatio`, `tags`,
 * `archivedAt`, a `version` counter and a `history[]` of prior primary
 * prompts — plus the actions a library needs (`duplicateSet`, `renameSet`,
 * `archiveSet`, `restoreSet`). The same module now also composes the prompt a
 * generator sends: `resolvePromptSetForContent` finds the set a content
 * document should use (its own lineage first, then the page assignment for
 * its provider and type) and `composeSetPrompt` turns set + prompt + slot +
 * article + keyword matrix into the final text. Before this the AI cover
 * trigger never read the library at all, and the keyword matrix was read by
 * nothing.
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
  // Docker's pages (#775): the hub, news, blog, code, the sandbox recipe
  // (#774), tools and learning. No architecture or frameworks page exists.
  '/docker', '/docker/news', '/docker/blog', '/docker/code', '/docker/sandboxes',
  '/docker/tools', '/docker/education',
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

// ── set fields (ADR 0033 §4 Images) ───────────────────────────────────────

/** Aspect ratios Replicate's image models accept; '' means "model default". */
export const SET_ASPECT_RATIOS = Object.freeze(['', '16:9', '1:1', '4:3', '3:2', '9:16', '4:5']);
export const SET_HISTORY_LIMIT = 10;
export const SET_TAG_LIMIT = 20;

const SET_TEXT_LIMITS = Object.freeze({
  purpose: 500,
  theme: 500,
  styleRules: 4000,
  negativePrompt: 2000,
});

function cleanTags(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((tag) => String(tag || '').trim().toLowerCase().slice(0, 40))
        .filter(Boolean)
    ),
  ].slice(0, SET_TAG_LIMIT);
}

/**
 * The fields a saveSet writes, given what exists. Pure, so the version and
 * history rules are testable: `version` increments when the primary prompt
 * text changes, and the previous prompt is pushed onto `history` (newest
 * first, capped at SET_HISTORY_LIMIT). Optional creative fields are written
 * only when the body names them, so an older client that sends only
 * `primaryPrompt` cannot blank a set's style rules.
 *
 * @throws {Error} on an over-long field or an unknown aspect ratio
 */
export function buildSetSaveFields(existing, body, { nowIso, updatedBy }) {
  const primaryPrompt = String(body.primaryPrompt || '').trim();
  const fields = { primaryPrompt, updatedAt: nowIso, updatedBy };
  for (const [key, limit] of Object.entries(SET_TEXT_LIMITS)) {
    if (body[key] !== undefined && body[key] !== null) {
      assertStringLength(body[key], key, limit, { allowEmpty: true });
      fields[key] = String(body[key] || '').trim();
    }
  }
  if (body.aspectRatio !== undefined && body.aspectRatio !== null) {
    const ratio = String(body.aspectRatio || '').trim();
    if (!SET_ASPECT_RATIOS.includes(ratio)) {
      throw new Error(`aspectRatio must be one of ${SET_ASPECT_RATIOS.filter(Boolean).join(', ')}`);
    }
    fields.aspectRatio = ratio;
  }
  if (body.tags !== undefined && body.tags !== null) fields.tags = cleanTags(body.tags);

  const previousPrompt = String(existing?.primaryPrompt || '').trim();
  const previousVersion = Number(existing?.version) || (existing ? 1 : 0);
  if (!existing) {
    fields.version = 1;
    fields.history = [];
    fields.createdAt = nowIso;
    fields.createdBy = updatedBy;
  } else if (previousPrompt !== primaryPrompt) {
    fields.version = previousVersion + 1;
    fields.history = [
      {
        version: previousVersion,
        primaryPrompt: previousPrompt,
        savedAt: existing.updatedAt || null,
        savedBy: existing.updatedBy || null,
      },
      ...(Array.isArray(existing.history) ? existing.history : []),
    ].slice(0, SET_HISTORY_LIMIT);
  }
  return fields;
}

/** `${name}@v${version}` — the template version a generated image records. */
export function promptTemplateVersionFor(set) {
  const name = normalizePromptConfigKey(set?.name || set?.id);
  return name ? `${name}@v${Number(set?.version) || 1}` : '';
}

// ── keyword matrix ────────────────────────────────────────────────────────

/**
 * What the keyword matrix does to a piece of text: synonym groups whose
 * patterns appear collapse to their canonical tag; augmentations whose
 * patterns appear contribute their scene directive. Case-insensitive
 * substring match, which is what the panel's live tester has always shown.
 */
export function applyKeywordMatrix(text, { synonyms = [], augmentations = [] } = {}) {
  const lower = String(text || '').toLowerCase();
  const canonical = [];
  const directives = [];
  if (!lower.trim()) return { canonical, directives };
  const hits = (patterns) =>
    (Array.isArray(patterns) ? patterns : []).some((pattern) => {
      const p = String(pattern || '').trim().toLowerCase();
      return p && lower.includes(p);
    });
  for (const group of synonyms || []) {
    const label = String(group?.canonical || '').trim();
    if (label && hits(group.patterns) && !canonical.includes(label)) canonical.push(label);
  }
  for (const aug of augmentations || []) {
    const directive = String(aug?.directive || '').trim();
    if (directive && hits(aug.patterns) && !directives.includes(directive))
      directives.push(directive);
  }
  return { canonical, directives };
}

/** The prompt lines a matrix result contributes; [] when nothing matched. */
export function keywordMatrixLines(result) {
  const lines = [];
  if (result?.canonical?.length) lines.push(`Key concepts: ${result.canonical.join(', ')}.`);
  for (const directive of result?.directives || []) lines.push(directive);
  return lines;
}

/**
 * Both keyword collections, for a generator. Never throws: a matrix that
 * cannot be read is an empty matrix, because the image is the work and the
 * matrix is seasoning. A store without `queryDocs` reads as empty too.
 */
export async function loadKeywordMatrix(store, log = {}) {
  if (typeof store?.queryDocs !== 'function') return { synonyms: [], augmentations: [] };
  try {
    const [synonyms, augmentations] = await Promise.all([
      store.queryDocs(KEYWORD_COLLECTIONS.synonyms, `SELECT TOP ${LIST_WINDOW} * FROM c`, []),
      store.queryDocs(KEYWORD_COLLECTIONS.augmentations, `SELECT TOP ${LIST_WINDOW} * FROM c`, []),
    ]);
    return { synonyms: synonyms || [], augmentations: augmentations || [] };
  } catch (error) {
    log.warn?.(`[imagePrompts] keyword matrix unavailable: ${error?.message || error}`);
    return { synonyms: [], augmentations: [] };
  }
}

// ── content → page → set resolution ───────────────────────────────────────

const PROVIDER_SLUGS = Object.freeze({
  aws: 'aws',
  'amazon web services': 'aws',
  azure: 'azure',
  'microsoft azure': 'azure',
  gcp: 'gcp',
  'google cloud': 'gcp',
  'google cloud platform': 'gcp',
  google: 'gcp',
  finops: 'finops',
  terraform: 'terraform',
  github: 'github',
  docker: 'docker',
  vmware: 'vmware',
  ansible: 'ansible',
});

const TYPE_SUFFIXES = Object.freeze({
  news: '/news',
  blog: '/blog',
  architecture: '/architecture-designs',
  framework: '/frameworks',
  coder_corner: '/code',
});

/** The provider slug (`aws`, `gcp`, …) a content document names, or ''. */
export function providerSlugFor(data = {}) {
  const raw = String(
    data.cloudProvider || data['Cloud Provider'] || data.provider || data.Provider || ''
  )
    .trim()
    .toLowerCase();
  return PROVIDER_SLUGS[raw] || (ADMIN_PROMPT_PAGE_ALLOWLIST.has(`/${raw}`) ? raw : '');
}

/**
 * The allowlisted pages whose assignment applies to a content document, most
 * specific first: `/{provider}{type page}` then the provider landing. Empty
 * when the provider is unknown — there is nothing to assign to.
 */
export function pagePathsForContent(data = {}) {
  const slug = providerSlugFor(data);
  if (!slug) return [];
  const type = String(data.type || data.contentType || 'blog')
    .trim()
    .toLowerCase();
  const suffix = TYPE_SUFFIXES[type] || TYPE_SUFFIXES.blog;
  return [`/${slug}${suffix}`, `/${slug}`].filter((path) => ADMIN_PROMPT_PAGE_ALLOWLIST.has(path));
}

/**
 * The set (and prompt) a content document should generate with.
 *
 * Order: lineage already on the document (`imagePromptSet` / `imageLineage`,
 * written by the Submit URLs flow), then the page assignment for the
 * document's provider and type, then the provider landing page. A set that is
 * archived, or named but missing, resolves to null so the caller falls back.
 *
 * @returns {Promise<null | { set: object, prompt: object|null, pagePath: string|null, source: 'content'|'page' }>}
 */
export async function resolvePromptSetForContent(store, data = {}) {
  if (!store?.readDoc) return null;
  const readSet = async (name) => {
    const setName = normalizePromptConfigKey(name);
    if (!setName) return null;
    const set = await store.readDoc('image_prompt_sets', setName, setName).catch(() => null);
    if (!set || set.archivedAt) return null;
    return set;
  };
  const readPrompt = async (setName, name) => {
    const promptName = normalizePromptConfigKey(name);
    if (!promptName) return null;
    return store.readDoc('image_prompt_sets_prompts', promptName, setName).catch(() => null);
  };

  const ownSetName = data.imagePromptSet || data.promptSet || data.imageLineage?.promptSet;
  const ownSet = await readSet(ownSetName);
  if (ownSet) {
    const promptName = data.imagePromptName || data.promptName || data.imageLineage?.promptName;
    return {
      set: ownSet,
      prompt: await readPrompt(ownSet.id, promptName),
      pagePath: null,
      source: 'content',
    };
  }

  for (const pagePath of pagePathsForContent(data)) {
    const assignment = await store
      .readDoc('image_prompt_pages', pathToPromptPageDocId(pagePath), pathToPromptPageDocId(pagePath))
      .catch(() => null);
    const set = await readSet(assignment?.setName);
    if (!set) continue;
    return {
      set,
      prompt: await readPrompt(set.id, assignment?.promptName),
      pagePath,
      source: 'page',
    };
  }
  return null;
}

/** Title / summary / topics lines for the article being illustrated. */
function articleLines(article = {}) {
  const lines = [];
  const title = String(article.Title || article.title || '').trim();
  const summary = String(article.summary || article.Summary || article.description || '').trim();
  const topics = Array.isArray(article.keyTopics) ? article.keyTopics.filter(Boolean) : [];
  if (title) lines.push(`Subject: ${title}.`);
  if (topics.length) lines.push(`Topics: ${topics.join(', ')}.`);
  if (summary) lines.push(`Context: ${summary.slice(0, 600)}`);
  if (article.visualTheme) lines.push(`Visual metaphor: ${String(article.visualTheme).trim()}`);
  return lines;
}

/**
 * The final prompt for one slot from a set, a prompt variation, the article
 * and the keyword matrix. The order is the order a reader would brief an
 * illustrator: the set's shared prompt, the variation, the slot's own
 * template, the article, the matrix, the style rules, then what to avoid.
 */
export function composeSetPrompt({ set, prompt = null, slot = 'hero', article = {}, keyword } = {}) {
  const lines = [String(set?.primaryPrompt || '').trim()];
  const variation = String(prompt?.additionalParameters || '').trim();
  if (variation) lines.push(`Variation: ${variation}`);
  const template = String(prompt?.slotTemplates?.[slot] || '').trim();
  if (template) lines.push(`Slot composition: ${template}`);
  lines.push(...articleLines(article));
  const matrix = applyKeywordMatrix(
    [article.Title, article.title, article.summary, (article.keyTopics || []).join(' ')]
      .filter(Boolean)
      .join(' '),
    keyword
  );
  lines.push(...keywordMatrixLines(matrix));
  const styleRules = String(set?.styleRules || '').trim();
  if (styleRules) lines.push(`Style rules: ${styleRules}`);
  const negative = String(set?.negativePrompt || '').trim();
  if (negative) lines.push(`Avoid: ${negative}`);
  lines.push('No text overlays, labels, or written words in the image.');
  return lines.filter(Boolean).join('\n');
}

/** The lineage fields every generated image row carries (ADR 0033 §4). */
export function lineageFor({ set, prompt, promptText, slot, source }) {
  return {
    promptSetId: set?.id || '',
    promptSet: set?.name || set?.id || '',
    setId: set?.id || '',
    promptName: prompt?.name || prompt?.id || '',
    promptTemplateVersion: set ? promptTemplateVersionFor(set) : '',
    prompt: String(promptText || ''),
    promptSlot: slot || '',
    promptSource: source || '',
  };
}

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

const GALLERY_COLLECTIONS = ['generated_content_images', 'curated_article_images'];
const IMAGE_PROJECTION =
  'c.id, c.imageUrl, c.title, c.slot, c.contentId, c.articleId, c.promptSet, c.promptSetId, ' +
  'c.promptName, c.promptTemplateVersion, c.approvalStatus, c.archivedAt, c.softDeletedAt, ' +
  'c.createdAt, c.generatedAt, c.imageModel, c.imageProvider, c.sourceCollection, c.width, c.height';

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

  async function promptsOfSet(setName) {
    // Scoped to one logical partition rather than fanned out: this container
    // is partitioned on /setName and the predicate IS the partition key, so the
    // fan-out was buying nothing (T-312).
    return store.queryDocs(
      'image_prompt_sets_prompts',
      'SELECT * FROM c WHERE c.setName = @set',
      [{ name: '@set', value: setName }],
      { partitionKey: setName }
    );
  }

  /** Source deleteImagePromptSetArtifacts (:1072). */
  async function deleteSetArtifacts(setName, nowIso) {
    const prompts = await promptsOfSet(setName);
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

  /** Copy a set's prompts into another set's partition. */
  async function copyPrompts(fromSet, toSet, nowIso, updatedBy) {
    const prompts = await promptsOfSet(fromSet);
    for (const prompt of prompts) {
      // eslint-disable-next-line no-unused-vars
      const { _rid, _self, _etag, _attachments, _ts, ...rest } = prompt;
      await store.upsertDoc('image_prompt_sets_prompts', {
        ...rest,
        id: prompt.id,
        setName: toSet,
        updatedAt: nowIso,
        updatedBy,
      });
    }
    return prompts.length;
  }

  /** Re-point every page assignment and gallery row from one set name to another. */
  async function repointSet(fromSet, toSet, nowIso, updatedBy) {
    const assignments = await store.queryDocs(
      'image_prompt_pages',
      `SELECT TOP ${LIST_WINDOW} * FROM c`,
      []
    );
    let pages = 0;
    for (const entry of assignments) {
      if (normalizePromptConfigKey(entry.setName) !== fromSet) continue;
      await store.patchDoc('image_prompt_pages', entry.id, {
        setName: toSet,
        updatedAt: nowIso,
        updatedBy,
      });
      pages += 1;
    }
    let images = 0;
    for (const collection of GALLERY_COLLECTIONS) {
      const rows = await store.queryDocs(
        collection,
        `SELECT TOP ${LIST_WINDOW} c.id FROM c WHERE c.promptSet = @set OR c.promptSetId = @set`,
        [{ name: '@set', value: fromSet }]
      );
      for (const row of rows) {
        await store.patchDoc(collection, row.id, {
          promptSet: toSet,
          promptSetId: toSet,
          setId: toSet,
          updatedAt: nowIso,
        });
        images += 1;
      }
    }
    return { pages, images };
  }

  function stripSystem(doc) {
    // eslint-disable-next-line no-unused-vars
    const { _rid, _self, _etag, _attachments, _ts, ...rest } = doc || {};
    return rest;
  }

  return {
    /** POST /api/manageImagePromptConfig — the five original actions plus the set-library ones. */
    async manageConfig(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const { user } = auth;

      try {
        const body = (await request.json().catch(() => null)) || {};
        const normalizedAction = String(body.action || '').trim();
        const normalizedSetName = normalizePromptConfigKey(body.setName);
        const normalizedPromptName = normalizePromptConfigKey(body.promptName);
        const normalizedNewSetName = normalizePromptConfigKey(body.newSetName);

        if (!normalizedAction) {
          return json(400, { error: 'action is required' });
        }
        if (
          normalizedSetName.length > 120 ||
          normalizedPromptName.length > 120 ||
          normalizedNewSetName.length > 120
        ) {
          return json(400, { error: 'setName/promptName exceeds 120 characters' });
        }

        const nowIso = now().toISOString();
        const updatedBy = actor(user);

        switch (normalizedAction) {
          case 'saveSet': {
            if (!normalizedSetName) return json(400, { error: 'setName is required' });
            let fields;
            try {
              assertStringLength(body.primaryPrompt, 'primaryPrompt', 12000, { allowEmpty: false });
              const existing = await store.readDoc(
                'image_prompt_sets',
                normalizedSetName,
                normalizedSetName
              );
              fields = buildSetSaveFields(existing, body, { nowIso, updatedBy });
            } catch (error) {
              return json(400, { error: String(error.message || error) });
            }
            const saved = await mergeSet(store, 'image_prompt_sets', normalizedSetName, {
              name: normalizedSetName,
              ...fields,
            });
            return json(200, {
              success: true,
              action: 'saveSet',
              setName: normalizedSetName,
              version: saved?.version ?? fields.version ?? null,
            });
          }

          case 'deleteSet': {
            if (!normalizedSetName) return json(400, { error: 'setName is required' });
            await deleteSetArtifacts(normalizedSetName, nowIso);
            return json(200, { success: true, action: 'deleteSet', setName: normalizedSetName });
          }

          case 'archiveSet':
          case 'restoreSet': {
            if (!normalizedSetName) return json(400, { error: 'setName is required' });
            const existing = await store.readDoc(
              'image_prompt_sets',
              normalizedSetName,
              normalizedSetName
            );
            if (!existing) return json(404, { error: `set ${normalizedSetName} not found` });
            const archiving = normalizedAction === 'archiveSet';
            await store.patchDoc('image_prompt_sets', normalizedSetName, {
              archivedAt: archiving ? nowIso : null,
              updatedAt: nowIso,
              updatedBy,
            });
            if (archiving) await clearAssignmentsForSet(normalizedSetName, nowIso);
            return json(200, {
              success: true,
              action: normalizedAction,
              setName: normalizedSetName,
              archivedAt: archiving ? nowIso : null,
            });
          }

          case 'duplicateSet':
          case 'renameSet': {
            if (!normalizedSetName || !normalizedNewSetName) {
              return json(400, { error: 'setName and newSetName are required' });
            }
            if (normalizedSetName === normalizedNewSetName) {
              return json(400, { error: 'newSetName must differ from setName' });
            }
            const source = await store.readDoc(
              'image_prompt_sets',
              normalizedSetName,
              normalizedSetName
            );
            if (!source) return json(404, { error: `set ${normalizedSetName} not found` });
            const clash = await store.readDoc(
              'image_prompt_sets',
              normalizedNewSetName,
              normalizedNewSetName
            );
            if (clash) return json(409, { error: `set ${normalizedNewSetName} already exists` });

            const renaming = normalizedAction === 'renameSet';
            const base = stripSystem(source);
            await store.upsertDoc('image_prompt_sets', {
              ...base,
              id: normalizedNewSetName,
              name: normalizedNewSetName,
              ...(renaming
                ? { aliases: [...new Set([...(base.aliases || []), normalizedSetName])] }
                : { version: 1, history: [], aliases: [], duplicatedFrom: normalizedSetName }),
              archivedAt: renaming ? base.archivedAt || null : null,
              createdAt: renaming ? base.createdAt || nowIso : nowIso,
              createdBy: renaming ? base.createdBy || updatedBy : updatedBy,
              updatedAt: nowIso,
              updatedBy,
            });
            const prompts = await copyPrompts(
              normalizedSetName,
              normalizedNewSetName,
              nowIso,
              updatedBy
            );
            let repointed = { pages: 0, images: 0 };
            if (renaming) {
              repointed = await repointSet(normalizedSetName, normalizedNewSetName, nowIso, updatedBy);
              const old = await promptsOfSet(normalizedSetName);
              for (const prompt of old) {
                await deleteIgnoringMissing(
                  store,
                  'image_prompt_sets_prompts',
                  prompt.id,
                  normalizedSetName
                );
              }
              await deleteIgnoringMissing(store, 'image_prompt_sets', normalizedSetName);
            }
            return json(200, {
              success: true,
              action: normalizedAction,
              setName: normalizedSetName,
              newSetName: normalizedNewSetName,
              prompts,
              ...repointed,
            });
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
     * GET /api/cms/image-prompts — the whole config tree in one response,
     * plus `images`: every gallery row that carries set lineage, so the page
     * can show each set's generated images without a second read. The hook's
     * legacy-merge logic (findLegacySetByName etc.) stays client-side.
     */
    async getConfigTree(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const all = (container) =>
          store.queryDocs(container, `SELECT TOP ${LIST_WINDOW} * FROM c`, []);
        const lineageRows = (container) =>
          store
            .queryDocs(
              container,
              `SELECT TOP ${LIST_WINDOW} ${IMAGE_PROJECTION} FROM c WHERE (IS_DEFINED(c.promptSet) AND c.promptSet != '') OR (IS_DEFINED(c.promptSetId) AND c.promptSetId != '')`,
              []
            )
            .then((rows) => rows.map((row) => ({ ...row, galleryCollection: container })))
            .catch(() => []);
        const [pages, sets, prompts, legacyPages, legacySets, generated, curated] =
          await Promise.all([
            all('image_prompt_pages'),
            all('image_prompt_sets'),
            all('image_prompt_sets_prompts'),
            all('image_prompts'),
            all('image_prompts_sets'),
            lineageRows('generated_content_images'),
            lineageRows('curated_article_images'),
          ]);
        return json(200, {
          success: true,
          pages,
          sets,
          prompts,
          legacyPages,
          legacySets,
          images: [...generated, ...curated],
          allowedPages: [...ADMIN_PROMPT_PAGE_ALLOWLIST],
        });
      } catch (error) {
        context.error('getImagePromptConfig failed:', error);
        return json(500, { error: 'Failed to load image prompt config' });
      }
    },

    /**
     * GET /api/cms/image-prompts/resolve?contentId= — which set a content
     * document would generate with today, and the prompt it would send for
     * the hero slot. The review board shows this beside "Generate AI Cover" so
     * the button's text can be true.
     */
    async resolveForContent(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const contentId = String(request.query.get('contentId') || '').trim();
        if (!contentId) return json(400, { error: 'contentId required' });
        const data = await store.readDoc('content', contentId, contentId);
        if (!data) return json(404, { error: `content ${contentId} not found` });
        const resolved = await resolvePromptSetForContent(store, data);
        if (!resolved) {
          return json(200, {
            success: true,
            contentId,
            setName: '',
            promptName: '',
            source: 'builtin',
            pagePaths: pagePathsForContent(data),
            prompt: '',
          });
        }
        const keyword = await loadKeywordMatrix(store, context);
        const prompt = composeSetPrompt({
          set: resolved.set,
          prompt: resolved.prompt,
          slot: 'hero',
          article: data,
          keyword,
        });
        return json(200, {
          success: true,
          contentId,
          setName: resolved.set.name || resolved.set.id,
          promptName: resolved.prompt?.name || resolved.prompt?.id || '',
          promptTemplateVersion: promptTemplateVersionFor(resolved.set),
          source: resolved.source,
          pagePath: resolved.pagePath,
          pagePaths: pagePathsForContent(data),
          prompt,
        });
      } catch (error) {
        context.error('resolveImagePrompt failed:', error);
        return json(500, { error: 'Failed to resolve image prompt' });
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
