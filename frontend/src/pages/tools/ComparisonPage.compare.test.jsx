/**
 * The second-region comparison on the scenario card (#613, Phase 3). What
 * must hold: the select offers every region but the current one, choosing
 * one writes `?compare=` and fetches that region once, each provider gains
 * its other-region total with a signed delta and the cheapest there is
 * named, a compare id the API did not list (or the current region) is
 * ignored, clearing the select removes `?compare=`, a stale answer is never
 * shown as the new region's, and a failed compare read is reported inline
 * without touching the page's own numbers.
 *
 * Prices: the round fixture of the Phase 2 test in us-east-1; every price
 * 10% higher in us-west-2, and westeurope missing the NoSQL rows entirely.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router';

import ComparisonPage from './ComparisonPage';
import { clearPublicGetCache } from '@/lib/publicApi';

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

const row = (provider, pricePerUnit) => ({
  provider,
  sku: `${provider}-sku`,
  pricePerUnit,
  unit: 'x',
  currency: 'USD',
  source: 'live',
});
const service = (serviceId, rows) => ({ serviceId, label: serviceId, unit: 'x', rows });

const REGIONS = [
  { id: 'us-east-1', label: 'US East' },
  { id: 'us-west-2', label: 'US West' },
  { id: 'westeurope', label: 'Western Europe' },
];

const SERVICES = [
  service('compute-vm', [row('aws', 0.2), row('azure', 0.25), row('gcp', 0.15)]),
  service('compute-serverless', [row('aws', 3), row('azure', 3), row('gcp', 2)]),
  service('storage-object', [row('aws', 0.02), row('azure', 0.02), row('gcp', 0.01)]),
  service('database-relational', [row('aws', 0.5), row('azure', 0.4), row('gcp', 0.6)]),
  service('database-nosql', [row('aws', 1), row('azure', 1), row('gcp', 1)]),
  service('containers-kubernetes', [row('aws', 0.4), row('azure', 0.4), row('gcp', 0.4)]),
  service('integration-messaging', [row('aws', 0.8), row('azure', 0.9), row('gcp', 0.7)]),
  service('edge-cdn', [row('aws', 0.1), row('azure', 0.08), row('gcp', 0.05)]),
];

const scale = (factor) =>
  SERVICES.map((s) => ({
    ...s,
    rows: s.rows.map((r) => ({
      ...r,
      pricePerUnit: Math.round(r.pricePerUnit * factor * 1e6) / 1e6,
    })),
  }));

const PRICING = {
  'us-east-1': SERVICES,
  'us-west-2': scale(1.1),
  westeurope: SERVICES.filter((s) => s.serviceId !== 'database-nosql'),
};

const payload = (region) => ({
  success: true,
  pricing: {
    region,
    regions: REGIONS,
    refreshedAt: '2026-09-14T06:00:00.000Z',
    ttlMinutes: 1440,
    ageMinutes: 95,
    stale: false,
    counts: { live: 24, baseline: 0, unavailable: 0 },
    services: PRICING[region],
  },
});

const NO_HISTORY = {
  success: true,
  changes: { region: 'us-east-1', asOf: null, windows: {}, sampleDays: 0 },
};

/** Pricing answers by region; anything else (price changes) gets no history. */
function routeFetch(over = {}) {
  fetchMock.mockImplementation(async (url) => {
    const parsed = new URL(String(url));
    if (!parsed.pathname.endsWith('/cloud-tools/pricing')) return jsonResponse(NO_HISTORY);
    const region = parsed.searchParams.get('region');
    if (over[region]) return over[region]();
    return PRICING[region]
      ? jsonResponse(payload(region))
      : jsonResponse({ success: false, error: `Unknown region: ${region}` }, 400);
  });
}
const pricingCalls = () =>
  fetchMock.mock.calls
    .map((call) => new URL(String(call[0])))
    .filter((url) => url.pathname.endsWith('/cloud-tools/pricing'))
    .map((url) => url.searchParams.get('region'));

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

const search = () => screen.getByTestId('search').textContent;
const providerRow = (id) => document.querySelector(`[data-scenario-provider="${id}"]`);
const compareLine = (id) => providerRow(id).querySelector(`[data-compare="${id}"]`);
const summary = () => screen.queryByTestId('compare-summary');
const awaitResults = () =>
  waitFor(() => expect(screen.getByTestId('scenario-results')).toBeTruthy());
const compareSelect = () => screen.getByLabelText('Compare with');

beforeEach(() => {
  clearPublicGetCache();
  fetchMock.mockReset();
  routeFetch();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  clearPublicGetCache();
  vi.unstubAllGlobals();
});

