import { useState, useCallback } from 'react';
import { postJSON, getJSON, sendJSON } from '@/lib/api';
import {
  asConfigTree,
  buildPromptLibrary,
  findAssignmentInTree,
  findPromptInTree,
  findSetInTree,
  normalizeKey,
  promptNamesInTree,
  promptSetNames,
  resolvePromptFromTree,
} from './imagePromptLibrary';
import {
  augmentationRequest,
  augmentationRows,
  describeError,
  hasPageDocId,
  saveSetBody,
  savePageAssignmentBody,
  savePromptBody,
  synonymRequest,
  synonymRows,
} from './imagePromptRequests';

/**
 * Image prompt configuration hook.
 *
 * Reads come from GET cms/image-prompts — the whole config tree (pages, sets,
 * prompts, plus the two legacy collections) in one response; every read
 * derives from it through the pure functions in hooks/imagePromptLibrary.js
 * (the tree shapes are documented there). Writes go through the
 * manageImagePromptConfig RPC (sets/prompts/assignments) and
 * cms/keyword-config (synonym/augmentation collections), with their bodies
 * built in hooks/imagePromptRequests.js. Split that way for PR #841 so this
 * file is one guarded call per method.
 */

// Pure over the tree; re-exported so existing imports keep working.
export { buildPromptLibrary } from './imagePromptLibrary';

/** One round trip for the whole config tree; every read derives from it. */
async function loadConfigTree() {
  return asConfigTree(await getJSON('cms/image-prompts'));
}

const CONFIG_RPC = 'manageImagePromptConfig';

/** One manageImagePromptConfig write; true once it has landed. */
const configCall = (body) => postJSON(CONFIG_RPC, body).then(() => true);

/** One keyword-config PUT; true once it has landed. */
const putKeyword = ({ url, body }) => sendJSON(url, 'PUT', body).then(() => true);

