/**
 * The session's transitions (forgeSessionReducer.js), each pinned where the
 * page depends on its exact effect: what a start resets, what a save
 * rewrites on the document, what a failure keeps.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_BRIEF } from './brief';
import { INITIAL, forgeSessionReducer, initialState, isDirty } from './forgeSessionReducer';

const reduce = (state, ...actions) => actions.reduce(forgeSessionReducer, state);

const DOC = { id: 'c1', Title: 'T', Summary: 'S', content: 'B', _etag: 'e1', activity: [] };

describe('forgeSessionReducer', () => {
  it('starts on the document the URL names, and start/reset clear it', () => {
    expect(initialState('c1').contentId).toBe('c1');
    expect(initialState().contentId).toBe('');
    const started = reduce(initialState('c1'), {
      type: 'start',
      mode: 'existing',
      title: 'Again',
      briefExtras: { sourceContentId: 'old-1' },
    });
    expect(started.contentId).toBe('');
    expect(started.title).toBe('Again');
    expect(started.brief).toEqual({
      ...EMPTY_BRIEF,
      mode: 'existing',
      ideaOrigin: 'repurposing',
      sourceContentId: 'old-1',
    });
    expect(reduce(started, { type: 'reset' })).toEqual(INITIAL);
  });

  it('showDoc takes the id and the text from the document and clears a conflict', () => {
    const state = reduce({ ...INITIAL, conflict: true }, { type: 'showDoc', doc: DOC });
    expect(state.contentId).toBe('c1');
    expect(state.text).toEqual({ title: 'T', summary: 'S', body: 'B' });
    expect(state.conflict).toBe(false);
    expect(isDirty(state)).toBe(false);
    expect(isDirty(reduce(state, { type: 'setText', field: 'body', value: 'B2' }))).toBe(true);
  });

  it('begin clears the messages (the notice only unless kept), failed keeps the job unless told', () => {
    const noisy = { ...INITIAL, error: 'old', notice: 'old', job: { status: 'running' } };
    const begun = reduce(noisy, { type: 'begin', busy: 'save' });
    expect(begun).toMatchObject({ busy: 'save', error: null, notice: null });
    expect(begun.job).toEqual({ status: 'running' });
    expect(reduce(noisy, { type: 'begin', busy: 'assist', keepNotice: true }).notice).toBe('old');
    const failed = reduce(begun, { type: 'failed', error: 'boom' });
    expect(failed).toMatchObject({ error: 'boom', job: { status: 'running' }, conflict: false });
    expect(reduce(begun, { type: 'failed', error: 'moved', conflict: true }).conflict).toBe(true);
    expect(reduce(failed, { type: 'end' }).busy).toBeNull();
  });

  it('saved rewrites the document from the text on screen under the new ETag', () => {
    const edited = reduce(
      INITIAL,
      { type: 'showDoc', doc: DOC },
      { type: 'setText', field: 'body', value: 'B2' },
      { type: 'saved', etag: 'e2', activity: [{ action: 'save' }] }
    );
    expect(edited.doc).toMatchObject({ _etag: 'e2', content: 'B2', blogDraft: 'B2', Title: 'T' });
    expect(edited.doc.activity).toEqual([{ action: 'save' }]);
    expect(edited.notice).toBe('Saved.');
    expect(isDirty(edited)).toBe(false);
    // No ETag back: the old one stands.
    const kept = reduce(edited, { type: 'saved', etag: undefined, activity: undefined });
    expect(kept.doc._etag).toBe('e2');
    expect(kept.doc.activity).toEqual([{ action: 'save' }]);
  });

  it('assisted records the call on the document and holds the result until cleared', () => {
    const state = reduce(
      INITIAL,
      { type: 'showDoc', doc: DOC },
      { type: 'assisted', result: { action: 'title' }, activity: { action: 'forge_assist' } }
    );
    expect(state.assistResult).toEqual({ action: 'title' });
    expect(state.doc.activity).toEqual([{ action: 'forge_assist' }]);
    expect(reduce(state, { type: 'clearAssist' }).assistResult).toBeNull();
    // Without a document there is nothing to record on.
    expect(reduce(INITIAL, { type: 'assisted', result: {}, activity: {} }).doc).toBeNull();
  });

  it('ignores an action it does not know', () => {
    expect(forgeSessionReducer(INITIAL, { type: 'nope' })).toBe(INITIAL);
  });
});
