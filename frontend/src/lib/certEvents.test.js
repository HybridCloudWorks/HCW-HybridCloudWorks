/**
 * The certEvents documents the Friday scraper writes, shaped for the timeline
 * and merged over the static entries (#461 item 4). The static entries are
 * the fallback, so the merge must be a no-op on an empty list.
 */
import { describe, expect, it } from 'vitest';
import {
  certEventToTimelineEvent,
  isoDayOf,
  mergeTimelineEvents,
  timelineDateFor,
} from './certEvents';

/** A document exactly as timers/skills-hub.js `buildCertEvent` writes it. */
const doc = (over = {}) => ({
  id: 'aHR0cHM6Ly9s',
  type: 'retirement',
  certCodes: ['AZ-305'],
  title: 'AZ-305 exam retires June 30, 2026',
  summary: 'The exam retires. Study before then.',
  link: 'https://techcommunity.microsoft.com/skills-hub/az-305',
  pubDate: '2026-05-01T09:00:00.000Z',
  mentionedDates: ['June 30, 2026'],
  createdAt: '2026-05-08T09:00:00.000Z',
  source: 'skills-hub-rss',
  ...over,
});

describe('isoDayOf', () => {
  it('reads ISO timestamps, ISO days and written dates as the calendar day itself', () => {
    expect(isoDayOf('2026-05-01T09:00:00.000Z')).toBe('2026-05-01');
    expect(isoDayOf('2026-05-01')).toBe('2026-05-01');
    expect(isoDayOf('June 30, 2026')).toBe('2026-06-30');
    expect(isoDayOf('September 30, 2026')).toBe('2026-09-30');
  });

  it('returns null for garbage rather than a wrong day', () => {
    expect(isoDayOf('soon')).toBeNull();
    expect(isoDayOf(undefined)).toBeNull();
    expect(isoDayOf(12345)).toBeNull();
  });

  it('rejects a day that does not exist instead of rolling it into the next month', () => {
    // isIsoDate is the gate (#465): 2026-02-30 must not become March 2.
    expect(isoDayOf('2026-02-30')).toBeNull();
    expect(isoDayOf('2026-02-30T09:00:00.000Z')).toBeNull();
    expect(isoDayOf('February 30, 2026')).toBeNull();
    expect(isoDayOf('June 31, 2026')).toBeNull();
    expect(isoDayOf('2026-13-01')).toBeNull();
    expect(isoDayOf('30')).toBeNull();
    expect(isoDayOf('February 28, 2026')).toBe('2026-02-28');
  });
});

describe('timelineDateFor', () => {
  it('places a post on the earliest date it mentions on or after publication', () => {
    expect(timelineDateFor(doc())).toBe('2026-06-30');
    // Earliest wins, whatever order the post mentioned them in.
    expect(
      timelineDateFor(doc({ mentionedDates: ['2026-08-31', 'July 31, 2026', 'May 6, 2026'] }))
    ).toBe('2026-05-06');
  });

  it('ignores dates before publication and falls back to the publication day', () => {
    // A retirement post that recalls a launch date is not an event on that day.
    expect(timelineDateFor(doc({ mentionedDates: ['January 1, 2026'] }))).toBe('2026-05-01');
    expect(timelineDateFor(doc({ mentionedDates: [] }))).toBe('2026-05-01');
    expect(timelineDateFor(doc({ mentionedDates: undefined }))).toBe('2026-05-01');
  });

  it('is null without a publication date', () => {
    expect(timelineDateFor(doc({ pubDate: 'garbage' }))).toBeNull();
    expect(timelineDateFor(doc({ pubDate: '2026-02-30T09:00:00.000Z' }))).toBeNull();
    expect(timelineDateFor(null)).toBeNull();
  });

  it('skips an impossible mentioned day and takes the next real one', () => {
    expect(timelineDateFor(doc({ mentionedDates: ['June 31, 2026', 'July 31, 2026'] }))).toBe(
      '2026-07-31'
    );
  });
});

describe('certEventToTimelineEvent', () => {
  it('maps the writer fields onto the timeline shape and marks the row live', () => {
    expect(certEventToTimelineEvent(doc())).toEqual({
      id: 'aHR0cHM6Ly9s',
      date: '2026-06-30',
      type: 'retirement',
      credentialType: 'certification',
      certCode: 'AZ-305',
      certCodes: ['AZ-305'],
      title: 'AZ-305 exam retires June 30, 2026',
      description: 'The exam retires. Study before then.',
      sourceUrl: 'https://techcommunity.microsoft.com/skills-hub/az-305',
      publishedAt: '2026-05-01',
      live: true,
    });
  });

  it('renders an unknown type as an update instead of dropping the row', () => {
    expect(certEventToTimelineEvent(doc({ type: 'exam_refresh' })).type).toBe('update');
  });

  it('drops a document with no id or no usable date', () => {
    expect(certEventToTimelineEvent(doc({ id: '' }))).toBeNull();
    expect(certEventToTimelineEvent(doc({ pubDate: null, mentionedDates: [] }))).toBeNull();
    expect(certEventToTimelineEvent(undefined)).toBeNull();
  });

  it('tolerates a document with no codes or title', () => {
    const row = certEventToTimelineEvent(doc({ certCodes: [], title: '' }));
    expect(row.certCode).toBeNull();
    expect(row.title).toBe('Certification update');
  });
});

describe('mergeTimelineEvents', () => {
  const statics = [
    { id: 'az-500-retire', date: '2026-08-31', type: 'retirement', title: 'AZ-500 Retires' },
    { id: 'ai-103-beta', date: '2026-04-16', type: 'beta_launch', title: 'AI-103 Beta' },
  ];

  it('returns the static entries unchanged, sorted by day, when there are no live ones', () => {
    expect(mergeTimelineEvents(statics, []).map((e) => e.id)).toEqual([
      'ai-103-beta',
      'az-500-retire',
    ]);
    expect(mergeTimelineEvents(statics, undefined)).toHaveLength(2);
    expect(mergeTimelineEvents(statics, [null])).toHaveLength(2);
  });

  it('replaces a static entry by id and adds the rest', () => {
    const live = [
      { id: 'az-500-retire', date: '2026-09-15', type: 'retirement', title: 'AZ-500 moved' },
      { id: 'live-1', date: '2026-10-01', type: 'update', title: 'New' },
    ];
    const merged = mergeTimelineEvents(statics, live);
    expect(merged.map((e) => e.id)).toEqual(['ai-103-beta', 'az-500-retire', 'live-1']);
    expect(merged.find((e) => e.id === 'az-500-retire').title).toBe('AZ-500 moved');
  });

  it('does not mutate its inputs', () => {
    const copy = statics.map((e) => ({ ...e }));
    mergeTimelineEvents(statics, [{ id: 'x', date: '2026-01-01' }]);
    expect(statics).toEqual(copy);
  });
});
