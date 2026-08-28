import { describe, it, expect } from 'vitest';
import {
  SORT_OPTIONS,
  sortQueueItemsBy,
  getForgeGradeForSort,
  forgedTodayFromStats,
} from './itemHelpers';

describe('grade sort (T-607)', () => {
  it('descending puts the best-graded staged items first and ungraded last', () => {
    const items = [
      { id: 'ungraded', Title: 'No grade' },
      { id: 'mid', forgeGrade: { overall: 72 } },
      { id: 'top', forgeGrade: { overall: 91 } },
    ];
    expect(sortQueueItemsBy(items, 'grade', 'desc').map((i) => i.id)).toEqual([
      'top',
      'mid',
      'ungraded',
    ]);
    expect(sortQueueItemsBy(items, 'grade', 'asc').map((i) => i.id)).toEqual([
      'ungraded',
      'mid',
      'top',
    ]);
  });

  it('is registered in SORT_OPTIONS with a label the dropdown renders', () => {
    expect(SORT_OPTIONS.grade.label).toBe('Forge grade');
    expect(getForgeGradeForSort({ forgeGrade: { overall: 0 } })).toBe(0);
    expect(getForgeGradeForSort({})).toBe(-1);
  });
});

describe('forgedTodayFromStats (T-607)', () => {
  const now = new Date('2026-08-28T15:00:00Z');

  it("reads today's bucket and treats a stale or missing bucket as zero", () => {
    expect(forgedTodayFromStats({ today: { date: '2026-08-28', forged: 2 } }, now)).toBe(2);
    expect(forgedTodayFromStats({ today: { date: '2026-08-27', forged: 9 } }, now)).toBe(0);
    expect(forgedTodayFromStats({}, now)).toBe(0);
    expect(forgedTodayFromStats(null, now)).toBe(0);
  });
});
