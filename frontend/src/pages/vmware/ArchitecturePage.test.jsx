/**
 * The one architecture page whose blueprint module is empty (issue #373).
 *
 * `/vmware/architecture-designs` is the route this change removes from
 * `sitemap.xml`, and it is removed because `architecture-blueprints.js` here
 * exports nothing and the live corpus holds no VMware architecture document.
 * The pre-render reads that module; this page has to read the SAME module, or
 * adding a blueprint would bring the URL back while the page still rendered
 * nothing — the original bug, inverted.
 *
 * So the second test is the load-bearing one: it hands the page a non-empty
 * module and requires the blueprint on screen.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import VMwareArchitecturePage from './ArchitecturePage';

// The public API returns no VMware architecture document — measured against the
// live endpoint on 2026-09-07, where `type=architecture` answered with a single
// Azure blueprint. An empty corpus is that state.
vi.mock('@/hooks/usePublicData', () => ({
  usePublicData: () => ({ data: [], loading: false, error: null, refetch: () => {} }),
}));

vi.mock('@/lib/publicApi', () => ({
  fetchPublicContentList: () => Promise.resolve([]),
  PUBLIC_CORPUS_LIMIT: 250,
}));

// What the sibling data module exports on the next render. A `let` and a
// factory, because one test needs the real (empty) export and the other needs a
// blueprint in it.
let blueprints = [];
vi.mock('./architecture-blueprints', () => ({
  get staticBlueprints() {
    return blueprints;
  },
}));

afterEach(() => {
  blueprints = [];
  cleanup();
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/vmware/architecture-designs']}>
      <VMwareArchitecturePage />
    </MemoryRouter>
  );

describe('the VMware architecture page', () => {
  it('shows the empty state when neither the API nor the module has anything', () => {
    renderPage();
    // The exact copy ContentListingTemplate renders for itemType "architecture".
    expect(screen.getByText('No architectures published yet.')).toBeInTheDocument();
  });

  it('renders a blueprint from its data module, so the sitemap count means something', () => {
    blueprints = [
      {
        title: 'VMware Cloud Foundation Landing Zone',
        description: 'A management domain with NSX overlay and vSAN storage policies.',
        category: 'Networking',
        level: 'Production',
        slug: 'vcf-landing-zone',
      },
    ];
    renderPage();

    expect(screen.getByText('VMware Cloud Foundation Landing Zone')).toBeInTheDocument();
    expect(screen.queryByText('No architectures published yet.')).toBeNull();
  });
});
