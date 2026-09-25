/**
 * A `landing-zone` fence in an article (#670, Phase 4 of #657). What must
 * hold: the fence body decodes to the build the tool would show and the
 * link carries the same build back; the fence renders the read-only card —
 * diagram without buttons, one line per selected component, the link — and
 * every other fence is still a code block; a garbled body falls back rather
 * than throwing; nothing is fetched; the map in CodeBlock dispatches this
 * fence and the pricing one; and a post with the fence pre-renders through
 * `renderToString` and hydrates without a mismatch, as the build's
 * pre-render step needs.
 */
import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { EMBED_COMPONENTS, markdownCodeComponents } from '@/components/shared/CodeBlock';
import { LANDING_ZONE_LANGUAGE, loadLandingZoneCard } from './LandingZoneEmbed';
import { landingZoneHref, parseEmbedQuery, summarize } from './LandingZoneCard';
import { PRICING_SCENARIO_LANGUAGE } from './PricingScenarioEmbed';
import { DEFAULT_STATE, decodeLz, layoutDiagram } from '@/lib/landingZone';

vi.mock('@/lib/functionsBase', () => ({
  requireFunctionsBase: () => 'https://api.test/api',
}));

const fetchMock = vi.fn();

const QUERY = 'lz=mg,policy,mgmt,hub,fw&corp=2';
const FENCE = `\`\`\`landing-zone\n${QUERY}\n\`\`\``;
const ARTICLE = `## The platform\n\nSome prose first.\n\n${FENCE}\n\nAnd a real code block:\n\n\`\`\`bash\necho hello\n\`\`\`\n`;

function Article({ text }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownCodeComponents}>
      {text}
    </ReactMarkdown>
  );
}

const card = () => screen.getByTestId('landing-zone-card');
const nodeIds = (root) =>
  Array.from(root.querySelectorAll('[data-node]')).map((g) => g.dataset.node);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockReturnValue(new Promise(() => {}));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('parseEmbedQuery, landingZoneHref and summarize', () => {
  it('reads the build from the fence body and links the same build in the tool', () => {
    // `online=` is absent, so it is the default: one online landing zone.
    const state = parseEmbedQuery(`\n ${QUERY} \n`);
    expect(state.selected).toEqual([
      'management-groups',
      'policy',
      'management',
      'connectivity-hub',
      'firewall',
      'corp',
      'online',
    ]);
    expect(state.options.corpCount).toBe(2);
    expect(state.options.onlineCount).toBe(1);
    expect(state).toEqual(decodeLz(new URLSearchParams(QUERY)));
    expect(landingZoneHref(state)).toBe(
      '/tools/landing-zone?lz=mg%2Cpolicy%2Cmgmt%2Chub%2Cfw&corp=2'
    );
    expect(summarize(state)).toBe(
      'Region centralus · Hub 10.0.0.0/16 · Private DNS zones · Firewall Standard · Spokes from 10.1.0.0/16'
    );
  });

  it('tolerates a leading question mark, junk, an empty body and null', () => {
    expect(parseEmbedQuery(`?${QUERY}`)).toEqual(parseEmbedQuery(QUERY));

    // An unknown token is dropped, the firewall brings its hub, a count that
    // is not a number is its default, and a knob that fails its check is too.
    const junk = parseEmbedQuery('lz=teleport,fw&corp=lots&hub.cidr=nope&loc=Mars&fw.sku=Gold');
    expect(junk.selected).toEqual([
      'management-groups',
      'connectivity-hub',
      'firewall',
      'corp',
      'online',
    ]);
    expect(junk.options).toMatchObject({
      hubCidr: '10.0.0.0/16',
      location: 'centralus',
      firewallSku: 'Standard',
      corpCount: 1,
      onlineCount: 1,
    });

    expect(parseEmbedQuery('')).toEqual(DEFAULT_STATE);
    expect(parseEmbedQuery(null)).toEqual(DEFAULT_STATE);
    expect(landingZoneHref(parseEmbedQuery(''))).toBe('/tools/landing-zone');

    const bare = parseEmbedQuery('lz=mg,mgmt&corp=0&online=0&root=contoso');
    expect(summarize(bare)).toBe('Region centralus · under contoso');
  });
});

