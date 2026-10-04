/**
 * Loads the prompt library for the page the builder is drafting for, and
 * again whenever that page changes (a different provider or content type
 * resolves to a different assignment). The work is promptStage.
 * loadPromptLibrary; this is the effect around it, out of SubmitUrlsPage.jsx
 * so the page is a composition root (PR #841).
 *
 * The bag is spread into the dependency list field by field rather than
 * passed whole: the page rebuilds it every render, and an effect keyed on
 * the object would reload the library on every keystroke. The setters are
 * useState setters and never change identity.
 */
import { useEffect } from 'react';
import * as promptStage from './promptStage';

export function usePromptLibraryLoad({
  promptLibraryPagePath,
  fetchPageAssignment,
  fetchPrompt,
  fetchPromptNames,
  fetchPromptSet,
  fetchPromptSets,
  setDetailsPrompt,
  setPromptLibraryError,
  setPromptLibraryLoading,
  setPromptLibraryStatus,
  setPromptNames,
  setPromptSets,
  setSelectedPromptName,
  setSelectedPromptSet,
  setSelectedSlotTemplates,
  setSummaryPrompt,
}) {
  useEffect(() => {
    let cancelled = false;
    promptStage.loadPromptLibrary(
      {
        promptLibraryPagePath,
        fetchPageAssignment,
        fetchPrompt,
        fetchPromptNames,
        fetchPromptSet,
        fetchPromptSets,
        setDetailsPrompt,
        setPromptLibraryError,
        setPromptLibraryLoading,
        setPromptLibraryStatus,
        setPromptNames,
        setPromptSets,
        setSelectedPromptName,
        setSelectedPromptSet,
        setSelectedSlotTemplates,
        setSummaryPrompt,
      },
      () => cancelled
    );

    return () => {
      cancelled = true;
    };
  }, [
    promptLibraryPagePath,
    fetchPageAssignment,
    fetchPrompt,
    fetchPromptNames,
    fetchPromptSet,
    fetchPromptSets,
    setDetailsPrompt,
    setPromptLibraryError,
    setPromptLibraryLoading,
    setPromptLibraryStatus,
    setPromptNames,
    setPromptSets,
    setSelectedPromptName,
    setSelectedPromptSet,
    setSelectedSlotTemplates,
    setSummaryPrompt,
  ]);
}
