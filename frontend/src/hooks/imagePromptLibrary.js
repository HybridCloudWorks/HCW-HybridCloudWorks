/**
 * The prompt library (split from useImagePrompts for PR #841): every set as
 * the Image Prompts page shows it, built from the config tree that
 * hooks/imagePromptTree.js reads. Pure over the tree.
 */
import {
  docIdToPath,
  findLegacyPromptDataInTree,
  findLegacySetByNameInTree,
  legacyPageEntries,
  legacySetNamesForPage,
  normalizeKey,
} from './imagePromptTree';

// The tree reads the hook composes; re-exported so one import serves it.
export {
  asConfigTree,
  docIdToPath,
  findAssignmentInTree,
  findLegacyPromptDataInTree,
  findLegacyPromptForPageInTree,
  findLegacySetByNameInTree,
  findPromptInTree,
  findSetInTree,
  normalizeKey,
  normalizeSlotTemplates,
  pathToDocId,
  promptNamesInTree,
  promptSetNames,
  resolvePromptFromTree,
} from './imagePromptTree';

/** A configured set as the library shows it, before anything is attached. */
function librarySetFrom(set) {
  return {
    ...set,
    name: set.name || set.id,
    legacy: false,
    prompts: [],
    pages: [],
    images: [],
    tags: Array.isArray(set.tags) ? set.tags : [],
    history: Array.isArray(set.history) ? set.history : [],
    version: Number(set.version) || 1,
  };
}

/** A legacy set as the library shows it, with its one legacy prompt attached. */
function legacyLibrarySet(tree, name, legacy) {
  return {
    id: name,
    ...legacy,
    legacy: true,
    version: 1,
    history: [],
    tags: [],
    prompts: [
      {
        id: legacy.legacyPromptName,
        name: legacy.legacyPromptName,
        ...(findLegacyPromptDataInTree(tree, legacy, name) || {}),
      },
    ],
    pages: [],
    images: [],
  };
}

/** Legacy per-page sets, added to the library under their own names. */
function addLegacySets(tree, byName) {
  for (const { pageDocId, data } of legacyPageEntries(tree)) {
    for (const name of legacySetNamesForPage(tree, pageDocId, data)) {
      if (byName.has(name)) continue;
      const legacy = findLegacySetByNameInTree(tree, name);
      if (legacy) byName.set(name, legacyLibrarySet(tree, name, legacy));
    }
  }
}

/** Every prompt under the set it names. */
function attachPrompts(tree, byName) {
  for (const prompt of tree.prompts) {
    const set = byName.get(prompt.setName);
    if (set) set.prompts.push({ ...prompt, name: prompt.name || prompt.id });
  }
}

/** Every page assignment under the set it names. */
function attachPages(tree, byName) {
  for (const page of tree.pages) {
    const set = byName.get(normalizeKey(page.setName));
    if (set) {
      set.pages.push({
        pagePath: page.pagePath || docIdToPath(page.id),
        promptName: page.promptName || '',
      });
    }
  }
}

/** Every image under the set its lineage names. */
function attachImages(tree, byName) {
  for (const image of tree.images) {
    const set = byName.get(normalizeKey(image.promptSet || image.promptSetId));
    if (set) set.images.push(image);
  }
}

const imageStamp = (row) => new Date(row.createdAt || row.generatedAt || 0).getTime();

/** Prompts and pages A-Z, images newest first; in place. */
function sortLibrarySet(set) {
  set.prompts.sort((a, b) => a.name.localeCompare(b.name));
  set.pages.sort((a, b) => a.pagePath.localeCompare(b.pagePath));
  set.images.sort((a, b) => imageStamp(b) - imageStamp(a));
  return set;
}

/**
 * Every set as the Image Prompts page shows it: the set document with its
 * prompts, the pages assigned to it and the generated images carrying its
 * lineage. Legacy per-page sets appear too, flagged `legacy`, so nothing an
 * older page configured goes missing from the grid. Pure over the tree.
 */
export function buildPromptLibrary(tree) {
  const byName = new Map(tree.sets.map((set) => [set.id, librarySetFrom(set)]));
  addLegacySets(tree, byName);
  attachPrompts(tree, byName);
  attachPages(tree, byName);
  attachImages(tree, byName);
  const sets = [...byName.values()].map(sortLibrarySet);
  return {
    sets: sets.sort((a, b) => a.name.localeCompare(b.name)),
    pages: tree.pages,
    allowedPages: tree.allowedPages,
  };
}
