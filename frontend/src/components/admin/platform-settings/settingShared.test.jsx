/**
 * useSetting's race-safety: a double submit sends one PUT, a slow load cannot
 * land over a newer one, and a failed reload leaves nothing from the last
 * good load behind.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';

import { SettingSection, settingRoute, useSetting } from './settingShared';

const getJSON = vi.fn();
const sendJSON = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
}));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const loaded = (value, over = {}) => ({
  success: true,
  value,
  exists: true,
  stored: 'valid',
  ...over,
});

beforeEach(() => {
  getJSON.mockReset();
  sendJSON.mockReset();
  toast.mockReset();
});

describe('useSetting', () => {
  it('does not load until auth is ready', async () => {
    getJSON.mockResolvedValue(loaded({ feeds: [] }));
    const { rerender, result } = renderHook(({ ready }) => useSetting('podcast-feeds', ready), {
      initialProps: { ready: false },
    });
    expect(getJSON).not.toHaveBeenCalled();
    rerender({ ready: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getJSON).toHaveBeenCalledWith(settingRoute('podcast-feeds'));
    expect(result.current.value).toEqual({ feeds: [] });
  });

  it('sends one PUT for a double submit', async () => {
    getJSON.mockResolvedValue(loaded({ feeds: [] }));
    const put = deferred();
    sendJSON.mockReturnValue(put.promise);
    const { result } = renderHook(() => useSetting('podcast-feeds', true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let first;
    let second;
    act(() => {
      first = result.current.save({ feeds: [] });
      second = result.current.save({ feeds: [] });
    });
    expect(await second).toBe(false);
    expect(sendJSON).toHaveBeenCalledTimes(1);
    await act(async () => {
      put.resolve(loaded({ feeds: [] }, { updatedAt: '2026-09-14T10:00:00.000Z' }));
      expect(await first).toBe(true);
    });
    expect(result.current.saving).toBe(false);
    expect(result.current.meta).toMatchObject({ exists: true, stored: 'valid' });
  });

  it('clears the last good value when a reload fails', async () => {
    getJSON.mockResolvedValueOnce(
      loaded({ geminiModel: 'x' }, { options: [{ id: 'x', tier: 'best' }] })
    );
    const { result } = renderHook(() => useSetting('listen-and-learn-speech', true));
    await waitFor(() => expect(result.current.value).toEqual({ geminiModel: 'x' }));
    expect(result.current.options).toHaveLength(1);

    getJSON.mockRejectedValueOnce(new Error('HTTP 500'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe('HTTP 500'));
    expect(result.current.value).toBeNull();
    expect(result.current.options).toEqual([]);
    expect(result.current.meta.exists).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('ignores a slow load that a retry has superseded', async () => {
    const slow = deferred();
    getJSON
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(loaded({ heroes: { AWS: '/new.png' } }));
    const { result } = renderHook(() => useSetting('default-heroes', true));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.value).toEqual({ heroes: { AWS: '/new.png' } }));

    await act(async () => {
      slow.resolve(loaded({ heroes: { AWS: '/old.png' } }));
      await slow.promise;
    });
    expect(result.current.value).toEqual({ heroes: { AWS: '/new.png' } });
  });
});

describe('SettingSection', () => {
  it('names the setting in a failure and offers a retry instead of the card', () => {
    const reload = vi.fn();
    const renderCard = vi.fn(() => <p>card</p>);
    render(
      <SettingSection
        setting={{ loading: false, error: 'HTTP 500', reload }}
        label="Podcast feeds"
        render={renderCard}
      />
    );
    expect(screen.getByRole('alert').textContent).toContain('Podcast feeds: HTTP 500');
    expect(renderCard).not.toHaveBeenCalled();
    screen.getByRole('button', { name: /Retry/ }).click();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
