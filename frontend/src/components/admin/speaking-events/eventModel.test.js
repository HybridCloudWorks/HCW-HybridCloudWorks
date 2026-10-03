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
  filterRows,
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

  it("pairs by eventId, then by name — the widget's two steps — and keeps the rest as manual entries", () => {
    const { mergedEvents, manualEntries } = mergeEvents(sessionize, stored);
    expect(mergedEvents.map((e) => [e.id, e._storedDoc?._docId ?? null])).toEqual([
      [2, null],
      [1, 'event-1'],
    ]);
    expect(manualEntries.map((fd) => fd._docId)).toEqual(['manual-x']);

    // A row created by hand before Sessionize listed the event has no id; the
    // name pairs it, so it is not shown twice (once per source).
    const byName = [{ _docId: 'hand', eventName: 'two', description: 'x' }];
    const merged = mergeEvents(sessionize, byName);
    expect(merged.mergedEvents.find((e) => e.id === 2)._storedDoc._docId).toBe('hand');
    expect(merged.manualEntries).toEqual([]);
  });

  it('lists every stored row when Sessionize answered nothing, so an outage hides no entry', () => {
    const { mergedEvents, manualEntries } = mergeEvents([], stored);
    expect(mergedEvents).toEqual([]);
    expect(manualEntries.map((fd) => fd._docId)).toEqual(['manual-x', 'event-1']);
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
    // Sessionize sends a timestamp; the store takes the calendar day.
    expect(
      buildSyncPatch({ eventId: 1 }, { ...sessionize[0], date: '2026-09-01T00:00:00' }, 1).date
    ).toBe('2026-09-01');
    expect(buildSessionizeCreatePayload(sessionize[1], 2)).toEqual({
      eventId: 2,
      sessionizeId: 2,
      eventName: 'Two',
      name: 'Two',
      date: '2026-10-01',
      location: null,
      eventUrl: null,
      display: true,
      status: 'accepted',
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
    status: 'proposed',
    cfpDeadline: '2026-05-01',
    audience: ' Platform engineers ',
    topic: '',
    attendance: '80.9',
    feedback: '',
    sessions: [
      { title: ' Keynote ', abstract: 'A', slidesUrl: 'https://s', videoUrl: 'javascript:x' },
      { title: '', abstract: 'dropped' },
    ],
    evidence: [
      { label: '', url: 'https://p' },
      { label: 'No URL', url: '' },
    ],
    _manualName: ' Meetup ',
    _manualDate: '2026-07-01',
  };

  it("sends name and date for a manual entry, with the hub's fields cleaned", () => {
    expect(buildSpeakingEventPayload(null, form)).toEqual({
      description: 'Talk',
      location: null,
      eventUrl: 'https://e',
      presentationUrl: null,
      eventImageUrl: null,
      display: true,
      status: 'proposed',
      cfpDeadline: '2026-05-01',
      audience: 'Platform engineers',
      topic: null,
      attendance: 80,
      feedback: null,
      sessions: [{ title: 'Keynote', abstract: 'A', slidesUrl: 'https://s', videoUrl: null }],
      evidence: [{ label: 'https://p', url: 'https://p' }],
      eventName: 'Meetup',
      name: 'Meetup',
      date: '2026-07-01',
    });
  });

  it('filters rows by search text and by the shown status', () => {
    const sessionize = mapSessionizeEvents({
      events: [
        { id: 1, name: 'One', eventStartDate: '2026-09-01' },
        { id: 2, name: 'Two', eventStartDate: '2099-10-01' },
      ],
    });
    const rows = mergeEvents(sessionize, [
      { _docId: 'event-1', eventId: 1, topic: 'Landing zones', status: 'delivered' },
      { _docId: 'manual-x', eventName: 'Meetup', date: '2099-07-01', status: 'proposed' },
    ]);
    expect(filterRows(rows, { search: 'landing' }).mergedEvents.map((e) => e.id)).toEqual([1]);
    expect(filterRows(rows, { search: 'landing' }).manualEntries).toEqual([]);
    expect(filterRows(rows, { status: 'proposed' }).manualEntries.map((r) => r._docId)).toEqual([
      'manual-x',
    ]);
    // A Sessionize row with no override shows as accepted, and is found there.
    expect(filterRows(rows, { status: 'accepted' }).mergedEvents.map((e) => e.id)).toEqual([2]);
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
    ).toMatchObject({
      eventUrl: 'https://site',
      location: 'Here',
      display: true,
      status: 'accepted',
    });
    expect(
      formFromManual({ _docId: 'm', name: 'N', date: '2026-07-01', display: false })
    ).toMatchObject({
      _manualName: 'N',
      _manualDate: '2026-07-01',
      display: false,
      status: 'idea',
    });
    expect(
      formFromManual({ _docId: 'm', name: 'N', attendance: 40, sessions: [{ title: 'T' }] })
    ).toMatchObject({ attendance: '40', sessions: [{ title: 'T', slidesUrl: '', videoUrl: '' }] });
  });

  it('renders structured locations and drops unknown objects', () => {
    expect(safeString({ _lat: 1, _long: 2 })).toBe('1, 2');
    expect(safeString({ nope: true })).toBeNull();
  });
});

describe('publishing and links', () => {
  it('counts published rows, tombstones for hidden Sessionize rows, and the withheld rest', () => {
    expect(
      countPublishable([{ display: true }, { display: false }, {}, { display: false, eventId: 5 }])
    ).toEqual({ published: 1, tombstones: 1, withheld: 2 });
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