describe('the landing-zone fence', () => {
  it('renders the read-only card with the diagram, the components and a link to the tool', async () => {
    const { container } = render(<Article text={ARTICLE} />);
    expect(screen.getByRole('heading', { name: 'The platform' })).toBeTruthy();
    expect(container.textContent).toContain('echo hello');
    expect(screen.getByText('bash')).toBeTruthy();

    await waitFor(() => expect(screen.queryByTestId('landing-zone-card')).toBeTruthy());
    expect(within(card()).getByRole('heading').textContent).toBe('Landing zone: 7 of 8 components');
    expect(screen.getByTestId('landing-zone-summary').textContent).toBe(
      'Region centralus · Hub 10.0.0.0/16 · Private DNS zones · Firewall Standard · Spokes from 10.1.0.0/16'
    );

    // The diagram is the page's own layout, drawn without buttons.
    const state = parseEmbedQuery(QUERY);
    const svg = within(card()).getByTestId('lz-diagram');
    expect(svg.dataset.interactive).toBe('false');
    expect(nodeIds(svg)).toEqual(layoutDiagram(state).nodes.map((n) => n.id));
    expect(nodeIds(svg).filter((id) => id.startsWith('spoke:corp'))).toHaveLength(2);
    expect(svg.querySelectorAll('[role="button"]')).toHaveLength(0);
    expect(svg.querySelectorAll('[tabindex]')).toHaveLength(0);
    const titleId = svg.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    expect(svg.querySelector(`title[id="${titleId}"]`).textContent).toMatch(
      /^Landing zone diagram: /
    );

    // One line per selected component, in catalogue order, with the count.
    const items = Array.from(screen.getByTestId('landing-zone-components').children);
    expect(items.map((li) => li.dataset.component)).toEqual(state.selected);
    const corp = items.find((li) => li.dataset.component === 'corp');
    expect(corp.textContent).toContain('Corp landing zone × 2');
    expect(corp.textContent).toContain('An application subscription for internal workloads');
    const online = items.find((li) => li.dataset.component === 'online');
    expect(online.textContent).toContain('Online landing zone — ');
    expect(online.textContent).not.toContain('×');

    // Read-only: none of the page's controls, and the answer button is not here.
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByTestId('lz-explain-button')).toBeNull();
    expect(screen.queryByLabelText('Zoom in')).toBeNull();

    const link = screen.getByRole('link', { name: /Open in the Landing Zone Builder/ });
    expect(link.getAttribute('href')).toBe(
      '/tools/landing-zone?lz=mg%2Cpolicy%2Cmgmt%2Chub%2Cfw&corp=2'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('draws nothing for an empty build and says so', async () => {
    render(<Article text={'```landing-zone\nlz=&corp=0&online=0\n```'} />);
    await waitFor(() => expect(screen.queryByTestId('landing-zone-card')).toBeTruthy());
    expect(within(card()).getByRole('heading').textContent).toBe('Landing zone: nothing selected');
    expect(screen.getByTestId('landing-zone-empty')).toBeTruthy();
    expect(screen.queryByTestId('lz-diagram')).toBeNull();
    expect(screen.queryByTestId('landing-zone-components')).toBeNull();
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      '/tools/landing-zone?lz=&corp=0&online=0'
    );
  });

  it('leaves every other fence, and inline code, as it was', () => {
    const { container } = render(
      <Article
        text={
          'Use `npm test`.\n\n```js\nconst x = 1;\n```\n\n```\nplain\n```\n\n```constructor\nnot an embed\n```'
        }
      />
    );
    expect(screen.queryByTestId('landing-zone-embed')).toBeNull();
    expect(screen.queryByTestId('pricing-scenario-embed')).toBeNull();
    expect(screen.getByText('npm test').tagName).toBe('CODE');
    expect(screen.getByText('js')).toBeTruthy();
    expect(container.textContent).toContain('plain');
    expect(screen.getByText('constructor')).toBeTruthy();
    expect(container.textContent).toContain('not an embed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is one entry in the map beside the pricing fence, and both dispatch', async () => {
    expect(Object.keys(EMBED_COMPONENTS).sort()).toEqual(
      [PRICING_SCENARIO_LANGUAGE, LANDING_ZONE_LANGUAGE].sort()
    );
    expect(LANDING_ZONE_LANGUAGE).toBe('landing-zone');
    for (const Component of Object.values(EMBED_COMPONENTS)) {
      expect(typeof Component).toBe('function');
    }

    render(
      <Article
        text={`${FENCE}\n\n\`\`\`pricing-scenario\nscenario=three-tier-web&region=us-east-1\n\`\`\``}
      />
    );
    expect(screen.getByTestId('landing-zone-embed')).toBeTruthy();
    expect(screen.getByTestId('pricing-scenario-embed')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('landing-zone-card')).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId('pricing-scenario-card')).toBeTruthy());
  });

  it('pre-renders the whole card and hydrates without a mismatch', async () => {
    // The build's pre-render (`prerenderToNodeStream`) waits for the lazy
    // chunk before it writes the page; renderToString does not wait, so
    // resolve the lazy component first by rendering it once, which is what
    // that wait amounts to.
    expect(typeof (await loadLandingZoneCard()).default).toBe('function');
    const warmup = render(<Article text={ARTICLE} />);
    await waitFor(() => expect(screen.queryByTestId('landing-zone-card')).toBeTruthy());
    warmup.unmount();

    const html = renderToString(<Article text={ARTICLE} />);
    expect(renderToString(<Article text={ARTICLE} />)).toBe(html);
    const container = document.createElement('div');
    container.innerHTML = html;
    const text = container.textContent;
    expect(text).toContain('Landing zone: 7 of 8 components');
    expect(text).toContain('Open in the Landing Zone Builder');
    expect(text).not.toContain('Loading the landing zone…');
    expect(text).toContain('echo hello');
    expect(container.querySelector('[data-testid="landing-zone-card"]')).toBeTruthy();
    expect(nodeIds(container)).toEqual(
      layoutDiagram(parseEmbedQuery(QUERY)).nodes.map((n) => n.id)
    );

    document.body.appendChild(container);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root;
    try {
      await act(async () => {
        root = hydrateRoot(container, <Article text={ARTICLE} />);
      });
      const complaints = errors.mock.calls.map((call) => String(call[0]));
      expect(complaints.filter((m) => /hydrat|did not match|server/i.test(m))).toEqual([]);
      expect(container.querySelector('[data-testid="landing-zone-card"]')).toBeTruthy();
    } finally {
      errors.mockRestore();
      await act(async () => root?.unmount());
      container.remove();
    }
  });
});
