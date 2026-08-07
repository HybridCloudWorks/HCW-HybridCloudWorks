import { useState, useCallback } from 'react';
import { postJSON, getJSON, sendJSON } from '@/lib/api';

/**
 * Image prompt configuration hook.
 *
 * Reads come from GET cms/image-prompts — the whole config tree (pages, sets,
 * prompts, plus the two legacy collections) in one response; the legacy-merge
 * logic that used to run over direct Firestore reads runs over that tree
 * unchanged. Writes go through the manageImagePromptConfig RPC (sets/prompts/
 * assignments) and cms/keyword-config (synonym/augmentation collections).
 *
 * Tree shapes (see functions/src/lib/cms/image-prompts.js):
 *   sets[]        id = set name, { primaryPrompt }
 *   prompts[]     id = prompt name, { setName, additionalParameters, slotTemplates }
 *   pages[]       id = page doc id, { pagePath, setName, promptName }
 *   legacyPages[] id = page doc id, may carry { title, primaryPrompt, secondaryPrompt }
 *   legacySets[]  id = set name, { pageId, title?, primaryPrompt, secondaryPrompt }
 */

function pathToDocId(pagePath) {
  return String(pagePath || '')
    .replace(/\//g, '_')
    .replace(/^_/, '');
}

function normalizeKey(value) {
  return String(value || '').trim();
}

const LEGACY_DEFAULT_PROMPT_NAME = 'default';
const SLOT_KEYS = ['hero', 'secondary1', 'secondary2', 'secondary3'];

function docIdToPath(docId) {
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

function normalizeSlotTemplates(slotTemplates = {}) {
  return SLOT_KEYS.reduce((acc, key) => {
    const value = String(slotTemplates?.[key] || '').trim();
    if (value) acc[key] = value;
    return acc;
  }, {});
}

/** One round trip for the whole config tree; every read derives from it. */
async function loadConfigTree() {
  const res = await getJSON('cms/image-prompts');
  return {
    pages: res.pages || [],
    sets: res.sets || [],
    prompts: res.prompts || [],
    legacyPages: res.legacyPages || [],
    legacySets: res.legacySets || [],
  };
}

const legacyPageEntries = (tree) =>
  tree.legacyPages.map((page) => ({
    pageDocId: page.id,
    pagePath: docIdToPath(page.id),
    data: page,
  }));

const legacySetsForPage = (tree, pageDocId) =>
  tree.legacySets.filter((entry) => entry.pageId === pageDocId);

function findLegacySetByNameInTree(tree, setName) {
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

function findLegacyPromptForPageInTree(tree, pagePath) {
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

function findAssignmentInTree(tree, pagePath) {
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

function findLegacyPromptDataInTree(tree, setData, setName) {
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

function resolvePromptFromTree(tree, pagePath) {
  const assignment = findAssignmentInTree(tree, pagePath);
  const assignedSetName = normalizeKey(assignment?.setName);
  const assignedPromptName = normalizeKey(assignment?.promptName);

  if (!assignedSetName) {
    return findLegacyPromptForPageInTree(tree, pagePath);
  }

  const setData =
    tree.sets.find((entry) => entry.id === assignedSetName) ||
    findLegacySetByNameInTree(tree, assignedSetName);
  if (!setData) {
    return findLegacyPromptForPageInTree(tree, pagePath);
  }

  let promptData = null;
  if (assignedPromptName) {
    promptData =
      tree.prompts.find(
        (entry) => entry.setName === assignedSetName && entry.id === assignedPromptName
      ) || null;
    if (!promptData && setData.legacy && assignedPromptName === setData.legacyPromptName) {
      promptData = findLegacyPromptDataInTree(tree, setData, assignedSetName);
    }
  }

  return {
    setName: assignedSetName,
    promptName: assignedPromptName,
    primaryPrompt: setData.primaryPrompt || '',
    additionalParameters: promptData?.additionalParameters || '',
    slotTemplates: normalizeSlotTemplates(promptData?.slotTemplates),
    legacy: Boolean(setData.legacy || promptData?.legacy || assignment?.legacy),
  };
}

export function useImagePrompts() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchPromptSets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tree = await loadConfigTree();
      const globalSetNames = tree.sets.map((entry) => entry.id);
      const legacySetNames = legacyPageEntries(tree).flatMap(({ pageDocId, data }) => {
        const names = legacySetsForPage(tree, pageDocId).map((entry) => entry.id);
        if (names.length > 0) return names;
        return hasLegacyPromptFields(data)
          ? [normalizeKey(data.title) || LEGACY_DEFAULT_PROMPT_NAME]
          : [];
      });

      return [...new Set([...globalSetNames, ...legacySetNames])].sort();
    } catch (err) {
      const errorMsg = err?.message || 'Unknown error';
      const errorCode = err?.code || 'UNKNOWN';
      setError(`${errorCode}: ${errorMsg}`);
      console.error('Error fetching prompt sets:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPromptSet = useCallback(async (setName) => {
    const normalizedSetName = normalizeKey(setName);
    if (!normalizedSetName) return null;

    setLoading(true);
    setError(null);
    try {
      const tree = await loadConfigTree();
      const setDoc = tree.sets.find((entry) => entry.id === normalizedSetName);
      if (setDoc) return setDoc;

      return findLegacySetByNameInTree(tree, normalizedSetName);
    } catch (err) {
      const errorMsg = err?.message || 'Unknown error';
      const errorCode = err?.code || 'UNKNOWN';
      setError(`${errorCode}: ${errorMsg}`);
      console.error('Error fetching prompt set:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const savePromptSet = useCallback(async (setName, primaryPrompt) => {
    const normalizedSetName = normalizeKey(setName);
    setLoading(true);
    setError(null);
    try {
      await postJSON('manageImagePromptConfig', {
        action: 'saveSet',
        setName: normalizedSetName,
        primaryPrompt: String(primaryPrompt || '').trim(),
      });
      return true;
    } catch (err) {
      const errorMsg = err?.message || 'Unknown error';
      const errorCode = err?.code || 'UNKNOWN';
      setError(`${errorCode}: ${errorMsg}`);
      console.error('Error saving prompt set:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const deletePromptSet = useCallback(async (setName) => {
    const normalizedSetName = normalizeKey(setName);
    setLoading(true);
    setError(null);
    try {
      await postJSON('manageImagePromptConfig', {
        action: 'deleteSet',
        setName: normalizedSetName,
      });
      return true;
    } catch (err) {
      const errorMsg = err?.message || 'Unknown error';
      const errorCode = err?.code || 'UNKNOWN';
      setError(`${errorCode}: ${errorMsg}`);
      console.error('Error deleting prompt set:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPromptNames = useCallback(async (setName) => {
    const normalizedSetName = normalizeKey(setName);
    if (!normalizedSetName) return [];

    setLoading(true);
    setError(null);
    try {
      const tree = await loadConfigTree();
      const promptNames = tree.prompts
        .filter((entry) => entry.setName === normalizedSetName)
        .map((entry) => entry.id)
        .sort();
      if (promptNames.length > 0) {
        return promptNames;
      }

      const legacySet = findLegacySetByNameInTree(tree, normalizedSetName);
      return legacySet ? [legacySet.legacyPromptName] : [];
    } catch (err) {
      const errorMsg = err?.message || 'Unknown error';
      const errorCode = err?.code || 'UNKNOWN';
      setError(`${errorCode}: ${errorMsg}`);
      console.error('Error fetching prompt names:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPrompt = useCallback(async (setName, promptName) => {
    const normalizedSetName = normalizeKey(setName);
    const normalizedPromptName = normalizeKey(promptName);
    if (!normalizedSetName || !normalizedPromptName) return null;

    setLoading(true);
    setError(null);
    try {
      const tree = await loadConfigTree();
      const promptDoc = tree.prompts.find(
        (entry) => entry.setName === normalizedSetName && entry.id === normalizedPromptName
      );
      if (promptDoc) return promptDoc;

      const legacySet = findLegacySetByNameInTree(tree, normalizedSetName);
      if (!legacySet) return null;

      if (normalizedPromptName !== legacySet.legacyPromptName) {
        return null;
      }

      const legacySetDoc = legacySetsForPage(tree, legacySet.legacyPageDocId).find(
        (entry) => entry.id === normalizedSetName
      );
      if (legacySetDoc) {
        return mapLegacyPromptData(legacySetDoc);
      }

      const legacyPage = tree.legacyPages.find((page) => page.id === legacySet.legacyPageDocId);
      if (legacyPage && hasLegacyPromptFields(legacyPage)) {
        return mapLegacyPromptData(legacyPage);
      }

      return null;
    } catch (err) {
      const errorMsg = err?.message || 'Unknown error';
      const errorCode = err?.code || 'UNKNOWN';
      setError(`${errorCode}: ${errorMsg}`);
      console.error('Error fetching prompt:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const savePrompt = useCallback(
    async (setName, promptName, additionalParameters, slotTemplates = {}) => {
      const normalizedSetName = normalizeKey(setName);
      const normalizedPromptName = normalizeKey(promptName);
      setLoading(true);
      setError(null);
      try {
        await postJSON('manageImagePromptConfig', {
          action: 'savePrompt',
          setName: normalizedSetName,
          promptName: normalizedPromptName,
          additionalParameters: String(additionalParameters || '').trim(),
          slotTemplates: normalizeSlotTemplates(slotTemplates),
        });
        return true;
      } catch (err) {
        const errorMsg = err?.message || 'Unknown error';
        const errorCode = err?.code || 'UNKNOWN';
        setError(`${errorCode}: ${errorMsg}`);
        console.error('Error saving prompt:', err);
        return false;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const deletePrompt = useCallback(async (setName, promptName) => {
    const normalizedSetName = normalizeKey(setName);
    const normalizedPromptName = normalizeKey(promptName);
    setLoading(true);
    setError(null);
    try {
      await postJSON('manageImagePromptConfig', {
        action: 'deletePrompt',
        setName: normalizedSetName,
        promptName: normalizedPromptName,
      });
      return true;
    } catch (err) {
      const errorMsg = err?.message || 'Unknown error';
      const errorCode = err?.code || 'UNKNOWN';
      setError(`${errorCode}: ${errorMsg}`);
      console.error('Error deleting prompt:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPageAssignment = useCallback(async (pagePath) => {
    const pageDocId = pathToDocId(pagePath);
    if (!pageDocId) return null;

    setLoading(true);
    setError(null);
    try {
      const tree = await loadConfigTree();
      const pageDoc = tree.pages.find((entry) => entry.id === pageDocId);
      if (pageDoc) return pageDoc;

      const legacyPrompt = findLegacyPromptForPageInTree(tree, pagePath);
      if (!legacyPrompt) return null;

      return {
        pagePath,
        setName: legacyPrompt.setName,
        promptName: legacyPrompt.promptName,
        legacy: true,
      };
    } catch (err) {
      const errorMsg = err?.message || 'Unknown error';
      const errorCode = err?.code || 'UNKNOWN';
      setError(`${errorCode}: ${errorMsg}`);
      console.error('Error fetching page assignment:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const savePageAssignment = useCallback(async (pagePath, setName, promptName) => {
    const pageDocId = pathToDocId(pagePath);
    const normalizedSetName = normalizeKey(setName);
    const normalizedPromptName = normalizeKey(promptName);

    if (!pageDocId) return false;

    setLoading(true);
    setError(null);
    try {
      await postJSON('manageImagePromptConfig', {
        action: 'savePageAssignment',
        pagePath,
        setName: normalizedSetName || '',
        promptName: normalizedPromptName || '',
      });
      return true;
    } catch (err) {
      const errorMsg = err?.message || 'Unknown error';
      const errorCode = err?.code || 'UNKNOWN';
      setError(`${errorCode}: ${errorMsg}`);
      console.error('Error saving page assignment:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const resolvePromptForPage = useCallback(async (pagePath) => {
    setLoading(true);
    setError(null);
    try {
      // One tree fetch resolves assignment + set + prompt (was four reads).
      const tree = await loadConfigTree();
      return resolvePromptFromTree(tree, pagePath);
    } catch (err) {
      const errorMsg = err?.message || 'Unknown error';
      const errorCode = err?.code || 'UNKNOWN';
      setError(`${errorCode}: ${errorMsg}`);
      console.error('Error resolving prompt for page:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // --------------------------------------------------------------------------
  // Keyword Matrix CRUD (cms/keyword-config)
  // --------------------------------------------------------------------------
  //   synonyms/{id}      { canonical, patterns:[string] }
  //   augmentations/{id} { label, patterns:[string], directive }
  // --------------------------------------------------------------------------

  const fetchKeywordSynonyms = useCallback(async () => {
    try {
      setError(null);
      const res = await getJSON('cms/keyword-config');
      return (res.synonyms || []).map((d) => ({
        id: d.id,
        canonical: String(d.canonical || '').trim(),
        patterns: Array.isArray(d.patterns) ? d.patterns : [],
      }));
    } catch (err) {
      setError(err.message || 'Failed to load synonyms.');
      return [];
    }
  }, []);

  const saveKeywordSynonym = useCallback(async (id, { canonical, patterns }) => {
    try {
      setError(null);
      const docId = normalizeKey(id) || normalizeKey(canonical);
      if (!docId) throw new Error('Canonical tag required.');
      await sendJSON(`cms/keyword-config/synonyms/${encodeURIComponent(docId)}`, 'PUT', {
        canonical: normalizeKey(canonical),
        patterns: (patterns || []).map((p) => String(p || '').trim()).filter(Boolean),
      });
      return true;
    } catch (err) {
      setError(err.message || 'Failed to save synonym group.');
      return false;
    }
  }, []);

  const deleteKeywordSynonym = useCallback(async (id) => {
    try {
      setError(null);
      await sendJSON(`cms/keyword-config/synonyms/${encodeURIComponent(id)}`, 'DELETE');
      return true;
    } catch (err) {
      setError(err.message || 'Failed to delete synonym group.');
      return false;
    }
  }, []);

  const fetchKeywordAugmentations = useCallback(async () => {
    try {
      setError(null);
      const res = await getJSON('cms/keyword-config');
      return (res.augmentations || []).map((d) => ({
        id: d.id,
        label: String(d.label || '').trim(),
        patterns: Array.isArray(d.patterns) ? d.patterns : [],
        directive: String(d.directive || '').trim(),
      }));
    } catch (err) {
      setError(err.message || 'Failed to load augmentations.');
      return [];
    }
  }, []);

  const saveKeywordAugmentation = useCallback(async (id, { label, patterns, directive }) => {
    try {
      setError(null);
      const docId = normalizeKey(id) || normalizeKey(label);
      if (!docId) throw new Error('Label required.');
      await sendJSON(`cms/keyword-config/augmentations/${encodeURIComponent(docId)}`, 'PUT', {
        label: normalizeKey(label),
        patterns: (patterns || []).map((p) => String(p || '').trim()).filter(Boolean),
        directive: String(directive || '').trim(),
      });
      return true;
    } catch (err) {
      setError(err.message || 'Failed to save augmentation.');
      return false;
    }
  }, []);

  const deleteKeywordAugmentation = useCallback(async (id) => {
    try {
      setError(null);
      await sendJSON(`cms/keyword-config/augmentations/${encodeURIComponent(id)}`, 'DELETE');
      return true;
    } catch (err) {
      setError(err.message || 'Failed to delete augmentation.');
      return false;
    }
  }, []);

  return {
    loading,
    error,
    fetchPromptSets,
    fetchPromptSet,
    savePromptSet,
    deletePromptSet,
    fetchPromptNames,
    fetchPrompt,
    savePrompt,
    deletePrompt,
    fetchPageAssignment,
    savePageAssignment,
    resolvePromptForPage,
    fetchKeywordSynonyms,
    saveKeywordSynonym,
    deleteKeywordSynonym,
    fetchKeywordAugmentations,
    saveKeywordAugmentation,
    deleteKeywordAugmentation,
  };
}
