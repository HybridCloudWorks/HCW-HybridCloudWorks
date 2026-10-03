/**
 * The article open in the Drafts page's editor: the API view (or a new
 * draft's stand-in), the form, and the form as last saved — the baseline
 * "unsaved changes" is measured against.
 */
import { useCallback, useState } from 'react';
import { getJSON } from '@/lib/api';
import { EMPTY_FORM, NEW_DRAFT_ACTIONS, draftRoute, fromDraft, isDirty } from './draftForm';

export const NEW_DRAFT = Object.freeze({ id: null, stage: 'draft', actions: NEW_DRAFT_ACTIONS });

/**
 * @param {(draft: object) => void} onLoaded called with each draft opened from the API
 */
export function useOpenDraft(onLoaded) {
  const [current, setCurrent] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [baseline, setBaseline] = useState(EMPTY_FORM);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState(null);

  /** Show an article in the editor as saved: the form and its baseline agree. */
  const show = useCallback((draft, nextForm = fromDraft(draft)) => {
    setCurrent(draft);
    setForm(nextForm);
    setBaseline(nextForm);
    setOpenError(null);
  }, []);

  const open = useCallback(
    async (id) => {
      setOpening(true);
      try {
        const result = await getJSON(draftRoute(id));
        show(result.draft);
        onLoaded(result.draft);
      } catch (err) {
        setOpenError(err.message || 'Failed to open the draft.');
      } finally {
        setOpening(false);
      }
    },
    [show, onLoaded]
  );

  const startNew = useCallback(() => show(NEW_DRAFT, EMPTY_FORM), [show]);
  const close = useCallback(() => show(null, EMPTY_FORM), [show]);
  const change = useCallback((key, value) => setForm((prev) => ({ ...prev, [key]: value })), []);

  return {
    current,
    form,
    opening,
    openError,
    dirty: Boolean(current) && isDirty(form, baseline),
    isNew: Boolean(current) && !current.id,
    show,
    open,
    startNew,
    close,
    change,
  };
}
