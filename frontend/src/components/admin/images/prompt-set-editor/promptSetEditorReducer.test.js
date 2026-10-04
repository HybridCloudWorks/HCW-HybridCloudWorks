/**
 * The image-set editor's reducer (ADR 0033). What these pin: opening a
 * different set resets every form and keeps the tab, the new-set name and
 * the sample subject; choosing a prompt replaces the whole prompt form; a
 * sample run clears the usage listing so it reloads with the new image.
 */
import { describe, it, expect } from 'vitest';
import { EMPTY_SLOT_TEMPLATES } from './promptSetEditorModel';
import { initialEditorState, reduceEditor, setIdOf } from './promptSetEditorReducer';

const AZURE = {
  id: 'Azure Chibi',
  name: 'Azure Chibi',
  primaryPrompt: 'Chibi engineers',
  tags: ['azure'],
  prompts: [{ id: 'Hero', name: 'Hero', slotTemplates: { hero: 'Wide shot' } }],
};
const AWS = { id: 'AWS Lego', name: 'AWS Lego', primaryPrompt: 'Lego builders', prompts: [] };

const run = (state, ...actions) => actions.reduce(reduceEditor, state);

describe('initial state', () => {
  it('starts on the Set tab with the first prompt open', () => {
    const state = initialEditorState(AZURE);
    expect(state.tab).toBe('set');
    expect(state.setKey).toBe('Azure Chibi');
    expect(state.fields.primaryPrompt).toBe('Chibi engineers');
    expect(state.fields.tags).toBe('azure');
    expect(state.promptName).toBe('Hero');
    expect(state.promptFields.slotTemplates.hero).toBe('Wide shot');
    expect(state.sample.slot).toBe('hero');
    expect(setIdOf(null)).toBe('');
    expect(initialEditorState(null).promptName).toBe('');
  });
});

describe('opening another set', () => {
  it('resets every form and the images, keeping tab, new name and sample subject', () => {
    const edited = run(
      initialEditorState(AZURE),
      { type: 'setTab', tab: 'images' },
      { type: 'setNewName', value: 'Draft name' },
      { type: 'setField', key: 'purpose', value: 'Edited' },
      { type: 'choosePage', path: '/azure/blog', value: 'Hero' },
      { type: 'imagesLoaded', items: [{ id: 'img1' }] },
      { type: 'setSampleField', key: 'title', value: 'KEDA' },
      { type: 'sampleSucceeded', result: { imageUrl: '/x.png' } },
      { type: 'sampleFailed', message: 'boom' }
    );
    const next = reduceEditor(edited, { type: 'openSet', set: AWS });
    expect(next.setKey).toBe('AWS Lego');
    expect(next.fields.primaryPrompt).toBe('Lego builders');
    expect(next.fields.purpose).toBe('');
    expect(next.promptName).toBe('');
    expect(next.promptFields.slotTemplates).toEqual(EMPTY_SLOT_TEMPLATES);
    expect(next.pageChoice).toEqual({});
    expect(next.imagesWithUsage).toBeNull();
    expect(next.sampleResult).toBeNull();
    expect(next.sampleError).toBe('');
    expect(next.tab).toBe('images');
    expect(next.newName).toBe('Draft name');
    expect(next.sample.title).toBe('KEDA');
  });
});

describe('prompts', () => {
  it('replaces the whole prompt form on choose, and clears it for a new prompt', () => {
    const state = run(initialEditorState(AZURE), {
      type: 'setSlotTemplate',
      key: 'secondary1',
      value: 'leak',
    });
    expect(state.promptFields.slotTemplates.secondary1).toBe('leak');
    const fresh = reduceEditor(state, { type: 'choosePrompt', prompt: null });
    expect(fresh.promptName).toBe('');
    expect(fresh.promptFields).toEqual({
      name: '',
      additionalParameters: '',
      slotTemplates: EMPTY_SLOT_TEMPLATES,
    });
    const back = run(
      fresh,
      { type: 'setPromptField', key: 'name', value: 'Minimal' },
      { type: 'promptSaved', name: 'Minimal' }
    );
    expect(back.promptName).toBe('Minimal');
    expect(back.promptFields.name).toBe('Minimal');
  });
});

describe('samples and dialogs', () => {
  it('runs start, success and failure, and a success invalidates the usage listing', () => {
    const loaded = reduceEditor(initialEditorState(AZURE), {
      type: 'imagesLoaded',
      items: [{ id: 'img1' }],
    });
    const started = reduceEditor(loaded, { type: 'sampleStarted' });
    expect(started.sampling).toBe(true);
    const done = reduceEditor(started, { type: 'sampleSucceeded', result: { prompt: 'p' } });
    expect(done.sampling).toBe(false);
    expect(done.sampleResult).toEqual({ prompt: 'p' });
    expect(done.imagesWithUsage).toBeNull();
    const failed = reduceEditor(started, { type: 'sampleFailed', message: 'boom' });
    expect(failed).toMatchObject({ sampling: false, sampleError: 'boom', sampleResult: null });
  });

  it('toggles history, opens and closes dialogs, and ignores unknown actions', () => {
    const state = initialEditorState(AZURE);
    expect(reduceEditor(state, { type: 'toggleHistory' }).showHistory).toBe(true);
    const open = reduceEditor(state, { type: 'setDialog', dialog: 'rename' });
    expect(open.dialog).toBe('rename');
    expect(reduceEditor(open, { type: 'setDialog', dialog: null }).dialog).toBeNull();
    expect(reduceEditor(state, { type: 'nothing' })).toBe(state);
  });
});