describe('Compare with', () => {
  it('offers every region but the current one, and nothing is fetched until one is chosen', async () => {
    renderPage();
    await awaitResults();
    const select = compareSelect();
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'None',
      'US West',
      'Western Europe',
    ]);
    expect(select.value).toBe('');
    expect(summary()).toBeNull();
    expect(compareLine('aws')).toBeNull();
    expect(pricingCalls()).toEqual(['us-east-1']);
  });

  it('choosing a region writes ?compare=, fetches it once, and sets every total against it', async () => {
    renderPage();
    await awaitResults();
    fireEvent.change(compareSelect(), { target: { value: 'us-west-2' } });
    expect(search()).toBe('compare=us-west-2');
    await waitFor(() => expect(summary()?.dataset.status).toBe('ready'));
    expect(pricingCalls()).toEqual(['us-east-1', 'us-west-2']);
    // Three-tier: AWS $711 here, 10% more there.
    expect(compareLine('aws').textContent).toBe('US West: $782.10 (+10%)');
    expect(compareLine('azure').textContent).toBe('US West: $771.10 (+10%)');
    expect(compareLine('gcp').textContent).toBe('US West: $752.40 (+10%)');
    expect(summary().textContent).toBe('Cheapest in US West: Google Cloud');
    // The page's own numbers are untouched.
    expect(providerRow('aws').querySelector('.text-lg').textContent).toBe('$711.00');
    // Scenario changes reprice both regions without another fetch.
    fireEvent.change(screen.getByLabelText('Scenario'), {
      target: { value: 'kubernetes-platform' },
    });
    expect(search()).toBe('scenario=kubernetes-platform&compare=us-west-2');
    await waitFor(() => expect(compareLine('aws').textContent).toBe('US West: $852.50 (+10%)'));
    expect(pricingCalls()).toEqual(['us-east-1', 'us-west-2']);
  });

  it('marks a provider unpriced in the other region, and names the cheapest there', async () => {
    renderPage('/tools/comparison?scenario=static-site-api&compare=westeurope');
    await awaitResults();
    await waitFor(() => expect(summary()?.dataset.status).toBe('ready'));
    expect(compareSelect().value).toBe('westeurope');
    // Static site needs NoSQL, which Western Europe lacks for everyone.
    expect(compareLine('aws').textContent).toBe('Western Europe: unavailable');
    expect(summary().textContent).toBe('Nothing is priced in Western Europe.');
    fireEvent.change(screen.getByLabelText('Scenario'), { target: { value: 'three-tier-web' } });
    await waitFor(() =>
      expect(compareLine('aws').textContent).toBe('Western Europe: $711.00 (0%)')
    );
    expect(summary().textContent).toBe('Cheapest in Western Europe: Google Cloud');
  });

  it('ignores a compare region the API did not list, or the region already shown', async () => {
    const first = renderPage('/tools/comparison?compare=mars-1');
    await awaitResults();
    expect(compareSelect().value).toBe('');
    expect(summary()).toBeNull();
    expect(pricingCalls()).toEqual(['us-east-1']);
    // Rewriting the state drops the unknown id.
    fireEvent.click(screen.getByLabelText('Backup'));
    expect(search()).toBe('extras=backup');
    first.unmount();

    clearPublicGetCache();
    renderPage('/tools/comparison?region=us-west-2&compare=us-west-2');
    await awaitResults();
    expect(compareSelect().value).toBe('');
    expect(Array.from(compareSelect().options).map((o) => o.value)).toEqual([
      '',
      'us-east-1',
      'westeurope',
    ]);
    expect(summary()).toBeNull();
    expect(pricingCalls()).toEqual(['us-east-1', 'us-west-2']);
  });

  it('clearing the select removes ?compare= and the comparison, keeping the rest', async () => {
    renderPage('/tools/comparison?region=us-west-2&extras=backup&compare=westeurope');
    await awaitResults();
    await waitFor(() => expect(summary()?.dataset.status).toBe('ready'));
    expect(compareLine('aws').textContent).toMatch(/^Western Europe: \$/);
    fireEvent.change(compareSelect(), { target: { value: '' } });
    expect(search()).toBe('region=us-west-2&extras=backup');
    await waitFor(() => expect(summary()).toBeNull());
    expect(compareLine('aws')).toBeNull();
  });

  it('never shows the previous region’s answer as the new one’s', async () => {
    let releaseWest;
    routeFetch({
      'us-west-2': () =>
        new Promise((resolve) => {
          releaseWest = () => resolve(jsonResponse(payload('us-west-2')));
        }),
    });
    renderPage('/tools/comparison?compare=westeurope');
    await awaitResults();
    await waitFor(() => expect(summary()?.dataset.status).toBe('ready'));
    fireEvent.change(compareSelect(), { target: { value: 'us-west-2' } });
    await waitFor(() => expect(summary().dataset.status).toBe('loading'));
    expect(summary().textContent).toBe('Loading US West prices…');
    expect(compareLine('aws')).toBeNull();
    releaseWest();
    await waitFor(() => expect(summary().dataset.status).toBe('ready'));
    expect(compareLine('aws').textContent).toBe('US West: $782.10 (+10%)');
  });

  it('reports a failed compare read inline and leaves the page’s numbers alone', async () => {
    routeFetch({
      'us-west-2': () => jsonResponse({ success: false, error: 'Region offline: us-west-2' }, 502),
    });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderPage('/tools/comparison?compare=us-west-2');
      await awaitResults();
      await waitFor(() => expect(summary()?.dataset.status).toBe('error'));
      expect(summary().textContent).toBe(
        'US West prices could not be loaded: Region offline: us-west-2'
      );
      expect(compareLine('aws')).toBeNull();
      expect(providerRow('aws').querySelector('.text-lg').textContent).toBe('$711.00');
      expect(screen.queryByText(/Prices could not be loaded:/)).toBeNull();
    } finally {
      quiet.mockRestore();
    }
  });
});
