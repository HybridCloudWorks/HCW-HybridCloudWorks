import { describe, expect, it } from 'vitest';
import { recordsFrom } from './tableRecords';

describe('recordsFrom', () => {
  it('zips each row with the column names, in row order', () => {
    const records = recordsFrom(
      ['id', 'label'],
      [
        ['a', 'Alpha'],
        ['b', 'Beta'],
      ]
    );
    expect(records).toEqual([
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ]);
  });

  it('freezes the list and every record', () => {
    const records = recordsFrom(['id'], [['a']]);
    expect(Object.isFrozen(records)).toBe(true);
    expect(Object.isFrozen(records[0])).toBe(true);
  });

  it('leaves a missing cell undefined rather than shifting the row', () => {
    expect(recordsFrom(['id', 'label', 'hint'], [['a', 'Alpha']])).toEqual([
      { id: 'a', label: 'Alpha', hint: undefined },
    ]);
    expect(recordsFrom(['id'], [])).toEqual([]);
  });
});
