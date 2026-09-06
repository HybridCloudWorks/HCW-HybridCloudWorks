/**
 * The emptiness thresholds of the published-pages audit, at their boundaries.
 *
 * Importing the crawler does not start it (it runs only when invoked
 * directly), so the pure decision can be pinned here. The thresholds exist
 * because of two real misreadings on 2026-09-06: a thin page with "Coming
 * Soon" is a decision while a thin page with nothing is missing content, and
 * a full landing page whose podcast widget says "No episodes available yet."
 * is not an empty page.
 */
import { describe, it, expect } from 'vitest';
import { decideEmptiness } from './audit-published-pages.mjs';

const COPY = ['No episodes available yet.'];

describe('decideEmptiness', () => {
  const cases = [
    // mainChars, emptyCopy, verdict, findings count, notes count
    [0, [], 'empty', 1, 0],
    [399, [], 'empty', 1, 0],
    [399, COPY, 'empty', 2, 0],
    [400, [], 'works', 0, 0],
    [400, COPY, 'empty', 1, 0],
    [799, COPY, 'empty', 1, 0],
    [800, COPY, 'works', 0, 1],
    [2179, COPY, 'works', 0, 1],
    [2179, [], 'works', 0, 0],
  ];

  for (const [mainChars, emptyCopy, verdict, findings, notes] of cases) {
    it(`${mainChars} chars ${emptyCopy.length ? 'with' : 'without'} empty-state copy → ${verdict}`, () => {
      const decision = decideEmptiness({ mainChars, emptyCopy });
      expect(decision.verdict).toBe(verdict);
      expect(decision.findings).toHaveLength(findings);
      expect(decision.notes).toHaveLength(notes);
    });
  }

  it('says which copy it saw, on the row for a thin page and as a note on a full one', () => {
    expect(decideEmptiness({ mainChars: 100, emptyCopy: ['Coming Soon'] }).findings).toEqual([
      'thin main region: 100 chars',
      'empty-state copy: Coming Soon',
    ]);
    expect(decideEmptiness({ mainChars: 2000, emptyCopy: COPY }).notes).toEqual([
      'a widget shows empty-state copy: No episodes available yet.',
    ]);
  });
});
