/**
 * The "Price changes" card (#613, Phase 3). What must hold: rows come from
 * the window the toggle names, a rise and a fall are coloured and signed
 * differently, "no history" and "no changes" are two different sentences,
 * the region is the one passed in, a failure shows the server's sentence and
 * Try again retries, and the first render is the loading line.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { PriceChanges, formatDeltaPct } from './PriceChanges';
import { clearPublicGetCache } from '@/lib/publicApi';

vi.mock('@/lib/functionsBase', () => ({
  requireFunctionsBase: () => 'https://api.test/api',
}));

const fetchMock = vi.fn();
const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const item = (provider, serviceId, label, from, to, deltaPct, unit = 'hour') => ({
  serviceId,
  label,
  provider,
  unit,
  sku: `${provider}-sku`,
  from,
  to,
  deltaPct,
});

const CHANGES = {
  success: true,
  changes: {
    region: 'us-east-1',
    asOf: '2026-09-15T06:00:00.000Z',
    windows: {
      '7d': {
        since: '2026-09-08T06:00:00.000Z',
        sampleDay: '2026-09-08',
        items: [
          item('aws', 'compute-vm', 'Virtual machine', 0.192, 0.201, 4.6875),
          item('gcp', 'storage-object', 'Object storage', 0.02, 0.018, -10, 'GB-month'),
        ],
      },
      '30d': {
        since: '2026-08-16T06:00:00.000Z',
        sampleDay: '2026-08-16',
        items: [
          item('aws', 'compute-vm', 'Virtual machine', 0.19, 0.201, 5.789),
          item('gcp', 'storage-object', 'Object storage', 0.02, 0.018, -10, 'GB-month'),
          item('azure', 'edge-cdn', 'CDN egress', 0.08, 0.081, 1.25, 'GB egress'),
        ],
      },
    },
    sampleDays: 31,
  },
};

const NO_HISTORY = {
  success: true,
  changes: { region: 'us-east-1', asOf: null, windows: {}, sampleDays: 0 },
};

const quiet = (changes) => ({
  ...CHANGES,
  changes: {
    ...CHANGES.changes,
    ...changes,
    windows: {
      '7d': { ...CHANGES.changes.windows['7d'], items: [] },
      '30d': CHANGES.changes.windows['30d'],
    },
  },
});

const rows = () =>
  Array.from(document.querySelectorAll('[data-change]')).map((li) => li.dataset.change);
const status = () => screen.getByTestId('price-changes-status').textContent;

beforeEach(() => {
  clearPublicGetCache();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse(CHANGES));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  clearPublicGetCache();
  vi.unstubAllGlobals();
});

describe('PriceChanges', () => {
  it('lists the 7-day window by default, one row per move, signed and coloured', async () => {
    render(<PriceChanges region="us-east-1" />);
    expect(screen.getByText('Loading price changes…')).toBeTruthy();
    await waitFor(() => expect(rows()).toEqual(['aws:compute-vm', 'gcp:storage-object']));
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('region')).toBe(
      'us-east-1'
    );

    const up = document.querySelector('[data-change="aws:compute-vm"]');
    expect(up.dataset.direction).toBe('up');
    expect(up.textContent).toContain('AWS · Virtual machine');
    expect(up.textContent).toContain('$0.192 → $0.201');
    expect(up.textContent).toContain('/hour');
    expect(up.textContent).toContain('↑ +4.7%');
    expect(up.querySelector('.text-rose-700')).toBeTruthy();

    const down = document.querySelector('[data-change="gcp:storage-object"]');
    expect(down.dataset.direction).toBe('down');
    expect(down.textContent).toContain('Google Cloud · Object storage');
    expect(down.textContent).toContain('$0.02 → $0.018');
    expect(down.textContent).toContain('↓ −10.0%');
    expect(down.querySelector('.text-emerald-700')).toBeTruthy();

    const asOf = screen.getByTestId('price-changes-as-of').textContent;
    expect(asOf).toMatch(/^Compared with the sample of 2026-09-08; as of .*2026.*\.$/);
    expect(screen.getByRole('button', { name: '7 days' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('switches to the 30-day window without another fetch', async () => {
    render(<PriceChanges region="us-east-1" />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    expect(rows()).toEqual(['aws:compute-vm', 'gcp:storage-object', 'azure:edge-cdn']);
    expect(screen.getByRole('button', { name: '30 days' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(screen.getByRole('button', { name: '7 days' }).getAttribute('aria-pressed')).toBe(
      'false'
    );
    expect(screen.getByTestId('price-changes-as-of').textContent).toContain('2026-08-16');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says "no changes" for an empty window and "no history" when there is none yet', async () => {
    fetchMock.mockResolvedValue(jsonResponse(quiet()));
    const first = render(<PriceChanges region="us-east-1" />);
    await waitFor(() => expect(status()).toBe('No changes in the last 7 days.'));
    expect(screen.getByTestId('price-changes-as-of')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    expect(rows()).toHaveLength(3);
    first.unmount();

    clearPublicGetCache();
    fetchMock.mockResolvedValue(jsonResponse(NO_HISTORY));
    render(<PriceChanges region="us-east-1" />);
    await waitFor(() => expect(status()).toMatch(/^No history yet/));
    expect(screen.queryByTestId('price-changes-as-of')).toBeNull();
  });

  it('follows the region it is given and ignores another region’s answer', async () => {
    fetchMock.mockImplementation(async (url) => {
      const region = new URL(String(url)).searchParams.get('region');
      return jsonResponse({ ...CHANGES, changes: { ...CHANGES.changes, region } });
    });
    const { rerender } = render(<PriceChanges region="us-east-1" />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    rerender(<PriceChanges region="westeurope" />);
    // While the new region loads the old rows are not shown as its answer.
    expect(screen.getByText('Loading price changes…')).toBeTruthy();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('region')).toBe(
      'westeurope'
    );
  });

  it('shows the server sentence on a failure, and Try again fetches again', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'Unknown region: mars-1' }, 400))
      .mockResolvedValueOnce(jsonResponse(CHANGES));
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<PriceChanges region="us-east-1" />);
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(
        'Price changes could not be loaded: Unknown region: mars-1'
      );
      fireEvent.click(within(alert).getByRole('button', { name: /Try again/ }));
      await waitFor(() => expect(rows()).toHaveLength(2));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      silence.mockRestore();
    }
  });

  it('formats the percentage with a sign and one decimal', () => {
    expect(formatDeltaPct(4.6875)).toBe('+4.7%');
    expect(formatDeltaPct(-10)).toBe('−10.0%');
    expect(formatDeltaPct(0)).toBe('0.0%');
    expect(formatDeltaPct('x')).toBe('');
  });
});
