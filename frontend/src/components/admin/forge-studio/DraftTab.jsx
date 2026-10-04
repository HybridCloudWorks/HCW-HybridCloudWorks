/**
 * Draft — the workspace (ADR 0033 §7 slice 2).
 *
 * With no document yet, it creates one from the brief and runs the forge
 * job against it (or saves the brief as a draft and stops). With a
 * document, it shows the draft as it stands — title, summary, body, grade,
 * status — lets the text be edited and saved under the ETag, and offers the
 * AI actions, each one call to the router recorded on the document's
 * activity so AI-written text stays identifiable. A result is never applied
 * on its own: every one has an explicit "use" button.
 *
 * The pieces live beside this file: draftModel.js (the actions and the pure
 * text helpers), useDraftActions.js (the tab's own state), draftPanels.jsx
 * (before the document, and the toolbar over it), draftEditor.jsx (the
 * fields, the activity, the AI actions) and assistResults.jsx (one renderer
 * per result shape).
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import EmptyState from '@/components/admin/shared/EmptyState';
import { AssistResult } from './assistResults';
import { ActivityList, AssistPanel, DraftFields } from './draftEditor';
import { ConflictBanner, DraftToolbar, GeneratePanel, JobStatus } from './draftPanels';
import { useDraftActions } from './useDraftActions';

export { ASSIST_ACTIONS, gradeVerdict, outlineToMarkdown, spliceBody } from './draftModel';

/** The document on screen: the fields on the left, the AI actions on the right. */
function DraftWorkspace({ session, template, onFinish }) {
  const { doc, text, busy, job, assistResult, conflict, contentId } = session;
  const actions = useDraftActions(session);
  const forging = Boolean(job) && busy === 'generate';
  return (
    <div className="space-y-4">
      <DraftToolbar session={session} template={template} />
      {forging && <JobStatus job={job} running />}
      {conflict && <ConflictBanner onReload={() => session.loadDoc(contentId)} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-3">
          <DraftFields text={text} setText={session.setText} bodyRef={actions.bodyRef} />
          <ActivityList activity={doc.activity} />
        </div>

        <div className="space-y-3">
          <AssistPanel
            busy={busy}
            pendingAction={actions.pendingAction}
            canRun={Boolean(text.body.trim())}
            instruction={actions.instruction}
            tone={actions.tone}
            onInstruction={actions.setInstruction}
            onTone={actions.setTone}
            onRun={actions.runAction}
          />

          {assistResult && !busy && (
            <AssistResult
              assist={assistResult}
              resultText={actions.resultText}
              onEditText={actions.setResultText}
              hasSelection={actions.hasSelection}
              contentId={contentId}
              onClose={session.clearAssist}
              onApply={actions.apply}
            />
          )}

          <Button variant="secondary" className="w-full" onClick={onFinish}>
            Next steps for this piece
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * @param {{
 *   session: ReturnType<typeof import('./useForgeSession').useForgeSession>,
 *   formats: Array<{key: string, label: string}>,
 *   onBrief: () => void, onFinish: () => void,
 * }} props
 */
export default function DraftTab({ session, formats = [], onBrief, onFinish }) {
  const { doc, brief, title, contentId } = session;
  const template = formats.find((f) => f.key === brief.templateKey);
  const nothingYet = !doc && !title.trim() && !contentId;

  if (nothingYet) {
    return (
      <EmptyState
        title="No brief yet"
        description="Start from an idea, a template, existing content or a URL, write the brief, and the draft is created from it here."
        action={<Button onClick={onBrief}>Go to the brief</Button>}
      />
    );
  }
  if (!doc) {
    return <GeneratePanel session={session} template={template} onBrief={onBrief} />;
  }
  return <DraftWorkspace session={session} template={template} onFinish={onFinish} />;
}
