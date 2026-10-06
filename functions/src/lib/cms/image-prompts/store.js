/**
 * The multi-document store operations the set library needs: a set's
 * prompts, its page assignments, the legacy per-page copies, and the
 * gallery rows that carry its name (PR #841 split of image-prompts.js).
 */
import {
  LIST_WINDOW,
  deleteIgnoringMissing,
  hasLegacyPromptFields,
  normalizePromptConfigKey,
} from './shared.js';

const GALLERY_COLLECTIONS = ['generated_content_images', 'curated_article_images'];

const listAll = (store, container) =>
  store.queryDocs(container, `SELECT TOP ${LIST_WINDOW} * FROM c`, []);

/** Every page assignment currently naming `setName`. */
async function assignmentsOfSet(store, setName) {
  const assignments = await listAll(store, 'image_prompt_pages');
  return assignments.filter((entry) => normalizePromptConfigKey(entry.setName) === setName);
}

/** Blank every page assignment that names the set. */
export async function clearAssignmentsForSet(store, setName, nowIso) {
  for (const entry of await assignmentsOfSet(store, setName)) {
    await store.patchDoc('image_prompt_pages', entry.id, {
      setName: '',
      promptName: '',
      updatedAt: nowIso,
    });
  }
}

/** The prompts of one set, read from its own partition. */
export async function promptsOfSet(store, setName) {
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

/** Delete every prompt of a set, then the set document itself. */
export async function deleteSetAndPrompts(store, setName) {
  const prompts = await promptsOfSet(store, setName);
  for (const prompt of prompts) {
    await deleteIgnoringMissing(store, 'image_prompt_sets_prompts', prompt.id, setName);
  }
  await deleteIgnoringMissing(store, 'image_prompt_sets', setName);
}

/** Is this legacy page the set's own copy (its title names the set)? */
const legacyPageNames = (page, setName) =>
  hasLegacyPromptFields(page) && normalizePromptConfigKey(page.title || setName) === setName;

/** Source deleteImagePromptSetArtifacts (:1072). */
export async function deleteSetArtifacts(store, setName, nowIso) {
  await deleteSetAndPrompts(store, setName);

  for (const page of await listAll(store, 'image_prompts')) {
    const legacySet = await store.readDoc('image_prompts_sets', setName, page.id);
    if (legacySet) {
      await deleteIgnoringMissing(store, 'image_prompts_sets', setName, page.id);
    }
    if (legacyPageNames(page, setName)) {
      await deleteIgnoringMissing(store, 'image_prompts', page.id);
    }
  }

  await clearAssignmentsForSet(store, setName, nowIso);
}

/** Source deleteLegacyImagePromptIfNeeded (:1107). */
export async function deleteLegacyPromptIfNeeded(store, setName, promptName) {
  if (!setName || !promptName) return;
  for (const page of await listAll(store, 'image_prompts')) {
    const legacySet = await store.readDoc('image_prompts_sets', setName, page.id);
    if (legacySet) {
      if (normalizePromptConfigKey(legacySet.title || setName) === promptName) {
        await deleteIgnoringMissing(store, 'image_prompts_sets', setName, page.id);
      }
      continue;
    }
    if (
      legacyPageNames(page, setName) &&
      normalizePromptConfigKey(page.title || 'default') === promptName
    ) {
      await deleteIgnoringMissing(store, 'image_prompts', page.id);
    }
  }
}

/** Copy a set's prompts into another set's partition. */
export async function copyPrompts(store, fromSet, toSet, nowIso, updatedBy) {
  const prompts = await promptsOfSet(store, fromSet);
  for (const prompt of prompts) {
     
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

/** Re-point every page assignment from one set name to another; the count. */
async function repointAssignments(store, fromSet, toSet, nowIso, updatedBy) {
  const assignments = await assignmentsOfSet(store, fromSet);
  for (const entry of assignments) {
    await store.patchDoc('image_prompt_pages', entry.id, {
      setName: toSet,
      updatedAt: nowIso,
      updatedBy,
    });
  }
  return assignments.length;
}

/** Re-point every gallery row from one set name to another; the count. */
async function repointGalleryRows(store, fromSet, toSet, nowIso) {
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
  return images;
}

/** Re-point every page assignment and gallery row from one set name to another. */
export async function repointSet(store, fromSet, toSet, nowIso, updatedBy) {
  const pages = await repointAssignments(store, fromSet, toSet, nowIso, updatedBy);
  const images = await repointGalleryRows(store, fromSet, toSet, nowIso);
  return { pages, images };
}
