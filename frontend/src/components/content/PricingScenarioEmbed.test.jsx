/**
 * A `pricing-scenario` fence in an article (#613, Phase 3). What must hold:
 * the fence renders the read-only card with the scenario the body names and
 * a link to the same scenario in the tool; every other fence is still a code
 * block; a garbled body falls back rather than throwing; the chunk is not
 * loaded by a post that has no such fence; and a post that has one
 * pre-renders through `renderToString` and hydrates without a mismatch, as
 * the build's pre-render step needs.
 */
import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { markdownCodeComponents } from '@/components/shared/CodeBlock';
import { loadPricingScenarioCard } from './PricingScenarioEmbed';
import { comparisonHref, parseEmbedQuery } from './PricingScenarioCard';
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

const row = (provider, pricePerUnit) => ({ provider, pricePerUnit, source: 'live' });
const PAYLOAD = (region) => ({
  success: true,
  pricing: {
    region,
    regions: [
      { id: 'us-east-1', label: 'US East' },
      { id: 'westeurope', label: 'Western Europe' },
    ],
    refreshedAt: '2026-09-14T06:00:00.000Z',
    services: [
      { serviceId: 'compute-vm', rows: [row('aws', 0.2), row('azure', 0.25), row('gcp', 0.15)] },
      {
        serviceId: 'storage-object',
        rows: [row('aws', 0.02), row('azure', 0.02), row('gcp', 0.01)],
      },
      {
        serviceId: 'database-relational',
        rows: [row('aws', 0.5), row('azure', 0.4), row('gcp', 0.6)],
      },
      { serviceId: 'edge-cdn', rows: [row('aws', 0.1), row('azure', 0.08), row('gcp', 0.05)] },
    ],
  },
});

const FENCE =
  '```pricing-scenario\nscenario=three-tier-web&extras=backup,dr-warm-standby&egress=1000&region=us-east-1\n```';

const ARTICLE = `## The bill\n\nSome prose first.\n\n${FENCE}\n\nAnd a real code block:\n\n\`\`\`bash\necho hello\n\`\`\`\n`;

function Article({ text }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownCodeComponents}>
      {text}
    </ReactMarkdown>
  );
}

const card = () => screen.getByTestId('pricing-scenario-card');
const providerRow = (id) => document.querySelector(`[data-scenario-provider="${id}"]`);

beforeEach(() => {
  clearPublicGetCache();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url) =>
    jsonResponse(PAYLOAD(new URL(String(url)).searchParams.get('region')))
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  clearPublicGetCache();
  vi.unstubAllGlobals();
});

describe('parseEmbedQuery and comparisonHref', () => {
  it('reads the scenario, extras, quantities and region from the fence body', () => {
    const parsed = parseEmbedQuery(
      '\n scenario=data-platform&extras=backup,commit-3y&egress=5000&q.compute-vm=3650&region=westeurope \n'
    );
    expect(parsed).toEqual({
      state: {
        scenarioId: 'data-platform',
        extras: ['backup', 'commit-3y'],
        quantities: { 'compute-vm': 3650, 'edge-cdn': 5000 },
      },
      region: 'westeurope',
    });
    expect(comparisonHref(parsed)).toBe(
      '/tools/comparison?region=westeurope&scenario=data-platform&extras=backup%2Ccommit-3y&q.compute-vm=3650&egress=5000'
    );
  });

  it('falls back for anything it cannot read, and never sets compare', () => {
    expect(
      parseEmbedQuery('scenario=mainframe&extras=teleport&region=Mars&compare=westeurope')
    ).toEqual({
      state: { scenarioId: 'three-tier-web', extras: [], quantities: {} },
      region: 'us-east-1',
    });
    expect(comparisonHref(parseEmbedQuery(''))).toBe('/tools/comparison');
    expect(comparisonHref(parseEmbedQuery(null))).toBe('/tools/comparison');
  });
});

