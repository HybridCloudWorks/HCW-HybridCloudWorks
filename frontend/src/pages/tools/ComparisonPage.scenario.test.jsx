/**
 * The scenario card on the pricing comparison page (#613, Phase 2). What must
 * hold: the default scenario prices on load, choosing another changes the
 * totals, an extra adds its own segment, a commitment lowers the total, the
 * whole state round-trips through the URL beside `?region=`, a provider with
 * no price for a used service is "unavailable" rather than cheapest, the
 * breakdown table lists every line, Copy link copies the URL (and shows it
 * when it cannot), and the pre-rendered form hydrates without a mismatch.
 *
 * The prices are the round fixture of lib/pricingScenarios.test.js, so the
 * figures asserted here are the same hand-computed ones: three-tier is $711
 * on AWS, $701 on Azure and $684 on Google Cloud.
 */
import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, StaticRouter, useSearchParams } from 'react-router';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';

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

const row = (provider, pricePerUnit, source = 'live') => ({
  provider,
  sku: `${provider}-sku`,
  pricePerUnit,
  unit: 'x',
  currency: 'USD',
  providerRegion: `${provider}-region`,
  updatedAt: '2026-09-14T06:00:00.000Z',
  source,
});

const service = (serviceId, label, unit, rows) => ({ serviceId, label, unit, sku: 'shape', rows });

const PAYLOAD = {
  success: true,
  pricing: {
    region: 'us-east-1',
    regions: [
      { id: 'us-east-1', label: 'US East' },
      { id: 'westeurope', label: 'Western Europe' },
    ],
    refreshedAt: '2026-09-14T06:00:00.000Z',
    ttlMinutes: 1440,
    ageMinutes: 95,
    stale: false,
    counts: { live: 22, baseline: 1, unavailable: 1 },
    services: [
      service('compute-vm', 'Virtual machine', 'hour', [
        row('aws', 0.2),
        row('azure', 0.25),
        row('gcp', 0.15),
      ]),
      service('compute-serverless', 'Serverless', 'normalized request workload', [
        row('aws', 3),
        row('azure', 3),
        row('gcp', 2),
      ]),
      service('storage-object', 'Object storage', 'GB-month', [
        row('aws', 0.02),
        row('azure', 0.02, 'baseline'),
        row('gcp', 0.01),
      ]),
      service('database-relational', 'Relational database', 'hour', [
        row('aws', 0.5),
        row('azure', 0.4),
        row('gcp', 0.6),
      ]),
      // No GCP row: NoSQL is unavailable there.
      service('database-nosql', 'NoSQL database', 'million operations', [
        row('aws', 1),
        row('azure', 1),
      ]),
      service('containers-kubernetes', 'Kubernetes', 'hour', [
        row('aws', 0.4),
        row('azure', 0.4),
        row('gcp', 0.4),
      ]),
      service('integration-messaging', 'Messaging', 'million operations', [
        row('aws', 0.8),
        row('azure', 0.9),
        row('gcp', 0.7),
      ]),
      service('edge-cdn', 'CDN egress', 'GB egress', [
        row('aws', 0.1),
        row('azure', 0.08),
        row('gcp', 0.05),
      ]),
    ],
  },
};

/** The Phase 3 price-changes card fetches too; it is not under test here. */
const NO_HISTORY = {
  success: true,
  changes: { region: 'us-east-1', asOf: null, windows: {}, sampleDays: 0 },
};
const isPricingUrl = (url) => String(url).includes('cloud-tools/pricing?');
const answerPricing = (response) =>
  fetchMock.mockImplementation(async (url) =>
    isPricingUrl(url) ? response : jsonResponse(NO_HISTORY)
  );
const pricingCalls = () => fetchMock.mock.calls.filter((call) => isPricingUrl(call[0]));

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
const totalText = (id) => providerRow(id).querySelector('.text-lg').textContent;
const awaitResults = () =>
  waitFor(() => expect(screen.getByTestId('scenario-results')).toBeTruthy());

/** The extras menu's inputs, by their visible label. */
const extraInput = (label) =>
  within(screen.getByTestId('extras-summary').parentElement).getByLabelText(label);

beforeEach(() => {
  clearPublicGetCache();
  fetchMock.mockReset();
  answerPricing(jsonResponse(PAYLOAD));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  clearPublicGetCache();
  vi.unstubAllGlobals();
});

