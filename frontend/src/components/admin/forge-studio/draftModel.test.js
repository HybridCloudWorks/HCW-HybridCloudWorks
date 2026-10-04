/**
 * The Draft tab's pure parts that DraftTab.test does not already pin: the
 * selection an action reads, and how each "use" button lands on the session.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyAssistResult, selectionFor, selectionOf, sourceText } from './draftModel';

const session = () => ({ setText: vi.fn(), setBrief: vi.fn() });

describe('selectionOf / selectionFor / sourceText', () => {
  it('reads a textarea selection, and only for a selection-scoped action', () => {
    const el = { selectionStart: 2, selectionEnd: 5 };
    expect(selectionOf(el)).toEqual({ start: 2, end: 5 });
    expect(selectionOf({ selectionStart: 3, selectionEnd: 3 })).toBeNull();
    expect(selectionOf(null)).toBeNull();
    expect(selectionFor('rewrite', el)).toEqual({ start: 2, end: 5 });
    expect(selectionFor('title', el)).toBeNull();
    expect(selectionFor('unknown', el)).toBeNull();
    expect(sourceText('abcdef', { start: 2, end: 5 })).toBe('cde');
    expect(sourceText('abcdef', null)).toBe('abcdef');
  });
});

describe('applyAssistResult', () => {
  const context = { body: 'abcdef', keywords: 'azure', range: { start: 2, end: 4 } };

  it('writes a title or summary straight onto the text', () => {
    const s = session();
    applyAssistResult(s, { type: 'title', text: 'New' }, context);
    applyAssistResult(s, { type: 'summary', text: 'Sum' }, context);
    expect(s.setText.mock.calls).toEqual([
      ['title', 'New'],
      ['summary', 'Sum'],
    ]);
  });

  it('appends keywords to the brief, and splices, replaces or appends to the body', () => {
    const s = session();
    applyAssistResult(s, { type: 'keywords', text: 'hub' }, context);
    expect(s.setBrief).toHaveBeenCalledWith('seoKeywords', 'azure, hub');
    applyAssistResult(s, { type: 'keywords', text: 'hub' }, { ...context, keywords: '' });
    expect(s.setBrief).toHaveBeenLastCalledWith('seoKeywords', 'hub');

    applyAssistResult(s, { type: 'replace', text: 'XY' }, context);
    applyAssistResult(s, { type: 'replace-all', text: 'all' }, context);
    applyAssistResult(s, { type: 'append', text: 'more' }, { ...context, body: 'abc\n\n' });
    expect(s.setText.mock.calls).toEqual([
      ['body', 'abXYef'],
      ['body', 'all'],
      ['body', 'abc\n\nmore'],
    ]);
  });

  it('changes nothing for a type it does not know', () => {
    const s = session();
    applyAssistResult(s, { type: 'nope', text: 'x' }, context);
    expect(s.setText).not.toHaveBeenCalled();
    expect(s.setBrief).not.toHaveBeenCalled();
  });
});
