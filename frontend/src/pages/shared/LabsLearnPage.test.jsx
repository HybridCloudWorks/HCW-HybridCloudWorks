/**
 * `/education/labs` (#681): the cards come from the catalogue and nothing
 * else, every deep link carries its own lab id, the two "Run it locally"
 * lines are exactly the two from #658, and the two status cards say the two
 * explicit unprovisioned sentences when both routes answer
 * `{ configured: false }` — and render full data when they answer with it.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CODER_ORIGIN, RUN_LOCALLY_COMMANDS, labs } from '@/data/labs/catalogue';
import { NOT_PROVISIONED_SENTENCE } from '@/components/labs/LabsEstateCard';
import { CODER_NOT_PROVISIONED_SENTENCE } from '@/components/labs/CoderStatusCard';

const fetchLabsEstate = vi.fn();
const fetchCoderStatus = vi.fn();
vi.mock('@/lib/publicApi', () => ({
  fetchLabsEstate: () => fetchLabsEstate(),
  fetchCoderStatus: () => fetchCoderStatus(),
}));

import LabsLearnPage from './LabsLearnPage';

const NOW = Date.parse('2026-09-25T12:00:00Z');

const ESTATE = {
  configured: true,
  arc: {
    status: 'Connected',
    lastHeartbeatAt: new Date(NOW - 4 * 60_000).toISOString(),
    agentVersion: '1.52.02988.2222',
    osName: 'Ubuntu 24.04.3 LTS',
  },
  policy: { compliant: 12, nonCompliant: 1 },
  agent: { online: true, queued: 0 },
  coder: { reachable: true, running: 1, max: 5 },
  // The heartbeat age is measured from this, so "4 minutes ago" is exact.
  asOf: new Date(NOW).toISOString(),
};

const CODER = {
  configured: true,
  reachable: true,
  templates: [{ name: 'hcw-lab', activeVersion: 'v0.3.1' }],
  capacity: { running: 1, max: 5 },
  asOf: new Date(NOW - 20_000).toISOString(),
};

function renderPage() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/education/labs']}>
        <LabsLearnPage />
      </MemoryRouter>
    </HelmetProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(NOW));
  fetchLabsEstate.mockReset();
  fetchCoderStatus.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LabsLearnPage', () => {
  it('says both are unprovisioned when both routes answer configured: false', async () => {
    fetchLabsEstate.mockResolvedValue({ configured: false });
    fetchCoderStatus.mockResolvedValue({ configured: false });
    renderPage();

    expect(await screen.findByText(NOT_PROVISIONED_SENTENCE)).toBeInTheDocument();
    expect(await screen.findByText(CODER_NOT_PROVISIONED_SENTENCE)).toBeInTheDocument();
    expect(screen.queryByTestId('estate-facts')).not.toBeInTheDocument();
    expect(screen.queryByTestId('coder-templates')).not.toBeInTheDocument();
    expect(fetchLabsEstate).toHaveBeenCalledTimes(1);
    expect(fetchCoderStatus).toHaveBeenCalledTimes(1);
  });

  it('renders full data from both routes', async () => {
    fetchLabsEstate.mockResolvedValue(ESTATE);
    fetchCoderStatus.mockResolvedValue(CODER);
    renderPage();

    expect(await screen.findByTestId('estate-facts')).toBeInTheDocument();
    expect(screen.getByTestId('estate-arc-status')).toHaveTextContent('connected');
    expect(screen.getByTestId('estate-heartbeat')).toHaveTextContent('4 minutes ago');
    expect(screen.getByTestId('estate-coder')).toHaveTextContent('1 of 5 workspaces running');

    expect(await screen.findByTestId('coder-templates')).toBeInTheDocument();
    expect(screen.getByTestId('coder-status')).toHaveTextContent('1 of 5 workspaces running');
    expect(within(screen.getByTestId('coder-templates')).getByText('hcw-lab')).toBeInTheDocument();
  });

  it('renders one card per catalogue row, in catalogue order, with its facts', async () => {
    fetchLabsEstate.mockResolvedValue({ configured: false });
    fetchCoderStatus.mockResolvedValue({ configured: false });
    const { container } = renderPage();

    const cards = [...container.querySelectorAll('li[data-lab]')];
    expect(cards.map((card) => card.dataset.lab)).toEqual(labs.map((lab) => lab.id));

    for (const lab of labs) {
      const card = container.querySelector(`li[data-lab="${lab.id}"]`);
      expect(within(card).getByRole('heading', { level: 3 })).toHaveTextContent(lab.title);
      expect(within(card).getByText(lab.summary)).toBeInTheDocument();
      expect(within(card).getByText(lab.tools.join(', '))).toBeInTheDocument();
      expect(within(card).getByTestId('lab-minutes')).toHaveTextContent(
        `about ${lab.estimatedMinutes} minutes`
      );
    }
    await screen.findByText(NOT_PROVISIONED_SENTENCE);
  });

  it('deep-links each card to Coder with its own param.lab', async () => {
    fetchLabsEstate.mockResolvedValue({ configured: false });
    fetchCoderStatus.mockResolvedValue({ configured: false });
    const { container } = renderPage();

    for (const lab of labs) {
      const card = container.querySelector(`li[data-lab="${lab.id}"]`);
      const link = within(card).getByRole('link', { name: /open in coder/i });
      expect(link).toHaveAttribute(
        'href',
        `${CODER_ORIGIN}/templates/hcw-lab/workspace?mode=auto&param.lab=${lab.id}`
      );
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toMatch(/noopener/);
    }
    await screen.findByText(NOT_PROVISIONED_SENTENCE);
  });

  it('prints the two Run it locally lines on every card, PowerShell then bash', async () => {
    fetchLabsEstate.mockResolvedValue({ configured: false });
    fetchCoderStatus.mockResolvedValue({ configured: false });
    const { container } = renderPage();

    for (const lab of labs) {
      const card = container.querySelector(`li[data-lab="${lab.id}"]`);
      expect(within(card).getByText('Run it locally')).toBeInTheDocument();
      const lines = [...card.querySelectorAll('pre code')];
      expect(lines.map((line) => line.dataset.shell)).toEqual(['PowerShell', 'bash']);
      expect(lines.map((line) => line.textContent)).toEqual(
        RUN_LOCALLY_COMMANDS.map((entry) => entry.command)
      );
      expect(lines[0].textContent).toBe(
        'docker run --rm -it -v ${PWD}:/workspace ghcr.io/hybridcloudworks/hcw-lab:latest'
      );
      expect(lines[1].textContent).toBe(
        'docker run --rm -it -v "$PWD":/workspace ghcr.io/hybridcloudworks/hcw-lab:latest'
      );
    }
    await screen.findByText(NOT_PROVISIONED_SENTENCE);
  });

  it('holds the two later sections as headed slots that promise nothing', async () => {
    fetchLabsEstate.mockResolvedValue({ configured: false });
    fetchCoderStatus.mockResolvedValue({ configured: false });
    renderPage();

    const agent = screen.getByTestId('labs-slot-agent');
    expect(within(agent).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Run an agent against your landing zone'
    );
    expect(agent).toHaveTextContent('#676');
    const articles = screen.getByTestId('labs-slot-articles');
    expect(within(articles).getByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(articles).toHaveTextContent('#677');
    await screen.findByText(NOT_PROVISIONED_SENTENCE);
  });

  it('links back to the Learn index', async () => {
    fetchLabsEstate.mockResolvedValue({ configured: false });
    fetchCoderStatus.mockResolvedValue({ configured: false });
    renderPage();
    expect(screen.getByRole('link', { name: 'Learn any cloud' })).toHaveAttribute(
      'href',
      '/education'
    );
    await screen.findByText(NOT_PROVISIONED_SENTENCE);
  });
});
