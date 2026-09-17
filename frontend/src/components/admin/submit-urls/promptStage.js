/**
 * The prompt library: what is assigned to this page, and changing it.
 *
 * Module-level over a state bag, as the other stages are (#634). The load is
 * an effect, so it takes an `isCancelled` predicate rather than closing over a
 * flag — the caller still owns the cancellation, this just reads it.
 *
 * Behaviour here is deliberately identical to the inline handlers it replaces.
 */
import { EMPTY_SLOT_TEMPLATES } from './imageStage';

/**
 * The three status lines, in one place.
 *
 * Each was built twice inline — once in the effect and once in the matching
 * change handler — so the wording could drift between the page loading an
 * assignment and the operator making the same one by hand.
 */
export function assignedStatus(setName, promptName) {
  return promptName ? `Assigned: ${setName} / ${promptName}` : `Assigned: ${setName}`;
}

export function noAssignmentStatus(pagePath) {
  return `No Prompt Set assigned to ${pagePath} yet.`;
}

export const NO_SETS_STATUS = 'No saved Prompt Sets found yet.';

export const NO_TARGET_STATUS = 'Select a provider/page target to load saved prompts.';

/**
 * Load the prompts for a chosen set and prompt into the Stage 3 fields.
 *
 * An empty set name clears them: that is how deselecting works, and it must
 * not leave the previous set's prompts behind to be generated from.
 */
export async function applyPromptSelection(state, setName, promptName) {
  if (!setName) {
    state.setSummaryPrompt('');
    state.setDetailsPrompt('');
    state.setSelectedSlotTemplates(EMPTY_SLOT_TEMPLATES);
    return;
  }

  const [setData, promptData] = await Promise.all([
    state.fetchPromptSet(setName),
    promptName ? state.fetchPrompt(setName, promptName) : Promise.resolve(null),
  ]);

  state.setSummaryPrompt(setData?.primaryPrompt || '');
  state.setDetailsPrompt(promptData?.additionalParameters || '');
  state.setSelectedSlotTemplates({
    ...EMPTY_SLOT_TEMPLATES,
    ...(promptData?.slotTemplates || {}),
  });
}

/** Everything the library owns, back to empty, with a status saying why. */
export function clearPromptLibrary(state, status) {
  state.setPromptNames([]);
  state.setSelectedPromptSet('');
  state.setSelectedPromptName('');
  state.setSelectedSlotTemplates(EMPTY_SLOT_TEMPLATES);
  state.setPromptLibraryStatus(status);
}

/** The two reads this page needs, with the assignment normalized. */
async function readAssignment(state) {
  const [allSets, assignment] = await Promise.all([
    state.fetchPromptSets(),
    state.fetchPageAssignment(state.promptLibraryPagePath),
  ]);
  return {
    allSets,
    setName: String(assignment?.setName || '').trim(),
    promptName: String(assignment?.promptName || '').trim(),
  };
}

/** Show an assignment that was found on the server. */
function showAssignment(state, names, setName, promptName) {
  state.setPromptNames(names);
  state.setSelectedPromptSet(setName);
  state.setSelectedPromptName(promptName);
  state.setPromptLibraryStatus(assignedStatus(setName, promptName));
}

/**
 * The read-and-apply body, without the spinner or the error handling.
 *
 * `isCancelled` is checked after every await: the page path changes as the
 * operator picks a provider or content type, so a slower earlier request can
 * still be in flight when a newer one has already answered, and must not write
 * its stale result over the newer one.
 */
async function readAndApplyAssignment(state, isCancelled) {
  const { allSets, setName, promptName } = await readAssignment(state);
  if (isCancelled()) return;

  state.setPromptSets(allSets);

  if (!setName) {
    const status =
      allSets.length > 0 ? noAssignmentStatus(state.promptLibraryPagePath) : NO_SETS_STATUS;
    clearPromptLibrary(state, status);
    return;
  }

  const names = await state.fetchPromptNames(setName);
  if (isCancelled()) return;

  showAssignment(state, names, setName, promptName);
  await applyPromptSelection(state, setName, promptName);
}

/** Read the assignment for the current page and apply it. */
export async function loadPromptLibrary(state, isCancelled) {
  if (!state.promptLibraryPagePath) {
    state.setPromptSets([]);
    clearPromptLibrary(state, NO_TARGET_STATUS);
    state.setPromptLibraryError('');
    return;
  }

  state.setPromptLibraryLoading(true);
  state.setPromptLibraryError('');
  try {
    await readAndApplyAssignment(state, isCancelled);
  } catch (err) {
    // A cancelled load reports nothing: the newer one owns the status now.
    if (isCancelled()) return;
    state.setPromptLibraryError(err?.message || 'Failed to load saved prompts.');
  } finally {
    if (!isCancelled()) {
      state.setPromptLibraryLoading(false);
    }
  }
}

/**
 * The operator picked a different Prompt Set.
 *
 * The assignment is saved immediately rather than on a separate Save press —
 * including when the set is cleared, which persists the empty assignment.
 */
export async function selectPromptSet(state, setName) {
  state.setSelectedPromptSet(setName);
  state.setSelectedPromptName('');
  state.setPromptLibraryError('');

  if (!state.promptLibraryPagePath) return;

  if (!setName) {
    state.setPromptNames([]);
    await applyPromptSelection(state, '', '');
    state.setPromptLibraryStatus(noAssignmentStatus(state.promptLibraryPagePath));
    await state.savePageAssignment(state.promptLibraryPagePath, '', '');
    return;
  }

  state.setPromptLibraryLoading(true);
  try {
    const names = await state.fetchPromptNames(setName);
    state.setPromptNames(names);
    await applyPromptSelection(state, setName, '');
    state.setPromptLibraryStatus(assignedStatus(setName, ''));
    await state.savePageAssignment(state.promptLibraryPagePath, setName, '');
  } catch (err) {
    state.setPromptLibraryError(err?.message || 'Failed to load Prompt Set.');
  } finally {
    state.setPromptLibraryLoading(false);
  }
}

/** The operator picked a different Prompt Name within the chosen set. */
export async function selectPromptName(state, promptName) {
  state.setSelectedPromptName(promptName);
  state.setPromptLibraryError('');

  if (!state.promptLibraryPagePath || !state.selectedPromptSet) return;

  state.setPromptLibraryLoading(true);
  try {
    await applyPromptSelection(state, state.selectedPromptSet, promptName);
    await state.savePageAssignment(
      state.promptLibraryPagePath,
      state.selectedPromptSet,
      promptName
    );
    state.setPromptLibraryStatus(assignedStatus(state.selectedPromptSet, promptName));
  } catch (err) {
    state.setPromptLibraryError(err?.message || 'Failed to load Prompt Name.');
  } finally {
    state.setPromptLibraryLoading(false);
  }
}
