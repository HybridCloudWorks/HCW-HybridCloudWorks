/**
 * The Labs snapshot poll's `refresh`, which the Agents tab calls after every
 * registry write.
 *
 * The case that matters is a refresh that lands while a read is already in
 * flight. That read was sent before the write, so answering the refresh with
 * it would render the old state after the toast: a removed agent's card would
 * come back and stay until the next 15-second tick. The in-flight guard still
 * holds (never two reads at once); the refresh becomes one more read after it.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useLabsLive from './useLabsLive';

const postJSON = vi.fn();
vi.mock('@/lib/api', () => ({ postJSON: (...args) => postJSON(...args) }));

/** A promise the test settles by hand, so a read can be held in flight. */
function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const OLD = { agentId: 'srv939861', active: false };
const CURRENT = { agentId: 'vps-hostinger-01', active: true };

beforeEach(() => {
  postJSON.mockReset();
});

describe('useLabsLive refresh', () => {
  it('reads again after a read in flight, instead of dropping the refresh', async () => {
    const first = deferred();
    const second = deferred();
    postJSON.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result, unmount } = renderHook(() => useLabsLive(true));
    expect(postJSON).toHaveBeenCalledTimes(1);

    // The write happened; the read in flight predates it.
    act(() => result.current.refresh());
    expect(postJSON).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve({ agents: [CURRENT, OLD], jobs: [] }));
    await waitFor(() => expect(postJSON).toHaveBeenCalledTimes(2));

    await act(async () => second.resolve({ agents: [CURRENT], jobs: [] }));
    await waitFor(() => expect(result.current.agents).toEqual([CURRENT]));
    // One trailing read, not a loop.
    expect(postJSON).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('reads at once when nothing is in flight', async () => {
    postJSON.mockResolvedValue({ agents: [CURRENT], jobs: [] });
    const { result, unmount } = renderHook(() => useLabsLive(true));
    await waitFor(() => expect(result.current.agents).toEqual([CURRENT]));

    act(() => result.current.refresh());
    expect(postJSON).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('does not read again after it is unmounted', async () => {
    const first = deferred();
    postJSON.mockReturnValueOnce(first.promise);
    const { result, unmount } = renderHook(() => useLabsLive(true));

    act(() => result.current.refresh());
    unmount();
    await act(async () => first.resolve({ agents: [OLD], jobs: [] }));

    expect(postJSON).toHaveBeenCalledTimes(1);
  });
});