describe('the scenario card', () => {
  it('prices the default scenario on load, cheapest marked and the others measured against it', async () => {
    renderPage();
    await awaitResults();
    expect(screen.getByLabelText('Scenario').value).toBe('three-tier-web');
    expect(totalText('aws')).toBe('$711.00');
    expect(totalText('azure')).toBe('$701.00');
    expect(totalText('gcp')).toBe('$684.00');
    expect(providerRow('gcp').dataset.cheapest).toBe('true');
    expect(providerRow('aws').dataset.cheapest).toBeUndefined();
    expect(providerRow('aws').querySelector('[data-delta]').textContent).toBe('+4% vs cheapest');
    expect(providerRow('gcp').querySelector('[data-delta]')).toBeNull();
    // Yearly beside monthly, and the bar reads itself out.
    expect(providerRow('aws').textContent).toContain('$8,532.00 / year');
    const bar = within(providerRow('aws')).getByRole('img');
    expect(bar.getAttribute('aria-label')).toBe(
      'AWS: $711.00 a month, $8,532.00 a year; base $711.00.'
    );
    // Azure's storage is a catalogue figure, so its total says so.
    expect(within(providerRow('azure')).getByText('catalogue price')).toBeTruthy();
    expect(within(providerRow('aws')).queryByText('catalogue price')).toBeNull();
    // The Phase 1 table is still there beneath, with the same rows.
    expect(document.querySelector('tr[data-service="compute-vm"]')).toBeTruthy();
  });

  it('choosing another scenario changes the totals and the URL, and drops overrides', async () => {
    renderPage('/tools/comparison?q.compute-vm=2190');
    await awaitResults();
    // 711 + 730 × 0.2
    expect(totalText('aws')).toBe('$857.00');
    fireEvent.change(screen.getByLabelText('Scenario'), {
      target: { value: 'kubernetes-platform' },
    });
    expect(search()).toBe('scenario=kubernetes-platform');
    // AWS: 730×0.4 + 730×0.5 + 500×0.02 + 10×0.8 + 1000×0.1 = 292 + 365 + 10 + 8 + 100
    await waitFor(() => expect(totalText('aws')).toBe('$775.00'));
    expect(screen.getByText(/A managed cluster with its baseline nodes/)).toBeTruthy();
  });

  it('adding a DR level adds its own segment, one level at a time', async () => {
    renderPage();
    await awaitResults();
    fireEvent.click(extraInput('DR: pilot light'));
    expect(search()).toBe('extras=dr-pilot-light');
    await waitFor(() =>
      expect(providerRow('aws').querySelector('[data-segment="dr-pilot-light"]')).toBeTruthy()
    );
    // 711 + (4 + 2 + 365)
    expect(totalText('aws')).toBe('$1,082.00');
    expect(
      within(screen.getByRole('list', { name: 'Legend' })).getByText('DR: pilot light')
    ).toBeTruthy();

    fireEvent.click(extraInput('DR: active-active'));
    expect(search()).toBe('extras=dr-active-active');
    await waitFor(() =>
      expect(providerRow('aws').querySelector('[data-segment="dr-active-active"]')).toBeTruthy()
    );
    expect(providerRow('aws').querySelector('[data-segment="dr-pilot-light"]')).toBeNull();
    expect(extraInput('DR: pilot light').checked).toBe(false);
    expect(extraInput('DR: active-active').checked).toBe(true);
    // Backup is independent of the DR level.
    fireEvent.click(extraInput('Backup'));
    expect(search()).toBe('extras=backup%2Cdr-active-active');
  });

  it('a commitment lowers the total and is drawn as a reduction', async () => {
    renderPage();
    await awaitResults();
    fireEvent.click(extraInput('1-year commitment'));
    expect(search()).toBe('extras=commit-1y');
    // 711 − 0.28 × (292 + 365)
    await waitFor(() => expect(totalText('aws')).toBe('$527.04'));
    const reduction = providerRow('aws').querySelector('[data-segment="commit-1y"]');
    expect(reduction.className).toContain('border-dashed');
    expect(within(providerRow('aws')).getByRole('img').getAttribute('aria-label')).toContain(
      '1-year commitment −$183.96'
    );
    expect(screen.getByText('1-year commitment (reduction)')).toBeTruthy();
    // With three years Azure overtakes Google Cloud.
    fireEvent.click(extraInput('3-year commitment'));
    await waitFor(() => expect(providerRow('azure').dataset.cheapest).toBe('true'));
    expect(providerRow('gcp').dataset.cheapest).toBeUndefined();
  });

  it('the egress select rewrites the CDN quantity, with a custom value kept as an option', async () => {
    renderPage('/tools/comparison?egress=750');
    await awaitResults();
    const egress = screen.getByLabelText('Egress');
    expect(egress.value).toBe('750');
    expect(egress.options[0].textContent).toBe('750 GB (custom)');
    fireEvent.change(egress, { target: { value: '5000' } });
    expect(search()).toBe('egress=5000');
    // 711 − 50 + 500
    await waitFor(() => expect(totalText('aws')).toBe('$1,161.00'));
    expect(screen.getByLabelText('CDN egress').value).toBe('5000');
  });

  it('a quantity edit commits finite numbers, offers Reset, and keeps the region', async () => {
    renderPage('/tools/comparison?region=westeurope');
    await awaitResults();
    const vm = screen.getByLabelText('Virtual machine');
    expect(vm.value).toBe('1460');
    expect(screen.getByText('2 instances × 730 h')).toBeTruthy();
    fireEvent.change(vm, { target: { value: '' } });
    expect(search()).toBe('region=westeurope');
    fireEvent.change(vm, { target: { value: '2190' } });
    expect(search()).toBe('region=westeurope&q.compute-vm=2190');
    await waitFor(() => expect(totalText('aws')).toBe('$857.00'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset Virtual machine to 1,460' }));
    expect(search()).toBe('region=westeurope');
    await waitFor(() => expect(totalText('aws')).toBe('$711.00'));
    expect(screen.getByLabelText('Virtual machine').value).toBe('1460');
    // Only the one region fetch: scenario changes never refetch.
    expect(pricingCalls()).toHaveLength(1);
  });

  it('reads the whole scenario from the URL and writes it back the same way', async () => {
    renderPage(
      '/tools/comparison?scenario=data-platform&extras=backup,dr-warm-standby,commit-3y&egress=5000&q.compute-vm=3650&region=westeurope'
    );
    await awaitResults();
    expect(screen.getByLabelText('Scenario').value).toBe('data-platform');
    expect(extraInput('Backup').checked).toBe(true);
    expect(extraInput('DR: warm standby').checked).toBe(true);
    expect(extraInput('3-year commitment').checked).toBe(true);
    expect(extraInput('Zone redundancy').checked).toBe(false);
    expect(screen.getByLabelText('Egress').value).toBe('5000');
    expect(screen.getByLabelText('Virtual machine').value).toBe('3650');
    expect(screen.getByLabelText('Region').value).toBe('westeurope');
    // A change re-encodes everything, unknown keys gone, region kept.
    fireEvent.click(extraInput('Zone redundancy'));
    expect(search()).toBe(
      'region=westeurope&scenario=data-platform&extras=backup%2Cdr-warm-standby%2Czone-redundancy%2Ccommit-3y&q.compute-vm=3650&egress=5000'
    );
    expect(document.querySelector('[data-rule="backup"]').dataset.selected).toBe('true');
    expect(document.querySelector('[data-rule="dr-pilot-light"]').dataset.selected).toBeUndefined();
  });

  it('ignores an unknown scenario and bad numbers in the URL', async () => {
    renderPage('/tools/comparison?scenario=mainframe&extras=teleport&egress=lots&q.compute-vm=-1');
    await awaitResults();
    expect(screen.getByLabelText('Scenario').value).toBe('three-tier-web');
    expect(totalText('aws')).toBe('$711.00');
    expect(screen.getByLabelText('Egress').value).toBe('500');
  });

  it('shows a provider with no price for a used service as unavailable, never as cheapest', async () => {
    renderPage('/tools/comparison?scenario=static-site-api');
    await awaitResults();
    const gcp = providerRow('gcp');
    expect(gcp.dataset.total).toBe('unavailable');
    expect(gcp.textContent).toContain('unavailable: NoSQL database');
    expect(gcp.querySelector('.text-lg')).toBeNull();
    expect(within(gcp).queryByRole('img')).toBeNull();
    expect(gcp.dataset.cheapest).toBeUndefined();
    // AWS 76, Azure 66: Azure is cheapest of the two that have a price.
    expect(providerRow('azure').dataset.cheapest).toBe('true');
    expect(totalText('aws')).toBe('$76.00');
  });

  it('shows the breakdown table with every line, factor and unit price on request', async () => {
    renderPage('/tools/comparison?extras=backup,commit-1y');
    await awaitResults();
    const toggle = screen.getByRole('button', { name: 'Show breakdown' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(toggle.getAttribute('aria-controls'))).toBeNull();
    fireEvent.click(toggle);
    expect(
      screen.getByRole('button', { name: 'Hide breakdown' }).getAttribute('aria-expanded')
    ).toBe('true');
    const aws = document.querySelector('tbody[data-breakdown="aws"]');
    const lines = Array.from(aws.querySelectorAll('tr[data-line]')).map((tr) =>
      Array.from(tr.cells).map((td) => td.textContent.trim())
    );
    expect(lines).toEqual([
      ['Base', 'Virtual machine', '1,460 h', '$0.2', '$292.00'],
      ['Base', 'Object storage', '200 GB', '$0.02', '$4.00'],
      ['Base', 'Relational database', '730 h', '$0.5', '$365.00'],
      ['Base', 'CDN egress', '500 GB', '$0.1', '$50.00'],
      [
        'Backup',
        'Snapshot copies of 200 GB of object storage + 20 GB (20% of a 100 GB database), 30-day retention, at 60% of the hot rate',
        '220 GB × 0.6',
        '$0.02',
        '$2.64',
      ],
      [
        '1-year commitment',
        'Virtual machine: 28% off for the term',
        '1,460 h × -0.28',
        '$0.2',
        '−$81.76',
      ],
      [
        '1-year commitment',
        'Relational database: 28% off for the term',
        '730 h × -0.28',
        '$0.5',
        '−$102.20',
      ],
    ]);
    expect(aws.textContent).toContain('$529.68');
    // Azure's storage line says it is a catalogue figure.
    const azure = document.querySelector('tbody[data-breakdown="azure"]');
    expect(azure.querySelector('tr[data-line="azure:storage-object"]').textContent).toContain(
      '(catalogue)'
    );
  });

  it('explains the maths: every extra’s rule and the assumptions table with sources', async () => {
    renderPage();
    const assumptions = screen.getByTestId('assumptions');
    expect(within(assumptions).getByText('How this is calculated')).toBeTruthy();
    expect(assumptions.querySelectorAll('[data-rule]')).toHaveLength(7);
    const commit = assumptions.querySelector('tr[data-assumption="commit-1y"]');
    expect(
      Array.from(commit.cells)
        .map((c) => c.textContent.trim())
        .slice(0, 4)
    ).toEqual([
      '1-year commitment: discount on compute, Kubernetes and the database',
      '28%',
      '35%',
      '37%',
    ]);
    const link = within(commit).getByText('AWS Savings Plans pricing');
    expect(link.getAttribute('href')).toBe('https://aws.amazon.com/savingsplans/pricing/');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(
      assumptions.querySelector('tr[data-assumption="zone-storage-uplift"]').textContent
    ).toContain('×0.25');
  });
});

describe('Copy link', () => {
  it('copies the page URL with the scenario in it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderPage('/tools/comparison?extras=backup&region=westeurope');
    await awaitResults();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy());
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toBe(
      `${window.location.origin}/tools/comparison?extras=backup&region=westeurope`
    );
    expect(screen.queryByText('Copy this link by hand:')).toBeNull();
  });

  it('shows the link to copy by hand when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    renderPage('/tools/comparison?scenario=event-driven');
    await awaitResults();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    const field = await screen.findByLabelText('Copy this link by hand:');
    expect(field.value).toBe(`${window.location.origin}/tools/comparison?scenario=event-driven`);
    expect(screen.getByRole('button', { name: 'Copy link' }).dataset.copyState).toBe('failed');
  });
});

