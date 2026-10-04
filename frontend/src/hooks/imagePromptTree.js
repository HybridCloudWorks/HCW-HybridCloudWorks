/**
 * The image-prompt config tree and the reads over it (split from
 * useImagePrompts for PR #841): pure functions that resolve sets, prompts and
 * page assignments, legacy shapes included, without touching the network or
 * React state. hooks/imagePromptLibrary.js builds the whole library on top.
 *
 * Reads come from GET cms/image-prompts — the whole config tree (pages, sets,
 * prompts, plus the two legacy collections) in one response; the legacy-merge
 * logic that used to run over direct Firestore reads runs over that tree
 * unchanged.
 *
 * Tree shapes (see functions/src/lib/cms/image-prompts.js):
 *   sets[]        id = set name, { primaryPrompt, purpose, theme, styleRules,
 *                 negativePrompt, aspectRatio, tags, version, history,
 *                 archivedAt } — a set IS an image set (ADR 0033)
 *   images[]      gallery rows carrying set lineage, tagged galleryCollection
 *   prompts[]     id = prompt name, { setName, additionalParameters, slotTemplates }
 *   pages[]       id = page doc id, { pagePath, setName, promptName }
 *   legacyPages[] id = page doc id, may carry { title, primaryPrompt, secondaryPrompt }
 *   legacySets[]  id = set name, { pageId, title?, primaryPrompt, secondaryPrompt }
 */

