import { useState, useCallback } from 'react';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { postJSON } from '@/lib/api';

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

export function useImagePrompts() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const db = getFirestore();

  const listLegacyPageEntries = useCallback(async () => {
    const pageSnapshot = await getDocs(collection(db, 'image_prompts'));
    return pageSnapshot.docs.map((entry) => ({
      pageDocId: entry.id,
      pagePath: docIdToPath(entry.id),
      data: entry.data() || {},
    }));
  }, [db]);

  const findLegacySetByName = useCallback(
    async (setName) => {
      const normalizedSetName = normalizeKey(setName);
      if (!normalizedSetName) return null;

      const legacyPages = await listLegacyPageEntries();
      const legacyMatches = await Promise.all(
        legacyPages.map(async ({ pageDocId, data }) => {
          const setRef = doc(db, 'image_prompts', pageDocId, 'sets', normalizedSetName);
          const setSnap = await getDoc(setRef);
          if (setSnap.exists()) {
            return mapLegacySetData(pageDocId, normalizedSetName, setSnap.data());
          }

          if (
            hasLegacyPromptFields(data) &&
            normalizeKey(data.title || normalizedSetName) === normalizedSetName
          ) {
            return mapLegacySetData(pageDocId, normalizedSetName, data);
          }

          return null;
        })
      );

      return legacyMatches.find(Boolean) || null;
    },
    [db, listLegacyPageEntries]
  );

  const findLegacyPromptForPage = useCallback(
    async (pagePath) => {
      const pageDocId = pathToDocId(pagePath);
      if (!pageDocId) return null;

      const legacySetsSnapshot = await getDocs(collection(db, 'image_prompts', pageDocId, 'sets'));
      const legacySets = legacySetsSnapshot.docs
        .map((entry) => mapLegacySetData(pageDocId, entry.id, entry.data()))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (legacySets.length > 0) {
        const [firstSet] = legacySets;
        return {
          setName: firstSet.name,
          promptName: firstSet.legacyPromptName,
          primaryPrompt: firstSet.primaryPrompt,
          additionalParameters: String(
            legacySetsSnapshot.docs.find((entry) => entry.id === firstSet.name)?.data()
              ?.secondaryPrompt || ''
          ).trim(),
          legacy: true,
          legacyPagePath: firstSet.legacyPagePath,
        };
      }

      const legacyPageRef = doc(db, 'image_prompts', pageDocId);
      const legacyPageSnap = await getDoc(legacyPageRef);
      if (!legacyPageSnap.exists()) return null;

      const legacyPageData = legacyPageSnap.data() || {};
      if (!hasLegacyPromptFields(legacyPageData)) return null;

      const syntheticSetName = normalizeKey(legacyPageData.title) || LEGACY_DEFAULT_PROMPT_NAME;
      return {
        setName: syntheticSetName,
        promptName: getLegacyPromptName(legacyPageData),
        primaryPrompt: String(legacyPageData.primaryPrompt || '').trim(),
        additionalParameters: String(legacyPageData.secondaryPrompt || '').trim(),
        legacy: true,
        legacyPagePath: pagePath,
      };
    },
    [db]
  );

  const fetchPromptSets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const setsRef = collection(db, 'image_prompt_sets');
      const [querySnapshot, legacyPages] = await Promise.all([
        getDocs(setsRef),
        listLegacyPageEntries(),
      ]);

      const globalSetNames = querySnapshot.docs.map((entry) => entry.id);
      const legacySetNameLists = await Promise.all(
        legacyPages.map(async ({ pageDocId, data }) => {
          const legacySetsRef = collection(db, 'image_prompts', pageDocId, 'sets');
          const legacySetsSnapshot = await getDocs(legacySetsRef);
          const legacyNames = legacySetsSnapshot.docs.map((entry) => entry.id);

          if (legacyNames.length > 0) {
            return legacyNames;
          }

          return hasLegacyPromptFields(data)
            ? [normalizeKey(data.title) || LEGACY_DEFAULT_PROMPT_NAME]
            : [];
        })
      );

      return [...new Set([...globalSetNames, ...legacySetNameLists.flat()])].sort();
    } catch (err) {
      const errorMsg = err?.message || 'Unknown error';
      const errorCode = err?.code || 'UNKNOWN';
      setError(`${errorCode}: ${errorMsg}`);
      console.error('Error fetching prompt sets:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [db, listLegacyPageEntries]);

  const fetchPromptSet = useCallback(
    async (setName) => {
      const normalizedSetName = normalizeKey(setName);
      if (!normalizedSetName) return null;

      setLoading(true);
      setError(null);
      try {
        const setRef = doc(db, 'image_prompt_sets', normalizedSetName);
        const docSnap = await getDoc(setRef);
        if (docSnap.exists()) {
          return docSnap.data();
        }

        const legacySet = await findLegacySetByName(normalizedSetName);
        if (!legacySet) return null;
        return legacySet;
      } catch (err) {
        const errorMsg = err?.message || 'Unknown error';
        const errorCode = err?.code || 'UNKNOWN';
        setError(`${errorCode}: ${errorMsg}`);
        console.error('Error fetching prompt set:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [db, findLegacySetByName]
  );

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

  const fetchPromptNames = useCallback(
    async (setName) => {
      const normalizedSetName = normalizeKey(setName);
      if (!normalizedSetName) return [];

      setLoading(true);
      setError(null);
      try {
        const promptsRef = collection(db, 'image_prompt_sets', normalizedSetName, 'prompts');
        const querySnapshot = await getDocs(promptsRef);
        const promptNames = querySnapshot.docs.map((entry) => entry.id).sort();
        if (promptNames.length > 0) {
          return promptNames;
        }

        const legacySet = await findLegacySetByName(normalizedSetName);
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
    },
    [db, findLegacySetByName]
  );

  const fetchPrompt = useCallback(
    async (setName, promptName) => {
      const normalizedSetName = normalizeKey(setName);
      const normalizedPromptName = normalizeKey(promptName);
      if (!normalizedSetName || !normalizedPromptName) return null;

      setLoading(true);
      setError(null);
      try {
        const promptRef = doc(
          db,
          'image_prompt_sets',
          normalizedSetName,
          'prompts',
          normalizedPromptName
        );
        const docSnap = await getDoc(promptRef);
        if (docSnap.exists()) {
          return docSnap.data();
        }

        const legacySet = await findLegacySetByName(normalizedSetName);
        if (!legacySet) return null;

        if (normalizedPromptName !== legacySet.legacyPromptName) {
          return null;
        }

        const legacyPageRef = doc(db, 'image_prompts', legacySet.legacyPageDocId);
        const legacySetRef = doc(
          db,
          'image_prompts',
          legacySet.legacyPageDocId,
          'sets',
          normalizedSetName
        );
        const [legacyPageSnap, legacySetSnap] = await Promise.all([
          getDoc(legacyPageRef),
          getDoc(legacySetRef),
        ]);

        if (legacySetSnap.exists()) {
          return mapLegacyPromptData(legacySetSnap.data());
        }

        if (legacyPageSnap.exists() && hasLegacyPromptFields(legacyPageSnap.data())) {
          return mapLegacyPromptData(legacyPageSnap.data());
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
    },
    [db, findLegacySetByName]
  );

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

  const fetchPageAssignment = useCallback(
    async (pagePath) => {
      const pageDocId = pathToDocId(pagePath);
      if (!pageDocId) return null;

      setLoading(true);
      setError(null);
      try {
        const pageRef = doc(db, 'image_prompt_pages', pageDocId);
        const docSnap = await getDoc(pageRef);
        if (docSnap.exists()) {
          return docSnap.data();
        }

        const legacyPrompt = await findLegacyPromptForPage(pagePath);
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
    },
    [db, findLegacyPromptForPage]
  );

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

  const resolvePromptForPage = useCallback(
    async (pagePath) => {
      const assignment = await fetchPageAssignment(pagePath);
      const assignedSetName = normalizeKey(assignment?.setName);
      const assignedPromptName = normalizeKey(assignment?.promptName);

      if (!assignedSetName) {
        return findLegacyPromptForPage(pagePath);
      }

      const setData = await fetchPromptSet(assignedSetName);
      if (!setData) {
        return findLegacyPromptForPage(pagePath);
      }

      let promptData = null;
      if (assignedPromptName) {
        promptData = await fetchPrompt(assignedSetName, assignedPromptName);
      }

      return {
        setName: assignedSetName,
        promptName: assignedPromptName,
        primaryPrompt: setData.primaryPrompt || '',
        additionalParameters: promptData?.additionalParameters || '',
        slotTemplates: normalizeSlotTemplates(promptData?.slotTemplates),
        legacy: Boolean(setData.legacy || promptData?.legacy || assignment?.legacy),
      };
    },
    [fetchPageAssignment, fetchPrompt, fetchPromptSet, findLegacyPromptForPage]
  );

  // --------------------------------------------------------------------------
  // Keyword Matrix CRUD
  // --------------------------------------------------------------------------
  //   prompt_keyword_synonyms/{id}      { canonical, patterns:[string] }
  //   prompt_keyword_augmentations/{id} { label, patterns:[string], directive }
  // --------------------------------------------------------------------------

  const fetchKeywordSynonyms = useCallback(async () => {
    try {
      setError(null);
      const snap = await getDocs(collection(db, 'prompt_keyword_synonyms'));
      return snap.docs
        .map((d) => ({
          id: d.id,
          canonical: String(d.data()?.canonical || '').trim(),
          patterns: Array.isArray(d.data()?.patterns) ? d.data().patterns : [],
        }))
        .sort((a, b) => a.canonical.localeCompare(b.canonical));
    } catch (err) {
      setError(err.message || 'Failed to load synonyms.');
      return [];
    }
  }, [db]);

  const saveKeywordSynonym = useCallback(
    async (id, { canonical, patterns }) => {
      try {
        setError(null);
        const docId = normalizeKey(id) || normalizeKey(canonical);
        if (!docId) throw new Error('Canonical tag required.');
        await setDoc(
          doc(db, 'prompt_keyword_synonyms', docId),
          {
            canonical: normalizeKey(canonical),
            patterns: (patterns || []).map((p) => String(p || '').trim()).filter(Boolean),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        return true;
      } catch (err) {
        setError(err.message || 'Failed to save synonym group.');
        return false;
      }
    },
    [db]
  );

  const deleteKeywordSynonym = useCallback(
    async (id) => {
      try {
        setError(null);
        await deleteDoc(doc(db, 'prompt_keyword_synonyms', id));
        return true;
      } catch (err) {
        setError(err.message || 'Failed to delete synonym group.');
        return false;
      }
    },
    [db]
  );

  const fetchKeywordAugmentations = useCallback(async () => {
    try {
      setError(null);
      const snap = await getDocs(collection(db, 'prompt_keyword_augmentations'));
      return snap.docs
        .map((d) => ({
          id: d.id,
          label: String(d.data()?.label || '').trim(),
          patterns: Array.isArray(d.data()?.patterns) ? d.data().patterns : [],
          directive: String(d.data()?.directive || '').trim(),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch (err) {
      setError(err.message || 'Failed to load augmentations.');
      return [];
    }
  }, [db]);

  const saveKeywordAugmentation = useCallback(
    async (id, { label, patterns, directive }) => {
      try {
        setError(null);
        const docId = normalizeKey(id) || normalizeKey(label);
        if (!docId) throw new Error('Label required.');
        await setDoc(
          doc(db, 'prompt_keyword_augmentations', docId),
          {
            label: normalizeKey(label),
            patterns: (patterns || []).map((p) => String(p || '').trim()).filter(Boolean),
            directive: String(directive || '').trim(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        return true;
      } catch (err) {
        setError(err.message || 'Failed to save augmentation.');
        return false;
      }
    },
    [db]
  );

  const deleteKeywordAugmentation = useCallback(
    async (id) => {
      try {
        setError(null);
        await deleteDoc(doc(db, 'prompt_keyword_augmentations', id));
        return true;
      } catch (err) {
        setError(err.message || 'Failed to delete augmentation.');
        return false;
      }
    },
    [db]
  );

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