describe('without prices', () => {
  it('renders the controls at their defaults and a loading line — the pre-rendered form', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByLabelText('Scenario').value).toBe('three-tier-web');
    expect(screen.getByLabelText('Egress').value).toBe('500');
    expect(screen.getByLabelText('Virtual machine').value).toBe('1460');
    expect(screen.getByTestId('scenario-status').textContent).toBe(
      'Loading prices for this scenario…'
    );
    expect(screen.queryByTestId('scenario-results')).toBeNull();
    expect(screen.getByTestId('assumptions')).toBeTruthy();
  });

  it('hydrates the server-rendered markup without a mismatch', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const html = renderToString(
      <StaticRouter location="/tools/comparison">
        <ComparisonPage />
      </StaticRouter>
    );
    expect(html).toContain('Loading prices for this scenario…');
    expect(html).toContain('Price a scenario');
    // Phase 3: the price-changes card is on the static page at its loading state.
    expect(html).toContain('Price changes');
    expect(html).toContain('Loading price changes…');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root;
    try {
      await act(async () => {
        root = hydrateRoot(
          container,
          <MemoryRouter initialEntries={['/tools/comparison']}>
            <ComparisonPage />
          </MemoryRouter>
        );
      });
      const complaints = errors.mock.calls.map((call) => String(call[0]));
      expect(complaints.filter((m) => /hydrat|did not match|server/i.test(m))).toEqual([]);
    } finally {
      errors.mockRestore();
      await act(async () => root?.unmount());
      container.remove();
    }
  });

  it('says there is nothing to price after a failure, and the controls stay usable', async () => {
    answerPricing(jsonResponse({ success: false, error: 'Unknown region: mars-1' }, 400));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderPage('/tools/comparison?region=mars-1');
      await screen.findByText(/Prices could not be loaded:/);
      expect(screen.getByTestId('scenario-status').textContent).toBe(
        'No prices to build the scenario from until they load.'
      );
      fireEvent.change(screen.getByLabelText('Scenario'), { target: { value: 'event-driven' } });
      expect(search()).toBe('region=mars-1&scenario=event-driven');
    } finally {
      quiet.mockRestore();
    }
  });
});
