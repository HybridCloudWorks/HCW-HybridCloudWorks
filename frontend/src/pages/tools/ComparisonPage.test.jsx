/**
 * The pricing comparison page (#613, Phase 1). What must hold: rows and
 * badges come from the payload, the cheapest cell on a row is marked, a
 * provider missing from a row is "unavailable", the region lives in `?region=`
 * and changing it refetches, an empty cache is its own state, an error shows
 * the server's sentence and Try again really retries, and the page's first
 * render — the pre-rendered one — is the loading row under the real heading.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router';

import ComparisonPage from './ComparisonPage';
import { clearPublicGetCache } from '@/lib/publicApi';
import { PRICING_PAGES } from './pricingPages';

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }) => <>{children}</>,
}));
vi.mock('@/lib/functionsBase', () => ({
  requireFunctionsBase: () => 'https://api.test/api',
}));

const fetchMock = vi.fn();
const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const row = (provider, pricePerUnit, over = {}) => ({
  provider,
  sku: `${provider}-sku`,
  pricePerUnit,
  unit: 'hour',
  currency: 'USD',
  providerRegion: `${provider}-region`,
  updatedAt: '2026-09-14T06:00:00.000Z',
  source: 'live',
  ...over,
});

const PAYLOAD = {
  success: true,
  pricing: {
    region: 'us-east-1',
    regions: [
      { id: 'us-east-1', label: 'US East' },
      { id: 'us-west-2', label: 'US West' },
      { id: 'westeurope', label: 'Western Europe' },
    ],
    refreshedAt: '2026-09-14T06:00:00.000Z',
    ttlMinutes: 1440,
    ageMinutes: 95,
    stale: false,
    counts: { live: 4, baseline: 1, unavailable: 1 },
    services: [
      {
        serviceId: 'compute-vm',
        label: 'Virtual machine',
        unit: 'hour',
        sku: '4 vCPU / 16 GiB general purpose',
        rows: [row('aws', 0.192), row('azure', 0.201), row('gcp', 0.184)],
      },
      {
        serviceId: 'storage-object',
        label: 'Object storage',
        unit: 'GB-month',
        sku: 'Hot / standard tier',
        // Azure fell back to the catalogue; GCP answered nothing at all.
        rows: [row('aws', 0.023), row('azure', 0.02, { source: 'baseline', sku: 'catalogue' })],
      },
    ],
  },
};

const EMPTY = {
  success: true,
  pricing: {
    region: 'us-east-1',
    regions: [{ id: 'us-east-1', label: 'US East' }],
    refreshedAt: null,
    ttlMinutes: 1440,
    ageMinutes: null,
    stale: false,
    counts: { live: 0, baseline: 0, unavailable: 24 },
    services: [],
  },
};

/** The query string as the router sees it, so a region change is asserted on the URL. */
function SearchProbe() {
  const [params] = useSearchParams();
  return <output data-testid="search">{params.toString()}</output>;
}

function renderPage(path = '/tools/comparison') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ComparisonPage />
      <SearchProbe />
    </MemoryRouter>
  );
}

const regionOf = (call) => new URL(String(call[0])).searchParams.get('region');
const serviceRow = (id) => document.querySelector(`tr[data-service="${id}"]`);
const cell = (id, provider) => serviceRow(id).querySelector(`td[data-provider="${provider}"]`);

beforeEach(() => {
  clearPublicGetCache();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse(PAYLOAD));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  clearPublicGetCache();
  vi.unstubAllGlobals();
});