export function useImagePrompts() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * One call under the loading flag: the result, or `fallback` after the
   * error is recorded as `CODE: message` and logged under `label`.
   */
  const guarded = useCallback(async (label, fallback, work, failure) => {
    setLoading(true);
    setError(null);
    let result = fallback;
    try {
      result = await work();
    } catch (err) {
      setError(describeError(err, failure));
      console.error(`Error ${label}:`, err);
    } finally {
      setLoading(false);
    }
    return result;
  }, []);

  /** `guarded` only when `ready`; an unnamed set or page is the fallback, untouched state. */
  const guardedWhen = useCallback(
    (ready, label, fallback, work) =>
      ready ? guarded(label, fallback, work) : Promise.resolve(fallback),
    [guarded]
  );

  /** One keyword-config call: the result, or `fallback` after the error is recorded. */
  const quiet = useCallback(async (failure, fallback, work) => {
    setError(null);
    let result = fallback;
    try {
      result = await work();
    } catch (err) {
      setError(err.message || failure);
    }
    return result;
  }, []);

  const fetchPromptSets = useCallback(
    () => guarded('fetching prompt sets', [], async () => promptSetNames(await loadConfigTree())),
    [guarded]
  );

  const fetchPromptSet = useCallback(
    (setName) =>
      guardedWhen(Boolean(normalizeKey(setName)), 'fetching prompt set', null, async () =>
        findSetInTree(await loadConfigTree(), setName)
      ),
    [guardedWhen]
  );

  const savePromptSet = useCallback(
    (setName, primaryPromptOrFields) =>
      guarded('saving prompt set', false, () =>
        configCall(saveSetBody(setName, primaryPromptOrFields))
      ),
    [guarded]
  );

  const deletePromptSet = useCallback(
    (setName) =>
      guarded('deleting prompt set', false, () =>
        configCall({ action: 'deleteSet', setName: normalizeKey(setName) })
      ),
    [guarded]
  );

  const fetchPromptNames = useCallback(
    (setName) =>
      guardedWhen(Boolean(normalizeKey(setName)), 'fetching prompt names', [], async () =>
        promptNamesInTree(await loadConfigTree(), setName)
      ),
    [guardedWhen]
  );

  const fetchPrompt = useCallback(
    (setName, promptName) =>
      guardedWhen(
        Boolean(normalizeKey(setName) && normalizeKey(promptName)),
        'fetching prompt',
        null,
        async () => findPromptInTree(await loadConfigTree(), setName, promptName)
      ),
    [guardedWhen]
  );

  const savePrompt = useCallback(
    (setName, promptName, additionalParameters, slotTemplates = {}) =>
      guarded('saving prompt', false, () =>
        configCall(savePromptBody(setName, promptName, additionalParameters, slotTemplates))
      ),
    [guarded]
  );

  const deletePrompt = useCallback(
    (setName, promptName) =>
      guarded('deleting prompt', false, () =>
        configCall({
          action: 'deletePrompt',
          setName: normalizeKey(setName),
          promptName: normalizeKey(promptName),
        })
      ),
    [guarded]
  );

  const fetchPageAssignment = useCallback(
    (pagePath) =>
      guardedWhen(hasPageDocId(pagePath), 'fetching page assignment', null, async () =>
        findAssignmentInTree(await loadConfigTree(), pagePath)
      ),
    [guardedWhen]
  );

  const savePageAssignment = useCallback(
    (pagePath, setName, promptName) =>
      guardedWhen(hasPageDocId(pagePath), 'saving page assignment', false, () =>
        configCall(savePageAssignmentBody(pagePath, setName, promptName))
      ),
    [guardedWhen]
  );

  const resolvePromptForPage = useCallback(
    (pagePath) =>
      // One tree fetch resolves assignment + set + prompt (was four reads).
      guarded('resolving prompt for page', null, async () =>
        resolvePromptFromTree(await loadConfigTree(), pagePath)
      ),
    [guarded]
  );

  /** The whole library — sets with prompts, pages and images — in one read. */
  const fetchPromptLibrary = useCallback(
    () =>
      guarded('loading prompt library', null, async () =>
        buildPromptLibrary(await loadConfigTree())
      ),
    [guarded]
  );

  /** One manageImagePromptConfig action that returns the response or null. */
  const runSetAction = useCallback(
    (action, body, failure) =>
      guarded(`on ${action}`, null, () => postJSON(CONFIG_RPC, { action, ...body }), failure),
    [guarded]
  );

  const duplicatePromptSet = useCallback(
    (setName, newSetName) =>
      runSetAction(
        'duplicateSet',
        { setName: normalizeKey(setName), newSetName: normalizeKey(newSetName) },
        'Failed to duplicate set.'
      ),
    [runSetAction]
  );

  const renamePromptSet = useCallback(
    (setName, newSetName) =>
      runSetAction(
        'renameSet',
        { setName: normalizeKey(setName), newSetName: normalizeKey(newSetName) },
        'Failed to rename set.'
      ),
    [runSetAction]
  );

  const archivePromptSet = useCallback(
    (setName) =>
      runSetAction('archiveSet', { setName: normalizeKey(setName) }, 'Failed to archive set.'),
    [runSetAction]
  );

  const restorePromptSet = useCallback(
    (setName) =>
      runSetAction('restoreSet', { setName: normalizeKey(setName) }, 'Failed to restore set.'),
    [runSetAction]
  );

  /**
   * One hero from a set through POST cms/image-prompts/sample. Throws on
   * failure so the caller can show the server's message; a sample is an
   * explicit, billed action and a silent null would hide the reason.
   */
  const generateSetSample = useCallback(async (body) => {
    setError(null);
    return postJSON('cms/image-prompts/sample', body);
  }, []);

  /** Which set a content document would generate with today, or null. */
  const resolvePromptForContent = useCallback(
    (contentId) =>
      getJSON(`cms/image-prompts/resolve?contentId=${encodeURIComponent(contentId)}`).catch(
        (err) => {
          console.error('Error resolving prompt for content:', err);
          return null;
        }
      ),
    []
  );

  // --------------------------------------------------------------------------
  // Keyword Matrix CRUD (cms/keyword-config)
  // --------------------------------------------------------------------------

  const fetchKeywordSynonyms = useCallback(
    () =>
      quiet('Failed to load synonyms.', [], async () =>
        synonymRows(await getJSON('cms/keyword-config'))
      ),
    [quiet]
  );

  const saveKeywordSynonym = useCallback(
    (id, fields) =>
      quiet('Failed to save synonym group.', false, () => putKeyword(synonymRequest(id, fields))),
    [quiet]
  );

  const deleteKeywordSynonym = useCallback(
    (id) =>
      quiet('Failed to delete synonym group.', false, () =>
        sendJSON(`cms/keyword-config/synonyms/${encodeURIComponent(id)}`, 'DELETE').then(() => true)
      ),
    [quiet]
  );

  const fetchKeywordAugmentations = useCallback(
    () =>
      quiet('Failed to load augmentations.', [], async () =>
        augmentationRows(await getJSON('cms/keyword-config'))
      ),
    [quiet]
  );

  const saveKeywordAugmentation = useCallback(
    (id, fields) =>
      quiet('Failed to save augmentation.', false, () =>
        putKeyword(augmentationRequest(id, fields))
      ),
    [quiet]
  );

  const deleteKeywordAugmentation = useCallback(
    (id) =>
      quiet('Failed to delete augmentation.', false, () =>
        sendJSON(`cms/keyword-config/augmentations/${encodeURIComponent(id)}`, 'DELETE').then(
          () => true
        )
      ),
    [quiet]
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
    fetchPromptLibrary,
    duplicatePromptSet,
    renamePromptSet,
    archivePromptSet,
    restorePromptSet,
    generateSetSample,
    resolvePromptForContent,
    fetchKeywordSynonyms,
    saveKeywordSynonym,
    deleteKeywordSynonym,
    fetchKeywordAugmentations,
    saveKeywordAugmentation,
    deleteKeywordAugmentation,
  };
}
