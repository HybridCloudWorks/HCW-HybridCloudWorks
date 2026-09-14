/**
 * Change history: the table shows who, when, which setting and the recorded
 * summary; the filter asks the server for one setting; Load more pages by the
 * server's cursor; and the loading, empty and error states each say which
 * they are, with no rows left behind from a filter that failed to refresh.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import ChangeHistoryTab, {
  HISTORY_PAGE_SIZE,
  formatSummaryValue,
  historyRoute,
} from './ChangeHistoryTab';

const getJSON = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: vi.fn(),
  postJSON: vi.fn(),
}));
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));

const entry = (over = {}) => ({
  id: 'a1',
  at: '2026-09-14T10:00:00.000Z',
  actor: 'Saul Patino',
  setting: 'social-autopost',
  summary: { enabled: true, accounts: 2, scheduleDelayMinutes: 60 },
  ...over,
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  getJSON.mockReset().mockResolvedValue({ success: true, entries: [entry()], nextAfter: null });
});

describe('historyRoute and formatSummaryValue', () => {
  it('builds the query the server validates', () => {
    expect(historyRoute()).toBe(`cms/platform-settings/history?limit=${HISTORY_PAGE_SIZE}`);
    expect(historyRoute({ setting: 'podcast-feeds', after: '2026-09-14T10:00:00.000Z' })).toBe(
      `cms/platform-settings/history?limit=${HISTORY_PAGE_SIZE}&setting=podcast-feeds&after=2026-09-14T10%3A00%3A00.000Z`
    );
  });

  it('renders each recorded kind of value as one short string', () => {
    expect(formatSummaryValue(true)).toBe('yes');
    expect(formatSummaryValue(false)).toBe('no');
    expect(formatSummaryValue(3)).toBe('3');
    expect(formatSummaryValue(null)).toBe('none');
    expect(formatSummaryValue([])).toBe('none');
    expect(formatSummaryValue(['articles', 'podcasts'])).toBe('articles, podcasts');
    expect(formatSummaryValue('gemini-2.5-flash-preview-tts')).toBe('gemini-2.5-flash-preview-tts');
  });
});

describe('the Change history tab', () => {
  it('shows a loading state, then who, which setting and the summary chips', async () => {
    const pending = deferred();
    getJSON.mockReturnValueOnce(pending.promise);
    render(<ChangeHistoryTab />);
    expect(screen.getByText(/Loading change history/)).toBeTruthy();

    pending.resolve({ success: true, entries: [entry()], nextAfter: null });
    const table = await screen.findByRole('table');
    const [, row] = within(table).getAllByRole('row');
    expect(within(row).getByText('Saul Patino')).toBeTruthy();
    expect(within(row).getByText('Social autoposting')).toBeTruthy();
    const chips = within(row)
      .getAllByRole('listitem')
      .map((chip) => chip.textContent);
    expect(chips).toEqual(['enabled: yes', 'accounts: 2', 'scheduleDelayMinutes: 60']);
    expect(row.querySelector('time').getAttribute('datetime')).toBe('2026-09-14T10:00:00.000Z');
    expect(getJSON).toHaveBeenCalledWith(historyRoute());
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('says so when nothing has been recorded', async () => {
    getJSON.mockResolvedValue({ success: true, entries: [], nextAfter: null });
    render(<ChangeHistoryTab />);
    expect(await screen.findByText(/No settings changes recorded yet/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the server’s error, with no table', async () => {
    getJSON.mockRejectedValue(new Error('Failed to read platform settings history'));
    render(<ChangeHistoryTab />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Failed to read platform settings history');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('asks the server for one setting when filtered, and says when it has none', async () => {
    render(<ChangeHistoryTab />);
    await screen.findByRole('table');
    getJSON.mockResolvedValue({ success: true, entries: [], nextAfter: null });
    fireEvent.change(screen.getByLabelText('Setting'), { target: { value: 'podcast-feeds' } });
    await waitFor(() =>
      expect(getJSON).toHaveBeenLastCalledWith(historyRoute({ setting: 'podcast-feeds' }))
    );
    expect(await screen.findByText(/No changes recorded for this setting yet/)).toBeTruthy();
  });

  it('clears the previous rows when a refresh fails, rather than showing them as current', async () => {
    render(<ChangeHistoryTab />);
    await screen.findByRole('table');
    getJSON.mockRejectedValue(new Error('HTTP 500'));
    fireEvent.change(screen.getByLabelText('Setting'), { target: { value: 'default-heroes' } });
    expect((await screen.findByRole('alert')).textContent).toBe('HTTP 500');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Saul Patino')).toBeNull();
  });

  it('keeps only the latest filter’s rows when an older request answers last', async () => {
    const slowAll = deferred();
    getJSON.mockReturnValueOnce(slowAll.promise).mockResolvedValueOnce({
      success: true,
      entries: [entry({ id: 'p1', setting: 'podcast-feeds', summary: { feeds: 3 } })],
      nextAfter: null,
    });
    render(<ChangeHistoryTab />);
    await waitFor(() => expect(getJSON).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Setting'), { target: { value: 'podcast-feeds' } });
    await screen.findByText('feeds: 3');

    slowAll.resolve({ success: true, entries: [entry({ id: 'stale' })], nextAfter: null });
    await slowAll.promise;
    await Promise.resolve();
    expect(screen.queryByText('Social autoposting', { selector: 'td' })).toBeNull();
    expect(screen.getByText('feeds: 3')).toBeTruthy();
  });

  it('loads more from the server’s cursor, once per click in flight, appending', async () => {
    getJSON.mockResolvedValueOnce({
      success: true,
      entries: [entry({ id: 'a1' })],
      nextAfter: '2026-09-14T10:00:00.000Z',
    });
    render(<ChangeHistoryTab />);
    const more = await screen.findByRole('button', { name: 'Load more' });

    const page2 = deferred();
    getJSON.mockReturnValueOnce(page2.promise);
    fireEvent.click(more);
    fireEvent.click(more);
    expect(getJSON).toHaveBeenCalledTimes(2);
    expect(getJSON).toHaveBeenLastCalledWith(historyRoute({ after: '2026-09-14T10:00:00.000Z' }));

    page2.resolve({
      success: true,
      entries: [entry({ id: 'a2', actor: 'oid-2', setting: 'podcast-feeds', summary: {} })],
      nextAfter: null,
    });
    expect(await screen.findByText('oid-2')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('keeps the rows it has when Load more fails', async () => {
    getJSON.mockResolvedValueOnce({
      success: true,
      entries: [entry()],
      nextAfter: '2026-09-14T10:00:00.000Z',
    });
    render(<ChangeHistoryTab />);
    const more = await screen.findByRole('button', { name: 'Load more' });
    getJSON.mockRejectedValueOnce(new Error('HTTP 503'));
    fireEvent.click(more);
    expect((await screen.findByRole('alert')).textContent).toBe('HTTP 503');
    expect(screen.getByText('Saul Patino')).toBeTruthy();
  });

  it('refreshes on demand, so a save made meanwhile appears', async () => {
    render(<ChangeHistoryTab />);
    await screen.findByRole('table');
    getJSON.mockResolvedValue({
      success: true,
      entries: [entry({ id: 'new', actor: 'Someone Else' }), entry()],
      nextAfter: null,
    });
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    expect(await screen.findByText('Someone Else')).toBeTruthy();
    expect(getJSON).toHaveBeenCalledTimes(2);
  });
});
