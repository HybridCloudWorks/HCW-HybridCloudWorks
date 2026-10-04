/** The Evidence tab's filters (ADR 0033 §4): each narrows, none widens, and the years come from the dates. */
import { describe, it, expect } from 'vitest';
import { EMPTY_EVIDENCE_FILTERS, anyFilterSet, filterEvidence, yearsOf } from './evidenceView';

const evidence = [
  { id: 'talk', sourceModule: 'speaking', date: '2026-08-14', programIds: [] },
  { id: 'cert', sourceModule: 'certifications', date: '2025-01-02', programIds: ['mvp'] },
  { id: 'post', sourceModule: 'content', verificationStatus: 'verified', programIds: ['hero'] },
];

describe('filterEvidence', () => {
  it('keeps everything when no filter is set', () => {
    expect(filterEvidence(evidence, EMPTY_EVIDENCE_FILTERS).map((e) => e.id)).toEqual([
      'talk',
      'cert',
      'post',
    ]);
    expect(anyFilterSet(EMPTY_EVIDENCE_FILTERS)).toBe(false);
  });

  it('narrows by source, program relevance, year and verification, all at once', () => {
    const by = (patch) =>
      filterEvidence(evidence, { ...EMPTY_EVIDENCE_FILTERS, ...patch }).map((e) => e.id);
    expect(by({ source: 'speaking' })).toEqual(['talk']);
    // Evidence naming no program counts for every program.
    expect(by({ program: 'mvp' })).toEqual(['talk', 'cert']);
    expect(by({ year: '2025' })).toEqual(['cert']);
    expect(by({ verification: 'unverified' })).toEqual(['talk', 'cert']);
    expect(by({ verification: 'verified', program: 'hero' })).toEqual(['post']);
    expect(anyFilterSet({ ...EMPTY_EVIDENCE_FILTERS, year: '2025' })).toBe(true);
  });
});

describe('yearsOf', () => {
  it('lists the years of dated items once each, newest first', () => {
    expect(yearsOf(evidence)).toEqual(['2026', '2025']);
    expect(yearsOf([])).toEqual([]);
  });
});
