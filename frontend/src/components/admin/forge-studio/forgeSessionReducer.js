/**
 * The Forge Studio session's state and every transition over it (ADR 0033
 * §7 slice 2), pure. useForgeSession dispatches these; the server calls
 * live in forgeJobs.js and the operations that sequence both in
 * forgeSessionActions.js, so each of the three can be read and tested on
 * its own.
 */
import { EMPTY_BRIEF, MODE_ORIGINS, bodyOf, titleOf } from './brief';

export const INITIAL = Object.freeze({
  title: '',
  brief: { ...EMPTY_BRIEF },
  contentId: '',
  doc: null,
  text: { title: '', summary: '', body: '' },
  loading: false,
  job: null,
  busy: null, // 'create' | 'generate' | 'assist' | 'save' | 'send' | null
  assistResult: null, // { action, label, result, provider, model }; `assist` is the call
  error: null,
  conflict: false,
  notice: null,
});

/** The session as it begins, on the document `?contentId=` names if any. */
export const initialState = (contentId = '') => ({ ...INITIAL, contentId: contentId || '' });

/** The editable text of a document: the three fields the Studio writes. */
export function textOf(doc) {
  return {
    title: titleOf(doc),
    summary: String(doc?.Summary ?? doc?.summary ?? ''),
    body: bodyOf(doc),
  };
}

/** Has the text on screen moved away from the document as last read? */
export function isDirty(state) {
  if (!state.doc) return false;
  const current = textOf(state.doc);
  const { text } = state;
  return (
    current.title !== text.title || current.summary !== text.summary || current.body !== text.body
  );
}

/** A fresh brief seeded for a start mode; the idea origin follows the mode. */
const seededBrief = (mode, extras) => ({
  ...EMPTY_BRIEF,
  mode,
  ideaOrigin: MODE_ORIGINS[mode] || 'manual',
  ...extras,
});

/** The document after a save: the text on screen, under the new ETag. */
const savedDoc = (doc, text, { etag, activity }) => ({
  ...doc,
  _etag: etag || doc._etag,
  Title: text.title,
  Summary: text.summary,
  content: text.body,
  blogDraft: text.body,
  activity: activity || doc.activity,
});

const withActivity = (doc, entry) =>
  doc ? { ...doc, activity: [...(doc.activity || []), entry] } : doc;

/** One transition per action type; each takes the state and the action. */
const TRANSITIONS = Object.freeze({
  start: (state, { mode, title = '', briefExtras = {} }) => ({
    ...INITIAL,
    title,
    brief: seededBrief(mode, briefExtras),
  }),
  reset: () => ({ ...INITIAL }),
  showDoc: (state, { doc }) => ({
    ...state,
    doc,
    contentId: doc?.id || '',
    text: textOf(doc),
    conflict: false,
  }),
  setTitle: (state, { title }) => ({ ...state, title }),
  setBrief: (state, { field, value }) => ({ ...state, brief: { ...state.brief, [field]: value } }),
  setBriefFields: (state, { fields }) => ({ ...state, brief: { ...state.brief, ...fields } }),
  setText: (state, { field, value }) => ({ ...state, text: { ...state.text, [field]: value } }),
  loadStart: (state) => ({ ...state, loading: true, error: null }),
  loadEnd: (state) => ({ ...state, loading: false }),
  /** An operation begins: it owns `busy`, and the messages clear (the notice too unless kept). */
  begin: (state, { busy, job = state.job, keepNotice = false }) => ({
    ...state,
    busy,
    job,
    error: null,
    notice: keepNotice ? state.notice : null,
  }),
  end: (state) => ({ ...state, busy: null }),
  failed: (state, { error, job = state.job, conflict = state.conflict }) => ({
    ...state,
    error,
    job,
    conflict,
  }),
  notice: (state, { notice }) => ({ ...state, notice }),
  job: (state, { job }) => ({ ...state, job }),
  assisted: (state, { result, activity }) => ({
    ...state,
    assistResult: result,
    doc: withActivity(state.doc, activity),
  }),
  saved: (state, action) => ({
    ...state,
    doc: savedDoc(state.doc, state.text, action),
    notice: 'Saved.',
    conflict: false,
  }),
  clearMessages: (state) => ({ ...state, error: null, notice: null }),
  clearAssist: (state) => ({ ...state, assistResult: null }),
});

export function forgeSessionReducer(state, action) {
  const transition = TRANSITIONS[action.type];
  return transition ? transition(state, action) : state;
}
