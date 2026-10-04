/**
 * The image-set editor's state and actions as one hook (ADR 0033). The
 * reducer owns the forms; this hook wires it to the open set (a different
 * set resets the forms), loads the set's images with their usage counts
 * when the Images tab opens, and exposes the handful of actions the tabs
 * call, so the tabs themselves stay presentational.
 */
import { useEffect, useMemo, useReducer } from 'react';
import { queryGalleryImages } from '@/lib/imageGallery';
import { findPrompt, groupPages, isLiveImage, setPayloadFrom } from './promptSetEditorModel';
import { initialEditorState, reduceEditor, setIdOf } from './promptSetEditorReducer';

/** The set's images with usage counts, fetched when the Images tab opens. */
function useImagesWithUsage({ wanted, setName, dispatch }) {
  useEffect(() => {
    if (!wanted) return undefined;
    let cancelled = false;
    queryGalleryImages({ set: setName, state: 'all', limit: 200, usage: true })
      .then((listing) => {
        if (!cancelled) dispatch({ type: 'imagesLoaded', items: listing.items });
      })
      .catch(() => {
        // The set's own image list (without usage) stays on screen.
      });
    return () => {
      cancelled = true;
    };
  }, [wanted, setName, dispatch]);
}

function useEditorActions({ state, dispatch, set, isNew, prompts, props }) {
  const { onCreateSet, onSaveSet, onSavePrompt, onGenerateSample } = props;
  return {
    setTab: (tab) => dispatch({ type: 'setTab', tab }),
    setNewName: (value) => dispatch({ type: 'setNewName', value }),
    setField: (key, value) => dispatch({ type: 'setField', key, value }),
    toggleHistory: () => dispatch({ type: 'toggleHistory' }),
    choosePrompt: (name) => dispatch({ type: 'choosePrompt', prompt: findPrompt(prompts, name) }),
    startNewPrompt: () => dispatch({ type: 'choosePrompt', prompt: null }),
    setPromptField: (key, value) => dispatch({ type: 'setPromptField', key, value }),
    setSlotTemplate: (key, value) => dispatch({ type: 'setSlotTemplate', key, value }),
    choosePage: (path, value) => dispatch({ type: 'choosePage', path, value }),
    setSampleField: (key, value) => dispatch({ type: 'setSampleField', key, value }),
    openDialog: (dialog) => dispatch({ type: 'setDialog', dialog }),
    closeDialog: () => dispatch({ type: 'setDialog', dialog: null }),
    saveSet: () => {
      const payload = setPayloadFrom(state.fields);
      if (isNew) onCreateSet(state.newName.trim(), payload);
      else onSaveSet(set.name, payload);
    },
    savePrompt: () => {
      const name = state.promptFields.name.trim();
      onSavePrompt(set.name, name, {
        additionalParameters: state.promptFields.additionalParameters,
        slotTemplates: state.promptFields.slotTemplates,
      });
      dispatch({ type: 'promptSaved', name });
    },
    runSample: async () => {
      dispatch({ type: 'sampleStarted' });
      try {
        const result = await onGenerateSample({
          setName: set.name,
          promptName: state.sample.promptName,
          slot: state.sample.slot,
          title: state.sample.title.trim(),
          summary: state.sample.summary.trim(),
          provider: state.sample.provider,
        });
        dispatch({ type: 'sampleSucceeded', result });
      } catch (err) {
        const message = err?.message || 'The sample could not be generated.';
        dispatch({ type: 'sampleFailed', message });
      }
    },
  };
}

export default function usePromptSetEditor(props) {
  const { set, isNew, allowedPages } = props;
  const [state, dispatch] = useReducer(reduceEditor, set, initialEditorState);
  if (setIdOf(set) !== state.setKey) {
    // A different set opened: every form follows it, nothing carries over.
    dispatch({ type: 'openSet', set });
  }

  const prompts = useMemo(() => set?.prompts || [], [set]);
  const selectedPrompt = useMemo(
    () => findPrompt(prompts, state.promptName),
    [prompts, state.promptName]
  );
  const groups = useMemo(() => groupPages(allowedPages), [allowedPages]);
  const setName = set?.name || '';
  const images = state.imagesWithUsage || set?.images || [];
  const wantsUsage = state.tab === 'images' && !isNew && Boolean(setName);
  useImagesWithUsage({ wanted: wantsUsage, setName, dispatch });

  const actions = useEditorActions({ state, dispatch, set, isNew, prompts, props });
  const canSaveSet = Boolean(state.fields.primaryPrompt.trim()) && (!isNew || state.newName.trim());

  return {
    state,
    prompts,
    selectedPrompt,
    groups,
    images,
    liveImages: images.filter(isLiveImage),
    canSaveSet,
    actions,
  };
}
