/**
 * The editor's four dialogs (ADR 0033): rename and duplicate ask for a
 * name; delete set and delete prompt ask for confirmation. Which one is
 * open is the reducer's `dialog`; each closes itself before acting.
 */
import React from 'react';
import ConfirmModal from '@/components/admin/ConfirmModal';
import NameDialog from './NameDialog';
import { deleteSetDescription } from './promptSetEditorModel';

const NAME_DIALOGS = [
  {
    key: 'rename',
    title: (name) => `Rename "${name}"`,
    description:
      'Prompts, page assignments and generated images move to the new name; the old name is kept as an alias.',
    confirmLabel: 'Rename',
    initial: (set) => set?.name,
    handler: 'onRenameSet',
  },
  {
    key: 'duplicate',
    title: (name) => `Duplicate "${name}"`,
    description:
      'A copy of the set and its prompts at version 1. Page assignments and images stay with the original.',
    confirmLabel: 'Duplicate',
    initial: (set) => (set ? `${set.name} copy` : ''),
    handler: 'onDuplicateSet',
  },
];

export default function EditorDialogs({
  set,
  prompts,
  selectedPrompt,
  busy,
  dialog,
  closeDialog,
  startNewPrompt,
  handlers,
}) {
  const name = set?.name;
  return (
    <>
      {NAME_DIALOGS.map((spec) => (
        <NameDialog
          key={spec.key}
          open={dialog === spec.key}
          title={spec.title(name)}
          description={spec.description}
          confirmLabel={spec.confirmLabel}
          initial={spec.initial(set)}
          busy={busy}
          onConfirm={(next) => {
            closeDialog();
            handlers[spec.handler](name, next);
          }}
          onCancel={closeDialog}
        />
      ))}
      <ConfirmModal
        open={dialog === 'delete'}
        title={`Delete "${name}"?`}
        description={deleteSetDescription(set, prompts)}
        confirmLabel="Delete set"
        onConfirm={() => {
          closeDialog();
          handlers.onDeleteSet(name);
        }}
        onCancel={closeDialog}
      />
      <ConfirmModal
        open={dialog === 'deletePrompt'}
        title={`Delete prompt "${selectedPrompt?.name}"?`}
        description="Pages assigned to this prompt fall back to the set's primary prompt."
        confirmLabel="Delete prompt"
        onConfirm={() => {
          closeDialog();
          handlers.onDeletePrompt(name, selectedPrompt.name);
          startNewPrompt();
        }}
        onCancel={closeDialog}
      />
    </>
  );
}