describe('with prices', () => {
  it('renders one row per service with a price, SKU and link per provider', async () => {
    renderPage();
    await waitFor(() => expect(serviceRow('compute-vm')).toBeTruthy());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Cloud pricing comparison');
    const vm = serviceRow('compute-vm');
    expect(vm.textContent).toContain('Virtual machine');
    expect(vm.textContent).toContain('per hour');
    expect(vm.textContent).toContain('4 vCPU / 16 GiB general purpose');

    const aws = cell('compute-vm', 'aws');
    expect(aws.textContent).toContain('$0.192');
    expect(aws.textContent).toContain('aws-sku');
    const link = within(aws).getByRole('link');
    expect(link.getAttribute('href')).toBe(PRICING_PAGES.aws['compute-vm']);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(cell('compute-vm', 'gcp').getAttribute('href')).toBeNull();
    expect(within(cell('compute-vm', 'gcp')).getByRole('link').getAttribute('href')).toBe(
      PRICING_PAGES.gcp['compute-vm']
    );
  });

  it('highlights the cheapest cell on each row and only that one', async () => {
    renderPage();
    await waitFor(() => expect(serviceRow('compute-vm')).toBeTruthy());
    expect(cell('compute-vm', 'gcp').dataset.cheapest).toBe('true');
    expect(cell('compute-vm', 'aws').dataset.cheapest).toBeUndefined();
    expect(cell('compute-vm', 'azure').dataset.cheapest).toBeUndefined();
    // A catalogue figure still competes: it is the best number the row has.
    expect(cell('storage-object', 'azure').dataset.cheapest).toBe('true');
  });

  it('badges a catalogue price, with a title saying it is a fallback', async () => {
    renderPage();
    await waitFor(() => expect(serviceRow('storage-object')).toBeTruthy());
    const azure = cell('storage-object', 'azure');
    const badge = within(azure).getByText('catalogue price');
    expect(badge.getAttribute('title')).toMatch(/fallback, not a live price/);
    expect(azure.dataset.source).toBe('baseline');
    expect(within(cell('storage-object', 'aws')).queryByText('catalogue price')).toBeNull();
  });

  it('marks a provider with no row as unavailable, still linking to its pricing page', async () => {
    renderPage();
    await waitFor(() => expect(serviceRow('storage-object')).toBeTruthy());
    const gcp = cell('storage-object', 'gcp');
    expect(within(gcp).getByText('unavailable')).toBeTruthy();
    expect(gcp.dataset.source).toBe('unavailable');
    expect(gcp.dataset.cheapest).toBeUndefined();
    expect(within(gcp).getByRole('link').getAttribute('href')).toBe(
      PRICING_PAGES.gcp['storage-object']
    );
  });

  it('says when the prices are from, and that they refresh daily', async () => {
    renderPage();
    const asOf = await screen.findByTestId('as-of');
    expect(asOf.dataset.tone).toBe('fresh');
    expect(asOf.textContent).toMatch(/^Prices as of .+, refreshed daily\.$/);
    expect(asOf.textContent).toMatch(/2026/);
  });

  it('says how late a stale cache is, in hours', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...PAYLOAD,
        pricing: { ...PAYLOAD.pricing, stale: true, ageMinutes: 31 * 60 + 20 },
      })
    );
    renderPage();
    const asOf = await screen.findByTestId('as-of');
    expect(asOf.dataset.tone).toBe('stale');
    expect(asOf.textContent).toBe('Stale: last refreshed 31 hours ago.');
  });
});

describe('the region', () => {
  it('reads ?region= for the fetch and fills the select from the payload', async () => {
    renderPage('/tools/comparison?region=westeurope');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(regionOf(fetchMock.mock.calls[0])).toBe('westeurope');

    const select = await screen.findByLabelText('Region');
    await waitFor(() => expect(select.disabled).toBe(false));
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'US East',
      'US West',
      'Western Europe',
    ]);
    expect(select.value).toBe('westeurope');
  });

  it('defaults to us-east-1 when the URL names none', async () => {
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(regionOf(fetchMock.mock.calls[0])).toBe('us-east-1');
  });

  it('writes a change to ?region= and fetches the new region', async () => {
    renderPage();
    const select = await screen.findByLabelText('Region');
    await waitFor(() => expect(select.disabled).toBe(false));

    fireEvent.change(select, { target: { value: 'us-west-2' } });
    expect(screen.getByTestId('search').textContent).toBe('region=us-west-2');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(regionOf(fetchMock.mock.calls[1])).toBe('us-west-2');

    // Back to the default drops the parameter: the canonical URL has none.
    fireEvent.change(select, { target: { value: 'us-east-1' } });
    expect(screen.getByTestId('search').textContent).toBe('');
  });
});

describe('without prices', () => {
  it('renders the heading, intro and the loading row before any data — the pre-rendered form', () => {
    // Never resolves: this is the page as the static build and the first
    // client render both see it.
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Cloud pricing comparison');
    expect(screen.getByText(/It is a price, not a bill/)).toBeTruthy();
    expect(screen.getByText('Loading prices…')).toBeTruthy();
    expect(screen.getByLabelText('Region').disabled).toBe(true);
    expect(screen.queryByTestId('as-of')).toBeNull();
  });

  it('says the cache has never been filled when the API answers with no services', async () => {
    fetchMock.mockResolvedValue(jsonResponse(EMPTY));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('Nothing to compare until the first refresh.')).toBeTruthy()
    );
    const asOf = screen.getByTestId('as-of');
    expect(asOf.dataset.tone).toBe('never');
    expect(asOf.textContent).toBe('Prices have not been refreshed yet.');
    expect(document.querySelector('tr[data-service]')).toBeNull();
  });

  it('shows the server sentence on a failure, and Try again fetches again', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'Unknown region: mars-1' }, 400))
      .mockResolvedValueOnce(jsonResponse(PAYLOAD));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderPage('/tools/comparison?region=mars-1');
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('Unknown region: mars-1');
      expect(screen.getByText('Prices could not be loaded.')).toBeTruthy();

      // The select stays usable after a failure, offering the default as the
      // way out of a region the API refused.
      const select = screen.getByLabelText('Region');
      expect(select.disabled).toBe(false);
      expect(Array.from(select.options).map((option) => option.value)).toEqual([
        'us-east-1',
        'mars-1',
      ]);

      fireEvent.click(within(alert).getByRole('button', { name: /Try again/ }));
      await waitFor(() => expect(serviceRow('compute-vm')).toBeTruthy());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      quiet.mockRestore();
    }
  });
});
