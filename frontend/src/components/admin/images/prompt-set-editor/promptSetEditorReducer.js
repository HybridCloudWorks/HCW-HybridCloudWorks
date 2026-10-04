/**
 * The image-set editor's state as one reducer (ADR 0033): every form the
 * four tabs edit, the dialog that is open, and the sample run. One handler
 * per action, looked up by name; the rule that matters most is `openSet` —
 * when a different set opens, every form follows it and nothing carries
 * over, while the tab, the new-set name and the sample subject stay.
 */
import { promptFieldsFrom, setFieldsFrom } from './promptSetEditorModel';

export const setIdOf = (set) => set?.id || '';
const firstPromptOf = (set) => set?.prompts?.[0];

/** The forms that belong to one set, fresh. */
function formsFor(set) {
  const first = firstPromptOf(set);
  return {
    setKey: setIdOf(set),
    fields: setFieldsFrom(set),
    promptName: first?.name || '',
    promptFields: promptFieldsFrom(first),
    pageChoice: {},
    imagesWithUsage: null,
    sampleResult: null,
    sampleError: '',
  };
}

export function initialEditorState(set) {
  return {
    tab: 'set',
    newName: '',
    showHistory: false,
    dialog: null,
    sample: { promptName: '', slot: 'hero', title: '', summary: '', provider: '' },
    sampling: false,
    ...formsFor(set),
  };
}

const HANDLERS = {
  openSet: (state, { set }) => ({ ...state, ...formsFor(set) }),
  setTab: (state, { tab }) => ({ ...state, tab }),
  setNewName: (state, { value }) => ({ ...state, newName: value }),
  setField: (state, { key, value }) => ({ ...state, fields: { ...state.fields, [key]: value } }),
  toggleHistory: (state) => ({ ...state, showHistory: !state.showHistory }),
  choosePrompt: (state, { prompt }) => ({
    ...state,
    promptName: prompt?.name || '',
    promptFields: promptFieldsFrom(prompt),
  }),
  setPromptField: (state, { key, value }) => ({
    ...state,
    promptFields: { ...state.promptFields, [key]: value },
  }),
  setSlotTemplate: (state, { key, value }) => ({
    ...state,
    promptFields: {
      ...state.promptFields,
      slotTemplates: { ...state.promptFields.slotTemplates, [key]: value },
    },
  }),
  promptSaved: (state, { name }) => ({ ...state, promptName: name }),
  choosePage: (state, { path, value }) => ({
    ...state,
    pageChoice: { ...state.pageChoice, [path]: value },
  }),
  imagesLoaded: (state, { items }) => ({ ...state, imagesWithUsage: items }),
  setSampleField: (state, { key, value }) => ({
    ...state,
    sample: { ...state.sample, [key]: value },
  }),
  sampleStarted: (state) => ({ ...state, sampling: true, sampleError: '', sampleResult: null }),
  sampleSucceeded: (state, { result }) => ({
    ...state,
    sampling: false,
    sampleResult: result,
    imagesWithUsage: null,
  }),
  sampleFailed: (state, { message }) => ({ ...state, sampling: false, sampleError: message }),
  setDialog: (state, { dialog }) => ({ ...state, dialog }),
};

export function reduceEditor(state, action) {
  const handler = HANDLERS[action.type];
  return handler ? handler(state, action) : state;
}
