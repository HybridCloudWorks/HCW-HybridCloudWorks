/**
 * The Azure certification detail page reads the same catalogue the landing
 * page links from, so every landing link resolves (#461 item 2), and it
 * shows the Listen & Learn block only when published audio exists.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import CertDetailPage from './CertDetailPage';
import { certifications } from '@/data/azure/certifications';
import { deriveStatus, todayIso } from '@/lib/certStatus';

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }) => <>{children}</>,
}));

const fetchPublishedEpisodes = vi.fn();

vi.mock('@/lib/listenAndLearn', () => ({
  SUPPORTED_PLATFORMS: ['azure', 'github', 'aws'],
  isSupportedPlatform: (platform) => ['azure', 'github', 'aws'].includes(platform),
  fetchPublishedEpisodes: (...args) => fetchPublishedEpisodes(...args),
}));

vi.mock('@/lib/functionsBase', () => ({
  resolveMediaUrl: (url) => url,
}));

const AB_100_EPISODES = {
  set: { id: 'azure_ab-100' },
  episodes: [
    { id: 'e1', title: 'Design the solution', areaName: 'Design', audioUrl: '/api/public/media/1' },
    { id: 'e2', title: 'Build the agents', areaName: 'Build', audioUrl: '/api/public/media/2' },
    { id: 'e3', title: 'Govern and monitor', areaName: 'Operate', audioUrl: '/api/public/media/3' },
  ],
};

function renderDetail(slug) {
  return render(
    <MemoryRouter initialEntries={[`/azure/education/${slug}`]}>
      <Routes>
        <Route path="/azure/education/:certSlug" element={<CertDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  fetchPublishedEpisodes.mockReset();
  fetchPublishedEpisodes.mockResolvedValue(null);
});

describe('CertDetailPage', () => {
  it('resolves every landing-page slug to a detail page', () => {
    // Before 2026-09-09 this page carried its own 15-entry copy of the data,
    // so 86 of the landing links opened "Certification Not Found".
    for (const cert of certifications) {
      const { unmount } = renderDetail(cert.slug);
      expect(screen.queryByText('Certification Not Found'), cert.slug).toBeNull();
      expect(screen.getByRole('heading', { level: 1 }).textContent, cert.slug).toBe(cert.title);
      unmount();
    }
  });

  it('gives the document a title made of one string, so the pre-render keeps it', () => {
    // react-helmet-async silently drops a <title> built from several JSX
    // children; the first pre-render of these routes wrote <title></title>.
    // Helmet is mocked to a fragment, and React 19 hoists a <title> rendered
    // anywhere into <head>, so the document title is the rendered string.
    renderDetail('ab-100');
    expect(document.title).toBe(
      'AB-100: Agentic AI Business Solutions Architect | Azure Education | HCW'
    );
  });

  it('still says not found for a slug the catalogue does not have', () => {
    renderDetail('dp-203');
    expect(screen.getByText('Certification Not Found')).toBeInTheDocument();
  });

  it('renders the Listen & Learn block for azure/AB-100 when episodes are published', async () => {
    fetchPublishedEpisodes.mockResolvedValue(AB_100_EPISODES);
    renderDetail('ab-100');
    expect(fetchPublishedEpisodes).toHaveBeenCalledWith({ platform: 'azure', examCode: 'AB-100' });
    expect(await screen.findByText('Listen & Learn')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^Listen: /)).toHaveLength(3);
  });

  it('puts a single-player chapter playlist in the hero alongside the full block (#498)', async () => {
    // Two surfaces for one feature, deliberately distinct: the hero says
    // "Study podcast" and labels its one <audio> "Play chapter:", so a screen
    // reader never hears "Listen & Learn" twice and the per-episode players
    // below keep their own "Listen:" labels and count.
    fetchPublishedEpisodes.mockResolvedValue(AB_100_EPISODES);
    renderDetail('ab-100');
    expect(await screen.findByText('Study podcast')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^Play chapter: /)).toHaveLength(1);
    expect(screen.getAllByLabelText(/^Listen: /)).toHaveLength(3);

    const chapters = screen.getByRole('list', { name: /chapters, in study-guide order/i });
    const buttons = chapters.querySelectorAll('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAttribute('aria-current', 'true');
    expect(buttons[1]).not.toHaveAttribute('aria-current');
  });

  it('renders the study-guide outline from the shipped data, area by area (#498)', () => {
    // AZ-104 has an outline; every area links to its own heading on Learn.
    fetchPublishedEpisodes.mockResolvedValue(null);
    renderDetail('az-104');
    // Scoped to the outline's own region: the catalogue's "Topics Covered"
    // grid above it lists the same area names for AZ-104, so an unscoped
    // text query finds two — which is the two sections doing their jobs.
    const region = screen.getByRole('region', { name: /skills measured/i });
    expect(within(region).getByText('Manage Azure identities and governance')).toBeInTheDocument();
    const deepLinks = within(region)
      .getAllByRole('link', { name: /this area on microsoft learn/i })
      .map((a) => a.getAttribute('href'));
    expect(deepLinks[0]).toBe(
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-104#manage-azure-identities-and-governance-2025'
    );
  });

  it('renders no audio control when nothing is published for the exam', async () => {
    fetchPublishedEpisodes.mockResolvedValue(null);
    renderDetail('az-104');
    expect(fetchPublishedEpisodes).toHaveBeenCalledWith({ platform: 'azure', examCode: 'AZ-104' });
    // Let the resolved fetch settle before asserting the absence.
    await screen.findByRole('heading', { level: 1 });
    await Promise.resolve();
    expect(screen.queryByText('Listen & Learn')).toBeNull();
    expect(screen.queryByLabelText(/^Listen: /)).toBeNull();
  });

  it('tells the reader when an exam is retired, and where to go instead', () => {
    renderDetail('ai-102');
    const notice = screen.getByTestId('cert-status-notice');
    expect(notice.dataset.status).toBe('retired');
    expect(notice.textContent).toMatch(/Retired by Microsoft on Jun 30, 2026/);
    expect(screen.getByRole('link', { name: /Replaced by AI-103/ })).toHaveAttribute(
      'href',
      '/azure/education/ai-103'
    );
  });

  it('tells the reader when an exam is retiring (AZ-800 → AZ-802)', () => {
    renderDetail('az-800');
    const notice = screen.getByTestId('cert-status-notice');
    expect(notice.dataset.status).toBe('expiring');
    expect(notice.textContent).toMatch(/Retires on Sep 30, 2026/);
    expect(screen.getByRole('link', { name: /Replaced by AZ-802/ })).toHaveAttribute(
      'href',
      '/azure/education/az-802'
    );
  });

  it('shows no status notice for an active exam', () => {
    const active = certifications.find((c) => deriveStatus(c, todayIso()) === 'active');
    renderDetail(active.slug);
    expect(screen.queryByTestId('cert-status-notice')).toBeNull();
  });
});
