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

vi.mock('@/hooks/usePublicData', () => ({
  usePublicData: () => ({ data: null, loading: false, error: null }),
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

// These six routes used to assert "Coming Soon". They stopped being
// placeholders when App.jsx routed them to real pages (TODO.md T-320); the
// suite is a ROUTE contract — path -> page module — so the pages are mocked
// with distinctive headings exactly like the providers above, not rendered.
vi.mock('@/pages/gcp/LandingPage', () => ({
  default: () => (
    <main>
      <h1>GCP Reference Architectures</h1>
    </main>
  ),
}));

vi.mock('@/pages/finops/LandingPage', () => ({
  default: () => (
    <main>
      <h1>FinOps Landing</h1>
    </main>
  ),
}));

vi.mock('@/pages/terraform/LandingPage', () => ({
  default: () => (
    <main>
      <h1>Terraform Landing</h1>
    </main>
  ),
}));

vi.mock('@/pages/github/LandingPage', () => ({
  default: () => (
    <main>
      <h1>GitHub Landing</h1>
    </main>
  ),
}));

vi.mock('@/pages/finops/ToolsPage', () => ({
  default: () => (
    <main>
      <h1>FinOps Tools</h1>
    </main>
  ),
}));

vi.mock('@/pages/terraform/ToolsPage', () => ({
  default: () => (
    <main>
      <h1>Terraform Tools</h1>
    </main>
  ),
}));

vi.mock('@/pages/github/ToolsPage', () => ({
  default: () => (
    <main>
      <h1>GitHub Tools</h1>
    </main>
  ),
}));

// The news routes render real RSS pages now — lazy and fetch-happy, so
// un-mocked they never resolved inside the test timeout. The mock headings
// keep the original contract text.
vi.mock('@/pages/aws/RssPage', () => ({
  default: () => (
    <main>
      <h1>AWS Cloud News</h1>
    </main>
  ),
}));

vi.mock('@/pages/azure/RssPage', () => ({
  default: () => (
    <main>
      <h1>Azure Platform News</h1>
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
    ['/gcp', /GCP Reference Architectures/i],
    ['/finops', /FinOps Landing/i],
    ['/terraform', /Terraform Landing/i],
    ['/github', /GitHub Landing/i],
    ['/vmware', /VMware Reference Architectures/i],
    ['/ansible', /Automation intelligence with Ansible/i],
    ['/aws/blog', /AWS Architecture Blog/i],
    ['/azure/blog', /Azure Cloud Insights/i],
    ['/aws/news', /AWS Cloud News/i],
    ['/azure/news', /Azure Platform News/i],
    ['/finops/tools', /FinOps Tools/i],
    ['/terraform/tools', /Terraform Tools/i],
    ['/github/tools', /GitHub Tools/i],
  ])('renders live public route %s', async (pathname, expectedText) => {
    renderRoute(pathname);

    expect(await screen.findByText(expectedText)).toBeInTheDocument();
    expect(screen.queryByText(/PAGES Not Found/i)).not.toBeInTheDocument();
  });

  it('mounts the staging preview route instead of the provider fallback', async () => {
    // usePublicData is mocked to no data, so PreviewPage shows its own
    // unavailable view — proving /preview/:id routes there, not to /:provider.
    // Unlike the provider routes above, PreviewPage is NOT mocked, so the
    // lazy chunk loads for real — under CI load that can outrun findByText's
    // default 1 s, so this lookup gets an explicit generous timeout.
    renderRoute('/preview/some-id?t=token');

    expect(
      await screen.findByText(/Preview unavailable/i, {}, { timeout: 10000 })
    ).toBeInTheDocument();
  });
});
