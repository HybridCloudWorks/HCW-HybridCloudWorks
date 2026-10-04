/**
 * The open image set on Image Prompts (ADR 0033): four tabs.
 *
 *   Set      the shared creative brief — purpose, theme, primary prompt,
 *            style rules, what to avoid, aspect ratio, tags — with version
 *            history, duplicate, rename, archive and delete
 *   Prompts  the named variations, each with its parameters and per-slot
 *            templates (the form resets fully when you switch, so one
 *            prompt's slot text never leaks into another)
 *   Pages    which site pages generate with this set; the dropdown picks a
 *            prompt and nothing saves until Assign is pressed
 *   Images   every image generated from the set, selected / rejected / in
 *            use, and a Generate action that tries the set on a subject
 *            without leaving the page
 *
 * The state lives in `prompt-set-editor/usePromptSetEditor` (one reducer),
 * each tab in its own module beside it; this file is the frame and the
 * public API the page imports.
 */
import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import EditorDialogs from './prompt-set-editor/EditorDialogs';
import EditorHeader from './prompt-set-editor/EditorHeader';
import ImagesTab from './prompt-set-editor/ImagesTab';
import PagesTab from './prompt-set-editor/PagesTab';
import PromptsTab from './prompt-set-editor/PromptsTab';
import SetTab from './prompt-set-editor/SetTab';
import usePromptSetEditor from './prompt-set-editor/usePromptSetEditor';

export {
  ASPECT_RATIOS,
  EMPTY_SLOT_TEMPLATES,
  SLOT_TEMPLATE_FIELDS,
  groupPages,
} from './prompt-set-editor/promptSetEditorModel';

/** The tab strip: a new set has only its Set tab until it is created. */
function EditorTabsList({ isNew, promptCount, pageCount, imageCount }) {
  return (
    <TabsList aria-label="Image set sections">
      <TabsTrigger value="set">Set</TabsTrigger>
      <TabsTrigger value="prompts" disabled={isNew}>
        Prompts ({promptCount})
      </TabsTrigger>
      <TabsTrigger value="pages" disabled={isNew}>
        Pages ({pageCount})
      </TabsTrigger>
      <TabsTrigger value="images" disabled={isNew}>
        Images ({imageCount})
      </TabsTrigger>
    </TabsList>
  );
}

export default function PromptSetEditor(props) {
  const { set, isNew, pageAssignments, busy, onBack } = props;
  const editor = usePromptSetEditor(props);
  const { state, prompts, selectedPrompt, groups, images, liveImages, canSaveSet, actions } =
    editor;
  const pages = set?.pages || [];

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      aria-label={isNew ? 'New image set' : `Image set ${set.name}`}
    >
      <EditorHeader
        set={set}
        isNew={isNew}
        busy={busy}
        onBack={onBack}
        onArchiveSet={props.onArchiveSet}
        onRestoreSet={props.onRestoreSet}
        openDialog={actions.openDialog}
      />

      <Tabs value={state.tab} onValueChange={actions.setTab}>
        <EditorTabsList
          isNew={isNew}
          promptCount={prompts.length}
          pageCount={pages.length}
          imageCount={liveImages.length}
        />

        <TabsContent value="set" className="space-y-4">
          <SetTab
            set={set}
            isNew={isNew}
            busy={busy}
            state={state}
            canSaveSet={canSaveSet}
            actions={actions}
          />
        </TabsContent>

        <TabsContent
          value="prompts"
          className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]"
        >
          <PromptsTab
            prompts={prompts}
            selectedPrompt={selectedPrompt}
            busy={busy}
            state={state}
            actions={actions}
          />
        </TabsContent>

        <TabsContent value="pages" className="space-y-3">
          <PagesTab
            set={set}
            groups={groups}
            prompts={prompts}
            pageAssignments={pageAssignments}
            busy={busy}
            state={state}
            actions={actions}
            onAssignPage={props.onAssignPage}
          />
        </TabsContent>

        <TabsContent value="images" className="space-y-4">
          <ImagesTab
            set={set}
            prompts={prompts}
            images={images}
            busy={busy}
            state={state}
            actions={actions}
            onOpenGallery={props.onOpenGallery}
            onOpenImage={props.onOpenImage}
          />
        </TabsContent>
      </Tabs>

      <EditorDialogs
        set={set}
        prompts={prompts}
        selectedPrompt={selectedPrompt}
        busy={busy}
        dialog={state.dialog}
        closeDialog={actions.closeDialog}
        startNewPrompt={actions.startNewPrompt}
        handlers={props}
      />
    </section>
  );
}