describe('the pricing-scenario fence', () => {
  it('renders the read-only card with the results and a link to the tool', async () => {
    const { container } = render(<Article text={ARTICLE} />);
    // The heading and the ordinary code block are untouched.
    expect(screen.getByRole('heading', { name: 'The bill' })).toBeTruthy();
    expect(container.textContent).toContain('echo hello');
    expect(screen.getByText('bash')).toBeTruthy();

    await waitFor(() => expect(screen.queryByTestId('pricing-scenario-card')).toBeTruthy());
    expect(within(card()).getByRole('heading').textContent).toBe(
      'Price a scenario: Three-tier web app'
    );
    await waitFor(() => expect(providerRow('aws')).toBeTruthy());
    // 711 − 50 + 100 = 761 base; backup 2.64; warm standby 371 + 146 + (1,000 − 500 = the egress
    // line is on the base only) → 517: AWS 1,280.64.
    expect(providerRow('aws').querySelector('.text-lg').textContent).toBe('$1,280.64');
    expect(providerRow('aws').querySelector('[data-segment="dr-warm-standby"]')).toBeTruthy();
    expect(screen.getByTestId('pricing-scenario-summary').textContent).toBe(
      'Extras: Backup, DR: warm standby · Egress 1,000 GB / month · Region: US East'
    );
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('region')).toBe(
      'us-east-1'
    );

    // Read-only: none of the page's controls.
    expect(screen.queryByLabelText('Scenario')).toBeNull();
    expect(screen.queryByLabelText('Egress')).toBeNull();
    expect(screen.queryByTestId('extras-summary')).toBeNull();
    expect(screen.queryByTestId('explain-button')).toBeNull();
    expect(screen.queryByLabelText('Compare with')).toBeNull();
    // The breakdown is still there to open.
    expect(screen.getByRole('button', { name: 'Show breakdown' })).toBeTruthy();

    const link = screen.getByRole('link', { name: /Open in the comparison tool/ });
    expect(link.getAttribute('href')).toBe(
      '/tools/comparison?extras=backup%2Cdr-warm-standby&egress=1000'
    );
  });

  it('leaves every other fence, and inline code, as it was', () => {
    const { container } = render(
      <Article text={'Use `npm test`.\n\n```js\nconst x = 1;\n```\n\n```\nplain\n```'} />
    );
    expect(screen.queryByTestId('pricing-scenario-embed')).toBeNull();
    expect(screen.getByText('npm test').tagName).toBe('CODE');
    expect(screen.getByText('js')).toBeTruthy();
    expect(container.textContent).toContain('plain');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pre-renders with the card at its loading state and hydrates without a mismatch', async () => {
    // The build's pre-render (`prerenderToNodeStream`) waits for the lazy
    // chunk before it writes the page; renderToString does not wait, so
    // resolve the lazy component first by rendering it once — which is what
    // that wait amounts to — with a fetch that never answers, so the card
    // is at the loading state the static page carries.
    fetchMock.mockReturnValue(new Promise(() => {}));
    expect(typeof (await loadPricingScenarioCard()).default).toBe('function');
    const warmup = render(<Article text={ARTICLE} />);
    await waitFor(() => expect(screen.queryByTestId('pricing-scenario-card')).toBeTruthy());
    warmup.unmount();

    const html = renderToString(<Article text={ARTICLE} />);
    const container = document.createElement('div');
    container.innerHTML = html;
    // The words on the static page, read back through the DOM so React's
    // text-boundary comments and the highlighter's spans do not split them.
    const text = container.textContent;
    expect(text).toContain('Price a scenario: Three-tier web app');
    expect(text).toContain('Loading prices for this scenario…');
    expect(text).toContain('Open in the comparison tool');
    expect(text).not.toContain('Loading the scenario…');
    expect(text).toContain('echo hello');
    expect(container.querySelector('[data-testid="pricing-scenario-card"]')).toBeTruthy();

    document.body.appendChild(container);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root;
    try {
      await act(async () => {
        root = hydrateRoot(container, <Article text={ARTICLE} />);
      });
      const complaints = errors.mock.calls.map((call) => String(call[0]));
      expect(complaints.filter((m) => /hydrat|did not match|server/i.test(m))).toEqual([]);
      expect(container.querySelector('[data-testid="pricing-scenario-card"]')).toBeTruthy();
    } finally {
      errors.mockRestore();
      await act(async () => root?.unmount());
      container.remove();
    }
  });
});
