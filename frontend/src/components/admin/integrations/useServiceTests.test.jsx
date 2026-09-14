/**
 * The session's connection tests. What must hold: "Test all" never runs two
 * providers at once, including when a test started from a Services card is
 * still running when it is pressed.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import useServiceTests from './useServiceTests';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('useServiceTests', () => {
  it('does not start "Test all" while another test is still running', async () => {
    const slow = deferred();
    const gemini = { id: 'gemini', test: vi.fn(() => slow.promise) };
    const resend = { id: 'resend', test: vi.fn(async () => 'ok') };
    const { result } = renderHook(() => useServiceTests());

    let single;
    act(() => {
      single = result.current.runTest(gemini);
    });
    await act(async () => {
      await result.current.runAll([gemini, resend]);
    });
    expect(resend.test).not.toHaveBeenCalled();
    expect(gemini.test).toHaveBeenCalledTimes(1);

    await act(async () => {
      slow.resolve('done');
      await single;
    });
    await act(async () => {
      await result.current.runAll([gemini, resend]);
    });
    expect(gemini.test).toHaveBeenCalledTimes(2);
    expect(resend.test).toHaveBeenCalledTimes(1);
  });

  it('refuses a card test while "Test all" is still running', async () => {
    const slow = deferred();
    const gemini = { id: 'gemini', test: vi.fn(() => slow.promise) };
    const resend = { id: 'resend', test: vi.fn(async () => 'ok') };
    const { result } = renderHook(() => useServiceTests());

    let all;
    act(() => {
      all = result.current.runAll([gemini]);
    });
    let card;
    await act(async () => {
      card = await result.current.runTest(resend);
    });
    expect(card).toBeNull();
    expect(resend.test).not.toHaveBeenCalled();

    await act(async () => {
      slow.resolve('done');
      await all;
    });
    await act(async () => {
      await result.current.runTest(resend);
    });
    expect(resend.test).toHaveBeenCalledTimes(1);
  });

  it('runs "Test all" one service at a time', async () => {
    const order = [];
    const make = (id) => ({
      id,
      test: vi.fn(async () => {
        order.push(`start:${id}`);
        await Promise.resolve();
        order.push(`end:${id}`);
        return 'ok';
      }),
    });
    const { result } = renderHook(() => useServiceTests());
    await act(async () => {
      await result.current.runAll([make('a'), make('b')]);
    });
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });
});
