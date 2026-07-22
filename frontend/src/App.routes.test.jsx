import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }) => <>{children}</>,
}));

vi.mock('@/hooks/usePodcastData', () => ({
  default: () => ({ episodes: [] }),
}));

vi.mock('@/hooks/useBlogData', () => ({
  useBlogData: () => ({ posts: [], loading: false, error: null }),
}));

vi.mock('@/hooks/useNewsData', () => ({
  useNewsData: () => ({ articles: [], rssItems: [], insights: [], loading: false }),
}));

vi.mock('@/hooks/useFirestore', () => ({
  useFirestoreCollection: () => ({ data: [], loading: false, error: null }),
}));

vi.mock('@/components/landing/ProviderLatestContentPanel', () => ({
  default: ({ provider }) => <div>Latest Content Panel {provider}</div>,
}));

vi.mock('@/components/shared/ProviderBlogPage', () => ({
  default: ({ title, provider }) => (
    <main>
      <h1>{title}</h1>
      <p>{provider} blog route ready</p>
    </main>
  ),
}));

vi.mock('@/hooks/useAdminAuth', () => ({
  useAdminAuth: () => ({ isAdmin: false }),
}));

vi.mock('@/pages/vmware/LandingPage', () => ({
  default: () => (
    <main>
      <h1>VMware Reference Architectures</h1>
    </main>
  ),
}));

vi.mock('@/pages/ansible/LandingPage', () => ({
  default: () => (
    <main>
      <h1>Automation intelligence with Ansible</h1>
    </main>
  ),
}));

vi.mock('@/pages/aws/LandingPage', () => ({
  default: () => (
    <main>
      <h1>AWS Reference Architectures</h1>
    </main>
  ),
}));

vi.mock('@/pages/azure/LandingPage', () => ({
  default: () => (
    <main>
      <h1>Azure Reference Architectures</h1>
    </main>
  ),
}));

vi.mock('@/components/animations', () => ({
  ScrollTrigger: ({ children }) => children,
}));

vi.mock('@/components/news/CuratedArticlesGrid', () => ({
  default: () => <div>Curated Articles Grid</div>,
}));

vi.mock('@/components/news/RssFeedTimeline', () => ({
  default: () => <div>RSS Feed Timeline</div>,
}));

vi.mock('@/components/news/AiInsightsPanel', () => ({
  default: () => <div>AI Insights Panel</div>,
}));

import AppWrapper from './App';

function renderRoute(pathname) {
  window.history.pushState({}, '', pathname);
  return render(<AppWrapper />);
}

describe('public route contract', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    window.history.pushState({}, '', '/');
  });

  it.each([
    ['/aws', /AWS Reference Architectures/i],
    ['/azure', /Azure Reference Architectures/i],
    ['/aws/blog', /AWS Architecture Blog/i],
    ['/azure/blog', /Azure Cloud Insights/i],
    ['/aws/news', /AWS Cloud News/i],
    ['/azure/news', /Azure Platform News/i],
  ])('renders live public route %s', async (pathname, expectedText) => {
    renderRoute(pathname);

    expect(await screen.findByText(expectedText, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(/PAGES Not Found/i)).not.toBeInTheDocument();
  });

  it.each([
    ['/gcp', 'Coming Soon'],
    ['/terraform', 'Coming Soon'],
    ['/github', 'Coming Soon'],
    ['/finops', 'Coming Soon'],
    ['/vmware', /VMware Reference Architectures/i],
    ['/ansible', /Automation intelligence with Ansible/i],
    ['/github/tools', 'Coming Soon'],
    ['/terraform/tools', 'Coming Soon'],
    ['/finops/tools', 'Coming Soon'],
  ])('renders approved placeholder route %s', async (pathname, expectedText) => {
    renderRoute(pathname);

    expect(await screen.findByText(expectedText, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(/PAGES Not Found/i)).not.toBeInTheDocument();
  });
});
