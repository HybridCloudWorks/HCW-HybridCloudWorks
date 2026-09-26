/**
 * The Platform Settings Hub's frame (#571): one tab per concern, `?tab=` deep
 * links, and each tab loading only its own settings when it is opened. What
 * each card sends on Save is tested beside the card, in
 * components/admin/platform-settings.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';

import PlatformSettingsPage, { TABS, resolveTab } from './PlatformSettingsPage';
import { settingRoute } from '@/components/admin/platform-settings/settingShared';
import { HISTORY_ROUTE } from '@/components/admin/platform-settings/ChangeHistoryTab';
import { ELEVENLABS_STATUS_ROUTE } from '@/components/admin/platform-settings/ElevenLabsCard';

// The Radix Switch measures its thumb with ResizeObserver, which jsdom lacks.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const getJSON = vi.fn();
const postJSON = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: vi.fn(),
  postJSON: (...args) => postJSON(...args),
}));
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const empty = {
  'default-heroes': { heroes: {} },
  'social-autopost': { enabled: false, accountIds: [], scheduleDelayMinutes: 60 },
  'podcast-feeds': { feeds: [] },
  'listen-and-learn-speech': { geminiModel: 'gemini-3.1-flash-tts-preview' },
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

const renderAt = (url) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <PlatformSettingsPage />
      <LocationProbe />
    </MemoryRouter>
  );

const routesAsked = () => getJSON.mock.calls.map(([route]) => route.split('?')[0]);

beforeEach(() => {
  getJSON.mockReset().mockImplementation(async (route) => {
    if (route.startsWith(HISTORY_ROUTE)) return { success: true, entries: [], nextAfter: null };
    if (route === ELEVENLABS_STATUS_ROUTE) {
      return { success: true, configured: false, reason: 'ELEVENLABS_API_KEY is not configured.' };
    }
    const setting = route.replace('cms/platform-settings/', '');
    return { success: true, setting, value: empty[setting], exists: false };
  });
  postJSON.mockReset().mockResolvedValue({ ok: false, code: 'INTEGRATION_NOT_CONFIGURED' });
});

describe('tabs', () => {
  it('are one per concern, with Change history last', () => {
    expect(TABS.map((tab) => [tab.id, tab.label])).toEqual([
      ['content', 'Content defaults'],
      ['social', 'Social automation'],
      ['audio', 'Audio'],
      ['history', 'Change history'],
    ]);
    expect(resolveTab('audio').id).toBe('audio');
    expect(resolveTab('nope').id).toBe('content');
    expect(resolveTab(null).id).toBe('content');
  });

  it('opens Content defaults with no ?tab=, loading only the covers', async () => {
    renderAt('/admin/platform');
    expect(screen.getByRole('heading', { name: /Platform Settings Hub/ })).toBeTruthy();
    await screen.findByText('Default covers');
    expect(
      screen.getByRole('tab', { name: 'Content defaults' }).getAttribute('aria-selected')
    ).toBe('true');
    expect(routesAsked()).toEqual([settingRoute('default-heroes')]);
    expect(postJSON).not.toHaveBeenCalled();
  });

  it('deep-links each tab, and each loads only its own data', async () => {
    renderAt('/admin/platform?tab=audio');
    await screen.findByText('Podcast feeds');
    await screen.findByText('Listen & Learn voice');
    await screen.findByText('Not configured');
    // Its two settings and the podcast voice's status (ElevenLabs, 2026-09-26).
    expect(routesAsked().sort()).toEqual(
      [
        settingRoute('listen-and-learn-speech'),
        settingRoute('podcast-feeds'),
        ELEVENLABS_STATUS_ROUTE,
      ].sort()
    );
    expect(screen.queryByText('Default covers')).toBeNull();
    expect(postJSON).not.toHaveBeenCalled();
  });

  it('deep-links Social automation, which alone asks Publer', async () => {
    renderAt('/admin/platform?tab=social');
    await screen.findByText('Social autoposting');
    expect(routesAsked()).toEqual([settingRoute('social-autopost')]);
    expect(postJSON).toHaveBeenCalledWith('publerProxy', { path: '/accounts', method: 'GET' });
  });

  it('deep-links Change history, which reads the history route only', async () => {
    renderAt('/admin/platform?tab=history');
    expect(await screen.findByText(/No settings changes recorded yet/)).toBeTruthy();
    expect(routesAsked()).toEqual([HISTORY_ROUTE]);
  });

  it('lands an unknown ?tab= on Content defaults rather than a blank page', async () => {
    renderAt('/admin/platform?tab=covers');
    await screen.findByText('Default covers');
    expect(
      screen.getByRole('tab', { name: 'Content defaults' }).getAttribute('aria-selected')
    ).toBe('true');
  });

  it('switching tabs writes ?tab= and mounts the new tab fresh', async () => {
    renderAt('/admin/platform');
    await screen.findByText('Default covers');
    fireEvent.click(screen.getByRole('tab', { name: 'Change history' }));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/platform?tab=history')
    );
    expect(await screen.findByText(/No settings changes recorded yet/)).toBeTruthy();
    expect(screen.queryByLabelText('Azure')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Content defaults' }));
    await screen.findByText('Default covers');
    // Opened twice, loaded twice: a tab reads what is stored now, not what it
    // held when it was last open.
    expect(routesAsked().filter((r) => r === settingRoute('default-heroes'))).toHaveLength(2);
  });

  it('follows the ARIA tabs keyboard pattern: roving tabindex, arrows wrap, Home and End', async () => {
    renderAt('/admin/platform');
    await screen.findByText('Default covers');
    const tab = (name) => screen.getByRole('tab', { name });
    expect(tab('Content defaults').getAttribute('tabindex')).toBe('0');
    expect(tab('Audio').getAttribute('tabindex')).toBe('-1');

    fireEvent.keyDown(tab('Content defaults'), { key: 'ArrowRight' });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/platform?tab=social')
    );
    expect(document.activeElement).toBe(tab('Social automation'));
    expect(tab('Social automation').getAttribute('tabindex')).toBe('0');

    fireEvent.keyDown(tab('Social automation'), { key: 'End' });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/platform?tab=history')
    );
    fireEvent.keyDown(tab('Change history'), { key: 'ArrowRight' });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/platform?tab=content')
    );
    fireEvent.keyDown(tab('Content defaults'), { key: 'ArrowLeft' });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/platform?tab=history')
    );
    fireEvent.keyDown(tab('Change history'), { key: 'Home' });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/platform?tab=content')
    );
  });

  it('a failure in one tab does not reach another', async () => {
    getJSON.mockImplementation(async (route) => {
      if (route === settingRoute('default-heroes')) throw new Error('HTTP 500');
      const setting = route.replace('cms/platform-settings/', '');
      return { success: true, value: empty[setting], exists: false };
    });
    renderAt('/admin/platform');
    expect((await screen.findByRole('alert')).textContent).toContain('HTTP 500');
    fireEvent.click(screen.getByRole('tab', { name: 'Audio' }));
    await screen.findByText('Podcast feeds');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
