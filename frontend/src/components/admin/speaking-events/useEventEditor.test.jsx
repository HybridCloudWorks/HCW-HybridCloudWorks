/**
 * The override editor's writes (#573): a double click saves once and deletes
 * once, a cancelled confirm sends nothing, the stored overrides are re-read
 * after each write, and a failure is reported without closing the form.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import useEventEditor, { DELETE_CONFIRM } from './useEventEditor';

const postJSON = vi.fn();
vi.mock('@/lib/api', () => ({ postJSON: (...args) => postJSON(...args) }));

const deferred = () => {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const stored = { refresh: vi.fn() };
const SESSIONIZE_EVENT = { id: 9, name: 'Nine', date: '2026-10-01', _storedDoc: null };

beforeEach(() => {
  postJSON.mockReset().mockResolvedValue({ ok: true });
  stored.refresh.mockReset().mockResolvedValue(true);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useEventEditor', () => {
  it('opens a new override for a Sessionize event and saves it once on a double click', async () => {
    const pending = deferred();
    postJSON.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useEventEditor(stored));
    act(() => result.current.openEnrich(SESSIONIZE_EVENT));
    expect(result.current.editingId).toBe('new');

    let first;
    let second;
    act(() => {
      first = result.current.save();
      second = result.current.save();
    });
    await act(async () => {
      pending.resolve({ ok: true });
      await Promise.all([first, second]);
    });

    expect(postJSON).toHaveBeenCalledTimes(1);
    expect(postJSON).toHaveBeenCalledWith('upsertSpeakerEvent', {
      docId: 'event-9',
      merge: true,
      data: expect.objectContaining({ eventId: 9, sessionizeId: 9, name: 'Nine' }),
    });
    expect(stored.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.isOpen).toBe(false);
    expect(result.current.saving).toBeNull();
  });

  it('keeps the form open and reports a failed save', async () => {
    postJSON.mockRejectedValueOnce(new Error('refused'));
    const { result } = renderHook(() => useEventEditor(stored));
    act(() => result.current.openManual());
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.error).toBe('Save failed: refused');
    expect(result.current.isOpen).toBe(true);
    expect(stored.refresh).not.toHaveBeenCalled();
    // The guard is released: a second attempt is sent.
    await act(async () => {
      await result.current.save();
    });
    expect(postJSON).toHaveBeenCalledTimes(2);
  });

  it('deletes once on a double click and closes the editor open on that row', async () => {
    const pending = deferred();
    postJSON.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useEventEditor(stored));
    act(() => result.current.openEditManual({ _docId: 'manual-1', name: 'M' }));

    let first;
    let second;
    act(() => {
      first = result.current.remove('manual-1');
      second = result.current.remove('manual-1');
    });
    expect(result.current.deleting).toBe('manual-1');
    await act(async () => {
      pending.resolve({ ok: true });
      await Promise.all([first, second]);
    });

    expect(window.confirm).toHaveBeenCalledWith(DELETE_CONFIRM);
    expect(postJSON).toHaveBeenCalledTimes(1);
    expect(postJSON).toHaveBeenCalledWith('deleteSpeakerEvent', { docId: 'manual-1' });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.deleting).toBeNull();
  });

  it('sends nothing when the delete is not confirmed', async () => {
    window.confirm.mockReturnValue(false);
    const { result } = renderHook(() => useEventEditor(stored));
    await act(async () => {
      await result.current.remove('manual-1');
    });
    expect(postJSON).not.toHaveBeenCalled();
  });
});
