/**
 * The Forge Studio Queue's pure rules (owner request 2026-10-06): the form
 * from one entry, the shared form from several, the payload a save sends
 * singly or in bulk, and the words per status.
 */
import { describe, it, expect } from 'vitest';
import {
  EMPTY_QUEUE_FORM,
  QUEUE_FIELDS,
  QUEUE_STATUS,
  describeEntry,
  editable,
  entryHasFields,
  fieldsPayload,
  formFromEntry,
  sharedForm,
  statusOf,
  toggleId,
} from './queueModel';

const entry = (over = {}) => ({
  id: 'e1',
  url: 'https://a.test/1',
  status: 'queued',
  kind: 'guide',
  brief: {
    objective: 'Teach',
    audience: '',
    tone: 'Direct and practical',
    targetLength: 1200,
    requiredTopics: ['a', 'b'],
    sources: ['https://s.test'],
    targetChannel: 'blog',
    seoKeywords: [],
  },
  ...over,
});

describe('formFromEntry and sharedForm', () => {
  it('shows one entry’s fields as the inputs hold them, lists one per line, numbers as text', () => {
    const form = formFromEntry(entry());
    expect(form.kind).toBe('guide');
    expect(form.objective).toBe('Teach');
    expect(form.targetLength).toBe('1200');
    expect(form.requiredTopics).toBe('a\nb');
    expect(form.sources).toBe('https://s.test');
    expect(form.seoKeywords).toBe('');
    expect(Object.keys(form).sort()).toEqual(['kind', ...QUEUE_FIELDS].sort());
  });

  it('shares a field only when every entry agrees, else leaves it blank', () => {
    const a = entry();
    const b = entry({
      id: 'e2',
      brief: { ...a.brief, objective: 'Different', tone: 'Direct and practical' },
    });
    const shared = sharedForm([a, b]);
    expect(shared.tone).toBe('Direct and practical');
    expect(shared.kind).toBe('guide');
    expect(shared.objective).toBe('');
    expect(sharedForm([])).toEqual({ ...EMPTY_QUEUE_FORM });
  });
});

describe('fieldsPayload', () => {
  it('for one entry sends every field, so a cleared one clears; lists travel as arrays', () => {
    const payload = fieldsPayload({
      ...EMPTY_QUEUE_FORM,
      objective: ' O ',
      requiredTopics: 'a, b\nb',
    });
    expect(payload.objective).toBe('O');
    expect(payload.audience).toBe('');
    expect(payload.requiredTopics).toEqual(['a', 'b']);
    expect(payload.kind).toBe('');
    expect(Object.keys(payload).sort()).toEqual(['kind', ...QUEUE_FIELDS].sort());
  });

  it('for several sends only the filled fields, so blank means leave as is', () => {
    const payload = fieldsPayload(
      { ...EMPTY_QUEUE_FORM, tone: 'Opinionated', kind: '' },
      { onlyFilled: true }
    );
    expect(payload).toEqual({ tone: 'Opinionated' });
  });
});

describe('status, summary, selection', () => {
  it('has a badge per status with queued as the fallback, and says what is filled', () => {
    expect(Object.keys(QUEUE_STATUS)).toEqual(['queued', 'forging', 'forged', 'failed']);
    expect(statusOf({ status: 'bogus' })).toBe(QUEUE_STATUS.queued);
    expect(describeEntry(entry())).toBe(
      'guide · → blog · Teach · Direct and practical · 1200 words'
    );
    expect(describeEntry({ brief: {} })).toBe('No fields yet');
    expect(entryHasFields(entry())).toBe(true);
    expect(entryHasFields({ brief: { tone: 'x' } })).toBe(false);
  });

  it('toggles a selection without mutating it, and only non-forging entries are editable', () => {
    const one = new Set(['a']);
    const two = toggleId(one, 'b');
    expect([...two]).toEqual(['a', 'b']);
    expect([...toggleId(two, 'a')]).toEqual(['b']);
    expect(one.size).toBe(1);
    expect(editable({ status: 'forging' })).toBe(false);
    expect(editable({ status: 'failed' })).toBe(true);
  });
});
