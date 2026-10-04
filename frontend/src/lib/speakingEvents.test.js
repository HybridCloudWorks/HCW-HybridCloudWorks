/**
 * The rules the Speaking Events Hub and the public widget share (ADR 0033,
 * Spotlight slice): the day a stored date names, the one "upcoming"
 * definition, the id-then-name match, the tombstone the widget honours, and
 * which published snapshot wins.
 */
import { describe, it, expect } from 'vitest';
import {
  derivedStatus,
  isTombstone,
  isUpcoming,
  matchStoredRow,
  newerSnapshot,
  normalizeName,
  parseDateValue,
  speakingStatusInfo,
  storedSessionizeId,
  toInputDate,
} from './speakingEvents';

const NOW = new Date(2026, 8, 14, 9); // 14 Sep 2026, 09:00 local

describe('dates', () => {
  it('reads the leading day of a stored value at local noon, so the day never shifts', () => {
    expect(parseDateValue('2026-09-14').getDate()).toBe(14);
    expect(parseDateValue('2026-09-14T00:00:00.000Z').getDate()).toBe(14);
    expect(toInputDate('2026-09-14T23:59:00-06:00')).toBe('2026-09-14');
    expect(toInputDate(null)).toBe('');
  });

  it('calls today and undated rows upcoming, yesterday past — in the hub and the widget alike', () => {
    expect(isUpcoming('2026-09-14', NOW)).toBe(true);
    expect(isUpcoming('2026-09-13', NOW)).toBe(false);
    expect(isUpcoming(undefined, NOW)).toBe(true);
  });
});

describe('matching', () => {
  const stored = [
    { _docId: 'a', eventId: 7, eventName: 'Seven' },
    { _docId: 'b', eventName: 'By Name Only' },
    { _docId: 'c', sessionizeId: '9' },
  ];

  it('reads the Sessionize id from either field as a number', () => {
    expect(storedSessionizeId({ eventId: 7 })).toBe(7);
    expect(storedSessionizeId({ sessionizeId: '9' })).toBe(9);
    expect(storedSessionizeId({ eventId: 'x' })).toBeNull();
    expect(storedSessionizeId({})).toBeNull();
  });

  it('pairs by id first, then by normalised name, else nothing', () => {
    expect(matchStoredRow({ id: 7, name: 'Different' }, stored)._docId).toBe('a');
    expect(matchStoredRow({ id: '9' }, stored)._docId).toBe('c');
    expect(matchStoredRow({ id: 1, name: ' by name only (copy) ' }, stored)._docId).toBe('b');
    expect(matchStoredRow({ id: 2, name: 'Unknown' }, stored)).toBeNull();
    expect(normalizeName('  Talk (copy)')).toBe('talk');
  });

  it('recognises the snapshot tombstone for a hidden Sessionize event', () => {
    expect(isTombstone({ id: 'x', sessionizeId: 5, display: false })).toBe(true);
    expect(isTombstone({ id: 'x', display: false })).toBe(false);
    expect(isTombstone({ id: 'x', sessionizeId: 5, display: true })).toBe(false);
  });
});

describe('status', () => {
  it('derives a status for rows that have none, and keeps a stored one', () => {
    expect(derivedStatus({ status: 'proposed' })).toBe('proposed');
    expect(derivedStatus({ date: '2099-01-01' }, { sessionizeBacked: true, now: NOW })).toBe(
      'accepted'
    );
    expect(derivedStatus({ date: '2020-01-01' }, { sessionizeBacked: true, now: NOW })).toBe(
      'delivered'
    );
    expect(derivedStatus({}, { now: NOW })).toBe('idea');
    expect(speakingStatusInfo('nope').label).toBe('Idea');
    expect(speakingStatusInfo('delivered').tone).toBe('ok');
  });
});

describe('newerSnapshot', () => {
  const older = { generatedAt: '2026-09-01T00:00:00Z', items: [{ id: 'old' }] };
  const newer = { publishedAt: '2026-09-02T00:00:00Z', items: [{ id: 'new' }] };

  it('prefers the newer stamp, falls back to whichever has rows', () => {
    expect(newerSnapshot(older, newer)).toBe(newer);
    expect(newerSnapshot(newer, older)).toBe(newer);
    expect(newerSnapshot({ items: [] }, older)).toBe(older);
    expect(newerSnapshot(older, null)).toBe(older);
    expect(newerSnapshot(null, null)).toBeNull();
  });
});
