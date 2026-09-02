// The gate for TODO.md's handling rule: an identifier may leave TODO.md only
// when CHANGELOG.md carries it. The pure function is tested here; the CLI
// wrapper is a thin git-show + file-read around it.
import { describe, it, expect } from 'vitest';
import {
  extractIds,
  findUnrecordedRemovals,
} from './check-todo-changelog-movement.mjs';

describe('extractIds', () => {
  it('finds T-identifiers wherever they appear', () => {
    expect(extractIds('closes T-519 and `T-726`; see T-519 again')).toEqual(
      new Set(['T-519', 'T-726'])
    );
  });

  it('does not match lookalikes', () => {
    expect(extractIds('CT-100, T-, T100, t-100')).toEqual(new Set());
  });
});

describe('findUnrecordedRemovals', () => {
  const base = 'open: T-518 T-519 T-719';

  it('passes when a removed id is recorded in the changelog', () => {
    expect(
      findUnrecordedRemovals(base, 'open: T-518 T-719', 'closed T-519 (#315)')
    ).toEqual([]);
  });

  it('flags a removed id the changelog does not carry', () => {
    expect(
      findUnrecordedRemovals(base, 'open: T-518 T-719', 'unrelated entry')
    ).toEqual(['T-519']);
  });

  it('passes when the id merely moved or renumbered within TODO.md', () => {
    expect(
      findUnrecordedRemovals(base, 'reordered: T-719 T-519 T-518', '')
    ).toEqual([]);
  });

  it('flags multiple unrecorded removals, sorted', () => {
    expect(
      findUnrecordedRemovals(base, 'open: T-518', 'mentions nothing relevant')
    ).toEqual(['T-519', 'T-719']);
  });

  it('an id recorded by an earlier entry still passes — the changelog only grows', () => {
    expect(
      findUnrecordedRemovals(base, 'open: T-518 T-719', 'old entry: T-519 closed long ago')
    ).toEqual([]);
  });
});
