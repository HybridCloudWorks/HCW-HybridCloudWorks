/**
 * The Image Prompts page's state and handlers, out of ImagePromptsPage.jsx
 * so the page is a composition root with one return (PR #841): the library
 * load, the two derived views of its sets, and every write the editor can
 * ask for, each as a toast-and-reload around one useImagePrompts call.
 */
import { useCallback, useEffect, useState } from 'react';

/** Load the library once, and again on every `refresh()`. */
export function usePromptLibrary(fetchPromptLibrary) {
  const [library, setLibrary] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchPromptLibrary().then((next) => {
      if (cancelled) return;
      if (next) {
        setLibrary(next);
        setLoadError('');
      } else {
        setLoadError('The prompt library could not be read.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPromptLibrary, generation]);

  const refresh = useCallback(() => setGeneration((g) => g + 1), []);
  return { library, loadError, refresh };
}

/** `{ [pagePath]: { setName, promptName } }` over every set's pages. */
export function indexPageAssignments(sets) {
  const map = {};
  for (const set of sets) {
    for (const page of set.pages)
      map[page.pagePath] = { setName: set.name, promptName: page.promptName };
  }
  return map;
}

/** The sets the grid shows: archived ones only when asked, and only those matching the search. */
export function filterSets(sets, query, showArchived) {
  const term = query.trim().toLowerCase();
  return sets.filter((set) => {
    if (!showArchived && set.archivedAt) return false;
    if (!term) return true;
    return [set.name, set.purpose, set.theme, set.primaryPrompt, set.tags.join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(term);
  });
}

/**
 * The editor's handlers. `api` is the useImagePrompts object; `open(name)`
 * shows a set (or the grid for ''); `hookError` is read at call time so a
 * failure toast carries the server's reason.
 */
export function buildSetHandlers({ api, open, openName, navigate, toast, hookError, refresh }) {
  const ok = (title, description) => toast({ title, description });
  const bad = (title, description) => toast({ title, description, variant: 'destructive' });

  /** Run a write; on success say so and reload; on failure show the hook's error. */
  const act = async (work, success, failure) => {
    const result = await work();
    if (result) {
      ok(success.title, success.description);
      refresh();
    } else {
      bad(failure, hookError || 'The server did not accept the change.');
    }
    return result;
  };

  /** A write that, when it succeeds, opens `target` (a set name, or '' for the grid). */
  const actThenOpen = async (work, success, failure, target) => {
    if (await act(work, success, failure)) open(target);
  };

  return {
    onSaveSet: (name, fields) =>
      act(
        () => api.savePromptSet(name, fields),
        { title: 'Set saved', description: `"${name}" updated.` },
        'Set not saved'
      ),
    onCreateSet: (name, fields) =>
      actThenOpen(
        () => api.savePromptSet(name, fields),
        { title: 'Set created', description: `"${name}" is ready for prompts and pages.` },
        'Set not created',
        name
      ),
    onDeleteSet: (name) =>
      actThenOpen(
        () => api.deletePromptSet(name),
        { title: 'Set deleted', description: `"${name}" and its prompts were removed.` },
        'Set not deleted',
        ''
      ),
    onArchiveSet: (name) =>
      act(
        () => api.archivePromptSet(name),
        {
          title: 'Set archived',
          description: `"${name}" is hidden from generators; its pages are unassigned.`,
        },
        'Set not archived'
      ),
    onRestoreSet: (name) =>
      act(
        () => api.restorePromptSet(name),
        { title: 'Set restored', description: `"${name}" can be assigned again.` },
        'Set not restored'
      ),
    onDuplicateSet: (name, newName) =>
      actThenOpen(
        () => api.duplicatePromptSet(name, newName),
        { title: 'Set duplicated', description: `"${newName}" copied from "${name}".` },
        'Set not duplicated',
        newName
      ),
    onRenameSet: (name, newName) =>
      actThenOpen(
        () => api.renamePromptSet(name, newName),
        { title: 'Set renamed', description: `"${name}" is now "${newName}".` },
        'Set not renamed',
        newName
      ),
    onSavePrompt: (setName, promptName, fields) =>
      act(
        () =>
          api.savePrompt(setName, promptName, fields.additionalParameters, fields.slotTemplates),
        { title: 'Prompt saved', description: `"${promptName}" is in "${setName}".` },
        'Prompt not saved'
      ),
    onDeletePrompt: (setName, promptName) =>
      act(
        () => api.deletePrompt(setName, promptName),
        { title: 'Prompt deleted', description: `"${promptName}" removed from "${setName}".` },
        'Prompt not deleted'
      ),
    onAssignPage: (pagePath, setName, promptName) =>
      act(
        () => api.savePageAssignment(pagePath, setName, promptName),
        setName
          ? {
              title: 'Page assigned',
              description: `${pagePath} now generates with "${setName}"${promptName ? ` / ${promptName}` : ''}.`,
            }
          : {
              title: 'Page unassigned',
              description: `${pagePath} falls back to the built-in prompt.`,
            },
        'Assignment not saved'
      ),
    onGenerateSample: async (body) => {
      const result = await api.generateSetSample(body);
      ok('Sample generated', `Filed under "${body.setName}" in the gallery.`);
      refresh();
      return result;
    },
    onOpenGallery: (name) => navigate(`/admin/image-gallery?set=${encodeURIComponent(name)}`),
    onOpenImage: (image) =>
      navigate(
        `/admin/image-gallery?set=${encodeURIComponent(image.promptSet || openName)}&q=${encodeURIComponent(image.id)}`
      ),
  };
}
