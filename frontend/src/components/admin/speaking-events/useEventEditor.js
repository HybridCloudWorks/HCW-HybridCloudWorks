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
 * After a write the stored overrides are re-read through their generation
 * guard; `stored.refresh` never throws, so the write's own outcome is what
 * this hook reports.
 */

import { useCallback, useRef, useState } from 'react';
import { postJSON } from '@/lib/api';
import {
  EMPTY_FORM,
  buildSpeakingEventPayload,
  formFromManual,
  formFromSessionize,
} from './eventModel';

export const DELETE_CONFIRM =
  'Delete this stored override? The event will still show from Sessionize without custom data.';

export default function useEventEditor(stored) {
  // editingId: null=closed, 'new'=new override or manual entry, else a stored docId
  // editingEvent: the Sessionize event row being enriched (null for manual entries)
  const [editingId, setEditingIdState] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');
  const editingIdRef = useRef(null);
  const savingRef = useRef(false);
  const deletingRef = useRef(new Set());

  const open = useCallback((id, event, nextForm) => {
    editingIdRef.current = id;
    setEditingIdState(id);
    setEditingEvent(event);
    setForm(nextForm);
  }, []);

  const close = useCallback(() => open(null, null, EMPTY_FORM), [open]);

  const openEnrich = (sessionizeEvent) =>
    open(
      sessionizeEvent._storedDoc ? sessionizeEvent._storedDoc._docId : 'new',
      sessionizeEvent,
      formFromSessionize(sessionizeEvent)
    );
  const openManual = () => open('new', null, { ...EMPTY_FORM, _manualName: '', _manualDate: '' });
  const openEditManual = (fd) => open(fd._docId, null, formFromManual(fd));

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
    if (!window.confirm(DELETE_CONFIRM)) return;
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

  return {
    editingId,
    editingEvent,
    form,
    setForm,
    isOpen: editingId !== null,
    openEnrich,
    openManual,
    openEditManual,
    close,
    save,
    remove,
    saving,
    deleting,
    error,
    clearError: () => setError(''),
  };
}
