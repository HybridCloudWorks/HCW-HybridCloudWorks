/**
 * The Speaking Events Hub's data rules (#573): the ones moved unchanged from
 * the one-scroll page (merge by eventId, sync patches, save payloads) and the
 * ones the tabs add (upcoming or past, what a sync would change, what a
 * publish would write).
 */
import { describe, it, expect } from 'vitest';

import {
  buildSessionizeCreatePayload,
  buildSpeakingEventPayload,
  buildSyncPatch,
  countPublishable,
  formFromManual,
  formFromSessionize,
  formatShortDate,
  httpUrl,
  isUpcoming,
  mapSessionizeEvents,
  mergeEvents,
  safeString,
  sessionizeUrl,
  splitByDate,
  syncDifferences,
  toInputDate,
} from './eventModel';

const NOW = new Date(2026, 8, 14, 9); // 14 Sep 2026, 09:00 local

describe('dates', () => {
  it('formats and converts the date shapes the store holds', () => {
    expect(formatShortDate('2026-09-14')).toBe('09/14/2026');
    expect(formatShortDate('2026-09-14T00:00:00Z')).toBe('09/14/2026');
    expect(formatShortDate(null)).toBe('—');
    expect(toInputDate('2026-01-02T10:00:00Z')).toBe('2026-01-02');
    expect(toInputDate(new Date(2026, 0, 2))).toBe('2026-01-02');
    expect(toInputDate('')).toBe('');
  });

  it('counts today and undated rows as upcoming, and yesterday as past', () => {
    expect(isUpcoming('2026-09-14', NOW)).toBe(true);
    expect(isUpcoming('2026-09-13', NOW)).toBe(false);
    expect(isUpcoming(null, NOW)).toBe(true);
  });

  it('splits rows: upcoming soonest first with undated last, past newest first', () => {
    const rows = [
      { id: 'a', date: '2026-10-01' },
      { id: 'b', date: null },
      { id: 'c', date: '2026-09-20' },
      { id: 'd', date: '2025-01-01' },
      { id: 'e', date: '2026-08-01' },
    ];
    const { upcoming, past } = splitByDate(rows, NOW);
    expect(upcoming.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(past.map((r) => r.id)).toEqual(['e', 'd']);
  });
});

describe('merging Sessionize with stored overrides', () => {
  const sessionize = mapSessionizeEvents({
    events: [
      {
        id: 1,
        name: 'One',
        eventStartDate: '2026-09-01',
        location: 'Chicago',
        website: 'https://1',
      },
      { id: 2, name: 'Two', eventStartDate: '2026-10-01' },
    ],
  });
  const stored = [
    { _docId: 'event-1', eventId: 1, description: 'Enriched' },
    { _docId: 'manual-x', eventName: 'Meetup', date: '2026-07-01' },
  ];

  it('maps the Sessionize JSON to the fields the hub uses', () => {
    expect(sessionize[1]).toEqual({
      id: 2,
      name: 'Two',
      date: '2026-10-01',
      location: null,
      website: null,
    });
    expect(mapSessionizeEvents({})).toEqual([]);
  });

  it('pairs by eventId only and keeps unmatched stored rows as manual entries', () => {
    const { mergedEvents, manualEntries } = mergeEvents(sessionize, stored);
    expect(mergedEvents.map((e) => [e.id, e._storedDoc?._docId ?? null])).toEqual([
      [2, null],
      [1, 'event-1'],
    ]);
    expect(manualEntries.map((fd) => fd._docId)).toEqual(['manual-x']);
  });

  it('says what a sync would create and which records it would fill in', () => {
    const { toCreate, toPatch } = syncDifferences(sessionize, stored);
    expect(toCreate.map((e) => e.id)).toEqual([2]);
    expect(toPatch.map((e) => e.id)).toEqual([1]);

    const complete = [
      {
        _docId: 'event-1',
        eventId: 1,
        sessionizeId: 1,
        eventName: 'One',
        name: 'One',
        date: '2026-09-01',
        location: 'Chicago',
        eventUrl: 'https://1',
      },
    ];
    expect(syncDifferences([sessionize[0]], complete)).toEqual({ toCreate: [], toPatch: [] });
  });

  it('patches only empty fields and creates with everything the API gave', () => {
    expect(buildSyncPatch({ eventId: 1, name: 'Kept' }, sessionize[0], 1)).toEqual({
      sessionizeId: 1,
      eventName: 'One',
      date: '2026-09-01',
      location: 'Chicago',
      eventUrl: 'https://1',
    });
    expect(buildSessionizeCreatePayload(sessionize[1], 2)).toEqual({
      eventId: 2,
      sessionizeId: 2,
      eventName: 'Two',
      name: 'Two',
      date: '2026-10-01',
      location: null,
      eventUrl: null,
      display: true,
    });
  });
});

describe('save payloads and forms', () => {
  const form = {
    description: ' Talk ',
    location: '',
    eventUrl: 'https://e',
    presentationUrl: '',
    eventImageUrl: '',
    display: true,
    _manualName: ' Meetup ',
    _manualDate: '2026-07-01',
  };

  it('sends name and date for a manual entry', () => {
    expect(buildSpeakingEventPayload(null, form)).toEqual({
      description: 'Talk',
      location: null,
      eventUrl: 'https://e',
      presentationUrl: null,
      eventImageUrl: null,
      display: true,
      eventName: 'Meetup',
      name: 'Meetup',
      date: '2026-07-01',
    });
  });

  it('sends Sessionize identity only where the stored doc lacks it', () => {
    const editing = { id: '7', name: 'Seven', date: '2026-09-30', _storedDoc: { eventId: 7 } };
    const payload = buildSpeakingEventPayload(editing, form);
    expect(payload).toMatchObject({ sessionizeId: 7, eventName: 'Seven', date: '2026-09-30' });
    expect(payload).not.toHaveProperty('eventId');
  });

  it('prefills forms from the override, then Sessionize', () => {
    expect(
      formFromSessionize({ website: 'https://site', location: 'Here', _storedDoc: null })
    ).toMatchObject({ eventUrl: 'https://site', location: 'Here', display: true });
    expect(
      formFromManual({ _docId: 'm', name: 'N', date: '2026-07-01', display: false })
    ).toMatchObject({ _manualName: 'N', _manualDate: '2026-07-01', display: false });
  });

  it('renders structured locations and drops unknown objects', () => {
    expect(safeString({ _lat: 1, _long: 2 })).toBe('1, 2');
    expect(safeString({ nope: true })).toBeNull();
  });
});

describe('publishing and links', () => {
  it('counts only display === true as published, as the server sanitizer does', () => {
    expect(countPublishable([{ display: true }, { display: false }, {}])).toEqual({
      published: 1,
      withheld: 2,
    });
  });

  it('links only http(s) URLs', () => {
    expect(httpUrl(' https://slides.example/deck ')).toBe('https://slides.example/deck');
    expect(httpUrl('javascript:alert(1)')).toBeNull();
    expect(httpUrl(undefined)).toBeNull();
  });
});

describe('sessionizeUrl', () => {
  it('keeps a plain speaker ID as the last path segment', () => {
    expect(sessionizeUrl('abc123')).toBe('https://sessionize.com/api/speaker/json/abc123');
  });

  it('encodes reserved characters so the ID cannot add a path or a query', () => {
    expect(sessionizeUrl('a/b?c#d e')).toBe(
      'https://sessionize.com/api/speaker/json/a%2Fb%3Fc%23d%20e'
    );
  });
});
