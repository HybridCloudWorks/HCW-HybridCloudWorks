/**
 * The Certifications Hub's list read and its writes. What must hold is
 * ordering: the newest read wins however the network orders the answers, a
 * torn-down read takes nothing, a failed read leaves no stale rows beside its
 * error, a read that raced a write is re-issued, and a second write to a cert
 * whose first has not answered is not sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import useCertifications from './useCertifications';

const getJSON = vi.fn();
const sendJSON = vi.fn();
vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
}));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const FIRST = { items: [{ id: 'a', name: 'First', display_order: 2 }] };
const NEWER = {
  items: [
    { id: 'b', name: 'Newer B', display_order: 5 },
    { id: 'a', name: 'Newer A', display_order: 1 },
  ],
};

beforeEach(() => {
  getJSON.mockReset();
  sendJSON.mockReset();
});

describe('useCertifications reads', () => {
  it('waits for auth, then loads, keyed by _docId and sorted by display order', async () => {
    getJSON.mockResolvedValue(NEWER);
    const { result, rerender } = renderHook(({ ready }) => useCertifications(ready), {
      initialProps: { ready: false },
    });
    expect(getJSON).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    rerender({ ready: true });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(getJSON).toHaveBeenCalledWith('cms/certifications');
    expect(result.current.items.map((c) => c._docId)).toEqual(['a', 'b']);
    expect(result.current.loading).toBe(false);
  });

  it('does not let a slow first load overwrite a refresh that resolved before it', async () => {
    const slow = deferred();
    getJSON.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(NEWER);
    const { result } = renderHook(() => useCertifications(true));

    await act(async () => {
      expect(await result.current.refresh()).toBe(true);
    });
    await act(async () => {
      slow.resolve(FIRST);
      await slow.promise;
    });
    expect(result.current.items.map((c) => c.name)).toEqual(['Newer A', 'Newer B']);
  });

  it('drops a superseded failure rather than blanking a newer read', async () => {
    const slow = deferred();
    getJSON.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(NEWER);
    const { result } = renderHook(() => useCertifications(true));
    await act(async () => {
      await result.current.refresh();
    });
    await act(async () => {
      slow.reject(new Error('timed out'));
      await slow.promise.catch(() => {});
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.error).toBe('');
  });

  it('empties the list, sets the error and toasts when a refresh fails', async () => {
    const toast = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getJSON.mockResolvedValueOnce(FIRST).mockRejectedValueOnce(new Error('refused'));
    const { result } = renderHook(() => useCertifications(true, { toast }));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let landed;
    await act(async () => {
      landed = await result.current.refresh();
    });
    expect(landed).toBe(false);
    expect(result.current.error).toBe('refused');
    expect(result.current.items).toEqual([]);
    expect(result.current.loaded).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Failed to load' }));
    spy.mockRestore();
  });

  it('takes nothing from a read whose effect was torn down before it answered', async () => {
    const slow = deferred();
    getJSON.mockReturnValueOnce(slow.promise);
    const { result, rerender } = renderHook(({ ready }) => useCertifications(ready), {
      initialProps: { ready: true },
    });
    rerender({ ready: false });
    await act(async () => {
      slow.resolve(FIRST);
      await slow.promise;
    });
    expect(result.current.items).toEqual([]);
    expect(result.current.loaded).toBe(false);
  });

  it('re-reads when a write landed while a read was out, instead of painting over it', async () => {
    getJSON.mockResolvedValueOnce(FIRST);
    const { result } = renderHook(() => useCertifications(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const stale = deferred();
    getJSON
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ items: [{ id: 'a', name: 'First', featured: true }] });
    sendJSON.mockResolvedValue({ success: true });

    let refreshing;
    act(() => {
      refreshing = result.current.refresh();
    });
    await act(async () => {
      await result.current.patch(result.current.items[0], { featured: true });
    });
    // The read answers with rows from before the write.
    await act(async () => {
      stale.resolve(FIRST);
      expect(await refreshing).toBe(true);
    });
    expect(getJSON).toHaveBeenCalledTimes(3);
    expect(result.current.items[0].featured).toBe(true);
  });
});

describe('useCertifications writes', () => {
  it('patches a cert once, ignoring a second toggle while the first is in flight', async () => {
    getJSON.mockResolvedValue(FIRST);
    const { result } = renderHook(() => useCertifications(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const write = deferred();
    sendJSON.mockReturnValueOnce(write.promise);
    const [cert] = result.current.items;
    let first;
    let second;
    act(() => {
      first = result.current.patch(cert, { display: false });
      second = result.current.patch(cert, { display: false });
    });
    expect(await second).toBe(false);
    expect(result.current.busyIds.has('a')).toBe(true);

    await act(async () => {
      write.resolve({ success: true });
      expect(await first).toBe(true);
    });
    expect(sendJSON).toHaveBeenCalledTimes(1);
    expect(sendJSON).toHaveBeenCalledWith('cms/certifications/a', 'PATCH', { display: false });
    expect(result.current.items[0].display).toBe(false);
    expect(result.current.busyIds.has('a')).toBe(false);
  });

  it('keeps the row and toasts when a patch is refused', async () => {
    const toast = vi.fn();
    getJSON.mockResolvedValue(FIRST);
    sendJSON.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useCertifications(true, { toast }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      expect(await result.current.patch(result.current.items[0], { featured: true })).toBe(false);
    });
    expect(result.current.items[0].featured).toBeUndefined();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Update failed' }));
  });

  it('deletes a cert and removes its row; a failed delete keeps it', async () => {
    const toast = vi.fn();
    getJSON.mockResolvedValue(NEWER);
    sendJSON.mockRejectedValueOnce(new Error('locked')).mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useCertifications(true, { toast }));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.remove(result.current.items[0]);
    });
    expect(result.current.items).toHaveLength(2);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete failed' }));

    await act(async () => {
      await result.current.remove(result.current.items[0]);
    });
    expect(sendJSON).toHaveBeenLastCalledWith('cms/certifications/a', 'DELETE');
    expect(result.current.items.map((c) => c._docId)).toEqual(['b']);
    expect(toast).toHaveBeenCalledWith({ title: 'Deleted' });
  });

  it('upserts a saved row: replaces by id, appends a new one', async () => {
    getJSON.mockResolvedValue(FIRST);
    const { result } = renderHook(() => useCertifications(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => {
      result.current.upsertLocal({ _docId: 'a', name: 'Edited' });
      result.current.upsertLocal({ _docId: 'z', name: 'Added' });
    });
    expect(result.current.items.map((c) => c.name)).toEqual(['Edited', 'Added']);
  });
});
