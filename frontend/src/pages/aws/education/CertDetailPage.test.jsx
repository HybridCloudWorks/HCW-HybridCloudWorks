/**
 * The AWS certification detail page mounts Listen & Learn the way the Azure
 * page does (#461 item 10): the block, and the audio control inside it,
 * appear only when published episodes exist for the exam, and the page asks
 * the API for `aws` — the platform the study-guide adapter is keyed on.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import AWSCertDetailPage from './CertDetailPage';
import { certifications } from '@/data/aws/certifications';

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

const CLF_C02_EPISODES = {
  set: { id: 'aws_clf-c02' },
  episodes: [
    { id: 'e1', title: 'Cloud concepts', areaName: 'Domain 1', audioUrl: '/api/public/media/1' },
    {
      id: 'e2',
      title: 'Security and compliance',
      areaName: 'Domain 2',
      audioUrl: '/api/public/media/2',
    },
  ],
};

function renderDetail(slug) {
  return render(
    <MemoryRouter initialEntries={[`/aws/education/${slug}`]}>
      <Routes>
        <Route path="/aws/education/:certSlug" element={<AWSCertDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  fetchPublishedEpisodes.mockReset();
  fetchPublishedEpisodes.mockResolvedValue(null);
});

describe('AWSCertDetailPage', () => {
  it('resolves every catalogue slug to a detail page', () => {
    for (const cert of certifications) {
      const { unmount } = renderDetail(cert.slug);
      expect(screen.queryByText('Certification Not Found'), cert.slug).toBeNull();
      expect(screen.getByRole('heading', { level: 1 }).textContent, cert.slug).toBe(cert.title);
      unmount();
    }
  });

  it('renders the Listen & Learn block for aws/CLF-C02 when episodes are published', async () => {
    fetchPublishedEpisodes.mockResolvedValue(CLF_C02_EPISODES);
    renderDetail('clf-c02');
    expect(fetchPublishedEpisodes).toHaveBeenCalledWith({ platform: 'aws', examCode: 'CLF-C02' });
    expect(await screen.findByText('Listen & Learn')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^Listen: /)).toHaveLength(2);
  });

  it('renders no audio control when nothing is published for the exam', async () => {
    fetchPublishedEpisodes.mockResolvedValue(null);
    renderDetail('saa-c03');
    expect(fetchPublishedEpisodes).toHaveBeenCalledWith({ platform: 'aws', examCode: 'SAA-C03' });
    // Let the resolved fetch settle before asserting the absence.
    await screen.findByRole('heading', { level: 1 });
    await Promise.resolve();
    expect(screen.queryByText('Listen & Learn')).toBeNull();
    expect(screen.queryByLabelText(/^Listen: /)).toBeNull();
  });
});