export function pathToDocId(pagePath) {
  return String(pagePath || '')
    .replace(/\//g, '_')
    .replace(/^_/, '');
}

export function normalizeKey(value) {
  return String(value || '').trim();
}

const LEGACY_DEFAULT_PROMPT_NAME = 'default';
const SLOT_KEYS = ['hero', 'secondary1', 'secondary2', 'secondary3'];

export function docIdToPath(docId) {
  const normalizedDocId = normalizeKey(docId);
  if (!normalizedDocId) return '';
  return `/${normalizedDocId.replace(/_/g, '/')}`;
}

function getLegacyPromptName(legacyData) {
  return normalizeKey(legacyData?.title) || LEGACY_DEFAULT_PROMPT_NAME;
}

function hasLegacyPromptFields(data) {
  return Boolean(data?.primaryPrompt || data?.secondaryPrompt || data?.title);
}

function mapLegacySetData(pageDocId, setName, data) {
  return {
    name: normalizeKey(setName),
    primaryPrompt: String(data?.primaryPrompt || '').trim(),
    updatedAt: data?.updatedAt || null,
    legacy: true,
    legacyPageDocId: pageDocId,
    legacyPagePath: docIdToPath(pageDocId),
    legacyPromptName: getLegacyPromptName(data),
  };
}

function mapLegacyPromptData(data) {
  return {
    name: getLegacyPromptName(data),
    additionalParameters: String(data?.secondaryPrompt || '').trim(),
    slotTemplates: {},
    updatedAt: data?.updatedAt || null,
    legacy: true,
  };
}

export function normalizeSlotTemplates(slotTemplates = {}) {
  return SLOT_KEYS.reduce((acc, key) => {
    const value = String(slotTemplates?.[key] || '').trim();
    if (value) acc[key] = value;
    return acc;
  }, {});
}

/** The GET cms/image-prompts response with every list present. */
export function asConfigTree(res) {
  return {
    pages: res.pages || [],
    sets: res.sets || [],
    prompts: res.prompts || [],
    legacyPages: res.legacyPages || [],
    legacySets: res.legacySets || [],
    images: res.images || [],
    allowedPages: res.allowedPages || [],
  };
}

export const legacyPageEntries = (tree) =>
  tree.legacyPages.map((page) => ({
    pageDocId: page.id,
    pagePath: docIdToPath(page.id),
    data: page,
  }));

const legacySetsForPage = (tree, pageDocId) =>
  tree.legacySets.filter((entry) => entry.pageId === pageDocId);

/**
 * The set names a legacy page contributes: its own legacy set docs, or the
 * one synthetic name its prompt fields imply, or nothing.
 */
export function legacySetNamesForPage(tree, pageDocId, data) {
  const names = legacySetsForPage(tree, pageDocId).map((entry) => entry.id);
  if (names.length > 0) return names;
  return hasLegacyPromptFields(data) ? [getLegacyPromptName(data)] : [];
}

/** Every set name the tree knows, global and legacy, sorted and deduplicated. */
export function promptSetNames(tree) {
  const globalSetNames = tree.sets.map((entry) => entry.id);
  const legacySetNames = legacyPageEntries(tree).flatMap(({ pageDocId, data }) =>
    legacySetNamesForPage(tree, pageDocId, data)
  );
  return [...new Set([...globalSetNames, ...legacySetNames])].sort();
}

export function findLegacySetByNameInTree(tree, setName) {
  const normalizedSetName = normalizeKey(setName);
  if (!normalizedSetName) return null;

  for (const { pageDocId, data } of legacyPageEntries(tree)) {
    const setDoc = legacySetsForPage(tree, pageDocId).find(
      (entry) => entry.id === normalizedSetName
    );
    if (setDoc) {
      return mapLegacySetData(pageDocId, normalizedSetName, setDoc);
    }

    if (
      hasLegacyPromptFields(data) &&
      normalizeKey(data.title || normalizedSetName) === normalizedSetName
    ) {
      return mapLegacySetData(pageDocId, normalizedSetName, data);
    }
  }
  return null;
}

/** A set document by name: the global one, else the legacy one, else null. */
export function findSetInTree(tree, setName) {
  const normalizedSetName = normalizeKey(setName);
  if (!normalizedSetName) return null;
  const setDoc = tree.sets.find((entry) => entry.id === normalizedSetName);
  return setDoc || findLegacySetByNameInTree(tree, normalizedSetName);
}

/** The prompt names under a set: the configured ones, else the legacy one. */
export function promptNamesInTree(tree, setName) {
  const normalizedSetName = normalizeKey(setName);
  if (!normalizedSetName) return [];
  const promptNames = tree.prompts
    .filter((entry) => entry.setName === normalizedSetName)
    .map((entry) => entry.id)
    .sort();
  if (promptNames.length > 0) return promptNames;
  const legacySet = findLegacySetByNameInTree(tree, normalizedSetName);
  return legacySet ? [legacySet.legacyPromptName] : [];
}

export function findLegacyPromptForPageInTree(tree, pagePath) {
  const pageDocId = pathToDocId(pagePath);
  if (!pageDocId) return null;

  const legacySets = legacySetsForPage(tree, pageDocId)
    .map((entry) => mapLegacySetData(pageDocId, entry.id, entry))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (legacySets.length > 0) {
    const [firstSet] = legacySets;
    const firstSetDoc = legacySetsForPage(tree, pageDocId).find(
      (entry) => entry.id === firstSet.name
    );
    return {
      setName: firstSet.name,
      promptName: firstSet.legacyPromptName,
      primaryPrompt: firstSet.primaryPrompt,
      additionalParameters: String(firstSetDoc?.secondaryPrompt || '').trim(),
      legacy: true,
      legacyPagePath: firstSet.legacyPagePath,
    };
  }

  const legacyPage = tree.legacyPages.find((page) => page.id === pageDocId);
  if (!legacyPage || !hasLegacyPromptFields(legacyPage)) return null;

  const syntheticSetName = normalizeKey(legacyPage.title) || LEGACY_DEFAULT_PROMPT_NAME;
  return {
    setName: syntheticSetName,
    promptName: getLegacyPromptName(legacyPage),
    primaryPrompt: String(legacyPage.primaryPrompt || '').trim(),
    additionalParameters: String(legacyPage.secondaryPrompt || '').trim(),
    legacy: true,
    legacyPagePath: pagePath,
  };
}

/** The page's assignment document, or the one its legacy prompt implies, or null. */
export function findAssignmentInTree(tree, pagePath) {
  const pageDocId = pathToDocId(pagePath);
  const pageDoc = tree.pages.find((entry) => entry.id === pageDocId);
  if (pageDoc) return pageDoc;

  const legacyPrompt = findLegacyPromptForPageInTree(tree, pagePath);
  return legacyPrompt
    ? {
        pagePath,
        setName: legacyPrompt.setName,
        promptName: legacyPrompt.promptName,
        legacy: true,
      }
    : null;
}

export function findLegacyPromptDataInTree(tree, setData, setName) {
  const legacySetDoc = legacySetsForPage(tree, setData.legacyPageDocId).find(
    (entry) => entry.id === setName
  );
  if (legacySetDoc) return mapLegacyPromptData(legacySetDoc);

  const legacyPage = tree.legacyPages.find((page) => page.id === setData.legacyPageDocId);
  if (legacyPage && hasLegacyPromptFields(legacyPage)) {
    return mapLegacyPromptData(legacyPage);
  }
  return null;
}

/** One prompt under a set: the configured document, else the legacy one, else null. */
export function findPromptInTree(tree, setName, promptName) {
  const normalizedSetName = normalizeKey(setName);
  const normalizedPromptName = normalizeKey(promptName);
  if (!normalizedSetName || !normalizedPromptName) return null;

  const promptDoc = tree.prompts.find(
    (entry) => entry.setName === normalizedSetName && entry.id === normalizedPromptName
  );
  if (promptDoc) return promptDoc;

  const legacySet = findLegacySetByNameInTree(tree, normalizedSetName);
  if (!legacySet || normalizedPromptName !== legacySet.legacyPromptName) return null;
  return findLegacyPromptDataInTree(tree, legacySet, normalizedSetName);
}

/** The prompt document an assignment names, configured or legacy, or null. */
function assignedPromptData(tree, setData, assignedSetName, assignedPromptName) {
  if (!assignedPromptName) return null;
  const promptData = tree.prompts.find(
    (entry) => entry.setName === assignedSetName && entry.id === assignedPromptName
  );
  if (promptData) return promptData;
  const isLegacyPrompt = setData.legacy && assignedPromptName === setData.legacyPromptName;
  return isLegacyPrompt ? findLegacyPromptDataInTree(tree, setData, assignedSetName) : null;
}

export function resolvePromptFromTree(tree, pagePath) {
  const assignment = findAssignmentInTree(tree, pagePath);
  const assignedSetName = normalizeKey(assignment?.setName);
  const assignedPromptName = normalizeKey(assignment?.promptName);

  const setData = assignedSetName ? findSetInTree(tree, assignedSetName) : null;
  if (!setData) {
    return findLegacyPromptForPageInTree(tree, pagePath);
  }

  const promptData = assignedPromptData(tree, setData, assignedSetName, assignedPromptName);
  return {
    setName: assignedSetName,
    promptName: assignedPromptName,
    primaryPrompt: setData.primaryPrompt || '',
    additionalParameters: promptData?.additionalParameters || '',
    slotTemplates: normalizeSlotTemplates(promptData?.slotTemplates),
    legacy: Boolean(setData.legacy || promptData?.legacy || assignment?.legacy),
  };
}
