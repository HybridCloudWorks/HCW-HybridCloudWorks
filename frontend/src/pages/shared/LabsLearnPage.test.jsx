/**
 * `/education/labs` (#681): the cards come from the catalogue and nothing
 * else, every card opens its own lab's pane page (#751), the two "Run it
 * locally" lines are exactly the two from #658, the two status cards say the
 * two explicit unprovisioned sentences when both routes answer
 * `{ configured: false }` — and render full data when they answer with it —
 * the agent slot holds the sandbox section (#676) rather than a promise, a
 * tab returning from GitHub sign-in goes on to the pane it came from, Coder
 * is credited beside the intro, and nothing claims the host is onboarded to
 * Azure Arc before it is (#663).
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUN_LOCALLY_COMMANDS, labs } from '@/data/labs/catalogue';
import {
  SIGN_IN_PENDING_KEY,
  markSignInStarted,
  readSignedInAt,
} from '@/components/labs/labSignIn';
import { NOT_PROVISIONED_SENTENCE } from '@/components/labs/LabsEstateCard';
import { CODER_NOT_PROVISIONED_SENTENCE } from '@/components/labs/CoderStatusCard';
import { SANDBOX_COMMANDS } from '@/components/labs/SandboxSection';

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
  window.localStorage.clear();
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

  it('sends each card to its own lab’s pane page on the site', async () => {
    fetchLabsEstate.mockResolvedValue({ configured: false });
    fetchCoderStatus.mockResolvedValue({ configured: false });
    const { container } = renderPage();

    for (const lab of labs) {
      const card = container.querySelector(`li[data-lab="${lab.id}"]`);
      const link = within(card).getByRole('link', { name: /open lab workspace/i });
      expect(link).toHaveAttribute('href', `/education/labs/${lab.id}`);
      expect(link).not.toHaveAttribute('target');
    }
    // Since #750 a top-level visit to the workspace host lands back here, so
    // the page offers no link to it, in a card or in the prose.
    const labHosts = [...container.querySelectorAll('a[href]')]
      .map((a) => new URL(a.getAttribute('href'), 'https://hybridcloudworks.com').hostname)
      .filter(
        (host) => host === 'lab.hybridcloudworks.com' || host.endsWith('.lab.hybridcloudworks.com')
      );
    expect(labHosts).toEqual([]);
    expect(container.querySelector('header')).toHaveTextContent(/Open lab workspace opens the lab/);
    await screen.findByText(NOT_PROVISIONED_SENTENCE);
  });

  it('sends a tab returning from GitHub sign-in on to the pane it started from', async () => {
    fetchLabsEstate.mockResolvedValue({ configured: false });
    fetchCoderStatus.mockResolvedValue({ configured: false });
    const [, lab] = labs;
    markSignInStarted(lab.id);
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/education/labs']}>
          <Routes>
            <Route path="/education/labs" element={<LabsLearnPage />} />
            <Route path="/education/labs/:labId" element={<p>pane for the lab</p>} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    );
    expect(await screen.findByText('pane for the lab')).toBeInTheDocument();
    expect(window.localStorage.getItem(SIGN_IN_PENDING_KEY)).toBeNull();
    expect(readSignedInAt()).toBeGreaterThanOrEqual(NOW);
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

  it('fills the agent slot with the sandbox section: three steps and the two commands', async () => {
    fetchLabsEstate.mockResolvedValue({ configured: false });
    fetchCoderStatus.mockResolvedValue({ configured: false });
    renderPage();

    const agent = screen.getByTestId('labs-slot-agent');
    expect(within(agent).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Run an agent against your landing zone'
    );
    expect(agent).not.toHaveTextContent('Coming soon');
    expect(within(agent).getAllByTestId('sandbox-step')).toHaveLength(3);
    const lines = [...agent.querySelectorAll('pre code')];
    expect(lines.map((line) => line.dataset.shell)).toEqual(['PowerShell', 'bash']);
    expect(lines.map((line) => line.textContent)).toEqual(
      SANDBOX_COMMANDS.map((entry) => entry.command)
    );
    expect(within(agent).getByTestId('sandbox-first-prompt')).toBeInTheDocument();
    expect(within(agent).getByTestId('sandbox-recipe-link')).toHaveAttribute(
      'href',
      'https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/tree/main/lab-image/sandbox-template'
    );
    await screen.findByText(NOT_PROVISIONED_SENTENCE);
  });

  it('holds the article list as a headed slot that promises nothing', async () => {
    fetchLabsEstate.mockResolvedValue({ configured: false });
    fetchCoderStatus.mockResolvedValue({ configured: false });
    renderPage();

    const articles = screen.getByTestId('labs-slot-articles');
    expect(within(articles).getByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(articles).toHaveTextContent('Coming soon.');
    // The issue that builds it is the team's to-do, not the visitor's.
    expect(articles).not.toHaveTextContent(/#\d|issue/i);
    await screen.findByText(NOT_PROVISIONED_SENTENCE);
  });

  it('credits Coder beside the intro, in the header, after the intro paragraphs', async () => {
    fetchLabsEstate.mockResolvedValue({ configured: false });
    fetchCoderStatus.mockResolvedValue({ configured: false });
    const { container } = renderPage();

    const header = container.querySelector('header');
    const credit = within(header).getByTestId('coder-credit');
    const link = within(credit).getByRole('link', { name: 'Coder (opens in a new tab)' });
    expect(link).toHaveAttribute('href', 'https://coder.com/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(credit).getByRole('img', { name: 'Coder' })).toBeInTheDocument();
    expect(credit.querySelector('.coder-cursor')).not.toBeNull();

    // The intro and the credit share one row; the intro comes first, so it
    // reads first and sits in the left column.
    const intro = within(header).getByText(/Each lab below opens in VS Code/);
    expect(intro.parentElement.nextElementSibling).toBe(credit);
    expect(intro).toHaveClass('max-w-3xl');
    await screen.findByText(NOT_PROVISIONED_SENTENCE);
  });

  it('points to the estate card for the Arc state rather than asserting the host is onboarded', async () => {
    fetchLabsEstate.mockResolvedValue({ configured: false });
    fetchCoderStatus.mockResolvedValue({ configured: false });
    const { container } = renderPage();

    const header = container.querySelector('header');
    expect(header).toHaveTextContent(
      'a single server whose Azure Arc status is on the live card further down this page.'
    );
    // Onboarding (#663) has not run: nothing on the page may say it has.
    expect(container).not.toHaveTextContent(/onboarded/i);
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
