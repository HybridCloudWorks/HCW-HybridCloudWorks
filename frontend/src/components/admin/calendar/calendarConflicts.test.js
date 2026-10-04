/**
 * The collision rule (ADR 0033 §4). What must hold: two timed items in one
 * quarter hour are both flagged, a third in the next quarter hour is not,
 * published and sent items never collide, all-day items never collide, and an
 * unparseable start is ignored rather than thrown on.
 */
import { describe, it, expect } from 'vitest';
import { SLOT_MS, findConflicts, slotOf } from './calendarConflicts';

const at = (h, m = 0) => new Date(2026, 9, 5, h, m).toISOString();
const timed = (id, start, status = 'scheduled') => ({ id, start, allDay: false, status });

describe('slotOf', () => {
  it('floors an instant to its quarter hour and returns null for nonsense', () => {
    expect(slotOf(at(9, 0))).toBe(slotOf(at(9, 14)));
    expect(slotOf(at(9, 15))).toBe(slotOf(at(9, 0)) + 1);
    expect(slotOf('nope')).toBeNull();
    expect(SLOT_MS).toBe(15 * 60 * 1000);
  });
});

describe('findConflicts', () => {
  it('flags every timed item sharing a slot with another, and nothing else', () => {
    const conflicts = findConflicts([
      timed('a', at(9, 0)),
      timed('b', at(9, 10)),
      timed('c', at(9, 20)),
      timed('d', at(9, 0), 'published'),
      timed('e', at(9, 0), 'sent'),
      { id: 'f', start: '2026-10-05T00:00:00.000Z', allDay: true, status: 'accepted' },
      timed('g', 'not a date'),
    ]);
    expect([...conflicts].sort()).toEqual(['a', 'b']);
  });

  it('answers an empty set for nothing, one item, or a missing list', () => {
    expect(findConflicts([]).size).toBe(0);
    expect(findConflicts([timed('a', at(9))]).size).toBe(0);
    expect(findConflicts(undefined).size).toBe(0);
  });
});
