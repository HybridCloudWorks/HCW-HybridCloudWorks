/**
 * The pure helpers behind the Draft tab's "use this result" buttons, and the
 * session's words for a job. Rendering is covered by ForgeStudioPage.test.
 */
import { describe, expect, it } from 'vitest';
import { ASSIST_ACTIONS, gradeVerdict, outlineToMarkdown, spliceBody } from './DraftTab';
import { describeJob, textOf } from './useForgeSession';

describe('spliceBody', () => {
  it('replaces the selected range, or the whole body with no selection', () => {
    expect(spliceBody('abcdef', { start: 2, end: 4 }, 'XY')).toBe('abXYef');
    expect(spliceBody('abcdef', null, 'new')).toBe('new');
    expect(spliceBody('abcdef', { start: 3, end: 3 }, 'new')).toBe('new');
  });
});

describe('outlineToMarkdown', () => {
  it('turns headings and bullets into markdown sections', () => {
    expect(
      outlineToMarkdown([
        { heading: 'Why', bullets: ['a', 'b'] },
        { heading: 'How', bullets: [] },
      ])
    ).toBe('## Why\n\n- a\n- b\n\n## How');
    expect(outlineToMarkdown([])).toBe('');
  });
});

describe('gradeVerdict', () => {
  it('says whether a grade clears the threshold', () => {
    expect(gradeVerdict(88, 80)).toBe(' · clears it');
    expect(gradeVerdict(70, 80)).toBe(' · below it');
    expect(gradeVerdict(70, undefined)).toBe('');
  });
});

describe('the action row', () => {
  it('names every action the server offers', () => {
    expect(ASSIST_ACTIONS.map((a) => a.id)).toEqual([
      'outline',
      'expand',
      'condense',
      'rewrite',
      'tone',
      'title',
      'summary',
      'metadata',
      'social',
      'claims',
    ]);
    // The four that can work on a selection, and only those.
    expect(ASSIST_ACTIONS.filter((a) => a.scope === 'selection').map((a) => a.id)).toEqual([
      'expand',
      'condense',
      'rewrite',
      'tone',
    ]);
  });
});

describe('describeJob / textOf', () => {
  it('says what each job status means, in plain words', () => {
    expect(describeJob({ status: 'queued' })).toMatch(/Queued/);
    expect(describeJob({ status: 'running' })).toMatch(/few minutes/);
    expect(describeJob({ status: 'succeeded' })).toMatch(/written and graded/);
    expect(describeJob({ status: 'failed', error: 'boom' })).toBe('Failed: boom');
    expect(describeJob({ status: 'timeout' })).toMatch(/unchanged/);
    expect(describeJob(null)).toBe('');
  });

  it('reads a document’s title, summary and body whichever spelling it uses', () => {
    expect(textOf({ title: 'T', summary: 'S', blogDraft: 'B' })).toEqual({
      title: 'T',
      summary: 'S',
      body: 'B',
    });
    expect(textOf({ Title: 'T', Summary: 'S', content: 'C', blogDraft: 'B' })).toEqual({
      title: 'T',
      summary: 'S',
      body: 'C',
    });
    expect(textOf(null)).toEqual({ title: '', summary: '', body: '' });
  });
});
