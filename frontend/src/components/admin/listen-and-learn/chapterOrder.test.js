/** The Library's chapter order rules (ADR 0033 §4): archived last, and what a move sends. */
import { describe, it, expect } from 'vitest';
import { moveChapter, orderedChapters } from './chapterOrder';

const chapters = [
  { id: 'c', order: 2, status: 'published' },
  { id: 'z', order: 0, status: 'archived' },
  { id: 'a', order: 0, status: 'draft' },
  { id: 'b', order: 1, status: 'failed' },
];

describe('orderedChapters', () => {
  it('reads the live book first, in order, then the archived chapters', () => {
    expect(orderedChapters(chapters).map((c) => c.id)).toEqual(['a', 'b', 'c', 'z']);
  });
});

describe('moveChapter', () => {
  const ordered = orderedChapters(chapters);

  it('sends the whole live order with the moved chapter in its new place', () => {
    expect(moveChapter(ordered, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveChapter(ordered, 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('sends nothing for a move that changes nothing or names an archived or missing row', () => {
    expect(moveChapter(ordered, 1, 1)).toBeNull();
    expect(moveChapter(ordered, -1, 0)).toBeNull();
    expect(moveChapter(ordered, 0, 3)).toBeNull();
  });
});
