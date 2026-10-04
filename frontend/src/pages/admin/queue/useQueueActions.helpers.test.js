/**
 * The selection arithmetic useQueueActions hands to its setState updaters
 * (PR #841), as pure functions.
 */
import { describe, it, expect } from 'vitest';
import { selectedOnScreen, toggleAllIds, toggleId } from './useQueueActions';

describe('toggleId', () => {
  it('adds an absent id and removes a present one, without mutating the input', () => {
    const prev = new Set(['a']);
    const added = toggleId(prev, 'b');
    expect([...added]).toEqual(['a', 'b']);
    expect([...toggleId(added, 'a')]).toEqual(['b']);
    expect([...prev]).toEqual(['a']);
  });
});

describe('toggleAllIds', () => {
  it('selects every visible id when any is unselected, and clears when all are', () => {
    expect([...toggleAllIds(new Set(), ['a', 'b'])]).toEqual(['a', 'b']);
    expect([...toggleAllIds(new Set(['a']), ['a', 'b'])]).toEqual(['a', 'b']);
    expect([...toggleAllIds(new Set(['a', 'b']), ['a', 'b'])]).toEqual([]);
  });

  it('ignores empty ids and an empty page', () => {
    expect([...toggleAllIds(new Set(), ['a', '', null])]).toEqual(['a']);
    expect([...toggleAllIds(new Set(['a']), [])]).toEqual([]);
    expect([...toggleAllIds(new Set(['a']), undefined)]).toEqual([]);
  });
});

describe('selectedOnScreen', () => {
  it('keeps only the selected ids that are still among the items', () => {
    const items = [{ id: 'a' }, { id: 'c' }];
    expect(selectedOnScreen(new Set(['a', 'b', 'c']), items)).toEqual(['a', 'c']);
    expect(selectedOnScreen(new Set(['b']), items)).toEqual([]);
  });
});
