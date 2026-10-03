/**
 * The one override editor the Upcoming, Past and Sources tabs share (#573):
 * which row is open, its form, and the save and delete writes. Held by the
 * page, so a form opened on one tab is still open on the next.
 *
 * Race-safety, as #555 hardened the Newsletter Hub's writes: an in-flight ref
 * on save (a double click sends one upsert) and one per document on delete (a
 * double click sends one delete). The ref is checked before any await, which a
 * disabled button alone cannot promise — React re-renders after the click.
 *
 * CONFIRMATIONS ARE STATE, NOT window.confirm (ADR 0033 §2). A delete asks
 * first through `pendingDelete`, and closing or opening another row while the
 * form has unsaved edits asks through `pendingDiscard`; the page renders both
 * with ConfirmModal. Before this a click on another row's Enrich silently
 * threw away whatever was typed in the open form.
 *
 * After a write the stored overrides are re-read through their generation
 * guard; `stored.refresh` never throws, so the write's own outcome is what
 * this hook reports.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { postJSON } from '@/lib/api';
import {
  EMPTY_FORM,
  buildSpeakingEventPayload,
  formFromManual,
  formFromSessionize,
} from './eventModel';

export const DELETE_CONFIRM = {
  title: 'Delete this stored event?',
  description:
    'A Sessionize event keeps showing from Sessionize without its custom data; a manual entry is gone for good. The public page changes at the next publish.',
};

export const DISCARD_CONFIRM = {
  title: 'Discard unsaved changes?',
  description: 'The edits in the open form have not been saved and will be lost.',
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function useEventEditor(stored) {
  // editingId: null=closed, 'new'=new override or manual entry, else a stored docId
  // editingEvent: the Sessionize event row being enriched (null for manual entries)
  const [editingId, setEditingIdState] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [openedForm, setOpenedForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingOpen, setPendingOpen] = useState(null);
  const editingIdRef = useRef(null);
  const savingRef = useRef(false);
  const deletingRef = useRef(new Set());
  const dirtyRef = useRef(false);

  const dirty = useMemo(
    () => editingId !== null && !same(form, openedForm),
    [editingId, form, openedForm]
  );
  // Mirrored into a ref after render so the open/close handlers read the
  // current answer without the ref being written during render.
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const open = useCallback((id, event, nextForm) => {
    editingIdRef.current = id;
    setEditingIdState(id);
    setEditingEvent(event);
    setForm(nextForm);
    setOpenedForm(nextForm);
  }, []);

  const close = useCallback(() => open(null, null, EMPTY_FORM), [open]);

  /** Open now, or ask first when the open form has unsaved edits. */
  const guardedOpen = (id, event, nextForm) => {
    if (dirtyRef.current) {
      setPendingOpen({ id, event, form: nextForm });
      return;
    }
    open(id, event, nextForm);
  };

  const openEnrich = (sessionizeEvent) =>
    guardedOpen(
      sessionizeEvent._storedDoc ? sessionizeEvent._storedDoc._docId : 'new',
      sessionizeEvent,
      formFromSessionize(sessionizeEvent)
    );
  const openManual = () =>
    guardedOpen('new', null, { ...EMPTY_FORM, _manualName: '', _manualDate: '' });
  const openEditManual = (fd) => guardedOpen(fd._docId, null, formFromManual(fd));

  const requestClose = () => {
    if (dirtyRef.current) setPendingOpen({ id: null, event: null, form: EMPTY_FORM });
    else close();
  };

  const confirmDiscard = () => {
    const next = pendingOpen;
    setPendingOpen(null);
    if (next) open(next.id, next.event, next.form);
  };

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    const docId = editingId === 'new' ? `event-${editingEvent?.id || Date.now()}` : editingId;
    setSaving(docId);
    setError('');
    try {
      const data = buildSpeakingEventPayload(editingEvent, form);
      await postJSON('upsertSpeakerEvent', { docId, data, merge: true });
      await stored.refresh();
      close();
    } catch (err) {
      setError(`Save failed: ${err?.message}`);
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  };

  const remove = async (docId) => {
    if (deletingRef.current.has(docId)) return;
    deletingRef.current.add(docId);
    setDeleting(docId);
    setError('');
    try {
      await postJSON('deleteSpeakerEvent', { docId });
      await stored.refresh();
      // Read the editor as it is now, not as it was when Delete was clicked.
      if (editingIdRef.current === docId) close();
    } catch (err) {
      setError(`Delete failed: ${err?.message}`);
    } finally {
      deletingRef.current.delete(docId);
      setDeleting((current) => (current === docId ? null : current));
    }
  };

  const requestRemove = (docId) => {
    if (deletingRef.current.has(docId)) return;
    setPendingDelete(docId);
  };

  const confirmRemove = () => {
    const docId = pendingDelete;
    setPendingDelete(null);
    return docId ? remove(docId) : Promise.resolve();
  };

  const cancelConfirm = () => {
    setPendingDelete(null);
    setPendingOpen(null);
  };

  return {
    editingId,
    editingEvent,
    form,
    setForm,
    dirty,
    isOpen: editingId !== null,
    openEnrich,
    openManual,
    openEditManual,
    close,
    requestClose,
    save,
    remove,
    requestRemove,
    confirmRemove,
    confirmDiscard,
    cancelConfirm,
    pendingDelete,
    pendingDiscard: pendingOpen !== null,
    saving,
    deleting,
    error,
    clearError: () => setError(''),
  };
}
