import { describe, it, expect } from 'vitest';
import {
  MAX_WAIT_FOR_SLOT_MS,
  isValidSendTime,
  isValidTimeZone,
  nextSendSlot,
  resolveSendTime,
  zonedTimeToUtc,
} from './schedule.js';

const CENTRAL = { sendDay: 'tuesday', sendTime: '09:00', timeZone: 'America/Chicago' };

describe('zonedTimeToUtc', () => {
  it('honours daylight saving: 09:00 Central is 14:00 UTC in summer and 15:00 UTC in winter', () => {
    expect(zonedTimeToUtc({ year: 2026, month: 9, day: 15, hour: 9, minute: 0 }, 'America/Chicago').toISOString()).toBe(
      '2026-09-15T14:00:00.000Z'
    );
    expect(zonedTimeToUtc({ year: 2026, month: 12, day: 15, hour: 9, minute: 0 }, 'America/Chicago').toISOString()).toBe(
      '2026-12-15T15:00:00.000Z'
    );
  });

  it('is exact on UTC itself', () => {
    expect(zonedTimeToUtc({ year: 2026, month: 1, day: 6, hour: 9, minute: 30 }, 'UTC').toISOString()).toBe(
      '2026-01-06T09:30:00.000Z'
    );
  });
});

describe('nextSendSlot', () => {
  it('from a Monday morning, is the next day at 09:00 Central', () => {
    // Monday 2026-09-14 07:00 Central = 12:00 UTC.
    expect(nextSendSlot(new Date('2026-09-14T12:00:00Z'), CENTRAL).toISOString()).toBe('2026-09-15T14:00:00.000Z');
  });

  it('on the send day before the time, is today', () => {
    expect(nextSendSlot(new Date('2026-09-15T13:59:00Z'), CENTRAL).toISOString()).toBe('2026-09-15T14:00:00.000Z');
  });

  it('on the send day after the time, is next week', () => {
    expect(nextSendSlot(new Date('2026-09-15T14:00:00Z'), CENTRAL).toISOString()).toBe('2026-09-22T14:00:00.000Z');
  });

  it('uses the local date, not the UTC date, near midnight', () => {
    // Monday 2026-09-14 23:30 Central is already Tuesday 04:30 UTC. The slot
    // is still Tuesday 09:00 Central, not the Tuesday after.
    expect(nextSendSlot(new Date('2026-09-15T04:30:00Z'), CENTRAL).toISOString()).toBe('2026-09-15T14:00:00.000Z');
  });

  it('crosses the November change at the right hour', () => {
    // DST ends Sunday 2026-11-01. Monday 2026-11-02 is CST.
    expect(nextSendSlot(new Date('2026-11-02T12:00:00Z'), CENTRAL).toISOString()).toBe('2026-11-03T15:00:00.000Z');
  });

  it('refuses settings that cannot describe a slot', () => {
    expect(() => nextSendSlot(new Date(), { ...CENTRAL, sendDay: 'someday' })).toThrow(/sendDay/);
    expect(() => nextSendSlot(new Date(), { ...CENTRAL, sendTime: '9am' })).toThrow(/sendTime/);
    expect(() => nextSendSlot(new Date(), { ...CENTRAL, timeZone: 'Mars/Olympus' })).toThrow(/time zone/);
  });
});

describe('resolveSendTime', () => {
  it('schedules an issue approved the day before its slot', () => {
    expect(resolveSendTime(new Date('2026-09-14T12:00:00Z'), CENTRAL)).toEqual({
      sendNow: false,
      scheduledAt: '2026-09-15T14:00:00.000Z',
    });
  });

  it('sends now rather than hold a stale issue for most of a week', () => {
    // Approved Wednesday: the next Tuesday is six days away.
    expect(resolveSendTime(new Date('2026-09-16T15:00:00Z'), CENTRAL)).toEqual({ sendNow: true });
  });

  it('draws the line at three days', () => {
    const slot = new Date('2026-09-15T14:00:00Z').getTime();
    expect(resolveSendTime(new Date(slot - MAX_WAIT_FOR_SLOT_MS), CENTRAL).sendNow).toBe(false);
    expect(resolveSendTime(new Date(slot - MAX_WAIT_FOR_SLOT_MS - 60_000), CENTRAL).sendNow).toBe(true);
  });
});

describe('validators', () => {
  it('accepts HH:MM and real IANA zones only', () => {
    expect(isValidSendTime('09:00')).toBe(true);
    expect(isValidSendTime('23:59')).toBe(true);
    for (const bad of ['9:00', '24:00', '09:60', '', null]) expect(isValidSendTime(bad)).toBe(false);
    expect(isValidTimeZone('America/Chicago')).toBe(true);
    expect(isValidTimeZone('Nowhere/Special')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
