/**
 * "Sync from Sessionize" (#573): creates missing records, fills only empty
 * fields, runs once on a double click, and re-reads the store afterwards —
 * including after a sync that failed part-way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import useSessionizeSync, { runSync } from './useSessionizeSync';

const postJSON = vi.fn();
vi.mock('@/lib/api', () => ({ postJSON: (...args) => postJSON(...args) }));

const EVENTS = [
  { id: 1, name: 'One', date: '2026-09-01', location: null, website: null },
  { id: 2, name: 'Two', date: '2026-10-01', location: 'Chicago', website: null },
  { id: 3, name: 'Three', date: '2026-11-01', location: null, website: null },
];
const STORED = [
  { _docId: 'event-1', eventId: 1, sessionizeId: 1, eventName: 'One', name: 'One', date: 'x' },
  { _docId: 'legacy-2', eventId: 2 },
];

const sessionize = { data: EVENTS };
const stored = { data: STORED, refresh: vi.fn() };

beforeEach(() => {
  postJSON.mockReset().mockResolvedValue({ ok: true });
  stored.refresh.mockReset().mockResolvedValue(true);
});

describe('runSync', () => {
  it('skips complete records, patches empty fields and creates missing ones', async () => {
    const counts = await runSync(EVENTS, STORED);
    expect(counts).toEqual({ created: 1, patched: 1, skipped: 1 });
    expect(postJSON.mock.calls).toEqual([
      [
        'upsertSpeakerEvent',
        {
          docId: 'legacy-2',
          merge: true,
          data: {
            sessionizeId: 2,
            eventName: 'Two',
            name: 'Two',
            date: '2026-10-01',
            location: 'Chicago',
          },
        },
      ],
      [
        'upsertSpeakerEvent',
        {
          docId: 'event-3',
          merge: false,
          data: expect.objectContaining({ eventId: 3, name: 'Three', display: true }),
        },
      ],
    ]);
  });
});

describe('useSessionizeSync', () => {
  it('runs one sync on a double click and reports the counts', async () => {
    const { result } = renderHook(() => useSessionizeSync(sessionize, stored));
    let first;
    let second;
    act(() => {
      first = result.current.sync();
      second = result.current.sync();
    });
    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(postJSON).toHaveBeenCalledTimes(2);
    expect(stored.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.result).toEqual({ created: 1, patched: 1, skipped: 1 });
    expect(result.current.syncing).toBe(false);
  });

  it('refuses to sync before Sessionize has loaded', async () => {
    const { result } = renderHook(() => useSessionizeSync({ data: [] }, stored));
    await act(async () => {
      await result.current.sync();
    });
    expect(postJSON).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Sessionize data not loaded yet — hit Refresh first.');
  });

  it('reports a failure and still re-reads the store it may have partly written', async () => {
    postJSON.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error('refused'));
    const { result } = renderHook(() => useSessionizeSync(sessionize, stored));
    await act(async () => {
      await result.current.sync();
    });
    expect(result.current.error).toBe('Sync failed: refused');
    expect(result.current.result).toBeNull();
    expect(stored.refresh).toHaveBeenCalledTimes(1);
  });
});
