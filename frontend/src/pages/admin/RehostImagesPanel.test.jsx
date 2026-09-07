import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RehostImagesPanel, {
  REHOST_BATCH_SIZE,
  REHOST_ROUTE,
  failedHostsOf,
  shortDate,
  splitBatches,
  toResultRow,
} from './RehostImagesPanel';

const postJSON = vi.fn();
const getJSON = vi.fn();
const logAdminAction = vi.fn();

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
  getJSON: (...args) => getJSON(...args),
}));

vi.mock('@/lib/auditLog', () => ({
  logAdminAction: (...args) => logAdminAction(...args),
}));

const candidate = (n, over = {}) => ({
  id: `c${n}`,
  title: `Article ${n}`,
  slug: `article-${n}`,
  publicUrl: `https://hybridcloudworks.com/azure/blog/article-${n}`,
  live: true,
  fields: ['content'],
  urlCount: n,
  hosts: ['techcommunity.microsoft.com'],
  lastRun: null,
  ...over,
});

/** Seven candidates: one more than a batch, so the split is visible. */
const seven = Array.from({ length: 7 }, (_, i) => candidate(i + 1));

function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Images: re-host hotlinked' }));
}

describe('pure helpers', () => {
  it('splits ids into batches of the configured size', () => {
    expect(REHOST_BATCH_SIZE).toBe(5);
    expect(splitBatches(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
    expect(splitBatches([], 2)).toEqual([]);
    expect(splitBatches(seven.map((c) => c.id))).toEqual([
      ['c1', 'c2', 'c3', 'c4', 'c5'],
      ['c6', 'c7'],
    ]);
  });

  it('renders a dash, not the epoch, for a missing or invalid last-run date', () => {
    // new Date(null) is 1970-01-01T00:00:00Z, a valid date; the guard has to
    // run before Date is consulted or "unknown" renders as the epoch.
    expect(shortDate('2026-09-06T10:00:00.000Z')).toBe('2026-09-06');
    expect(shortDate(null)).toBe('—');
    expect(shortDate(undefined)).toBe('—');
    expect(shortDate('')).toBe('—');
    expect(shortDate('not a date')).toBe('—');
    expect(shortDate(0)).toBe('—');
  });

  it('reduces failed URLs to distinct sorted hosts, never the URL', () => {
    expect(
      failedHostsOf([
        'https://techcommunity.microsoft.com/a.png',
        'https://cdn-dynmedia-1.microsoft.com/b.png',
        'https://techcommunity.microsoft.com/c.png',
        'not a url',
      ])
    ).toEqual(['cdn-dynmedia-1.microsoft.com', 'invalid-url', 'techcommunity.microsoft.com']);
  });

  it('shapes a result row from each kind of route result', () => {
    const titles = new Map([['c1', 'One']]);
    expect(
      toResultRow(
        {
          contentId: 'c1',
          inlineImages: { rewritten: 3, failed: 1, failedUrls: ['https://x.example/a.png'] },
        },
        titles
      )
    ).toEqual({
      contentId: 'c1',
      title: 'One',
      rewritten: 3,
      failed: 1,
      failedHosts: ['x.example'],
      outcome: 'Re-hosted with failures',
    });
    expect(toResultRow({ contentId: 'c2', skipped: true, reason: 'none' }, titles).outcome).toBe(
      'Skipped: none'
    );
    expect(toResultRow({ contentId: 'c3', error: 'boom' }, titles)).toMatchObject({
      title: 'c3',
      rewritten: null,
      outcome: 'Error: boom',
    });
  });
});

describe('RehostImagesPanel', () => {
  beforeEach(() => {
    postJSON.mockReset();
    getJSON.mockReset();
    logAdminAction.mockReset();
    logAdminAction.mockResolvedValue(undefined);
  });

  it('fetches nothing until opened, then lists every candidate checked with its hosts', async () => {
    getJSON.mockResolvedValue({ success: true, candidates: seven, scanned: 22, total: 7 });
    render(<RehostImagesPanel />);
    expect(getJSON).not.toHaveBeenCalled();

    openPanel();
    expect(
      await screen.findByText('7 of 22 published articles hotlink third-party images.')
    ).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith(REHOST_ROUTE);

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(7);
    boxes.forEach((box) => expect(box).toBeChecked());
    expect(
      screen.getByText(/7 images · techcommunity\.microsoft\.com · in content/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-host selected (7)' })).toBeEnabled();
  });

  it('opening an article’s View link leaves its checkbox as it was', async () => {
    // The link sat inside the row's <label> once, so a click on it also
    // toggled the checkbox; a reviewer opening a page deselected it.
    getJSON.mockResolvedValue({
      success: true,
      candidates: seven.slice(0, 2).map((c) =>
        c.id === 'c1'
          ? {
              ...c,
              lastRun: {
                at: '2026-09-06T10:00:00.000Z',
                rewritten: 1,
                failed: 1,
                failedHosts: ['cdn-dynmedia-1.microsoft.com'],
              },
            }
          : c
      ),
      scanned: 22,
    });
    render(<RehostImagesPanel />);
    openPanel();
    const box = await screen.findByRole('checkbox', { name: 'Select Article 1' });
    expect(box).toBeChecked();

    fireEvent.click(screen.getByRole('link', { name: 'View Article 1' }));
    expect(box).toBeChecked();

    // The label still toggles the box: clicking the title is the row's gesture.
    fireEvent.click(screen.getByText('Article 1'));
    expect(box).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Re-host selected (1)' })).toBeEnabled();

    // The last run reads as counts and hosts, as the API now sends it.
    expect(
      screen.getByText(
        /Last run 2026-09-06: 1 re-hosted, 1 failed \(cdn-dynmedia-1\.microsoft\.com\)/
      )
    ).toBeInTheDocument();
  });

  it('re-hosts the selected articles in batches and tabulates the outcome per article', async () => {
    getJSON.mockResolvedValue({ success: true, candidates: seven, scanned: 22, total: 7 });
    postJSON.mockImplementation(async (route, body) => {
      expect(route).toBe(REHOST_ROUTE);
      return {
        success: true,
        results: body.contentIds.map((contentId) => {
          if (contentId === 'c1') {
            return {
              contentId,
              inlineImages: {
                fields: ['content'],
                rewritten: 3,
                failed: 1,
                failedUrls: ['https://cdn-dynmedia-1.microsoft.com/is/image/x'],
                at: '2026-09-07T10:00:00.000Z',
              },
            };
          }
          if (contentId === 'c6') return { contentId, error: 'Content not found' };
          return {
            contentId,
            inlineImages: { fields: ['content'], rewritten: 2, failed: 0, failedUrls: [], at: 't' },
          };
        }),
      };
    });

    render(<RehostImagesPanel />);
    openPanel();
    await screen.findByText('7 of 22 published articles hotlink third-party images.');

    // Take one out; the rest go, in batches of five.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Article 7' }));
    fireEvent.click(screen.getByRole('button', { name: 'Re-host selected (6)' }));

    const table = await screen.findByRole('table', { name: 'Re-host results' });
    await waitFor(() => expect(postJSON).toHaveBeenCalledTimes(2));
    expect(postJSON.mock.calls[0][1]).toEqual({ contentIds: ['c1', 'c2', 'c3', 'c4', 'c5'] });
    expect(postJSON.mock.calls[1][1]).toEqual({ contentIds: ['c6'] });

    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(7)); // header + 6
    const first = within(table).getByText('Article 1').closest('tr');
    expect(within(first).getByText('3')).toBeInTheDocument();
    expect(within(first).getByText('1')).toBeInTheDocument();
    expect(within(first).getByText('cdn-dynmedia-1.microsoft.com')).toBeInTheDocument();
    expect(within(first).getByText('Re-hosted with failures')).toBeInTheDocument();
    const sixth = within(table).getByText('Article 6').closest('tr');
    expect(within(sixth).getByText('Error: Content not found')).toBeInTheDocument();
    expect(within(table).queryByText('Article 7')).not.toBeInTheDocument();

    await waitFor(() =>
      expect(logAdminAction).toHaveBeenCalledWith('content_images_rehosted', {
        requested: 6,
        rehosted: 5,
        failed: 1,
        skipped: 0,
      })
    );
    // The list is re-read after the run so finished articles drop out.
    await waitFor(() => expect(getJSON).toHaveBeenCalledTimes(2));
  });

  it('says so plainly when nothing hotlinks', async () => {
    getJSON.mockResolvedValue({ success: true, candidates: [], scanned: 22, total: 0 });
    render(<RehostImagesPanel />);
    openPanel();
    expect(
      await screen.findByText(/already served from hybridcloudworks\.com \(22 scanned\)/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('surfaces a failed run without losing the list', async () => {
    getJSON.mockResolvedValue({ success: true, candidates: seven.slice(0, 2), scanned: 22 });
    postJSON.mockRejectedValue(new Error('cms/content/rehost-images timed out after 200s'));
    render(<RehostImagesPanel />);
    openPanel();
    await screen.findByRole('button', { name: 'Re-host selected (2)' });
    fireEvent.click(screen.getByRole('button', { name: 'Re-host selected (2)' }));
    expect(
      await screen.findByText('Re-host failed: cms/content/rehost-images timed out after 200s')
    ).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});
