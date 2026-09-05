import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VALID_PROVIDERS } from '@/context/ProviderContext';

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
  useNewsData: () => ({ articles: [], rssItems: [], loading: false }),
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

// T-762. These three were declared twice — once inside the `/:provider` block
// and once as a static top-level route rendering the identical component. The
// static declaration won, so the dispatcher branch was dead while its `:slug`
// sibling still ran, and `useProvider()` was null on them because the static
// routes sit outside ProviderLayout. The duplicates are gone; these mocks are
// what proves the surviving `/:provider` route still serves the same page.
vi.mock('@/pages/terraform/CodePage', () => ({
  default: () => (
    <main>
      <h1>Terraform Code</h1>
    </main>
  ),
}));

vi.mock('@/pages/github/CodePage', () => ({
  default: () => (
    <main>
      <h1>GitHub Code</h1>
    </main>
  ),
}));

vi.mock('@/pages/finops/ArchitecturePage', () => ({
  default: () => (
    <main>
      <h1>FinOps Architectures</h1>
    </main>
  ),
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
    // The three whose duplicate static declarations were removed (T-762).
    // They must still resolve — now through the `/:provider` dispatcher, and
    // therefore inside ProviderLayout, which is the point.
    ['/terraform/code', /Terraform Code/i],
    ['/github/code', /GitHub Code/i],
    ['/finops/architecture-designs', /FinOps Architectures/i],
    // The non-duplicate sibling, kept, and asserted so removing the duplicate
    // cannot be mistaken for removing this.
    ['/finops/architectures', /FinOps Architectures/i],
  ])('renders live public route %s', async (pathname, expectedText) => {
    renderRoute(pathname);

    expect(await screen.findByText(expectedText)).toBeInTheDocument();
    expect(screen.queryByText(/PAGES Not Found/i)).not.toBeInTheDocument();
  });

  describe('route declarations (T-762)', () => {
    // Read as text, because the failure is a *declaration* problem. React
    // Router resolves a shadowed route silently by ranking: both render
    // correctly in isolation and only one is ever reachable, so nothing
    // observed at runtime can see the other. A rendering test passes either
    // way — which is exactly why this went unnoticed.
    const source = () => readFileSync(join(process.cwd(), 'src', 'App.jsx'), 'utf8');

    /** Every `path="..."` on a <Route>, absolute and relative alike. */
    const allPaths = (src) => [...src.matchAll(/<Route\s+path="([^"]*)"/g)].map((m) => m[1]);

    /** Relative children of the `/:provider` block — `blog`, `code`, `code/:slug`. */
    const providerChildren = (src) => allPaths(src).filter((p) => !p.startsWith('/') && p !== '*');

    it('declares no absolute path twice', () => {
      const declared = allPaths(source()).filter((p) => p.startsWith('/'));
      expect(declared.length).toBeGreaterThan(10); // the regex still matches something

      const seen = new Set();
      const duplicates = [
        ...new Set(
          declared.filter((path) => {
            if (seen.has(path)) return true;
            seen.add(path);
            return false;
          })
        ),
      ];
      expect(duplicates, 'declared more than once — the later one is unreachable').toEqual([]);
    });

    it('declares no absolute route that shadows a /:provider child', () => {
      // THE shape of T-762, and the one the first version of this guard
      // missed. `/terraform/code` is not a duplicate of any other absolute
      // path — it duplicates the RELATIVE `code` child of `/:provider`, and a
      // static segment outranks a parameter, so the static route wins.
      //
      // What that costs is not redundancy. The dispatcher's matching branch
      // becomes unreachable while its `:slug` sibling keeps running, so one URL
      // family is served by two code paths; and the static declaration sits
      // outside ProviderLayout, so `useProvider()` is null on exactly those
      // paths and populated on their neighbours.
      const src = source();
      const children = new Set(providerChildren(src));
      expect(children.size).toBeGreaterThan(5); // the block was actually found

      const shadowing = allPaths(src)
        .filter((p) => p.startsWith('/'))
        .map((p) => p.slice(1).split('/'))
        .filter(([provider, ...rest]) => VALID_PROVIDERS.includes(provider) && rest.length > 0)
        .map(([provider, ...rest]) => ({ path: `/${provider}/${rest.join('/')}`, rest }))
        .filter(({ rest }) => children.has(rest.join('/')))
        .map(({ path }) => path);

      expect(
        [...new Set(shadowing)],
        'shadows a /:provider child route: the static path wins, so the dispatcher branch ' +
          'is dead and useProvider() is null here but populated on adjacent routes. ' +
          'Serve it through the /:provider block instead.'
      ).toEqual([]);
    });
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
